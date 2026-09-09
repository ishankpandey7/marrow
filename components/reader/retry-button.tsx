"use client";

import { useActionState } from "react";
import { retryReadingItem } from "./actions";

export function RetryButton({ id, preview }: { id: string; preview: boolean }) {
  const [message, action, pending] = useActionState(async () => {
    if (preview)
      return "This is a failure fixture. No extraction was requested; open the Pending fixture to inspect the next state.";
    try {
      await retryReadingItem(id);
      return "Retry queued. Your link is saved.";
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
