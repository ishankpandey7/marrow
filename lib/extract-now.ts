import "server-only";

import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { createServiceSupabase } from "@/lib/db/service";
import {
  claimItemJob,
  processJob,
  type JobReport,
  type SubmittedPage,
} from "@/lib/queue";

/**
 * Fetch a just-queued item after the response has gone (Slice 9).
 *
 * The save answers at once and the fetch runs in `after()`, so nobody waits
 * on a publisher's server to see their row appear. The daily cron remains the
 * backstop: if this is cut off, or the site does not answer, the job is still
 * in the queue and the next run takes it.
 *
 * `userId` must be the verified owner — the `user_id` on the row our own save
 * or retry RPC returned, never request input. The claim is keyed on it.
 *
 * With `page`, the markup the reader's browser already loaded is extracted
 * instead of fetching (Slice 10). It is claimed the same way, so it cannot
 * race a cron fetch of the same item.
 */
export function extractSoon(
  itemId: string,
  userId: string,
  route: string,
  page?: SubmittedPage,
) {
  after(async () => {
    try {
      // Service role, not the caller's client: item_content and fetch_jobs
      // accept writes from nobody else, and an RLS-scoped write here would
      // fail after the response, where no one would see it.
      const client = createServiceSupabase();
      const job = await claimItemJob(
        client,
        itemId,
        userId,
        page !== undefined,
      );
      if (job) recordJobReport(await processJob(client, job, { page }), route);
    } catch (error) {
      Sentry.captureException(error, { tags: { route } });
    }
    // The function is frozen once this callback returns, and Sentry batches.
    await Sentry.flush(2000);
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
export function recordJobReport(report: JobReport, route: string): void {
  const label = route.replace(/^api\//, "");

  if (report.warning !== null) {
    Sentry.captureMessage(`${label}: ${report.warning}`, {
      level: "error",
      tags: { route, outcome: report.outcome },
      extra: { url: report.url, itemId: report.itemId },
    });
  }

  if (report.reason === null) return;

  Sentry.captureMessage(`${label}: ${report.reason}`, {
    level: report.reason === "blocked_url" ? "warning" : "info",
    tags: {
      route,
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
