import { NextResponse, type NextRequest } from "next/server";

import * as Sentry from "@sentry/nextjs";

import { createServiceSupabase } from "@/lib/db/service";
import {
  PURGE_AFTER,
  authoriseCronRequest,
  purgeDeletedItems,
} from "@/lib/queue";

/**
 * The purge. Vercel Cron calls this daily; see vercel.json.
 *
 * Soft delete is what the app does — Slice 4's undo depends on it — and this
 * is the other half of that promise: a deleted item really is gone thirty days
 * later, from item_content and highlights too, through the FK cascade. An app
 * that says "deleted" and means "hidden" for ever is one nobody should trust
 * with what they read.
 *
 * The boundary lives in purge_deleted_items (0003_jobs.sql) so that the delete
 * is one statement against the database, not a list of ids shipped to a
 * serverless function and shipped back.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = authoriseCronRequest(request);

  if (auth === "misconfigured") {
    Sentry.captureMessage("cron/purge: CRON_SECRET is not set", {
      level: "error",
      tags: { route: "api/cron/purge" },
    });
    return NextResponse.json(
      { error: "Cron is not configured." },
      { status: 500 },
    );
  }

  if (auth === "unauthorised") {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  try {
    const purged = await purgeDeletedItems(
      createServiceSupabase(),
      PURGE_AFTER,
    );

    return NextResponse.json({ purged, olderThan: PURGE_AFTER });
  } catch (error) {
    // A purge that fails silently is a retention policy that is not being
    // kept, and nothing in the product would ever show it.
    Sentry.captureException(error, { tags: { route: "api/cron/purge" } });
    return NextResponse.json({ error: "Could not purge." }, { status: 500 });
  }
}
