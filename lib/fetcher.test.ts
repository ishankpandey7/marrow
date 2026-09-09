import { describe, expect, it } from "vitest";

import { APP_NAME } from "@/lib/constants";
import {
  CONNECT_TIMEOUT_MS,
  MAX_BYTES,
  MAX_REDIRECTS,
  TOTAL_TIMEOUT_MS,
  buildUserAgent,
  fetchPage,
  type FetchOutcome,
  type FetchPageOptions,
  type LookupResult,
  type Transport,
  type TransportRequest,
} from "@/lib/fetcher";

/**
 * Written before the implementation. This file is the only thing standing
 * between a string a stranger typed and a server-side request made from inside
 * our hosting provider's network, so every guard in ARCHITECTURE.md section 5
 * gets a test that fails if the guard is deleted.
 *
 * Nothing here touches the network. DNS and the transport are injected, which
 * is the reason both are parameters of fetchPage rather than imports inside it.
 */

const PUBLIC_IP = "93.184.216.34";
const PUBLIC_IPV6 = "2606:2800:220:1:248:1893:25c8:1946";

const encoder = new TextEncoder();

interface Stub {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array[];
  /** The socket never answers. Resolves only when the fetcher gives up. */
  hang?: true;
  /** Connection refused, TLS failure, socket reset. */
  error?: Error;
}

interface Harness {
  transport: Transport;
  calls: TransportRequest[];
  /** Body chunks the fetcher actually pulled, per URL. Proves the stream aborts. */
  pulled: Record<string, number>;
}

function harness(routes: Record<string, Stub>): Harness {
  const calls: TransportRequest[] = [];
  const pulled: Record<string, number> = {};

  const transport: Transport = async (request) => {
    calls.push(request);
    const stub = routes[request.url];
    if (!stub) {
      throw new Error(`no stub for ${request.url}`);
    }
    if (stub.error) {
      throw stub.error;
    }
    if (stub.hang) {
      return await new Promise<never>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(abortError()), {
          once: true,
        });
      });
    }

    const parts =
      typeof stub.body === "string"
        ? [encoder.encode(stub.body)]
        : (stub.body ?? []);

    async function* body(): AsyncGenerator<Uint8Array> {
      for (const part of parts) {
        if (request.signal.aborted) {
          throw abortError();
        }
        pulled[request.url] = (pulled[request.url] ?? 0) + 1;
        yield part;
      }
    }

    return {
      status: stub.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...stub.headers },
      body: body(),
    };
  };

  return { transport, calls, pulled };
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

/** DNS, injected. An unlisted host fails to resolve, exactly as it would live. */
function dns(map: Record<string, string[]>) {
  return async (hostname: string): Promise<LookupResult[]> => {
    const addresses = map[hostname];
    if (!addresses) {
      const error: NodeJS.ErrnoException = new Error("getaddrinfo ENOTFOUND");
      error.code = "ENOTFOUND";
      throw error;
    }
    return addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
  };
}

/** The common case: one public host serving one small HTML page. */
function publicPage(body = "<html><body><p>Hello.</p></body></html>") {
  const { transport, calls, pulled } = harness({
    "https://example.com/post": { body },
  });
  return {
    transport,
    calls,
    pulled,
    lookup: dns({ "example.com": [PUBLIC_IP] }),
  };
}

/**
 * Every call goes through here. The real default User-Agent is built from
 * NEXT_PUBLIC_SITE_URL, and an offline suite that reads the environment is one
 * unset variable away from failing for a reason that has nothing to do with
 * the code. buildUserAgent is pure and is tested on its own below.
 */
const TEST_USER_AGENT = "Marrow/1.0 (read-it-later; +https://marrow.test)";

function run(url: string, options: FetchPageOptions): Promise<FetchOutcome> {
  return fetchPage(url, { userAgent: TEST_USER_AGENT, ...options });
}

function expectBlocked(outcome: FetchOutcome) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("expected a blocked outcome");
  expect(outcome.reason).toBe("blocked_url");
}

function expectFailure(outcome: FetchOutcome, reason: string) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("expected a failed outcome");
  expect(outcome.reason).toBe(reason);
}

// ---------------------------------------------------------------------------
// Guard 1 — scheme allowlist
// ---------------------------------------------------------------------------

describe("scheme allowlist", () => {
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/post",
    "gopher://example.com:70/1",
    "data:text/html,<h1>hi</h1>",
    "javascript:fetch('http://169.254.169.254/')",
    "blob:https://example.com/uuid",
    "ws://example.com/socket",
  ])("refuses %s", async (url) => {
    const { transport, calls } = publicPage();
    const outcome = await run(url, { transport, lookup: dns({}) });

    expectBlocked(outcome);
    // Refused before anything resolved or connected: a scheme check that runs
    // after the socket opens has already lost.
    expect(calls).toEqual([]);
  });

  it("accepts http and https", async () => {
    const { transport, lookup } = publicPage();
    const outcome = await run("https://example.com/post", {
      transport,
      lookup,
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a string that is not a URL at all", async () => {
    const { transport } = publicPage();
    const outcome = await run("not a url", {
      transport,
      lookup: dns({}),
    });
    expectBlocked(outcome);
  });
});

// ---------------------------------------------------------------------------
// Guard 2 — no embedded credentials
// ---------------------------------------------------------------------------

describe("embedded credentials", () => {
  it.each([
    "https://user:secret@example.com/post",
    "https://user@example.com/post",
    "https://:secret@example.com/post",
  ])("refuses %s", async (url) => {
    const { transport, lookup, calls } = publicPage();
    const outcome = await run(url, { transport, lookup });

    expectBlocked(outcome);
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Guard 3 — port allowlist
// ---------------------------------------------------------------------------

describe("port allowlist", () => {
  it.each([
    "https://example.com:8080/post",
    "http://example.com:22/post",
    "http://example.com:6379/post",
    "http://example.com:25/post",
    "http://example.com:11211/post",
  ])("refuses %s", async (url) => {
    const { transport, lookup, calls } = publicPage();
    const outcome = await run(url, { transport, lookup });

    expectBlocked(outcome);
    expect(calls).toEqual([]);
  });

  it("allows the default ports whether or not they are spelled out", async () => {
    const { transport } = harness({
      "https://example.com/post": { body: "<p>ok</p>" },
      "http://example.com/post": { body: "<p>ok</p>" },
    });
    const lookup = dns({ "example.com": [PUBLIC_IP] });

    expect(
      (await run("https://example.com:443/post", { transport, lookup })).ok,
    ).toBe(true);
    expect(
      (await run("http://example.com:80/post", { transport, lookup })).ok,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard 4 — hostname denylist
// ---------------------------------------------------------------------------

describe("hostname denylist", () => {
  it.each([
    "http://localhost/post",
    "http://LOCALHOST/post",
    "http://localhost./post",
    "http://printer.local/status",
    "http://vault.internal/secret",
    "http://app.localhost/post",
    "http://nas.home.arpa/post",
    "http://metadata.google.internal/computeMetadata/v1/",
  ])("refuses %s", async (url) => {
    const { transport, calls } = publicPage();
    const outcome = await run(url, { transport, lookup: dns({}) });

    expectBlocked(outcome);
    // The denylist is checked before DNS, so a host we will never fetch never
    // becomes a lookup someone can observe.
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Guards 5 and 6 — resolve, then judge every address
// ---------------------------------------------------------------------------

describe("blocked IPv4 ranges", () => {
  it.each([
    ["0.0.0.0/8", "0.0.0.1"],
    ["10.0.0.0/8", "10.0.0.7"],
    ["100.64.0.0/10 (CGNAT)", "100.64.0.1"],
    ["127.0.0.0/8 (loopback)", "127.0.0.1"],
    ["127.0.0.0/8 (a second loopback address)", "127.1.2.3"],
    ["169.254.0.0/16 (cloud metadata)", "169.254.169.254"],
    ["172.16.0.0/12", "172.16.0.1"],
    ["172.16.0.0/12 (top of range)", "172.31.255.254"],
    ["192.0.0.0/24", "192.0.0.1"],
    ["192.0.2.0/24", "192.0.2.5"],
    ["192.168.0.0/16", "192.168.1.1"],
    ["198.18.0.0/15", "198.18.0.1"],
    ["224.0.0.0/4 (multicast)", "224.0.0.1"],
    ["240.0.0.0/4 (reserved)", "240.0.0.1"],
    ["255.255.255.255/32 (broadcast)", "255.255.255.255"],
  ])("refuses a host resolving into %s", async (_range, address) => {
    const { transport, calls } = publicPage();
    const outcome = await run("https://evil.example/post", {
      transport,
      lookup: dns({ "evil.example": [address] }),
    });

    expectBlocked(outcome);
    expect(calls).toEqual([]);
  });

  it.each([
    ["9.255.255.255", "just below 10/8"],
    ["11.0.0.1", "just above 10/8"],
    ["172.15.255.255", "just below 172.16/12"],
    ["172.32.0.1", "just above 172.16/12"],
    ["100.63.255.255", "just below the CGNAT block"],
    ["100.128.0.1", "just above the CGNAT block"],
    ["169.253.255.255", "just below link-local"],
    ["223.255.255.255", "just below multicast"],
  ])("still allows %s (%s)", async (address) => {
    const { transport } = harness({
      "https://news.example/post": { body: "<p>ok</p>" },
    });
    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [address] }),
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses an IPv4 literal in the URL, in any spelling", async () => {
    const { transport } = publicPage();
    // The WHATWG parser normalises 2130706433 and 0x7f.0.0.1 to 127.0.0.1
    // before we ever see the hostname, so one range check catches all three.
    for (const url of [
      "http://127.0.0.1/post",
      "http://2130706433/post",
      "http://0x7f.0.0.1/post",
    ]) {
      expectBlocked(await run(url, { transport, lookup: dns({}) }));
    }
  });

  it("refuses when only one of several addresses is private", async () => {
    // A hostname with one public and one private A record is an attack, not a
    // coincidence: whichever the resolver hands the socket, we lose.
    const { transport, calls } = publicPage();
    const outcome = await run("https://split.example/post", {
      transport,
      lookup: dns({ "split.example": [PUBLIC_IP, "10.0.0.7"] }),
    });

    expectBlocked(outcome);
    expect(calls).toEqual([]);
  });

  it("refuses when DNS returns nothing at all", async () => {
    const { transport } = publicPage();
    const outcome = await run("https://empty.example/post", {
      transport,
      lookup: async () => [],
    });
    expectBlocked(outcome);
  });
});

describe("blocked IPv6 ranges", () => {
  it.each([
    ["loopback", "::1"],
    ["unspecified", "::"],
    ["unique local fc00::/7", "fc00::1"],
    ["unique local fd00::/8", "fd12:3456:789a::1"],
    ["link local fe80::/10", "fe80::1"],
    ["link local with a zone", "fe80::1%eth0"],
    ["multicast ff00::/8", "ff02::1"],
  ])("refuses a host resolving to %s", async (_label, address) => {
    const { transport, calls } = publicPage();
    const outcome = await run("https://evil.example/post", {
      transport,
      lookup: dns({ "evil.example": [address] }),
    });

    expectBlocked(outcome);
    expect(calls).toEqual([]);
  });

  it.each([
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped metadata endpoint", "::ffff:169.254.169.254"],
    ["IPv4-mapped, written as hex groups", "::ffff:7f00:1"],
    ["IPv4-compatible loopback", "::127.0.0.1"],
    ["6to4 wrapping loopback", "2002:7f00:0001::"],
    ["6to4 wrapping the metadata endpoint", "2002:a9fe:a9fe::"],
    ["NAT64 wrapping loopback", "64:ff9b::7f00:1"],
    ["NAT64 wrapping the metadata endpoint", "64:ff9b::169.254.169.254"],
  ])("unmaps and refuses %s", async (_label, address) => {
    const { transport, calls } = publicPage();
    const outcome = await run("https://evil.example/post", {
      transport,
      lookup: dns({ "evil.example": [address] }),
    });

    expectBlocked(outcome);
    expect(calls).toEqual([]);
  });

  it("refuses an IPv6 literal in the URL", async () => {
    const { transport } = publicPage();
    for (const url of [
      "http://[::1]/post",
      "http://[::ffff:127.0.0.1]/post",
      "http://[fd00::1]/post",
    ]) {
      expectBlocked(await run(url, { transport, lookup: dns({}) }));
    }
  });

  it("still allows a public IPv6 address", async () => {
    const { transport, calls } = harness({
      "https://v6.example/post": { body: "<p>ok</p>" },
    });
    const outcome = await run("https://v6.example/post", {
      transport,
      lookup: dns({ "v6.example": [PUBLIC_IPV6] }),
    });

    expect(outcome.ok).toBe(true);
    expect(calls[0].family).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Guard 7 — pin the connection to the address that was validated
// ---------------------------------------------------------------------------

describe("connection pinning", () => {
  it("hands the transport the address it validated, not the hostname", async () => {
    // Validating a name and then handing the name to the socket leaves a
    // rebinding window: public for the check, 127.0.0.1 for the connection.
    const { transport, calls, lookup } = publicPage();
    await run("https://example.com/post", { transport, lookup });

    expect(calls).toHaveLength(1);
    expect(calls[0].address).toBe(PUBLIC_IP);
    expect(calls[0].family).toBe(4);
    // The URL keeps the hostname so the Host header and TLS SNI stay correct.
    expect(new URL(calls[0].url).hostname).toBe("example.com");
  });

  it("resolves once per hop and pins each hop separately", async () => {
    const { transport, calls } = harness({
      "https://one.example/a": {
        status: 302,
        headers: { location: "https://two.example/b" },
      },
      "https://two.example/b": { body: "<p>ok</p>" },
    });

    const outcome = await run("https://one.example/a", {
      transport,
      lookup: dns({
        "one.example": ["93.184.216.34"],
        "two.example": ["151.101.1.140"],
      }),
    });

    expect(outcome.ok).toBe(true);
    expect(calls.map((call) => call.address)).toEqual([
      "93.184.216.34",
      "151.101.1.140",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Guard 8 — redirects are re-validated, every hop
// ---------------------------------------------------------------------------

describe("redirects", () => {
  it("refuses a public host that redirects to 127.0.0.1", async () => {
    // The single most common bypass: every guard above is undone by one header
    // on someone else's server unless each hop is re-checked from scratch.
    const { transport, calls } = harness({
      "https://innocent.example/go": {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      },
    });

    const outcome = await run("https://innocent.example/go", {
      transport,
      lookup: dns({ "innocent.example": [PUBLIC_IP] }),
    });

    expectBlocked(outcome);
    expect(calls.map((call) => call.url)).toEqual([
      "https://innocent.example/go",
    ]);
  });

  it("refuses a redirect to the cloud metadata endpoint", async () => {
    const { transport, calls } = harness({
      "https://innocent.example/go": {
        status: 301,
        headers: { location: "http://169.254.169.254/latest/meta-data/iam/" },
      },
    });

    const outcome = await run("https://innocent.example/go", {
      transport,
      lookup: dns({ "innocent.example": [PUBLIC_IP] }),
    });

    expectBlocked(outcome);
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect to a hostname that resolves privately", async () => {
    const { transport, calls } = harness({
      "https://innocent.example/go": {
        status: 307,
        headers: { location: "https://internal.example/admin" },
      },
    });

    const outcome = await run("https://innocent.example/go", {
      transport,
      lookup: dns({
        "innocent.example": [PUBLIC_IP],
        "internal.example": ["10.1.2.3"],
      }),
    });

    expectBlocked(outcome);
    expect(calls).toHaveLength(1);
  });

  it("refuses a redirect that changes scheme to file:", async () => {
    const { transport } = harness({
      "https://innocent.example/go": {
        status: 302,
        headers: { location: "file:///etc/passwd" },
      },
    });

    expectBlocked(
      await run("https://innocent.example/go", {
        transport,
        lookup: dns({ "innocent.example": [PUBLIC_IP] }),
      }),
    );
  });

  it("refuses a redirect to a non-default port", async () => {
    const { transport } = harness({
      "https://innocent.example/go": {
        status: 302,
        headers: { location: "http://innocent.example:6379/" },
      },
    });

    expectBlocked(
      await run("https://innocent.example/go", {
        transport,
        lookup: dns({ "innocent.example": [PUBLIC_IP] }),
      }),
    );
  });

  it("resolves a relative Location against the URL of the current hop", async () => {
    const { transport, calls } = harness({
      "https://news.example/old/story": {
        status: 301,
        headers: { location: "../new/story" },
      },
      "https://news.example/new/story": { body: "<p>moved</p>" },
    });

    const outcome = await run("https://news.example/old/story", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      "https://news.example/old/story",
      "https://news.example/new/story",
    ]);
  });

  it("follows exactly three hops", async () => {
    const { transport, calls } = harness({
      "https://news.example/1": {
        status: 302,
        headers: { location: "https://news.example/2" },
      },
      "https://news.example/2": {
        status: 302,
        headers: { location: "https://news.example/3" },
      },
      "https://news.example/3": {
        status: 302,
        headers: { location: "https://news.example/4" },
      },
      "https://news.example/4": { body: "<p>arrived</p>" },
    });

    const outcome = await run("https://news.example/1", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("refuses a chain longer than three hops", async () => {
    const { transport, calls } = harness({
      "https://news.example/1": {
        status: 302,
        headers: { location: "https://news.example/2" },
      },
      "https://news.example/2": {
        status: 302,
        headers: { location: "https://news.example/3" },
      },
      "https://news.example/3": {
        status: 302,
        headers: { location: "https://news.example/4" },
      },
      "https://news.example/4": {
        status: 302,
        headers: { location: "https://news.example/5" },
      },
      "https://news.example/5": { body: "<p>never reached</p>" },
    });

    const outcome = await run("https://news.example/1", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expectBlocked(outcome);
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("refuses a redirect loop", async () => {
    const { transport } = harness({
      "https://news.example/a": {
        status: 302,
        headers: { location: "https://news.example/b" },
      },
      "https://news.example/b": {
        status: 302,
        headers: { location: "https://news.example/a" },
      },
    });

    expectBlocked(
      await run("https://news.example/a", {
        transport,
        lookup: dns({ "news.example": [PUBLIC_IP] }),
      }),
    );
  });

  it("refuses a redirect with no Location header", async () => {
    const { transport } = harness({
      "https://news.example/go": { status: 302 },
    });

    expectBlocked(
      await run("https://news.example/go", {
        transport,
        lookup: dns({ "news.example": [PUBLIC_IP] }),
      }),
    );
  });

  it("reports the final URL, not the one the user typed", async () => {
    const { transport } = harness({
      "https://short.example/abc": {
        status: 301,
        headers: { location: "https://news.example/the-real-story" },
      },
      "https://news.example/the-real-story": { body: "<p>ok</p>" },
    });

    const outcome = await run("https://short.example/abc", {
      transport,
      lookup: dns({
        "short.example": [PUBLIC_IP],
        "news.example": [PUBLIC_IP],
      }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a successful outcome");
    expect(outcome.page.url).toBe("https://news.example/the-real-story");
  });
});

// ---------------------------------------------------------------------------
// Guard 9 — size cap, enforced on the stream
// ---------------------------------------------------------------------------

describe("size cap", () => {
  const megabyte = () => new Uint8Array(1024 * 1024);

  it("accepts a body exactly at the cap", async () => {
    const { transport } = harness({
      "https://big.example/post": { body: [new Uint8Array(MAX_BYTES)] },
    });

    const outcome = await run("https://big.example/post", {
      transport,
      lookup: dns({ "big.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a successful outcome");
    expect(outcome.page.bytes).toBe(MAX_BYTES);
  });

  it("refuses one byte over the cap", async () => {
    const { transport } = harness({
      "https://big.example/post": { body: [new Uint8Array(MAX_BYTES + 1)] },
    });

    const outcome = await run("https://big.example/post", {
      transport,
      lookup: dns({ "big.example": [PUBLIC_IP] }),
    });

    expectFailure(outcome, "too_large");
  });

  it("aborts mid-stream rather than buffering the whole body first", async () => {
    const { transport, pulled } = harness({
      "https://big.example/post": {
        body: Array.from({ length: 20 }, megabyte),
      },
    });

    const outcome = await run("https://big.example/post", {
      transport,
      lookup: dns({ "big.example": [PUBLIC_IP] }),
    });

    expectFailure(outcome, "too_large");
    // Six 1 MB chunks are what it takes to exceed 5 MB. Pulling the other
    // fourteen would mean the cap is a post-hoc check on a buffer we have
    // already paid for.
    expect(pulled["https://big.example/post"]).toBe(6);
  });

  it("ignores a Content-Length that undersells the body", async () => {
    // Content-Length is supplied by the party we are defending against.
    const { transport } = harness({
      "https://liar.example/post": {
        headers: { "content-length": "42" },
        body: Array.from({ length: 8 }, megabyte),
      },
    });

    const outcome = await run("https://liar.example/post", {
      transport,
      lookup: dns({ "liar.example": [PUBLIC_IP] }),
    });

    expectFailure(outcome, "too_large");
  });

  it("ignores a Content-Length that oversells a small body", async () => {
    // The mirror image: refusing on the header alone throws away a page that
    // is actually forty bytes long.
    const { transport } = harness({
      "https://liar.example/post": {
        headers: { "content-length": "999999999" },
        body: "<p>tiny</p>",
      },
    });

    const outcome = await run("https://liar.example/post", {
      transport,
      lookup: dns({ "liar.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
  });

  it("caps at five megabytes", () => {
    expect(MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Guard 10 — timeouts
// ---------------------------------------------------------------------------

describe("timeouts", () => {
  it("gives up on a host that accepts the connection and says nothing", async () => {
    const { transport } = harness({
      "https://slow.example/post": { hang: true },
    });

    const outcome = await run("https://slow.example/post", {
      transport,
      lookup: dns({ "slow.example": [PUBLIC_IP] }),
      totalTimeoutMs: 25,
    });

    expectFailure(outcome, "unreachable");
  });

  it("gives up on a body that never ends", async () => {
    // One byte a minute must not hold a serverless function open until the
    // platform kills it.
    const transport: Transport = async (request) => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: {
        async *[Symbol.asyncIterator]() {
          yield encoder.encode("<p>");
          await new Promise<void>((resolve) => {
            request.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          throw abortError();
        },
      },
    });

    const outcome = await run("https://slow.example/post", {
      transport,
      lookup: dns({ "slow.example": [PUBLIC_IP] }),
      totalTimeoutMs: 25,
    });

    expectFailure(outcome, "unreachable");
  });

  it("spends the budget across the whole chain, not per hop", async () => {
    const { transport } = harness({
      "https://news.example/1": {
        status: 302,
        headers: { location: "https://news.example/2" },
      },
      "https://news.example/2": { hang: true },
    });

    const outcome = await run("https://news.example/1", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
      totalTimeoutMs: 25,
    });

    expectFailure(outcome, "unreachable");
  });

  it("passes the connect timeout down to the transport", async () => {
    const { transport, calls, lookup } = publicPage();
    await run("https://example.com/post", { transport, lookup });

    expect(calls[0].connectTimeoutMs).toBe(CONNECT_TIMEOUT_MS);
  });

  it("budgets ten seconds in total and five to connect", () => {
    expect(TOTAL_TIMEOUT_MS).toBe(10_000);
    expect(CONNECT_TIMEOUT_MS).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Guard 11 — Content-Type allowlist
// ---------------------------------------------------------------------------

describe("content type allowlist", () => {
  it.each([
    "text/html",
    "text/html; charset=utf-8",
    "TEXT/HTML;CHARSET=UTF-8",
    "application/xhtml+xml",
    "text/plain; charset=iso-8859-1",
  ])("accepts %s", async (contentType) => {
    const { transport } = harness({
      "https://news.example/post": {
        headers: { "content-type": contentType },
        body: "<p>ok</p>",
      },
    });

    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
  });

  it.each([
    "application/pdf",
    "image/png",
    "video/mp4",
    "application/json",
    "application/octet-stream",
    "text/css",
  ])("refuses %s", async (contentType) => {
    const { transport, pulled } = harness({
      "https://news.example/file": {
        headers: { "content-type": contentType },
        body: "not html",
      },
    });

    const outcome = await run("https://news.example/file", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expectFailure(outcome, "unsupported_type");
    // Refused after the headers, before the body: downloading 700 MB of video
    // to discover it is a video is the cost this guard exists to avoid.
    expect(pulled["https://news.example/file"]).toBeUndefined();
  });

  it("refuses a response with no Content-Type at all", async () => {
    const transport: Transport = async () => ({
      status: 200,
      headers: {},
      body: (async function* () {
        yield encoder.encode("<p>hi</p>");
      })(),
    });

    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expectFailure(outcome, "unsupported_type");
  });
});

// ---------------------------------------------------------------------------
// Guard 12 — no ambient authority
// ---------------------------------------------------------------------------

describe("request headers", () => {
  it("sends no cookies, no authorization and no ambient credentials", async () => {
    const { transport, calls, lookup } = publicPage();
    await run("https://example.com/post", { transport, lookup });

    const names = Object.keys(calls[0].headers).map((name) =>
      name.toLowerCase(),
    );
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("proxy-authorization");
  });

  it("identifies itself with a product name and a contact URL", async () => {
    const agent = buildUserAgent("https://marrow.example");
    expect(agent).toContain(APP_NAME);
    expect(agent).toContain("https://marrow.example");

    const { transport, calls, lookup } = publicPage();
    await run("https://example.com/post", { transport, lookup });
    expect(calls[0].headers["user-agent"]).toBe(TEST_USER_AGENT);
  });

  it("asks for an identity encoding so the byte cap is a real cap", async () => {
    // A gzip bomb is 5 MB on the wire and gigabytes in memory. Counting wire
    // bytes only means something if the wire carries what we will parse.
    const { transport, calls, lookup } = publicPage();
    await run("https://example.com/post", { transport, lookup });

    expect(calls[0].headers["accept-encoding"]).toBe("identity");
  });
});

// ---------------------------------------------------------------------------
// Guard 13 — the failure taxonomy, and saying nothing else
// ---------------------------------------------------------------------------

describe("failure taxonomy", () => {
  it.each([
    [404, "not_found"],
    [410, "not_found"],
    [401, "forbidden"],
    [403, "forbidden"],
    [429, "forbidden"],
    [451, "forbidden"],
    [400, "forbidden"],
    [500, "unreachable"],
    [502, "unreachable"],
    [503, "unreachable"],
  ])("maps HTTP %i to %s", async (status, reason) => {
    const { transport } = harness({
      "https://news.example/post": { status, body: "<p>nope</p>" },
    });

    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expectFailure(outcome, reason);
  });

  it("maps a DNS failure to unreachable", async () => {
    const { transport } = publicPage();
    const outcome = await run("https://nowhere.example/post", {
      transport,
      lookup: dns({}),
    });

    expectFailure(outcome, "unreachable");
  });

  it("maps a refused connection to unreachable", async () => {
    const refused: NodeJS.ErrnoException = new Error("connect ECONNREFUSED");
    refused.code = "ECONNREFUSED";

    const { transport } = harness({
      "https://news.example/post": { error: refused },
    });

    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expectFailure(outcome, "unreachable");
  });

  it("never leaks the resolved address, the host or the raw error", async () => {
    // A differentiated error is a working port scanner with a nice UI. The
    // whole failure object is serialised here because the caller logs it, and
    // anything in it is one careless response body away from the user.
    const refused: NodeJS.ErrnoException = new Error(
      "connect ECONNREFUSED 10.0.0.7:6379",
    );
    refused.code = "ECONNREFUSED";

    const outcomes: FetchOutcome[] = [
      await run("https://internal.example/x", {
        transport: publicPage().transport,
        lookup: dns({ "internal.example": ["10.0.0.7"] }),
      }),
      await run("https://news.example/post", {
        transport: harness({ "https://news.example/post": { error: refused } })
          .transport,
        lookup: dns({ "news.example": [PUBLIC_IP] }),
      }),
    ];

    for (const outcome of outcomes) {
      const serialised = JSON.stringify(outcome);
      expect(serialised).not.toContain("10.0.0.7");
      expect(serialised).not.toContain("6379");
      expect(serialised).not.toContain("ECONNREFUSED");
      expect(serialised).not.toContain("internal.example");
    }
  });
});

// ---------------------------------------------------------------------------
// What a success actually returns
// ---------------------------------------------------------------------------

describe("a successful fetch", () => {
  it("returns the decoded body, the final URL, the type and the byte count", async () => {
    const html = "<html><body><h1>Headline</h1></body></html>";
    const { transport } = harness({
      "https://news.example/post": { body: html },
    });

    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a successful outcome");
    expect(outcome.page.html).toBe(html);
    expect(outcome.page.url).toBe("https://news.example/post");
    expect(outcome.page.status).toBe(200);
    expect(outcome.page.contentType).toBe("text/html");
    expect(outcome.page.bytes).toBe(encoder.encode(html).byteLength);
  });

  it("decodes a charset declared in the header", async () => {
    // 0xe9 is é in latin-1 and an invalid byte in utf-8. Getting this wrong
    // turns every accented word in a French article into a replacement glyph.
    const body = new Uint8Array([
      ...encoder.encode("<p>caf"),
      0xe9,
      ...encoder.encode("</p>"),
    ]);

    const { transport } = harness({
      "https://news.example/post": {
        headers: { "content-type": "text/html; charset=iso-8859-1" },
        body: [body],
      },
    });

    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a successful outcome");
    expect(outcome.page.html).toBe("<p>café</p>");
  });

  it("falls back to a charset declared only in the markup", async () => {
    const body = new Uint8Array([
      ...encoder.encode('<meta charset="windows-1252"><p>caf'),
      0xe9,
      ...encoder.encode("</p>"),
    ]);

    const { transport } = harness({
      "https://news.example/post": {
        headers: { "content-type": "text/html" },
        body: [body],
      },
    });

    const outcome = await run("https://news.example/post", {
      transport,
      lookup: dns({ "news.example": [PUBLIC_IP] }),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected a successful outcome");
    expect(outcome.page.html).toContain("café");
  });
});
