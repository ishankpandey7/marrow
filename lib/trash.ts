import { PURGE_AFTER_DAYS } from "@/lib/constants";
import { PAGE_SIZE, UUID } from "@/lib/tags";

/**
 * Trash (Slice 12): what the page reads, what it says about time, and what
 * its actions accept. Pure, so the countdown can be table-tested and the
 * client list can import it without pulling in a database client.
 */

export const TRASH_COLUMNS = "id, url, title, site_name, deleted_at";

export interface TrashRow {
  id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  deleted_at: string;
}

/** A row as the list renders it, with the time already put into words. */
export interface TrashEntry {
  id: string;
  url: string;
  title: string;
  site: string;
  deleted: string;
  kept: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const NEXT_CLEANUP = "Goes at the next daily clean-up";

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The purge deletes an item at the first daily run after deleted_at plus
 * PURGE_AFTER_DAYS, and that run fires within an hour of its schedule, or
 * later if the database is paused. So the deadline is the earliest the item
 * can go, not when it goes. Every figure here rounds down: the row may
 * promise less time than the reader has, never more. Past the deadline it
 * names the clean-up rather than showing zero or a negative number.
 *
 * `now` is passed in, taken once on the server for the whole page, because a
 * client render would use a device clock that may be wrong and would
 * disagree with the server's HTML.
 */
export function purgeCountdown(
  deletedAt: string,
  now: number,
): { deleted: string; kept: string } {
  const at = Date.parse(deletedAt);
  if (Number.isNaN(at)) return { deleted: "Deleted", kept: NEXT_CLEANUP };
  // deleted_at is written from a server's clock, which may run ahead of the
  // one rendering this page. A deletion "in the future" happened just now.
  const elapsed = Math.max(0, now - at);
  const remaining = PURGE_AFTER_DAYS * DAY_MS - elapsed;
  const deleted =
    elapsed < HOUR_MS
      ? "Deleted just now"
      : elapsed < DAY_MS
        ? `Deleted ${plural(Math.floor(elapsed / HOUR_MS), "hour")} ago`
        : `Deleted ${plural(Math.floor(elapsed / DAY_MS), "day")} ago`;
  const kept =
    remaining <= 0
      ? NEXT_CLEANUP
      : remaining < DAY_MS
        ? "Less than a day left"
        : `Kept for ${plural(Math.floor(remaining / DAY_MS), "more day")}`;
  return { deleted, kept };
}

export function siteLabel(row: Pick<TrashRow, "site_name" | "url">): string {
  if (row.site_name) return row.site_name;
  try {
    return new URL(row.url).hostname;
  } catch {
    return row.url;
  }
}

export function toTrashEntry(row: TrashRow, now: number): TrashEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title ?? row.url,
    site: siteLabel(row),
    ...purgeCountdown(row.deleted_at, now),
  };
}

/** The ids an action may touch: one page's worth, well formed, no repeats. */
export function trashIds(input: unknown): string[] | null {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > PAGE_SIZE ||
    input.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    new Set(input).size !== input.length
  )
    return null;
  return input as string[];
}

// PostgREST's rendering of a timestamptz. The cutoff goes back exactly as
// the database wrote it: parsing it through Date would drop microseconds,
// and a row stamped by SQL a microsecond past the millisecond would then
// escape an Empty trash it was shown under.
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;

export function trashCutoff(input: unknown): string | null {
  return typeof input === "string" &&
    TIMESTAMP.test(input) &&
    !Number.isNaN(Date.parse(input))
    ? input
    : null;
}

export function trashPage(input: unknown): number {
  const page = Number(Array.isArray(input) ? input[0] : (input ?? 1));
  return Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 100000) : 1;
}

export function trashUrl(page: number): string {
  return page > 1 ? `/trash?page=${page}` : "/trash";
}
