import { describe, expect, it } from "vitest";
import { backlogLine, barPercent, statsWeeks, weekLabel } from "./stats";

const row = {
  week_start: "2026-09-28",
  saved: 3,
  finished: 1,
  finished_minutes: 12,
  highlights: 4,
};

describe("the rows reading_stats returns", () => {
  it("become weeks, with unknown minutes kept as unknown", () => {
    expect(
      statsWeeks([
        row,
        { ...row, week_start: "2026-09-21", finished_minutes: null },
      ]),
    ).toEqual([
      {
        weekStart: "2026-09-28",
        saved: 3,
        finished: 1,
        minutes: 12,
        highlights: 4,
      },
      {
        weekStart: "2026-09-21",
        saved: 3,
        finished: 1,
        minutes: null,
        highlights: 4,
      },
    ]);
    expect(statsWeeks([])).toEqual([]);
  });

  it.each([
    ["not a list", null],
    ["a bad date", [{ ...row, week_start: "28 Sep" }]],
    ["a negative count", [{ ...row, saved: -1 }]],
    ["a fraction", [{ ...row, highlights: 1.5 }]],
    ["a missing count", [{ ...row, finished: undefined }]],
    ["minutes as text", [{ ...row, finished_minutes: "12" }]],
  ])("refuse %s", (_name, value) => {
    expect(statsWeeks(value)).toBeNull();
  });
});

describe("week labels", () => {
  it("name the two newest weeks and date the rest by their Monday", () => {
    expect(weekLabel("2026-09-28", 0)).toBe("This week");
    expect(weekLabel("2026-09-21", 1)).toBe("Last week");
    expect(weekLabel("2026-09-14", 2)).toBe("Week of 14 Sep");
    // A Monday at midnight UTC is still that Monday, not the Sunday before.
    expect(weekLabel("2026-01-05", 5)).toBe("Week of 5 Jan");
  });
});

describe("bars", () => {
  it("draw nothing for a zero week, or when every week is zero", () => {
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(0, 0)).toBe(0);
  });

  it("fill for the biggest week and keep a small week visible", () => {
    expect(barPercent(40, 40)).toBe(100);
    expect(barPercent(20, 40)).toBe(50);
    expect(barPercent(1, 400)).toBe(3);
  });
});

describe("the backlog line", () => {
  it("counts in words that match the number", () => {
    expect(backlogLine(0)).toBe("Nothing unfinished is older than 14 days.");
    expect(backlogLine(1)).toBe(
      "1 article saved over 14 days ago, not finished and not archived.",
    );
    expect(backlogLine(7)).toMatch(/^7 articles saved/);
  });
});
