"use client";

import { useActionState, useState } from "react";

export interface TokenActionState {
  error?: string;
  token?: string;
  message?: string;
}

export type TokenAction = (
  previous: TokenActionState,
  form: FormData,
) => Promise<TokenActionState>;

export function TokenForm({ action }: { action: TokenAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);

  async function copyToken() {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-lg border border-edge p-5">
      <h2 className="text-lg font-semibold">Connect a browser</h2>
      <p className="mt-2 text-sm text-ink-dim">
        Give this browser a name, then paste its token into the extension’s
        options. It can only save links. It cannot read your library or change
        your settings.
      </p>
      <form
        action={formAction}
        onSubmit={() => setCopied(false)}
        className="mt-4 grid gap-3"
      >
        <label htmlFor="browser-name" className="text-sm font-medium">
          Browser name
        </label>
        <input
          id="browser-name"
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          className="rounded border border-edge bg-ground px-3 py-2"
        />
        <button
          disabled={pending}
          className="w-fit rounded bg-accent px-4 py-2 font-medium text-ground disabled:opacity-50"
        >
          {pending ? "Generating…" : "Generate save token"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-3 text-sm">
          {state.error}
        </p>
      )}
      {state.token && (
        <div className="mt-5 grid gap-3">
          <label htmlFor="save-token" className="text-sm font-medium">
            Copy this token now. It is shown only once.
          </label>
          <input
            id="save-token"
            value={state.token}
            readOnly
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded border border-edge bg-ground px-3 py-2 font-mono text-sm"
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            onClick={copyToken}
            className="w-fit text-sm text-accent underline underline-offset-2"
          >
            {copied ? "Copied" : "Copy token"}
          </button>
          <p className="text-sm text-ink-dim">
            Paste it into the extension, then close this page. The token lasts
            until you revoke it below.
          </p>
        </div>
      )}
    </section>
  );
}

export function RevokeToken({
  action,
  id,
}: {
  action: TokenAction;
  id: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button
        disabled={pending}
        className="text-sm text-accent underline underline-offset-2 disabled:opacity-50"
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-sm">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="mt-2 text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}
