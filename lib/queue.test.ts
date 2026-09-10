import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BACKOFF_MINUTES,
  authoriseCronRequest,
  planSettlement,
} from "@/lib/queue";
import type { FailReason } from "@/lib/types";

/**
 * Both halves of this file are the parts of Slice 7 that a deployed run does
 * not prove. The cron 401 is verified from outside with curl, but only for one
 * shaped request; the backoff schedule is verified live only for whichever
 * attempt happened to fail on the day. These pin the rest.
 *
 * Neither test touches the network, the database or the wall clock.
 */

const T0 = Date.parse("2026-09-10T12:00:00.000Z");
const MINUTE = 60_000;

// Not a secret: a literal that exists only inside this test process, chosen to
// be obviously fake so nobody mistakes it for a value that was ever deployed.
const SECRET = "cron-secret-for-tests-only";

describe("authoriseCronRequest", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  function ask(
    authorization?: string,
  ): ReturnType<typeof authoriseCronRequest> {
    const headers = new Headers();
    if (authorization !== undefined) {
      headers.set("authorization", authorization);
    }
    return authoriseCronRequest(
      new Request("https://example.test/api/cron", {
        headers,
      }),
    );
  }

  it("accepts the bearer token Vercel sends", () => {
    expect(ask(`Bearer ${SECRET}`)).toBe("authorised");
  });

  it("accepts the scheme case-insensitively", () => {
    // RFC 7235 says the scheme is case-insensitive, and a 401 that depends on
    // how a caller capitalised "bearer" is a support ticket, not a defence.
    expect(ask(`bearer ${SECRET}`)).toBe("authorised");
  });

  it("rejects a request with no Authorization header at all", () => {
    // This is the case the ROADMAP asks to be verified with curl. It is also
    // the one that matters: an unauthenticated cron route is a public endpoint
    // anyone can invoke as fast as they like.
    expect(ask()).toBe("unauthorised");
  });

  it("rejects an empty header, a bare scheme and a bare token", () => {
    expect(ask("")).toBe("unauthorised");
    expect(ask("Bearer")).toBe("unauthorised");
    expect(ask("Bearer   ")).toBe("unauthorised");
    expect(ask(SECRET)).toBe("unauthorised");
  });

  it("rejects another scheme carrying the right secret", () => {
    expect(ask(`Basic ${SECRET}`)).toBe("unauthorised");
  });

  it("rejects a wrong secret, including a prefix of the right one", () => {
    expect(ask("Bearer nope")).toBe("unauthorised");
    expect(ask(`Bearer ${SECRET.slice(0, -1)}`)).toBe("unauthorised");
    expect(ask(`Bearer ${SECRET} `)).toBe("authorised"); // trailing space trimmed
    expect(ask(`Bearer x${SECRET}`)).toBe("unauthorised");
  });

  it("refuses to run at all when the secret is not configured", () => {
    // Not "allow when unset". A deployment missing CRON_SECRET must fail
    // closed and loudly; an open cron route that returns 200 looks healthy.
    delete process.env.CRON_SECRET;
    expect(ask(`Bearer ${SECRET}`)).toBe("misconfigured");

    process.env.CRON_SECRET = "";
    expect(ask("Bearer ")).toBe("misconfigured");
  });
});

describe("planSettlement", () => {
  const MAX = 3;

  it("waits one minute after the first failed attempt", () => {
    const settled = planSettlement("unreachable", 1, MAX, T0);

    expect(settled).toEqual({
      kind: "retry",
      runAfter: new Date(T0 + BACKOFF_MINUTES[0] * MINUTE),
    });
  });

  it("waits five minutes after the second", () => {
    const settled = planSettlement("server_error", 2, MAX, T0);

    expect(settled).toEqual({
      kind: "retry",
      runAfter: new Date(T0 + BACKOFF_MINUTES[1] * MINUTE),
    });
  });

  it("gives up once the attempts are spent", () => {
    // The user gets a final answer roughly six minutes after saving, with the
    // retry button the taxonomy allows, rather than half an hour of spinner.
    expect(planSettlement("unreachable", MAX, MAX, T0)).toEqual({
      kind: "failed",
    });
  });

  it("walks further down the schedule when max_attempts is raised", () => {
    expect(planSettlement("unreachable", 3, 5, T0)).toEqual({
      kind: "retry",
      runAfter: new Date(T0 + BACKOFF_MINUTES[2] * MINUTE),
    });
  });

  it("holds at the last step rather than running off the end", () => {
    expect(planSettlement("unreachable", 9, 20, T0)).toEqual({
      kind: "retry",
      runAfter: new Date(
        T0 + BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1] * MINUTE,
      ),
    });
  });

  it("never retries a 404", () => {
    // ARCHITECTURE section 10: a 404 will still be a 404 in twenty-five
    // minutes. Retrying it is someone else's server paying for our optimism.
    expect(planSettlement("not_found", 1, MAX, T0)).toEqual({ kind: "failed" });
  });

  it("retries only the two transient reasons", () => {
    const everyReason: FailReason[] = [
      "blocked_url",
      "unreachable",
      "not_found",
      "forbidden",
      "paywalled",
      "too_large",
      "unsupported_type",
      "js_required",
      "no_content",
      "server_error",
    ];

    const retried = everyReason.filter(
      (reason) => planSettlement(reason, 1, MAX, T0).kind === "retry",
    );

    expect(retried).toEqual(["unreachable", "server_error"]);
  });
});
