import { siteLabel } from "@/lib/trash";

/**
 * The "From your backlog" strip (Slice 13). The rule lives in
 * public.backlog_strip (0012); these are its numbers, which the strip states
 * and test/schema.test.ts holds the migration to. The rule is fixed and
 * disclosed on purpose: ARCHITECTURE section 1 rules out an algorithmic feed.
 */
export const BACKLOG_MIN_AGE_DAYS = 14;
/** read_progress at or above this counts as finished. */
export const BACKLOG_FINISHED = 0.9;
export const BACKLOG_SIZE = 3;
export const NOT_NOW_DAYS = 30;

export const BACKLOG_RULE = `Articles you saved over ${BACKLOG_MIN_AGE_DAYS} days ago and haven't finished. A new pick every Monday.`;

const DAY_MS = 86_400_000;

export interface BacklogRow {
  id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  created_at: string;
  reading_minutes: number | null;
  read_progress: number;
}

export interface BacklogEntry {
  id: string;
  title: string;
  site: string;
  why: string;
}

/**
 * The ISO week of `now` in UTC, such as "2026-W39": the seed that keeps the
 * pick the same all week and changes it on Monday at 00:00 UTC. ISO weeks
 * start on Monday and belong to the year that holds their Thursday, so the
 * last days of December can be week 1 and the first days of January week 53.
 */
export function isoWeek(now: number): string {
  const date = new Date(now);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - sinceMonday + 3,
    ),
  );
  const year = thursday.getUTCFullYear();
  const dayOfYear = Math.floor(
    (thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS,
  );
  const week = 1 + Math.floor(dayOfYear / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function savedAgo(createdAt: string, now: number): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return "Saved a while ago";
  const days = Math.floor(Math.max(0, now - at) / DAY_MS);
  if (days === 0) return "Saved today";
  if (days < 14) return `Saved ${plural(days, "day")} ago`;
  if (days < 60) return `Saved ${plural(Math.floor(days / 7), "week")} ago`;
  if (days < 365) return `Saved ${plural(Math.floor(days / 30), "month")} ago`;
  return "Saved over a year ago";
}

/**
 * read_progress measures scrolling, not opening: an article opened and left
 * at the top reads 0 as well. So zero is "not started", never "unread" or
 * "not opened", and the percentage rounds down so it never claims more.
 */
function progressLabel(progress: number): string {
  if (!(progress > 0)) return "not started";
  const percent = Math.floor(progress * 100);
  return percent < 1 ? "under 1% read" : `${percent}% read`;
}

/** Why an item is on the strip, e.g. "Saved 3 weeks ago · 12 min · 40% read". */
export function backlogReason(row: BacklogRow, now: number): string {
  return [
    savedAgo(row.created_at, now),
    row.reading_minutes === null ? null : `${row.reading_minutes} min`,
    progressLabel(row.read_progress),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function toBacklogEntry(row: BacklogRow, now: number): BacklogEntry {
  return {
    id: row.id,
    title: row.title ?? row.url,
    site: siteLabel(row),
    why: backlogReason(row, now),
  };
}
