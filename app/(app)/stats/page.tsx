import { redirect } from "next/navigation";

import { StatsView } from "@/components/stats-view";
import { createServerSupabase } from "@/lib/db/server";
import { BACKLOG_FINISHED, BACKLOG_MIN_AGE_DAYS, isoWeek } from "@/lib/backlog";
import {
  STATS_WEEKS,
  statsWeeks,
  type StatsTotals,
  type StatsWeek,
} from "@/lib/stats";

export const metadata = { title: "Reading stats" };
export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

type View =
  | { kind: "signed-out" }
  | { kind: "failed" }
  | { kind: "ready"; weeks: StatsWeek[]; totals: StatsTotals };

async function loadStats(): Promise<View> {
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { kind: "signed-out" };
  // Taken once, so the weeks and the backlog's cut-off agree.
  const now = Date.now();
  const count = () =>
    db
      .from("items")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null);
  // RLS confines every one of these to the reader's own rows.
  const [weeks, saved, library, finished, backlog] = await Promise.all([
    db.rpc("reading_stats", { p_week: isoWeek(now), p_weeks: STATS_WEEKS }),
    count(),
    count().is("archived_at", null),
    count().not("read_at", "is", null),
    count()
      .eq("status", "ready")
      .is("archived_at", null)
      .lt("read_progress", BACKLOG_FINISHED)
      .lte(
        "created_at",
        new Date(now - BACKLOG_MIN_AGE_DAYS * DAY_MS).toISOString(),
      ),
  ]);
  const rows = weeks.error ? null : statsWeeks(weeks.data);
  const counts = [saved, library, finished, backlog].map((result) =>
    result.error ? null : result.count,
  );
  if (!rows || counts.some((value) => value === null))
    return { kind: "failed" };
  const [s, l, f, b] = counts as number[];
  return {
    kind: "ready",
    weeks: rows,
    totals: { saved: s, library: l, finished: f, backlog: b },
  };
}

export default async function StatsPage() {
  const view = await loadStats();
  if (view.kind === "signed-out")
    redirect(`/auth/sign-in?next=${encodeURIComponent("/stats")}`);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-6">
      {view.kind === "failed" ? (
        <p
          role="alert"
          className="rounded-lg border border-edge p-4 text-red-400"
        >
          Could not load your stats. Refresh to try again.
        </p>
      ) : (
        <StatsView weeks={view.weeks} totals={view.totals} />
      )}
    </main>
  );
}
