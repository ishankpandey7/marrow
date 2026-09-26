import { redirect } from "next/navigation";
import { loadLibrary } from "@/app/(app)/actions";
import { BacklogStrip } from "@/components/backlog-strip";
import { OrganiseInbox } from "@/components/filter-bar";
import {
  isoWeek,
  showsBacklog,
  toBacklogEntry,
  type BacklogEntry,
  type BacklogRow,
} from "@/lib/backlog";
import { createServerSupabase } from "@/lib/db/server";
import { parseFilters } from "@/lib/tags";

export const metadata = { title: "Library" };
export const dynamic = "force-dynamic";

async function loadBacklog(): Promise<BacklogEntry[]> {
  const db = await createServerSupabase();
  // Taken once: the week picks the three, and the same instant words them.
  const now = Date.now();
  const { data, error } = await db.rpc("backlog_strip", {
    p_week: isoWeek(now),
  });
  // The strip is a way back into the library, not part of it. If it cannot
  // load, the library below still must, so it is left out rather than shown
  // as an error.
  if (error || !data) return [];
  return (data as BacklogRow[]).map((row) => toBacklogEntry(row, now));
}

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const filters = parseFilters(await searchParams);
  const result = await loadLibrary(filters);
  if (result.signedOut) redirect("/auth/sign-in?next=/inbox");
  const backlog =
    result.snapshot && showsBacklog(filters) ? await loadBacklog() : [];
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-6">
      {result.snapshot ? (
        <OrganiseInbox
          initial={result.snapshot}
          filters={filters}
          backlog={
            backlog.length ? <BacklogStrip entries={backlog} /> : undefined
          }
        />
      ) : (
        <p
          role="alert"
          className="rounded-lg border border-edge p-4 text-red-400"
        >
          {result.message}
        </p>
      )}
    </main>
  );
}
