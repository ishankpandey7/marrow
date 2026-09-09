import Link from "next/link";

import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

const PROMISES = [
  "Fetched and parsed on the server, so the page you saved is the page you get.",
  "No tracker soup, no cookie banner, no newsletter modal on top of paragraph two.",
  "Your copy. Export the whole library as JSON whenever you want it.",
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <p className="mb-10 font-mono text-xs tracking-[0.2em] text-ink-faint uppercase">
        Coming soon
      </p>

      <h1 className="font-serif text-5xl leading-none tracking-tight sm:text-6xl">
        {APP_NAME}
      </h1>

      <p className="mt-5 text-lg leading-relaxed text-balance text-ink-dim">
        {APP_TAGLINE}
      </p>

      <ul className="mt-12 space-y-4 border-t border-edge pt-8">
        {PROMISES.map((promise) => (
          <li
            key={promise}
            className="flex gap-3 text-sm leading-relaxed text-ink-dim"
          >
            <span aria-hidden="true" className="text-accent select-none">
              —
            </span>
            <span>{promise}</span>
          </li>
        ))}
      </ul>

      <footer className="mt-16 text-xs">
        <Link
          href="/auth/sign-in"
          className="text-accent underline underline-offset-4"
        >
          Sign in
        </Link>
        <span className="text-ink-faint">
          {" "}
          — no password, just an email link.
        </span>
      </footer>
    </main>
  );
}
