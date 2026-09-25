import { redirect } from "next/navigation";
import { Reader } from "@/components/reader/reader";
import { ReaderState } from "@/components/reader/reader-state";
import { createServerSupabase } from "@/lib/db/server";
import {
  HIGHLIGHT_COLUMNS,
  isUuid,
  type SavedHighlight,
} from "@/lib/highlights";
import { isRecord, readerSettings, type ReaderItem } from "@/lib/reading";

export const dynamic = "force-dynamic";
// Try again fetches in after() inside its Server Action, which takes the
// page's ceiling. Same reasoning as /api/save.
export const maxDuration = 60;
export const metadata = {
  title: "Reading",
  robots: { index: false, follow: false },
};

export default async function ReadingPage({
  params,
  searchParams,
}: PageProps<"/read/[id]">) {
  const { id } = await params;
  const { h } = await searchParams;
  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/read/${id}`)}`);
  const [itemResult, contentResult, profileResult, highlightResult] =
    await Promise.all([
      db
        .from("items")
        .select(
          "id, url, title, author, site_name, published_at, reading_minutes, status, fail_reason, read_progress, lang",
        )
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle(),
      db.from("item_content").select("html").eq("item_id", id).maybeSingle(),
      db.from("profiles").select("settings").eq("id", user.id).single(),
      db
        .from("highlights")
        .select(HIGHLIGHT_COLUMNS)
        .eq("item_id", id)
        .order("start_offset"),
    ]);
  if (itemResult.error || !itemResult.data)
    return (
      <main className="reader" data-theme="system">
        <ReaderState reason="missing" id={id} url="" />
      </main>
    );
  const profile = profileResult.data?.settings as unknown;
  const highlights = highlightResult.error
    ? null
    : (highlightResult.data as SavedHighlight[]);
  // Only a highlight that exists suppresses the saved-position restore; a
  // stale link to a deleted one opens where the reader left off.
  const focusHighlight =
    isUuid(h) && highlights?.some((highlight) => highlight.id === h) ? h : null;
  return (
    <Reader
      item={itemResult.data as ReaderItem}
      html={contentResult.error ? null : (contentResult.data?.html ?? null)}
      settings={readerSettings(isRecord(profile) ? profile.reader : undefined)}
      storageScope={user.id}
      highlights={highlights}
      focusHighlight={focusHighlight}
    />
  );
}
