import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, root)), "utf8").replace(
    /\r\n/g,
    "\n",
  );
const migration = read("supabase/migrations/0005_extension_tokens.sql");
const schema = read("docs/SCHEMA.sql");
const previous = read("supabase/migrations/0002_save_item_enum_cast.sql");

function body(sql: string, name: string): string {
  const found = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
  ).exec(sql);
  if (!found) throw new Error(`Missing SQL function ${name}`);
  return found[1];
}

const statements = (value: string) =>
  value
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("approved shared save implementation", () => {
  it("preserves every existing statement except the source of the user id", () => {
    const expected = body(previous, "save_item").replace(
      "v_user uuid := (select auth.uid());",
      "v_user uuid := p_user_id;",
    );
    expect(statements(body(migration, "save_item_impl"))).toBe(
      statements(expected),
    );
    expect(body(schema, "save_item_impl")).toBe(
      body(migration, "save_item_impl"),
    );
  });

  it("keeps the web wrapper restricted to auth.uid with no duplicate upsert", () => {
    const wrapper = statements(body(migration, "save_item"));
    expect(wrapper).toBe(
      "begin return public.save_item_impl( (select auth.uid()), p_url, p_canonical_url, p_url_hash ); end;",
    );
    expect(body(schema, "save_item")).toBe(body(migration, "save_item"));
    expect(migration.match(/insert into public\.items/g)).toHaveLength(1);
  });

  it("restricts identity-taking execution and creates grants atomically", () => {
    expect(migration).toMatch(
      /revoke all on function public\.save_item_impl\(uuid, text, text, text\)\s+from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.save_item_impl\(uuid, text, text, text\)\s+to service_role;/,
    );
    expect(migration).toMatch(/begin;[\s\S]*create or replace function/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
  });

  it("gives token owners metadata access and revocation without hash reads or reactivation", () => {
    expect(migration).toContain(
      "alter table public.extension_tokens enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.extension_tokens from public, anon, authenticated;",
    );
    expect(migration).toMatch(
      /grant select \(id, user_id, name, created_at, revoked_at\)\s+on public\.extension_tokens to authenticated;/,
    );
    expect(migration).toContain(
      "grant update (revoked_at) on public.extension_tokens to authenticated;",
    );
    expect(migration).toContain(
      "using ((select auth.uid()) = user_id and revoked_at is null)",
    );
    expect(migration).toContain(
      "with check ((select auth.uid()) = user_id and revoked_at is not null)",
    );
  });
});
