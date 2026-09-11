import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/db/server";
import {
  extensionTokenSecret,
  issueExtensionToken,
  TOKEN_METADATA,
  type ExtensionTokenMetadata,
} from "@/extension/server/tokens";
import {
  RevokeToken,
  TokenForm,
  type TokenActionState,
} from "@/extension/web/token-form";

export const metadata = { title: "Browser extension" };
export const dynamic = "force-dynamic";

export default async function ExtensionSettingsPage() {
  const client = await createServerSupabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=%2Fsettings%2Fextension");

  async function generate(
    _previous: TokenActionState,
    form: FormData,
  ): Promise<TokenActionState> {
    "use server";
    const client = await createServerSupabase();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return { error: "Sign in again to generate a token." };
    const name = form.get("name");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      return { error: "Enter a browser name of 1–80 characters." };
    }
    try {
      const token = await issueExtensionToken(
        client,
        user.id,
        name.trim(),
        extensionTokenSecret(),
      );
      revalidatePath("/settings/extension");
      return { token };
    } catch {
      return { error: "Could not generate a token. Try again shortly." };
    }
  }

  async function revoke(
    _previous: TokenActionState,
    form: FormData,
  ): Promise<TokenActionState> {
    "use server";
    const client = await createServerSupabase();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return { error: "Sign in again to revoke a token." };
    const id = form.get("id");
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
      return { error: "Choose a token from this page." };
    }
    const { data, error } = await client
      .from("extension_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id");
    if (error) return { error: "Could not revoke that token. Try again." };
    if (!data?.length)
      return { error: "That token is already revoked or unavailable." };
    revalidatePath("/settings/extension");
    return { message: "Token revoked." };
  }

  const { data, error } = await client
    .from("extension_tokens")
    .select(TOKEN_METADATA)
    .order("created_at", { ascending: false });
  const tokens = (data ?? []) as ExtensionTokenMetadata[];

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <a
        href="/inbox"
        className="text-sm text-accent underline underline-offset-2"
      >
        Back to library
      </a>
      <div>
        <h1 className="text-2xl font-semibold">Browser extension</h1>
        <p className="mt-2 text-ink-dim">
          Save the page you’re on with one click.
        </p>
      </div>
      <TokenForm action={generate} />
      <section>
        <h2 className="text-lg font-semibold">Your browser tokens</h2>
        <p className="mt-2 text-sm text-ink-dim">
          Revoke a token to stop future saves from that browser. Your saved
          articles stay in your library.
        </p>
        {error ? (
          <p role="alert" className="mt-4">
            Could not load your tokens. Reload to try again.
          </p>
        ) : tokens.length ? (
          <ul className="mt-4 divide-y divide-edge">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex items-start justify-between gap-4 py-4"
              >
                <div>
                  <p className="font-medium break-words">{token.name}</p>
                  <p className="mt-1 text-sm text-ink-dim">
                    Created{" "}
                    {new Date(token.created_at).toISOString().slice(0, 10)}
                  </p>
                </div>
                {token.revoked_at ? (
                  <span className="text-sm text-ink-dim">Revoked</span>
                ) : (
                  <RevokeToken action={revoke} id={token.id} />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-ink-dim">
            Generate your first token above to connect a browser.
          </p>
        )}
      </section>
    </main>
  );
}
