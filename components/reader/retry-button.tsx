"use client";

import { useActionState } from "react";
import { SAVE_LIMIT } from "@/lib/rate-limit";
import { retryReadingItem } from "./actions";

export function RetryButton({ id, preview }: { id: string; preview: boolean }) {
  const [message, action, pending] = useActionState(async () => {
    if (preview)
      return "This is a failure fixture. No extraction was requested; open the Pending fixture to inspect the next state.";
    try {
      if ((await retryReadingItem(id)) === "limited")
        return `That is ${SAVE_LIMIT} saves in an hour, which is the limit. Your link is still saved; try again later.`;
      return "Trying again now. Check again in a few seconds.";
    } catch {
      return "Could not retry just now. Your link is still saved. Try again in a moment.";
    }
  }, "");
  return (
    <form action={action}>
      <button type="submit" disabled={pending}>
        {pending ? "Requesting…" : "Try again"}
      </button>
      {message && (
        <p className="reader-save-note" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
