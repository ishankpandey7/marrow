import { describe, expect, it } from "vitest";

import {
  BACKLOG_RULE,
  backlogReason,
  isoWeek,
  toBacklogEntry,
  type BacklogRow,
} from "@/lib/backlog";

const DAY = 86_400_000;
const now = Date.parse("2026-09-26T12:00:00.000Z");
const row = (patch: Partial<BacklogRow> = {}): BacklogRow => ({
  id: "12345678-1234-1234-1234-123456789abc",
  url: "https://example.com/a",
  title: "An article",
  site_name: "Example",
  created_at: new Date(now - 21 * DAY).toISOString(),
  reading_minutes: 12,
  read_progress: 0.4,
  ...patch,
});

describe("isoWeek", () => {
  it.each([
    ["2026-09-26T12:00:00Z", "2026-W39"],
    // Monday 00:00 UTC is 05:30 in India: the pick changes then.
    ["2026-09-27T23:59:59Z", "2026-W39"],
    ["2026-09-28T00:00:00Z", "2026-W40"],
    // 2026 starts on a Thursday, so it has 53 weeks.
    ["2026-01-01T00:00:00Z", "2026-W01"],
    ["2026-12-31T12:00:00Z", "2026-W53"],
    ["2027-01-01T12:00:00Z", "2026-W53"],
    ["2027-01-03T23:59:59Z", "2026-W53"],
    ["2027-01-04T00:00:00Z", "2027-W01"],
    // A year whose first days belong to the previous year's last week.
    ["2021-01-03T12:00:00Z", "2020-W53"],
    ["2024-12-30T12:00:00Z", "2025-W01"],
  ])("%s is %s", (at, week) => {
    expect(isoWeek(Date.parse(at))).toBe(week);
  });
});

describe("backlogReason", () => {
  it("says how old, how long and how far", () => {
    expect(backlogReason(row(), now)).toBe(
      "Saved 3 weeks ago · 12 min · 40% read",
    );
  });

  it.each([
    [14, "Saved 2 weeks ago"],
    [13, "Saved 13 days ago"],
    [1, "Saved 1 day ago"],
    [0, "Saved today"],
    [59, "Saved 8 weeks ago"],
    [60, "Saved 2 months ago"],
    [400, "Saved over a year ago"],
  ])("%i days old reads %s", (days, text) => {
    expect(
      backlogReason(
        row({ created_at: new Date(now - days * DAY).toISOString() }),
        now,
      ).split(" · ")[0],
    ).toBe(text);
  });

  it.each([
    [0, "not started"],
    [0.004, "under 1% read"],
    [0.019, "1% read"],
    [0.899, "89% read"],
  ])("progress %s reads %s", (progress, text) => {
    expect(
      backlogReason(row({ read_progress: progress }), now).split(" · ")[2],
    ).toBe(text);
  });

  it("never says unread or not opened, which nothing measures", () => {
    const text = backlogReason(row({ read_progress: 0 }), now);
    expect(text).not.toMatch(/unread|opened/i);
  });

  it("leaves out minutes it does not know", () => {
    expect(backlogReason(row({ reading_minutes: null }), now)).toBe(
      "Saved 3 weeks ago · 40% read",
    );
  });

  it("reads PostgREST's microsecond timestamps", () => {
    expect(
      backlogReason(
        row({ created_at: "2026-09-05T11:00:00.123456+00:00" }),
        now,
      ),
    ).toMatch(/^Saved 3 weeks ago/);
  });
});

describe("toBacklogEntry", () => {
  it("falls back to the URL and host", () => {
    expect(
      toBacklogEntry(row({ title: null, site_name: null }), now),
    ).toMatchObject({ title: "https://example.com/a", site: "example.com" });
  });
});

describe("the rule's copy", () => {
  it("states the numbers the migration uses", () => {
    expect(BACKLOG_RULE).toBe(
      "Articles you saved over 14 days ago and haven't finished. A new pick every Monday.",
    );
  });
});
