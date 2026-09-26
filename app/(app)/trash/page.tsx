import { redirect } from "next/navigation";

import { TrashList } from "@/components/trash-list";
import { createServerSupabase } from "@/lib/db/server";
import { PAGE_SIZE } from "@/lib/tags";
import {
  TRASH_COLUMNS,
  toTrashEntry,
  trashPage,
  trashUrl,
  type TrashEntry,
  type TrashRow,
} from "@/lib/trash";

export const metadata = { title: "Trash" };
export const dynamic = "force-dynamic";

type TrashView =
  | { kind: "signed-out" }
  | { kind: "failed" }
  | {
      kind: "ready";
      entries: TrashEntry[];
      hasMore: boolean;
      total: number | null;
      cutoff: string | null;
    };

async function loadTrash(page: number): Promise<TrashView> {
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { kind: "signed-out" };
  const offset = (page - 1) * PAGE_SIZE;
  const [list, newest] = await Promise.all([
    // RLS keeps this to the reader's rows; items_trash_idx (0011) serves it.
    db
      .from("items")
      .select(TRASH_COLUMNS)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE),
    // Whatever page this is, Empty trash needs the whole trash's count, to
    // say what it will delete, and its newest deleted_at, to stop there.
    // One statement, so the two agree.
    db
      .from("items")
      .select("deleted_at", { count: "exact" })
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(1),
  ]);
  if (list.error || !list.data || newest.error) return { kind: "failed" };
  // Taken once, on the server, for every row: see purgeCountdown.
  const now = Date.now();
  const rows = list.data as unknown as TrashRow[];
  const latest = (newest.data as { deleted_at: string }[] | null)?.[0];
  return {
    kind: "ready",
    entries: rows.slice(0, PAGE_SIZE).map((row) => toTrashEntry(row, now)),
    hasMore: rows.length > PAGE_SIZE,
    total: newest.count,
    cutoff: latest?.deleted_at ?? null,
  };
}

export default async function TrashPage({ searchParams }: PageProps<"/trash">) {
  const page = trashPage((await searchParams).page);
  const view = await loadTrash(page);
  if (view.kind === "signed-out")
    redirect(`/auth/sign-in?next=${encodeURIComponent(trashUrl(page))}`);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-6">
      {view.kind === "failed" ? (
        <p
          role="alert"
          className="rounded-lg border border-edge p-4 text-red-400"
        >
          Could not load your Trash. Refresh to try again.
        </p>
      ) : (
        <TrashList
          entries={view.entries}
          page={page}
          hasMore={view.hasMore}
          total={view.total}
          cutoff={view.cutoff}
        />
      )}
    </main>
  );
}
