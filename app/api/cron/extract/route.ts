import { NextResponse, type NextRequest } from "next/server";

import * as Sentry from "@sentry/nextjs";

import { createServiceSupabase } from "@/lib/db/service";
import {
  CLAIM_BATCH_SIZE,
  DRAIN_BUDGET_MS,
  authoriseCronRequest,
  claimJobs,
  processJob,
  reclaimStalledJobs,
  type JobReport,
} from "@/lib/queue";

/**
 * The extraction worker. Vercel Cron calls this on the schedule in vercel.json,
 * and `vercel crons run` or the dashboard's Run button call it on demand.
 *
 * It does three things in order: recover jobs abandoned by a worker that died,
 * claim batches until the queue is empty, and run each batch. The claim is the
 * part that has to be right — invocations can overlap, whether because two
 * schedules land together or because someone triggers a run while one is in
 * flight — and `for update skip locked` in claim_fetch_jobs is what stops both
 * of them fetching the same URL. See 0003_jobs.sql.
 */

// ARCHITECTURE section 5: anything that calls the fetcher needs node:dns and a
// socket-level lookup hook, and neither exists on Edge.
export const runtime = "nodejs";

// A cron route must never be served from a cache. Reading the Authorization
// header already forces this; saying it is cheaper than rediscovering it.
export const dynamic = "force-dynamic";

/**
 * The fetcher's own budget is ten seconds and the batch runs concurrently, so
 * a healthy invocation finishes well inside this. The ceiling exists for the
 * unhealthy one: a run killed by the platform leaves its rows locked, and they
 * then wait out the stale-lock window before anyone can pick them up.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = authoriseCronRequest(request);

  if (auth === "misconfigured") {
    Sentry.captureMessage("cron/extract: CRON_SECRET is not set", {
      level: "error",
      tags: { route: "api/cron/extract" },
    });
    await Sentry.flush(2000);
    return NextResponse.json(
      { error: "Cron is not configured." },
      { status: 500 },
    );
  }

  if (auth === "unauthorised") {
    // No detail, and no WWW-Authenticate header inviting a second guess.
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const client = createServiceSupabase();

  let reclaimed = 0;
  try {
    reclaimed = await reclaimStalledJobs(client);
  } catch (error) {
    // Recovering stalled rows is maintenance. Failing it should not stop the
    // run from doing the work that is actually queued.
    Sentry.captureException(error, { tags: { route: "api/cron/extract" } });
  }

  // Drain, rather than take one batch and leave. Throughput is the batch size
  // times how often the cron runs, and on Hobby it runs once a day — so a run
  // keeps claiming until the queue is empty or the budget is spent. Under a
  // per-minute schedule this changes nothing on a quiet queue and clears a
  // backlog faster on a busy one.
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  const reports: JobReport[] = [];
  let rounds = 0;
  let drained = false;

  while (Date.now() < deadline) {
    let batch;
    try {
      batch = await claimJobs(client, CLAIM_BATCH_SIZE);
    } catch (error) {
      Sentry.captureException(error, { tags: { route: "api/cron/extract" } });
      // Nothing processed yet means the queue is unreachable, not empty; say
      // so. A later round failing still leaves real work to report.
      if (rounds === 0) {
        await Sentry.flush(2000);
        return NextResponse.json(
          { error: "Could not claim jobs." },
          { status: 500 },
        );
      }
      break;
    }

    if (batch.length === 0) {
      drained = true;
      break;
    }

    rounds += 1;

    // Concurrently: five fetches of five different hosts, so a round costs one
    // fetch budget rather than five. processJob never throws, so no result
    // here can take the rest of the batch down with it.
    reports.push(
      ...(await Promise.all(batch.map((job) => processJob(client, job)))),
    );
  }

  for (const report of reports) record(report);

  // A serverless function is frozen the moment it returns, and Sentry batches,
  // so an event queued above can be dropped before it is ever sent. Flushing
  // is the documented remedy and costs nothing when the queue is empty.
  //
  // It is *not* why this deployment reports nothing. Server-side Sentry is
  // dead on the deployed app generally: /api/debug-sentry throws in production
  // and produces no event either, and that route exists precisely to answer
  // this question. A Slice 0 fault, tracked in ROADMAP.md, not one this slice
  // reaches into and fixes.
  await Sentry.flush(2000);

  return NextResponse.json({
    reclaimed,
    rounds,
    // False means the budget ran out with work still queued. The next run
    // picks it up; a run of these in a row means the schedule is too slow.
    drained,
    claimed: reports.length,
    done: reports.filter((r) => r.outcome === "done").length,
    retrying: reports.filter((r) => r.outcome === "retry").length,
    failed: reports.filter((r) => r.outcome === "failed").length,
    jobs: reports.map((r) => ({
      jobId: r.jobId,
      itemId: r.itemId,
      outcome: r.outcome,
      reason: r.reason,
      attempts: r.attempts,
      runAfter: r.runAfter,
    })),
  });
}

/**
 * ARCHITECTURE section 11: every extraction failure is logged with its URL and
 * its code. `blocked_url` is raised to warning on purpose — one is a user
 * pasting something odd, and a spike is someone probing the fetcher, which is
 * only visible if the events are countable in the first place.
 *
 * The note travels here and nowhere near a response body. "Blocked: connection
 * refused to 10.0.0.7" is a working port scanner with a nice UI.
 */
function record(report: JobReport): void {
  if (report.warning !== null) {
    Sentry.captureMessage(`cron/extract: ${report.warning}`, {
      level: "error",
      tags: { route: "api/cron/extract", outcome: report.outcome },
      extra: { url: report.url, itemId: report.itemId },
    });
  }

  if (report.reason === null) return;

  Sentry.captureMessage(`cron/extract: ${report.reason}`, {
    level: report.reason === "blocked_url" ? "warning" : "info",
    tags: {
      route: "api/cron/extract",
      failReason: report.reason,
      outcome: report.outcome,
    },
    extra: {
      url: report.url,
      itemId: report.itemId,
      note: report.note,
      attempts: report.attempts,
      runAfter: report.runAfter,
    },
  });
}
