import { describe, expect, it } from "vitest";

import { PURGE_AFTER_DAYS } from "@/lib/constants";
import { PURGE_AFTER } from "@/lib/queue";
import {
  NEXT_CLEANUP,
  purgeCountdown,
  siteLabel,
  toTrashEntry,
  trashCutoff,
  trashIds,
  trashPage,
  trashUrl,
} from "@/lib/trash";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.parse("2026-09-26T12:00:00.000Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const id = "12345678-1234-1234-1234-123456789abc";
const other = "12345678-1234-1234-1234-123456789def";

describe("the purge interval", () => {
  it("is the number the copy promises", () => {
    expect(PURGE_AFTER_DAYS).toBe(30);
    expect(PURGE_AFTER).toBe(`${PURGE_AFTER_DAYS} days`);
  });
});

describe("purgeCountdown", () => {
  it.each([
    ["exactly now", 0, "Deleted just now", "Kept for 30 more days"],
    ["a second ago", 1000, "Deleted just now", "Kept for 29 more days"],
    ["an hour ago", HOUR, "Deleted 1 hour ago", "Kept for 29 more days"],
    [
      "23 hours ago",
      23 * HOUR,
      "Deleted 23 hours ago",
      "Kept for 29 more days",
    ],
    ["a day ago", DAY, "Deleted 1 day ago", "Kept for 29 more days"],
    ["28.5 days ago", 28.5 * DAY, "Deleted 28 days ago", "Kept for 1 more day"],
    [
      "29 days 23 hours ago",
      29 * DAY + 23 * HOUR,
      "Deleted 29 days ago",
      "Less than a day left",
    ],
    [
      "30 days ago, to the millisecond",
      30 * DAY,
      "Deleted 30 days ago",
      NEXT_CLEANUP,
    ],
    [
      "33 days ago, the purge not yet run",
      33 * DAY,
      "Deleted 33 days ago",
      NEXT_CLEANUP,
    ],
  ])("deleted %s", (_label, elapsed, deleted, kept) => {
    expect(purgeCountdown(ago(elapsed), now)).toEqual({ deleted, kept });
  });

  it("never promises more time than is left", () => {
    for (let elapsed = 0; elapsed <= 31 * DAY; elapsed += 7 * HOUR + 13) {
      const { kept } = purgeCountdown(ago(elapsed), now);
      const days = /Kept for (\d+) more day/.exec(kept);
      if (days)
        expect(Number(days[1]) * DAY).toBeLessThanOrEqual(30 * DAY - elapsed);
      else if (kept === "Less than a day left")
        expect(30 * DAY - elapsed).toBeLessThan(DAY);
      else expect(30 * DAY - elapsed).toBeLessThanOrEqual(0);
    }
  });

  it("treats a deletion stamped in the future as just now", () => {
    expect(purgeCountdown(ago(-3 * DAY), now)).toEqual({
      deleted: "Deleted just now",
      kept: "Kept for 30 more days",
    });
  });

  it("reads PostgREST's microsecond timestamps", () => {
    expect(
      purgeCountdown("2026-09-24T12:00:00.123456+00:00", now).deleted,
    ).toBe("Deleted 1 day ago");
  });

  it("promises nothing for a timestamp it cannot read", () => {
    expect(purgeCountdown("yesterday", now)).toEqual({
      deleted: "Deleted",
      kept: NEXT_CLEANUP,
    });
  });
});

describe("toTrashEntry", () => {
  it("falls back to the URL for a missing title and the host for a missing site", () => {
    expect(
      toTrashEntry(
        {
          id,
          url: "https://example.com/a",
          title: null,
          site_name: null,
          deleted_at: ago(2 * DAY),
        },
        now,
      ),
    ).toEqual({
      id,
      url: "https://example.com/a",
      title: "https://example.com/a",
      site: "example.com",
      deleted: "Deleted 2 days ago",
      kept: "Kept for 28 more days",
    });
  });

  it("does not throw on a URL it cannot parse", () => {
    expect(siteLabel({ site_name: null, url: "not a url" })).toBe("not a url");
  });
});

describe("trashIds", () => {
  it("accepts one page of distinct UUIDs", () => {
    expect(trashIds([id, other])).toEqual([id, other]);
  });

  it.each([
    ["not an array", id],
    ["empty", []],
    ["a malformed id", ["bad"]],
    ["a non-string", [42]],
    ["a repeat", [id, id]],
    [
      "more than a page",
      Array.from(
        { length: 51 },
        (_, n) => `12345678-1234-1234-1234-${String(n).padStart(12, "0")}`,
      ),
    ],
  ])("refuses %s", (_label, input) => {
    expect(trashIds(input)).toBeNull();
  });
});

describe("trashCutoff", () => {
  it.each([
    "2026-09-26T12:00:00.123456+00:00",
    "2026-09-26T12:00:00+05:30",
    "2026-09-26T12:00:00.1Z",
  ])("passes %s back unchanged", (value) => {
    expect(trashCutoff(value)).toBe(value);
  });

  it.each([null, 42, "", "now()", "2026-09-26", "2026-13-40T99:99:99Z"])(
    "refuses %s",
    (value) => {
      expect(trashCutoff(value)).toBeNull();
    },
  );
});

describe("trash pages", () => {
  it.each([
    [undefined, 1],
    ["3", 3],
    [["2", "9"], 2],
    ["0", 1],
    ["-4", 1],
    ["2.5", 1],
    ["x", 1],
    ["999999999", 100000],
  ])("reads %j as page %i", (input, page) => {
    expect(trashPage(input)).toBe(page);
  });

  it("links page one without a query", () => {
    expect(trashUrl(1)).toBe("/trash");
    expect(trashUrl(4)).toBe("/trash?page=4");
  });
});
