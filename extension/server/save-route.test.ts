import { randomBytes, randomUUID } from "node:crypto";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const factories = vi.hoisted(() => ({
  session: null as SupabaseClient | null,
  service: null as SupabaseClient | null,
  sessionCalls: 0,
  serviceCalls: 0,
}));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => {
    factories.sessionCalls++;
    if (!factories.session) throw new Error("Test session not initialized");
    return factories.session;
  },
}));
vi.mock("@/lib/db/service", () => ({
  createServiceSupabase: () => {
    factories.serviceCalls++;
    if (!factories.service) throw new Error("Test service not initialized");
    return factories.service;
  },
}));

import { POST, OPTIONS } from "../../app/api/save/route";
import { hashExtensionToken } from "./tokens";

const site = "https://marrow-bice.vercel.app";
const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
const now = Date.UTC(2026, 8, 11, 12);
type Event = { user_id: string; created_at: string };

function harness() {
  const userId = randomUUID();
  const otherId = randomUUID();
  const token = `mrx_${randomBytes(32).toString("base64url")}`;
  const secret = randomBytes(32).toString("hex");
  vi.stubEnv("EXTENSION_TOKEN_SECRET", secret);
  const requests: {
    role: string;
    url: URL;
    body: Record<string, unknown> | null;
  }[] = [];
  const state = {
    revoked: false,
    lookupFails: false,
    countFails: false,
    saveFails: false,
    duplicate: false,
    events: [] as Event[],
  };
  const item = {
    id: randomUUID(),
    url: "https://example.com/post",
    title: "Saved article",
    status: "ready",
    created_at: new Date(now - 10000).toISOString(),
    updated_at: new Date(now - 10000).toISOString(),
    read_progress: 0.7,
    favourite: true,
    read_at: new Date(now - 5000).toISOString(),
  };
  function client(role: "session" | "service") {
    return createClient(
      "https://database.invalid",
      randomBytes(32).toString("hex"),
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: async (input, init) => {
            const request = new Request(input, init);
            const url = new URL(request.url);
            const raw = await request.text();
            const body: Record<string, unknown> | null = raw
              ? JSON.parse(raw)
              : null;
            requests.push({ role, url, body });
            if (url.pathname === "/rest/v1/extension_tokens") {
              if (state.lookupFails)
                return Response.json(
                  { message: "Unavailable" },
                  { status: 400 },
                );
              return Response.json(
                !state.revoked &&
                  url.searchParams.get("token_hash") ===
                    `eq.${hashExtensionToken(token, secret)}` &&
                  url.searchParams.get("revoked_at") === "is.null"
                  ? [{ user_id: userId }]
                  : [],
              );
            }
            if (url.pathname === "/rest/v1/save_events") {
              if (state.countFails)
                return Response.json(
                  { message: "Unavailable" },
                  { status: 400 },
                );
              const owner =
                role === "session"
                  ? userId
                  : url.searchParams.get("user_id")?.slice(3);
              const cutoff = url.searchParams.get("created_at")?.slice(4) ?? "";
              return Response.json(
                state.events
                  .filter(
                    (row) =>
                      (!owner || row.user_id === owner) &&
                      row.created_at >= cutoff,
                  )
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .slice(0, Number(url.searchParams.get("limit")))
                  .map(({ created_at }) => ({ created_at })),
              );
            }
            if (url.pathname.startsWith("/rest/v1/rpc/")) {
              if (state.saveFails)
                return Response.json(
                  { message: "Unavailable" },
                  { status: 500 },
                );
              state.events.push({
                user_id: String(body?.p_user_id ?? userId),
                created_at: new Date(now).toISOString(),
              });
              return Response.json({
                ...item,
                updated_at: state.duplicate
                  ? new Date(now).toISOString()
                  : item.created_at,
              });
            }
            throw new Error(`Unexpected offline request path: ${url.pathname}`);
          },
        },
      },
    );
  }
  factories.session = client("session");
  factories.service = client("service");
  const user: User = {
    id: userId,
    aud: "authenticated",
    created_at: new Date(now).toISOString(),
    app_metadata: {},
    user_metadata: {},
  };
  vi.spyOn(factories.session.auth, "getUser").mockResolvedValue({
    data: { user },
    error: null,
  });
  return { userId, otherId, token, requests, state, item };
}

function request(
  token?: string,
  payload: unknown = { url: "https://example.com/post?utm_source=browser" },
  origin: string | null = extensionOrigin,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new NextRequest(`${site}/api/save`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  factories.sessionCalls = 0;
  factories.serviceCalls = 0;
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("extension save entry point", () => {
  it("uses the stored owner for both the count and the sole save implementation", async () => {
    const h = harness();
    h.state.events = Array.from({ length: 60 }, () => ({
      user_id: h.otherId,
      created_at: new Date(now - 1000).toISOString(),
    }));
    const response = await POST(
      request(h.token, {
        url: "https://example.com/post?utm_source=browser",
        user_id: h.otherId,
      }),
    );
    expect(response.status).toBe(201);
    expect(factories.sessionCalls).toBe(0);
    const count = h.requests.find((r) =>
      r.url.pathname.endsWith("save_events"),
    );
    expect(count?.url.searchParams.get("user_id")).toBe(`eq.${h.userId}`);
    const save = h.requests.find((r) => r.url.pathname.includes("/rpc/"));
    expect(save?.url.pathname).toBe("/rest/v1/rpc/save_item_impl");
    expect(save?.body).toMatchObject({
      p_user_id: h.userId,
      p_canonical_url: "https://example.com/post",
    });
    expect(Object.keys(save?.body ?? {}).sort()).toEqual([
      "p_canonical_url",
      "p_url",
      "p_url_hash",
      "p_user_id",
    ]);
  });

  it("preserves the web RPC and its RLS-scoped count", async () => {
    const h = harness();
    const response = await POST(request(undefined, undefined, site));
    expect(response.status).toBe(201);
    expect(factories.serviceCalls).toBe(0);
    expect(h.requests[0].url.searchParams.has("user_id")).toBe(false);
    expect(h.requests[1].url.pathname).toBe("/rest/v1/rpc/save_item");
    expect(h.requests[1].body).not.toHaveProperty("p_user_id");
  });

  it("shares the web and extension save counter in both directions", async () => {
    const h = harness();
    h.state.events = Array.from({ length: 59 }, () => ({
      user_id: h.userId,
      created_at: new Date(now - 1000).toISOString(),
    }));
    expect((await POST(request(undefined, undefined, site))).status).toBe(201);
    const response = await POST(request(h.token));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await POST(request(undefined, undefined, site))).status).toBe(429);
    expect(
      h.requests.filter((r) => r.url.pathname.includes("/rpc/")),
    ).toHaveLength(1);
  });

  it.each([false, true])(
    "retains the existing response for alreadySaved=%s",
    async (duplicate) => {
      const h = harness();
      h.state.duplicate = duplicate;
      const before = structuredClone(h.item);
      const response = await POST(request(h.token));
      expect(response.status).toBe(duplicate ? 200 : 201);
      expect(await response.json()).toEqual({
        alreadySaved: duplicate,
        item: {
          id: h.item.id,
          url: h.item.url,
          title: h.item.title,
          status: h.item.status,
        },
      });
      expect(h.item).toEqual(before);
    },
  );

  it.each(["revoked", "malformed", "unknown", "missing"])(
    "rejects %s tokens without cookie fallback",
    async (mode) => {
      const h = harness();
      h.state.revoked = mode === "revoked";
      const token =
        mode === "missing"
          ? undefined
          : mode === "malformed"
            ? "invalid"
            : mode === "unknown"
              ? `mrx_${randomBytes(32).toString("base64url")}`
              : h.token;
      const req = request(token);
      req.headers.set("cookie", "session=present");
      expect((await POST(req)).status).toBe(401);
      expect(factories.sessionCalls).toBe(0);
      expect(
        h.requests.some(
          (r) =>
            r.url.pathname.includes("save_events") ||
            r.url.pathname.includes("/rpc/"),
        ),
      ).toBe(false);
    },
  );

  it.each(["lookupFails", "countFails", "saveFails"] as const)(
    "fails closed when %s",
    async (failure) => {
      const h = harness();
      h.state[failure] = true;
      const response = await POST(request(h.token));
      expect(response.status).toBe(500);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        extensionOrigin,
      );
      expect(h.state.events).toEqual([]);
    },
  );

  it.each([null, {}, { url: "file:///local" }])(
    "retains CORS on bad payload %j",
    async (payload) => {
      const h = harness();
      const response = await POST(request(h.token, payload));
      expect(response.status).toBe(400);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        extensionOrigin,
      );
      expect(
        h.requests.some((r) => r.url.pathname.includes("save_events")),
      ).toBe(false);
    },
  );

  it("rejects website origins before resolving credentials", async () => {
    const h = harness();
    const response = await POST(
      request(h.token, undefined, "https://attacker.invalid"),
    );
    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(h.requests).toEqual([]);
  });

  it("accepts a valid bearer without Origin and never grants credentialed CORS", async () => {
    const h = harness();
    const response = await POST(request(h.token, undefined, null));
    expect(response.status).toBe(201);
    expect(response.headers.has("access-control-allow-credentials")).toBe(
      false,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("handles preflight without authentication or database access", () => {
    harness();
    const response = OPTIONS(
      new NextRequest(`${site}/api/save`, {
        method: "OPTIONS",
        headers: {
          origin: extensionOrigin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("access-control-expose-headers")).toBe(
      "Retry-After",
    );
    expect(response.headers.has("access-control-allow-credentials")).toBe(
      false,
    );
    expect(factories.serviceCalls + factories.sessionCalls).toBe(0);
  });
});
