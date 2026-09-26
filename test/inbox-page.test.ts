import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  library: {
    snapshot: { loadedAt: 1, items: [], tags: [], hasMore: false },
    signedOut: false,
    message: null,
  } as {
    snapshot: unknown;
    signedOut: boolean;
    message: string | null;
  },
  rpc: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/app/(app)/actions", () => ({
  loadLibrary: async () => state.library,
}));
vi.mock("@/components/filter-bar", () => ({ OrganiseInbox: () => null }));
vi.mock("@/components/backlog-strip", () => ({ BacklogStrip: () => null }));
vi.mock("@/lib/db/server", () => ({
  createServerSupabase: async () => ({ rpc: state.rpc }),
}));
import InboxPage from "@/app/(app)/inbox/page";

const now = Date.parse("2026-09-26T12:00:00.000Z");
const row = {
  id: "12345678-1234-1234-1234-123456789abc",
  url: "https://example.com/a",
  title: "An old article",
  site_name: "Example",
  created_at: "2026-09-05T11:00:00.000+00:00",
  reading_minutes: 12,
  read_progress: 0.4,
};

async function inboxProps(params: Record<string, string> = {}) {
  const main = (await InboxPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(params),
  } as PageProps<"/inbox">)) as ReactElement<{ children: ReactElement }>;
  return main.props.children.props as {
    backlog?: ReactElement<{ entries: unknown[] }>;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  state.rpc.mockReset();
  state.library = {
    snapshot: { loadedAt: 1, items: [], tags: [], hasMore: false },
    signedOut: false,
    message: null,
  };
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the backlog strip on /inbox", () => {
  it("asks for this week's pick in the default view and words it", async () => {
    state.rpc.mockResolvedValueOnce({ data: [row], error: null });
    const props = await inboxProps();
    expect(state.rpc).toHaveBeenCalledWith("backlog_strip", {
      p_week: "2026-W39",
      p_min_age_days: 14,
    });
    expect(props.backlog?.props.entries).toEqual([
      {
        id: row.id,
        title: "An old article",
        site: "Example",
        why: "Saved 3 weeks ago · 12 min · 40% read",
      },
    ]);
  });

  it.each<Record<string, string>>([
    { state: "archive" },
    { state: "favourites" },
    { read: "unread" },
    { tag: "12345678-1234-1234-1234-123456789def" },
    { page: "2" },
  ])("is not asked for in %j", async (params) => {
    const props = await inboxProps(params);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(props.backlog).toBeUndefined();
  });

  it("is left out, not shown as an error, when it cannot load", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await inboxProps()).backlog).toBeUndefined();
  });

  it("is left out when nothing qualifies", async () => {
    state.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await inboxProps()).backlog).toBeUndefined();
  });

  it("is not asked for when the library itself failed", async () => {
    state.library = {
      snapshot: null,
      signedOut: false,
      message: "Could not load your library. Refresh to try again.",
    };
    await inboxProps();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
