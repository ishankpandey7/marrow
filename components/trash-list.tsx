"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  deleteForever,
  emptyTrash,
  restoreFromTrash,
  type TrashOutcome,
} from "@/app/(app)/trash/actions";
import { PURGE_AFTER_DAYS } from "@/lib/constants";
import { trashUrl, type TrashEntry } from "@/lib/trash";

const buttonClass =
  "rounded-md border border-edge px-3 py-2 text-sm hover:bg-ground-raised disabled:opacity-40";
const dangerClass =
  "rounded-md border border-red-400 px-3 py-2 text-sm text-red-400 hover:bg-ground-raised disabled:opacity-40";

function count(n: number): string {
  return `${n} item${n === 1 ? "" : "s"}`;
}

/**
 * The Trash list (Slice 12). Deliberately not optimistic, unlike the
 * library: nothing here can be undone, so a row changes only when the
 * server says it did. Each action revalidates this page, and the rows that
 * come back are the truth.
 */
export function TrashList({
  entries,
  page,
  hasMore,
  total,
  cutoff,
}: {
  entries: TrashEntry[];
  page: number;
  hasMore: boolean;
  total: number | null;
  cutoff: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<TrashOutcome | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (emptying) {
      if (element && !element.open) {
        element.showModal();
        // showModal focuses the first button, which is the destructive one,
        // and an Enter still held from opening the dialog would press it.
        keep.current?.focus();
      }
    } else if (element?.open) element.close();
  }, [emptying]);

  function run(action: () => Promise<TrashOutcome>) {
    setConfirming(null);
    setEmptying(false);
    setOutcome(null);
    startTransition(async () => {
      let result: TrashOutcome;
      try {
        result = await action();
      } catch {
        result = {
          ok: false,
          message: "Connection lost. Reload to see what changed.",
        };
      }
      setOutcome(result);
      // The row holding focus has usually just left the list.
      if (result.ok) heading.current?.focus();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-xl font-medium outline-none"
        >
          Trash
        </h1>
        <div className="flex gap-2">
          <a href="/inbox" className={buttonClass}>
            ← Library
          </a>
          <button
            className={buttonClass}
            disabled={pending || !cutoff}
            onClick={() => setEmptying(true)}
          >
            Empty trash
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm text-ink-dim">
        Deleted items wait here for {PURGE_AFTER_DAYS} days, then the daily
        clean-up deletes them for good. Saving a link again also brings it back.
      </p>
      <p role="status" className="mt-3 min-h-5 text-sm text-ink-dim">
        {pending ? "Working…" : outcome?.ok ? outcome.message : ""}
      </p>
      {outcome && !outcome.ok && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-400 p-3 text-sm text-red-400"
        >
          {outcome.message}
        </p>
      )}
      <ul aria-label="Deleted items" className="mt-4 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-edge p-3">
            {/* Plain text on purpose: the reader refuses a trashed item. */}
            <p className="font-medium break-words">{entry.title}</p>
            <p className="mt-1 text-xs text-ink-faint">
              {entry.site} · {entry.deleted} · {entry.kept}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                className={buttonClass}
                disabled={pending}
                onClick={() => run(() => restoreFromTrash([entry.id]))}
              >
                Restore
              </button>
              {/* One button that changes its label, so focus stays on it
                  between the first press and the second. That also puts the
                  second press where a double-click or a held Enter lands, so
                  both are refused: neither is a decision to delete. */}
              <button
                className={confirming === entry.id ? dangerClass : buttonClass}
                disabled={pending}
                aria-describedby={
                  confirming === entry.id ? `warning-${entry.id}` : undefined
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.repeat)
                    event.preventDefault();
                }}
                onClick={(event) => {
                  if (confirming !== entry.id) setConfirming(entry.id);
                  else if (event.detail <= 1)
                    run(() => deleteForever([entry.id]));
                }}
              >
                {confirming === entry.id
                  ? "Yes, delete forever"
                  : "Delete forever"}
              </button>
              {confirming === entry.id && (
                <button
                  className={buttonClass}
                  disabled={pending}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              )}
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="ml-auto text-sm text-ink-dim hover:underline"
              >
                Open original ↗
              </a>
            </div>
            {confirming === entry.id && (
              <p
                id={`warning-${entry.id}`}
                className="mt-2 text-xs text-ink-dim"
              >
                This deletes the saved copy, its highlights and notes, your
                reading position and its tag links. The tags themselves stay. It
                can&apos;t be undone.
              </p>
            )}
          </li>
        ))}
      </ul>
      {!entries.length &&
        (page > 1 ? (
          <p className="py-12 text-center text-ink-dim">
            Nothing on this page.{" "}
            <a href={trashUrl(1)} className="underline">
              Go to the first page
            </a>
          </p>
        ) : (
          <p className="py-12 text-center text-ink-dim">Trash is empty.</p>
        ))}
      {(hasMore || page > 1) && (
        <nav
          aria-label="Pagination"
          className="my-6 flex items-center justify-between gap-3"
        >
          {page > 1 ? (
            <a className={buttonClass} href={trashUrl(page - 1)}>
              Previous
            </a>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-dim">Page {page}</span>
          {hasMore ? (
            <a className={buttonClass} href={trashUrl(page + 1)}>
              Next
            </a>
          ) : (
            <span />
          )}
        </nav>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="empty-trash-title"
        onCancel={() => setEmptying(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setEmptying(false);
        }}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-edge bg-ground p-0 text-ink backdrop:bg-black/60"
      >
        {/* The padding lives on this wrapper, not the dialog, so a click in
            it lands here and only a click on the backdrop dismisses. */}
        <div className="p-5">
          <h2 id="empty-trash-title" className="font-medium">
            Empty trash?
          </h2>
          <p className="mt-2 text-sm">
            {total === null ? "Everything in Trash" : count(total)} will be
            deleted forever, with the saved copies, highlights and notes. This
            can&apos;t be undone.
          </p>
          <p className="mt-2 text-xs text-ink-dim">
            Anything deleted after this page loaded stays in Trash.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className={dangerClass}
              disabled={pending || !cutoff}
              onClick={() => {
                if (cutoff) run(() => emptyTrash(cutoff));
              }}
            >
              {total === null
                ? "Delete everything forever"
                : `Delete ${count(total)} forever`}
            </button>
            <button
              ref={keep}
              className={buttonClass}
              onClick={() => setEmptying(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
