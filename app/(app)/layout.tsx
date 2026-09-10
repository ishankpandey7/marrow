import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { signOut } from "@/app/auth/actions";
import { APP_NAME } from "@/lib/constants";
import { createServerSupabase } from "@/lib/db/server";

/**
 * The authenticated shell. Middleware already redirects unauthenticated
 * requests, but this check stays: middleware config is a regex that someone
 * will eventually edit, and the layout is the thing that actually renders
 * private data.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-edge">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-4">
          <span className="font-serif text-lg tracking-tight">{APP_NAME}</span>

          <div className="flex min-w-0 items-center gap-3">
            {/* A bordered control rather than a text link, because the library
                page already has a big centred box labelled "Find on this page"
                and a small grey word loses to it every time. The first person
                to use this typed four full-text queries into that box before
                finding this one. Slice 8 owns joining the two properly; until
                then the entry point at least has to look like a control. */}
            <a
              href="/search"
              className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-sm whitespace-nowrap text-ink transition-colors hover:bg-ground-raised"
            >
              Search<span className="hidden sm:inline"> everything</span>
            </a>
            <span className="hidden truncate text-xs text-ink-faint sm:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="text-xs text-ink-dim transition-colors hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
