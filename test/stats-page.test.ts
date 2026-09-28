import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  user: { id: "test-user" } as { id: string } | null,
  rpc: [] as unknown[][],
  queries: [] as { method: string; args: unknown[] }[][],
  weeks: { data: [] as unknown, error: null as unknown },
  counts: [] as { count: number | null; error: unknown }[],
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (...args: unknown[]) => {
      state.rpc.push(args);
      return state.weeks;
    },
    from: (...args: unknown[]) => {
      const calls: { method: string; args: unknown[] }[] = [
        { method: "from", args },
      ];
      state.queries.push(calls);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "is", "not", "eq", "lt", "lte"])
        chain[method] = (...methodArgs: unknown[]) => {
          calls.push({ method, args: methodArgs });
          return chain;
        };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(state.counts.shift() ?? { count: 0, error: null }).then(
          resolve,
        );
      return chain;
    },
  }),
}));
import StatsPage from "@/app/(app)/stats/page";

const now = Date.parse("2026-09-30T12:00:00.000Z");
const week = (week_start: string, saved = 0, finished = 0) => ({
  week_start,
  saved,
  finished,
  finished_minutes: finished ? finished * 5 : null,
  highlights: 0,
});

async function page() {
  return renderToStaticMarkup((await StatsPage()) as ReactElement);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state.user = { id: "test-user" };
  state.rpc = [];
  state.queries = [];
  state.weeks = {
    data: [week("2026-09-28", 2, 1), week("2026-09-21"), week("2026-09-14", 5)],
    error: null,
  };
  state.counts = [
    { count: 20, error: null },
    { count: 15, error: null },
    { count: 3, error: null },
    { count: 7, error: null },
  ];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the stats page loader", () => {
  it("sends a signed-out reader to sign in and back", async () => {
    state.user = null;
    await expect(StatsPage()).rejects.toThrow(
      "redirect:/auth/sign-in?next=%2Fstats",
    );
  });

  it("asks for twelve weeks ending in this ISO week", async () => {
    await page();
    expect(state.rpc).toEqual([
      ["reading_stats", { p_week: "2026-W40", p_weeks: 12 }],
    ]);
  });

  it("counts the backlog the way the strip defines it, from one clock", async () => {
    await page();
    const backlog = state.queries[3];
    expect(backlog).toEqual([
      { method: "from", args: ["items"] },
      { method: "select", args: ["id", { count: "exact", head: true }] },
      { method: "is", args: ["deleted_at", null] },
      { method: "eq", args: ["status", "ready"] },
      { method: "is", args: ["archived_at", null] },
      { method: "lt", args: ["read_progress", 0.9] },
      { method: "lte", args: ["created_at", "2026-09-16T12:00:00.000Z"] },
    ]);
    // Every count leaves Trash out.
    for (const query of state.queries)
      expect(query).toContainEqual({
        method: "is",
        args: ["deleted_at", null],
      });
  });

  it.each([
    [
      "the weeks fail",
      () => (state.weeks = { data: null, error: { code: "x" } }),
    ],
    [
      "the weeks come back malformed",
      () => (state.weeks = { data: [{}], error: null }),
    ],
    [
      "a count fails",
      () => (state.counts[2] = { count: null, error: { code: "x" } }),
    ],
  ])("says it could not load when %s", async (_name, breakIt) => {
    breakIt();
    const html = await page();
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load your stats.");
    expect(html).not.toContain("<table");
  });
});

describe("the stats page", () => {
  it("shows the totals, the backlog, one row per week newest first, and the rules", async () => {
    const html = await page();
    expect(html).toContain("In your library</dt><dd");
    expect(html).toMatch(/Finished<\/dt><dd[^>]*>3<\/dd>/);
    expect(html).toContain(
      "7 articles saved over 14 days ago, not finished and not archived.",
    );
    const rows = [
      ...html.matchAll(/<time dateTime="([^"]+)">([^<]+)<\/time>/g),
    ];
    expect(rows.map((m) => [m[1], m[2]])).toEqual([
      ["2026-09-28", "This week"],
      ["2026-09-21", "Last week"],
      ["2026-09-14", "Week of 14 Sep"],
    ]);
    expect(html).toContain("about 5");
    expect(html).toContain("not known");
    expect(html).toContain("scrolled to 90% of an article");
    expect(html).toContain("05:30 IST");
    expect(html).toContain('href="/inbox"');
  });

  it("scales saved and finished bars together, against the busiest week", async () => {
    const html = await page();
    const widths = [...html.matchAll(/style="width:(\d+)%"/g)].map((m) =>
      Number(m[1]),
    );
    // Saved then finished, per week: 2 and 1, 0 and 0, 5 and 0, of 5.
    expect(widths).toEqual([40, 20, 0, 0, 100, 0]);
  });

  it("says nothing is saved yet instead of drawing empty weeks", async () => {
    state.counts[0] = { count: 0, error: null };
    const html = await page();
    expect(html).toContain("Nothing saved yet.");
    expect(html).not.toContain("<table");
  });
});
