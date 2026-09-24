/**
 * The extraction queue: claiming work, doing it, and deciding what happens
 * when it fails.
 *
 * ARCHITECTURE.md section 10 is the shape. `POST /api/save` writes a `pending`
 * item and returns at once; this is what eventually turns it into an article.
 *
 * The Supabase client is a parameter rather than an import. Two reasons, and
 * both matter. It keeps `lib/db/service.ts` — and therefore `server-only`,
 * which throws outside a React Server Component — out of this module's graph,
 * so the retry policy and the cron authorisation below are testable offline.
 * And it makes the privilege explicit at the call site: everything here reads
 * and writes across every user's rows, which is a thing the caller should have
 * to say out loud.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { extractArticle, type ArticleMetadata } from "@/lib/extract";
import { fetchPage, type FetchNote, type FetchOutcome } from "@/lib/fetcher";
import type { FailReason } from "@/lib/types";

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Jobs claimed per invocation.
 *
 * Kept small on purpose: a run that is killed for running long leaves rows
 * locked, which costs more than the backlog it was trying to clear. Throughput
 * comes from the drain loop below, not from this number. The batch is fetched
 * concurrently, so the wall clock is one fetch budget, not five.
 */
export const CLAIM_BATCH_SIZE = 5;

/**
 * How long one invocation keeps claiming new batches for.
 *
 * The batch size alone decides throughput only when the cron runs often. On
 * Vercel's Hobby plan it runs once a day, and five items a day is not a queue,
 * it is a queue-shaped ornament — so a run keeps draining until nothing is
 * left. The budget stops it *starting* another round, and a round can still
 * take a full fetch budget after that, which is why this sits well short of
 * `maxDuration`: a run killed by the platform leaves its rows locked.
 */
export const DRAIN_BUDGET_MS = 40_000;

/**
 * How long a `running` row may go untouched before it is assumed abandoned.
 *
 * A function that is behaving cannot hold one for longer than its own maximum
 * duration, which is a minute. Five gives that a wide margin: reclaiming a
 * worker that is merely slow means fetching the same URL twice.
 */
export const STALE_LOCK = "5 minutes";

/** ARCHITECTURE section 10: soft-deleted items are hard-deleted after this. */
export const PURGE_AFTER = "30 days";

/**
 * Only these two are worth trying again. Every other reason in the taxonomy is
 * a settled fact about the URL — a 404 will still be a 404 in twenty-five
 * minutes, and retrying it is someone else's server paying for our optimism.
 */
export const RETRIABLE_REASONS: ReadonlySet<FailReason> = new Set<FailReason>([
  "unreachable",
  "server_error",
]);

/**
 * Backoff between attempts, in minutes, indexed by attempts already made.
 *
 * The schedule is the one in ARCHITECTURE section 10. How far down it a job
 * walks is capped by its own `max_attempts` column, which defaults to 3. The
 * minutes are a floor, not a schedule: a job is only claimed when the cron
 * runs, and on Vercel Hobby that is once a day, so a retriable failure gets
 * its next attempt at the next daily run — roughly a final answer two days
 * after the save, not six minutes. The twenty-five-minute step is reached
 * only by a row whose max_attempts has been raised deliberately.
 */
export const BACKOFF_MINUTES = [1, 5, 25] as const;

/** Injected so the backoff can be asserted against fixed instants. */
export type Clock = () => number;

// ---------------------------------------------------------------------------
// Cron authorisation
// ---------------------------------------------------------------------------

/**
 * A cron route with no auth is a public endpoint anyone can invoke as fast as
 * they like — on `/api/cron/extract`, one that spends our egress fetching
 * whatever is queued. This lives here, next to the jobs, because both cron
 * routes need it and it is background-work infrastructure rather than part of
 * either route.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations
 * whenever that variable is set on the project, so this is the same check for
 * the platform and for a human with curl.
 */
export type CronAuth = "authorised" | "unauthorised" | "misconfigured";

/**
 * Constant-time, and constant-length.
 *
 * timingSafeEqual throws on mismatched lengths, and the usual workaround — an
 * early length check — leaks the secret's length. Comparing digests instead
 * makes both operands 32 bytes whatever went in.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function authoriseCronRequest(request: Request): CronAuth {
  const expected = process.env.CRON_SECRET;

  // No fallback, and deliberately not "allow when unset". An unconfigured
  // deployment must fail loudly and closed; an open cron route that looks
  // healthy is worse than one that is plainly broken.
  if (!expected) return "misconfigured";

  const header = request.headers.get("authorization");
  if (!header) return "unauthorised";

  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer") return "unauthorised";

  const presented = rest.join(" ").trim();
  if (!presented) return "unauthorised";

  return secretsMatch(presented, expected) ? "authorised" : "unauthorised";
}

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

/** One row of `public.claimed_fetch_job`. See 0003_jobs.sql. */
export interface ClaimedJob {
  readonly job_id: number;
  readonly item_id: string;
  readonly user_id: string;
  readonly url: string;
  readonly url_hash: string;
  readonly attempts: number;
  readonly max_attempts: number;
}

/**
 * Take up to `limit` jobs, locking them against every other invocation.
 *
 * The safety is entirely in the SQL — see the comment above claim_fetch_jobs.
 * Nothing this side of it needs to coordinate, which is the point.
 */
export async function claimJobs(
  client: SupabaseClient,
  limit: number = CLAIM_BATCH_SIZE,
): Promise<ClaimedJob[]> {
  const { data, error } = await client.rpc("claim_fetch_jobs", {
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Could not claim fetch jobs: ${error.message}`);
  }

  return (data ?? []) as ClaimedJob[];
}

/**
 * Claim the one queued job for this item of this owner, or nothing.
 *
 * Fetch on save (Slice 9) uses this instead of claimJobs, which takes the
 * oldest jobs of any user. Null is the normal answer when the job is already
 * running elsewhere, has spent its attempts, or was never queued because the
 * item was ready.
 *
 * `pageSent` skips the fetch backoff (0009): the backoff spares a struggling
 * publisher, and with a page from the reader nobody asks the publisher.
 */
export async function claimItemJob(
  client: SupabaseClient,
  itemId: string,
  userId: string,
  pageSent = false,
): Promise<ClaimedJob | null> {
  const { data, error } = await client.rpc("claim_fetch_job_for_item", {
    p_item_id: itemId,
    p_user_id: userId,
    p_page_sent: pageSent,
  });

  if (error) {
    throw new Error(`Could not claim the job for this item: ${error.message}`);
  }

  return ((data ?? []) as ClaimedJob[])[0] ?? null;
}

/** Returns how many stalled rows were requeued or abandoned. */
export async function reclaimStalledJobs(
  client: SupabaseClient,
  staleAfter: string = STALE_LOCK,
): Promise<number> {
  const { data, error } = await client.rpc("reclaim_stalled_fetch_jobs", {
    p_stale_after: staleAfter,
  });

  if (error) {
    throw new Error(`Could not reclaim stalled fetch jobs: ${error.message}`);
  }

  return (data ?? 0) as number;
}

/** Returns how many items were hard-deleted. */
export async function purgeDeletedItems(
  client: SupabaseClient,
  olderThan: string = PURGE_AFTER,
): Promise<number> {
  const { data, error } = await client.rpc("purge_deleted_items", {
    p_older_than: olderThan,
  });

  if (error) {
    throw new Error(`Could not purge deleted items: ${error.message}`);
  }

  return (data ?? 0) as number;
}

// ---------------------------------------------------------------------------
// The retry decision
// ---------------------------------------------------------------------------

export type Settlement =
  | { readonly kind: "retry"; readonly runAfter: Date }
  | { readonly kind: "failed" };

/**
 * What to do with a job that just failed. Pure.
 *
 * `attempts` is the count *after* the claim incremented it, so the first run
 * of a job arrives here as 1. A job at its cap is finished: the user gets the
 * failure copy and, where the taxonomy allows it, a retry button — a decision
 * they make, rather than a queue that keeps trying on its own for ever.
 */
export function planSettlement(
  reason: FailReason,
  attempts: number,
  maxAttempts: number,
  now: number,
): Settlement {
  if (!RETRIABLE_REASONS.has(reason)) return { kind: "failed" };
  if (attempts >= maxAttempts) return { kind: "failed" };

  const step = Math.min(Math.max(attempts - 1, 0), BACKOFF_MINUTES.length - 1);

  return {
    kind: "retry",
    runAfter: new Date(now + BACKOFF_MINUTES[step] * 60_000),
  };
}

// ---------------------------------------------------------------------------
// Doing the work
// ---------------------------------------------------------------------------

export interface JobReport {
  readonly jobId: number;
  readonly itemId: string;
  readonly userId: string;
  /** The URL as the user gave it. Reported so failures are searchable. */
  readonly url: string;
  readonly attempts: number;
  readonly outcome: "done" | "retry" | "failed";
  readonly reason: FailReason | null;
  /** Which fetcher guard tripped, when one did. A closed set of literals. */
  readonly note: FetchNote | null;
  /** ISO 8601, set only when the outcome is "retry". */
  readonly runAfter: string | null;
  /**
   * Something went wrong that did not change the outcome — bookkeeping that
   * failed after the article was already stored, most often. The route reports
   * these to Sentry; swallowing them here would make the queue quietly lossy.
   */
  readonly warning: string | null;
}

/** A page the reader already has open, sent with the save (Slice 10). */
export interface SubmittedPage {
  /** Where the reader was. Relative links in the markup resolve to it. */
  readonly url: string;
  readonly html: string;
}

export interface ProcessJobOptions {
  readonly now?: Clock;
  /**
   * Use this markup instead of fetching. Everything after the fetch — the
   * extractor, the sanitiser, the item and content writes, the settlement —
   * is the same code, so a submitted page is held to exactly the rules a
   * fetched one is.
   */
  readonly page?: SubmittedPage;
}

function metadataColumns(metadata: ArticleMetadata) {
  return {
    title: metadata.title,
    author: metadata.author,
    site_name: metadata.siteName,
    excerpt: metadata.excerpt,
    lead_image_url: metadata.leadImageUrl,
    lang: metadata.lang,
    published_at: metadata.publishedAt,
  };
}

/** Unique violation on (user_id, url_hash). See adoptCanonicalUrl. */
const UNIQUE_VIOLATION = "23505";

/**
 * Run one claimed job to a conclusion: fetched and extracted, or queued for
 * another attempt, or failed with a reason the user can read.
 *
 * Never throws. A job that ends in an exception is a job left `running` with a
 * lock nothing will clear for five minutes, so every path here settles the row
 * — including the paths where our own database is the thing that failed.
 *
 * This is the only place an extraction result is written. It runs under the
 * service role across every user's rows and owns the job's bookkeeping; the
 * reader's Try again re-queues a job through retry_item rather than fetching
 * inline.
 */
export async function processJob(
  client: SupabaseClient,
  job: ClaimedJob,
  options: ProcessJobOptions = {},
): Promise<JobReport> {
  const now = options.now ?? Date.now;

  try {
    return await runJob(client, job, now, options.page);
  } catch (error) {
    // fetchPage and extractArticle both promise not to throw. If one of them
    // breaks that promise the row still has to be settled, or it holds a lock
    // and the item shows a spinner until the reclaim notices, five minutes on.
    const cause = describe(error);

    try {
      const settled = await settleFailure(client, job, "server_error", null, {
        now,
      });
      return { ...settled, warning: settled.warning ?? cause };
    } catch (settleError) {
      // Our own database is the thing failing. Leave the row locked and let
      // reclaim_stalled_fetch_jobs have it; throwing from here would take the
      // rest of the batch down with a job that was already lost.
      return report(job, "retry", {
        reason: "server_error",
        warning: `${cause}; could not settle: ${describe(settleError)}`,
      });
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runJob(
  client: SupabaseClient,
  job: ClaimedJob,
  now: Clock,
  submitted: SubmittedPage | undefined,
): Promise<JobReport> {
  const fetched: FetchOutcome = submitted
    ? {
        ok: true,
        page: {
          url: submitted.url,
          status: 200,
          contentType: "text/html",
          html: submitted.html,
          bytes: Buffer.byteLength(submitted.html, "utf8"),
        },
      }
    : await fetchPage(job.url);

  if (!fetched.ok) {
    return await settleFailure(client, job, fetched.reason, null, {
      now,
      note: fetched.note,
    });
  }

  const extracted = extractArticle({
    url: fetched.page.url,
    html: fetched.page.html,
  });

  if (!extracted.ok) {
    return await settleFailure(
      client,
      job,
      extracted.reason,
      extracted.metadata,
      { now },
    );
  }

  const { metadata, content } = extracted;

  const { error: updateError } = await client
    .from("items")
    .update({
      ...metadataColumns(metadata),
      word_count: content.wordCount,
      reading_minutes: content.readingMinutes,
      status: "ready",
      // The check constraint on items requires this: a ready row must not
      // still be claiming a reason, or a retry that finally succeeds leaves an
      // error on screen and nobody notices for a month.
      fail_reason: null,
    })
    .eq("id", job.item_id);

  if (updateError) {
    return await settleFailure(client, job, "server_error", null, {
      now,
      cause: updateError.message,
    });
  }

  const { error: contentError } = await client.from("item_content").upsert(
    {
      item_id: job.item_id,
      user_id: job.user_id,
      html: content.html,
      text: content.text,
      extractor: content.extractor,
      extracted_at: new Date(now()).toISOString(),
    },
    { onConflict: "item_id" },
  );

  if (contentError) {
    // The item now says `ready` with no body behind it. settleFailure puts it
    // back to a truthful state — pending for another attempt, or failed — so
    // the reader never opens an article that is not there.
    return await settleFailure(client, job, "server_error", null, {
      now,
      cause: contentError.message,
    });
  }

  const { error: jobError } = await client
    .from("fetch_jobs")
    .update({ state: "done", locked_at: null, last_error: null })
    .eq("id", job.job_id);

  // Everything below is bookkeeping after the article is safely stored. It is
  // reported, never allowed to undo a successful extraction: marking a ready
  // item failed because a second UPDATE lost its connection would throw away
  // work that is already on disk.
  const canonical = await adoptCanonicalUrl(client, job, metadata);

  const warning =
    [
      jobError ? `could not close the job: ${jobError.message}` : null,
      canonical,
    ]
      .filter((line): line is string => line !== null)
      .join("; ") || null;

  return report(job, "done", { warning });
}
function report(
  job: ClaimedJob,
  outcome: JobReport["outcome"],
  extra: Partial<JobReport> = {},
): JobReport {
  return {
    jobId: job.job_id,
    itemId: job.item_id,
    userId: job.user_id,
    url: job.url,
    attempts: job.attempts,
    outcome,
    reason: null,
    note: null,
    runAfter: null,
    warning: null,
    ...extra,
  };
}

interface SettleOptions {
  readonly now: Clock;
  /** Which fetcher guard tripped, when the failure came from the fetcher. */
  readonly note?: FetchNote;
  /** A database error message, when we are the ones who failed. */
  readonly cause?: string;
}

/**
 * Record a failed attempt against both the job and the item.
 *
 * The item is only marked failed once the job is out of attempts. Until then
 * it stays `pending`, because it is: another attempt is already scheduled, and
 * showing "That site blocked us" thirty seconds before it succeeds is a lie
 * the user has already acted on.
 */
async function settleFailure(
  client: SupabaseClient,
  job: ClaimedJob,
  reason: FailReason,
  metadata: ArticleMetadata | null,
  options: SettleOptions,
): Promise<JobReport> {
  const at = options.now();
  const settlement = planSettlement(reason, job.attempts, job.max_attempts, at);
  const warnings: string[] = options.cause ? [options.cause] : [];

  if (settlement.kind === "retry") {
    const runAfter = settlement.runAfter.toISOString();

    const { error } = await client
      .from("fetch_jobs")
      .update({
        state: "queued",
        locked_at: null,
        run_after: runAfter,
        last_error: reason,
      })
      .eq("id", job.job_id);

    if (error) warnings.push(`could not requeue the job: ${error.message}`);

    return report(job, "retry", {
      reason,
      note: options.note ?? null,
      runAfter,
      warning: warnings.join("; ") || null,
    });
  }

  // A fetch that never got a document has no metadata to write, and writing
  // nulls over a previous run's title would make the row worse, not honest.
  const columns = metadata === null ? {} : metadataColumns(metadata);

  const { error: itemError } = await client
    .from("items")
    .update({ ...columns, status: "failed", fail_reason: reason })
    .eq("id", job.item_id);

  if (itemError) {
    warnings.push(`could not fail the item: ${itemError.message}`);
  }

  const { error: jobError } = await client
    .from("fetch_jobs")
    .update({ state: "failed", locked_at: null, last_error: reason })
    .eq("id", job.job_id);

  if (jobError) {
    warnings.push(`could not fail the job: ${jobError.message}`);
  }

  return report(job, "failed", {
    reason,
    note: options.note ?? null,
    warning: warnings.join("; ") || null,
  });
}

/**
 * Adopt the URL the page says is canonical, when extraction found one that
 * differs from what we stored. Returns a warning, or null when there is
 * nothing to say.
 *
 * Never fatal: url_hash is unique per user, so a page whose canonical is an
 * article already in the library collides. Merging two items is a decision
 * nobody has made yet — read position, tags and highlights all have to go
 * somewhere — so the two rows stay two rows and the collision is swallowed
 * without comment. Any other error costs a dedupe, not the article.
 */
async function adoptCanonicalUrl(
  client: SupabaseClient,
  job: ClaimedJob,
  metadata: ArticleMetadata,
): Promise<string | null> {
  if (metadata.urlHash === job.url_hash) return null;

  const { error } = await client
    .from("items")
    .update({
      canonical_url: metadata.canonicalUrl,
      url_hash: metadata.urlHash,
    })
    .eq("id", job.item_id);

  if (!error || error.code === UNIQUE_VIOLATION) return null;

  return `could not adopt the canonical url: ${error.message}`;
}
