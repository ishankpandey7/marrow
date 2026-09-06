import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These tests enforce the two schema invariants from ARCHITECTURE.md section 4
 * without needing a database, which means CI catches a violation on the pull
 * request rather than a human catching it in production, or not at all.
 *
 * A table shipped without RLS is an incident: RLS is the authorisation model,
 * not a hardening step layered on top of one.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) =>
  readFileSync(new URL(relative, `file://${root}`), "utf8").replace(
    /\r\n/g,
    "\n",
  );

const schema = read("docs/SCHEMA.sql");
const migration = read("supabase/migrations/0001_init.sql");

function tableNames(sql: string): string[] {
  return [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
}

describe("docs/SCHEMA.sql and the applied migration", () => {
  it("are byte-identical", () => {
    // ARCHITECTURE.md calls SCHEMA.sql the source of truth and the migration
    // the applied form. If they drift, one of them is lying and there is no way
    // to tell which from the outside.
    expect(migration).toBe(schema);
  });

  it("declares at least the tables the app is built around", () => {
    expect(tableNames(schema)).toEqual(
      expect.arrayContaining([
        "profiles",
        "items",
        "item_content",
        "tags",
        "item_tags",
        "highlights",
        "fetch_jobs",
        "save_events",
      ]),
    );
  });
});

describe("row level security", () => {
  const tables = tableNames(schema);

  it("finds tables to check", () => {
    // Guards against the regex silently matching nothing, which would make
    // every test below pass vacuously.
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables)("is enabled on public.%s", (table) => {
    const enabled = new RegExp(
      `alter table\\s+public\\.${table}\\s+enable row level security`,
    );
    expect(schema).toMatch(enabled);
  });

  it.each(tables)("has at least one policy on public.%s", (table) => {
    // RLS with no policy denies everything. That is a valid choice for a table
    // only the service role touches, but it must be a choice someone made, so
    // every table needs at least one policy spelling out who can read it.
    const policy = new RegExp(`create policy \\w+ on public\\.${table}`);
    expect(schema).toMatch(policy);
  });
});

describe("security definer functions", () => {
  const definers = [
    ...schema.matchAll(/security definer([\s\S]{0,200}?)as \$\$/g),
  ];

  it("finds the definer functions", () => {
    expect(definers.length).toBeGreaterThan(0);
  });

  it.each(definers.map((m, i) => [i, m[1]] as const))(
    "pins search_path (function %i)",
    (_index, body) => {
      // A security definer function without an explicit search_path can be
      // hijacked by creating a shadowing object in a schema earlier on the
      // caller's path. This is the standard Postgres privilege-escalation
      // route and it is one line to close.
      expect(body).toMatch(/set search_path\s*=/);
    },
  );
});
