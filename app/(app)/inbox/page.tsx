import { redirect } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { ItemRow } from "@/components/item-row";
import { SaveForm } from "@/components/save-form";
import { createServerSupabase } from "@/lib/db/server";
import { ITEM_LIST_COLUMNS, type ItemListRow } from "@/lib/types";

export const metadata = {
  title: "Inbox",
};

// Per-user, mutable data. A cached list showing someone else's inbox, or your
// own from ten minutes ago, is worse than a list that takes another 80ms.
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?next=/inbox");
  }

  // No `where user_id = ...` here on purpose. RLS scopes this to the caller,
  // so a mistake in this query returns nothing rather than someone else's
  // library. The filters that remain are about state, not ownership.
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_LIST_COLUMNS)
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  const items = (data ?? []) as ItemListRow[];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6">
      <SaveForm isEmpty={items.length === 0 && !error} />

      {error ? (
        <p
          role="alert"
          className="mt-8 rounded-lg border border-edge p-4 text-sm leading-relaxed text-red-400"
        >
          Could not load your library just now. Refresh to try again.
        </p>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-6">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
