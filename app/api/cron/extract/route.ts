import { NextResponse, type NextRequest } from "next/server";

import * as Sentry from "@sentry/nextjs";

import { createServiceSupabase } from "@/lib/db/service";
import {
  CLAIM_BATCH_SIZE,
  authoriseCronRequest,
  claimJobs,
  processJob,
  reclaimStalledJobs,
  type JobReport,
} from "@/lib/queue";

/**
 * The extraction worker. Vercel Cron calls this every minute; see vercel.json.
 *
 * It does three things in order: recover jobs abandoned by a worker that died,
 * claim a small batch, and run it. The claim is the part that has to be right
 * — a one-minute schedule and a ten-second fetch budget mean two invocations
 * overlap routinely, and `for update skip locked` in claim_fetch_jobs is what
 * stops both of them fetching the same URL. See 0003_jobs.sql.
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

  let claimed;
  try {
    claimed = await claimJobs(client, CLAIM_BATCH_SIZE);
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "api/cron/extract" } });
    return NextResponse.json(
      { error: "Could not claim jobs." },
      { status: 500 },
    );
  }

  // Concurrently: five fetches of five different hosts, so the run costs one
  // fetch budget rather than five. processJob never throws, so no result here
  // can take the rest of the batch down with it.
  const reports = await Promise.all(
    claimed.map((job) => processJob(client, job)),
  );

  for (const report of reports) record(report);

  return NextResponse.json({
    reclaimed,
    claimed: claimed.length,
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
