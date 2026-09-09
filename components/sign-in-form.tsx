"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { sendMagicLink } from "@/app/auth/actions";
import { SIGN_IN_INITIAL_STATE } from "@/app/auth/state";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-ground transition-opacity disabled:opacity-60"
    >
      {pending ? "Sending…" : "Email me a link"}
    </button>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(
    sendMagicLink,
    SIGN_IN_INITIAL_STATE,
  );

  if (state.status === "sent") {
    return (
      <div
        role="status"
        className="rounded-lg border border-edge bg-ground-raised p-5"
      >
        <p className="text-sm text-ink">
          Link sent to <span className="text-accent">{state.email}</span>.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">
          Open it in this browser — the link is tied to it, so a link opened on
          another device will not work. Check spam if it does not arrive within
          a minute.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />

      <label htmlFor="email" className="block text-sm text-ink-dim">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        autoFocus
        placeholder="you@example.com"
        aria-describedby={
          state.status === "error" ? "sign-in-error" : undefined
        }
        className="w-full rounded-lg border border-edge bg-ground-raised px-4 py-3 text-base text-ink placeholder:text-ink-faint"
      />

      <SubmitButton />

      {state.status === "error" && (
        <p id="sign-in-error" role="alert" className="text-sm text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
