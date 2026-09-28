import { BACKLOG_FINISHED, BACKLOG_MIN_AGE_DAYS } from "@/lib/backlog";

/**
 * Reading stats (Slice 15). The counting is public.reading_stats (0014);
 * this is its shape, the labels and the copy. No streaks, goals or badges:
 * ARCHITECTURE section 1 rules out engagement ranking, and a streak is that
 * aimed at the reader.
 */

export const STATS_WEEKS = 12;

export const FINISHED_RULE = `"Finished" means scrolled to ${Math.round(
  BACKLOG_FINISHED * 100,
)}% of an article, so a short one that fits on the screen is finished when you open it.`;
export const WEEKS_RULE =
  "Weeks run Monday to Sunday in UTC, so they turn at 05:30 IST on Monday.";
export const MINUTES_RULE =
  "Minutes are the finished articles' estimated reading times, not time spent.";
export const BACKFILL_NOTE =
  "Articles finished before 28 September 2026 are dated by their last change, because finishing was not recorded until then.";

export interface StatsWeek {
  /** The Monday that starts the week, YYYY-MM-DD. */
  weekStart: string;
  saved: number;
  finished: number;
  /** Null when no finished article that week has a reading time. */
  minutes: number | null;
  highlights: number;
}

export interface StatsTotals {
  saved: number;
  library: number;
  finished: number;
  backlog: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** reading_stats' rows, or null for anything that is not what 0014 returns. */
export function statsWeeks(value: unknown): StatsWeek[] | null {
  if (!Array.isArray(value)) return null;
  const weeks: StatsWeek[] = [];
  for (const row of value) {
    if (typeof row !== "object" || row === null) return null;
    const { week_start, saved, finished, finished_minutes, highlights } =
      row as Record<string, unknown>;
    if (
      typeof week_start !== "string" ||
      !DAY.test(week_start) ||
      !isCount(saved) ||
      !isCount(finished) ||
      !isCount(highlights) ||
      !(finished_minutes === null || isCount(finished_minutes))
    )
      return null;
    weeks.push({
      weekStart: week_start,
      saved,
      finished,
      minutes: finished_minutes,
      highlights,
    });
  }
  return weeks;
}

/** "This week", "Last week", then "Week of 14 Sep", newest first. */
export function weekLabel(weekStart: string, position: number): string {
  if (position === 0) return "This week";
  if (position === 1) return "Last week";
  // Spelled out here rather than by Intl: ICU versions disagree on "Sep"
  // and "Sept", and the server and a test runner can carry different ones.
  const date = new Date(`${weekStart}T00:00:00Z`);
  return `Week of ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/**
 * A bar's width as a percentage of the largest value shown. Zero draws
 * nothing; anything above zero draws at least a sliver, so one article in
 * a week beside a week of forty is still visible.
 */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.max(3, Math.round((value / max) * 100)));
}

const articles = (n: number) => `${n} ${n === 1 ? "article" : "articles"}`;

export function backlogLine(count: number): string {
  if (count === 0)
    return `Nothing unfinished is older than ${BACKLOG_MIN_AGE_DAYS} days.`;
  return `${articles(count)} saved over ${BACKLOG_MIN_AGE_DAYS} days ago, not finished and not archived.`;
}
