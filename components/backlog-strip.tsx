"use client";

import { useRef, useState, useTransition } from "react";

import { notNow, type NotNowOutcome } from "@/components/backlog-actions";
import { BACKLOG_RULE, type BacklogEntry } from "@/lib/backlog";

/**
 * "From your backlog" (Slice 13): up to three old, unfinished articles, with
 * the rule that picked them stated underneath the heading. Not now waits for
 * the server; the revalidated page brings the next item in.
 */
export function BacklogStrip({ entries }: { entries: BacklogEntry[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  function putOff(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      let result: NotNowOutcome;
      try {
        result = await notNow(id);
      } catch {
        result = {
          ok: false,
          message: "Connection lost. Reload to see what changed.",
        };
      }
      if (result.ok) {
        // It comes back at the first Monday after NOT_NOW_DAYS, hence about.
        setNotice("Hidden from the strip for about a month.");
        heading.current?.focus();
      } else setError(result.message);
    });
  }

  if (!entries.length) return null;

  return (
    <section
      aria-labelledby="backlog-title"
      className="mt-5 rounded-lg border border-edge p-3"
    >
      <h2
        id="backlog-title"
        ref={heading}
        tabIndex={-1}
        className="text-sm font-medium outline-none"
      >
        From your backlog
      </h2>
      <p className="mt-1 text-xs text-ink-faint">{BACKLOG_RULE}</p>
      <ul className="mt-3 space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                href={`/read/${entry.id}`}
                className="font-medium break-words hover:underline"
              >
                {entry.title}
              </a>
              <p className="mt-1 text-xs text-ink-faint">
                {entry.site} · {entry.why}
              </p>
            </div>
            <button
              className="shrink-0 rounded-md border border-edge px-3 py-2 text-sm hover:bg-ground-raised disabled:opacity-40"
              disabled={pending}
              aria-label={`Not now: ${entry.title}`}
              onClick={() => putOff(entry.id)}
            >
              Not now
            </button>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-2 text-xs text-ink-dim empty:hidden">
        {notice}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
