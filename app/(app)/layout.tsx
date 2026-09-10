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
            <a
              href="/search"
              className="text-xs text-ink-dim transition-colors hover:text-ink"
            >
              Search
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
