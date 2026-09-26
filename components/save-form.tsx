"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { SaveResponse } from "@/app/api/save/route";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; alreadySaved: boolean }
  | { kind: "error"; message: string };

const EXAMPLE_URL = "https://en.wikipedia.org/wiki/Spaced_repetition";

/**
 * Accepts a bare host as well as a full URL. Someone pasting from a phone
 * address bar often gets "example.com/post", and refusing that is a pointless
 * argument to have with the person trying to use your app.
 */
function coerceUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidates = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? [trimmed]
    : [`https://${trimmed}`];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url;
    } catch {
      // Try the next shape, then fall through to null.
    }
  }
  return null;
}

export function SaveForm({ isEmpty }: { isEmpty: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const url = coerceUrl(value);
    if (!url) {
      setStatus({
        kind: "error",
        message: "That does not look like a web address.",
      });
      return;
    }

    setStatus({ kind: "saving" });

    try {
      const response = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.toString() }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "Could not save that.";
        setStatus({ kind: "error", message });
        return;
      }

      const body = (await response.json()) as SaveResponse;
      setValue("");
      setStatus({ kind: "saved", alreadySaved: body.alreadySaved });
      // Re-render the server component so the new row appears. The item is
      // saved either way; a failure here is a stale list, not lost data.
      router.refresh();
    } catch {
      setStatus({
        kind: "error",
        message: "No connection. The link was not saved.",
      });
    }
  }

  const saving = status.kind === "saving";

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="save-url" className="sr-only">
          Link to save
        </label>
        <input
          id="save-url"
          ref={inputRef}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Paste a link"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (status.kind !== "idle") setStatus({ kind: "idle" });
          }}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ground-raised px-4 py-3 text-base text-ink placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={saving || value.trim() === ""}
          className="rounded-lg bg-accent px-5 py-3 text-sm font-medium text-ground transition-opacity disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <div aria-live="polite" className="min-h-5">
        {status.kind === "error" && (
          <p className="mt-2 text-sm text-red-400">{status.message}</p>
        )}
        {status.kind === "saved" && (
          <p className="mt-2 text-sm text-ink-dim">
            {status.alreadySaved
              ? "Already in your library — it's in your inbox, under the date you first saved it."
              : "Saved."}
          </p>
        )}
      </div>

      {isEmpty && (
        <p className="mt-2 text-sm text-ink-faint">
          Nothing to hand?{" "}
          <button
            type="button"
            onClick={() => {
              setValue(EXAMPLE_URL);
              setStatus({ kind: "idle" });
              inputRef.current?.focus();
            }}
            className="text-accent underline underline-offset-4"
          >
            Try one
          </button>
          .
        </p>
      )}
    </div>
  );
}
