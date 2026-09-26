import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  user: { id: "test-user" } as { id: string } | null,
  queries: [] as { method: string; args: unknown[] }[][],
  responses: [] as { data: unknown; error: unknown; count?: number | null }[],
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/components/trash-list", () => ({ TrashList: () => null }));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (...args: unknown[]) => {
      const calls: { method: string; args: unknown[] }[] = [
        { method: "from", args },
      ];
      state.queries.push(calls);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "not", "order", "range", "limit"])
        chain[method] = (...methodArgs: unknown[]) => {
          calls.push({ method, args: methodArgs });
          return chain;
        };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(
          state.responses.shift() ?? { data: [], error: null, count: 0 },
        ).then(resolve);
      return chain;
    },
  }),
}));
import TrashPage from "@/app/(app)/trash/page";

const now = Date.parse("2026-09-26T12:00:00.000Z");
const newest = "2026-09-26T08:15:02.123456+00:00";
const row = (n: number) => ({
  id: `12345678-1234-1234-1234-${String(n).padStart(12, "0")}`,
  url: `https://example.com/${n}`,
  title: `Article ${n}`,
  site_name: "Example",
  deleted_at: "2026-09-24T12:00:00.000+00:00",
});

async function listProps(page?: string) {
  const main = (await TrashPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(page ? { page } : {}),
  } as PageProps<"/trash">)) as ReactElement<{ children: ReactElement }>;
  return main.props.children.props as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state.user = { id: "test-user" };
  state.queries = [];
  state.responses = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the Trash page loader", () => {
  it("reads one page with a lookahead row, newest deletion first", async () => {
    state.responses.push(
      { data: Array.from({ length: 51 }, (_, n) => row(n)), error: null },
      { data: [{ deleted_at: newest }], error: null, count: 120 },
    );
    const props = await listProps("2");
    expect(state.queries[0]).toEqual([
      { method: "from", args: ["items"] },
      { method: "select", args: ["id, url, title, site_name, deleted_at"] },
      { method: "not", args: ["deleted_at", "is", null] },
      { method: "order", args: ["deleted_at", { ascending: false }] },
      { method: "order", args: ["id", { ascending: false }] },
      { method: "range", args: [50, 100] },
    ]);
    expect(props.entries).toHaveLength(50);
    expect(props.hasMore).toBe(true);
    expect((props.entries as { kept: string }[])[0].kept).toBe(
      "Kept for 28 more days",
    );
  });

  it("hands Empty trash the whole trash's count and its newest deleted_at, unparsed", async () => {
    state.responses.push(
      { data: [row(1)], error: null },
      { data: [{ deleted_at: newest }], error: null, count: 120 },
    );
    const props = await listProps("3");
    expect(state.queries[1]).toEqual([
      { method: "from", args: ["items"] },
      { method: "select", args: ["deleted_at", { count: "exact" }] },
      { method: "not", args: ["deleted_at", "is", null] },
      { method: "order", args: ["deleted_at", { ascending: false }] },
      { method: "limit", args: [1] },
    ]);
    expect(props).toMatchObject({ total: 120, cutoff: newest, page: 3 });
  });

  it("offers no cutoff when the trash is empty", async () => {
    state.responses.push(
      { data: [], error: null },
      { data: [], error: null, count: 0 },
    );
    expect(await listProps()).toMatchObject({
      entries: [],
      total: 0,
      cutoff: null,
    });
  });

  it("sends a signed-out reader to sign in and back to this page", async () => {
    state.user = null;
    await expect(listProps("2")).rejects.toThrow(
      "redirect:/auth/sign-in?next=%2Ftrash%3Fpage%3D2",
    );
  });
});
