import Link from "next/link";

import { SignInForm } from "@/components/sign-in-form";
import { APP_NAME } from "@/lib/constants";
import { safeNext } from "@/lib/safe-next";

export const metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/auth/sign-in">) {
  const params = await searchParams;
  const next = safeNext(
    typeof params.next === "string" ? params.next : undefined,
  );
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <Link
        href="/"
        className="mb-10 self-start text-xs tracking-[0.2em] text-ink-faint uppercase hover:text-ink-dim"
      >
        ← {APP_NAME}
      </Link>

      <h1 className="font-serif text-3xl tracking-tight">Sign in</h1>
      <p className="mt-3 mb-8 text-sm leading-relaxed text-ink-dim">
        No password. We email you a link that signs you in — and creates your
        account if you do not have one yet.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-lg border border-edge bg-ground-raised p-4 text-sm leading-relaxed text-red-400"
        >
          {error}
        </p>
      )}

      <SignInForm next={next} />
    </main>
  );
}
