import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  SAVE_LIMIT,
  SAVE_LIMIT_SQLSTATE,
  SAVE_WINDOW_MS,
} from "@/lib/rate-limit";
import { NOTE_MAX, QUOTE_MAX } from "@/lib/highlights";

/**
 * These tests enforce the schema invariants from ARCHITECTURE.md section 4
 * without needing a database, which means CI catches a violation on the pull
 * request rather than a human catching it in production, or not at all.
 *
 * A table shipped without RLS is an incident: RLS is the authorisation model,
 * not a hardening step layered on top of one.
 *
 * These used to assert docs/SCHEMA.sql was byte-identical to
 * 0001_init.sql. That held only while there was exactly one migration, and it
 * broke the moment 0002 corrected a function. SCHEMA.sql now documents the
 * schema as it stands, so the useful invariant is weaker but still real: every
 * table it declares must actually be created by some migration.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const schema = read("docs/SCHEMA.sql");

const migrationsDir = join(root, "supabase/migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrations = migrationFiles.map((name) => ({
  name,
  sql: read(join("supabase/migrations", name)),
}));

function tableNames(sql: string): string[] {
  return [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
}

/**
 * Comments explain bugs by quoting them, so scanning them finds the very
 * pattern the fix removed — the header of 0002 describes the broken CASE and
 * tripped this suite on its first run.
 *
 * Does not attempt to respect `--` inside a string literal. No file here has
 * one, and a SQL parser is a lot of machinery for a lint.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

const tables = tableNames(schema);

describe("migrations", () => {
  it("exist", () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it("are numbered uniquely and in order", () => {
    // Two migrations sharing a number apply in an order that depends on the
    // filesystem, which is a genuinely horrible thing to debug.
    const numbers = migrationFiles.map((name) => name.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort()).toEqual(numbers);
  });
});

describe("docs/SCHEMA.sql", () => {
  it("declares at least the tables the app is built around", () => {
    expect(tables).toEqual(
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

  it.each(tables)(
    "does not document public.%s without a migration",
    (table) => {
      // Catches a table added to the doc that nobody ever wrote a migration for —
      // the schema then exists only on paper and every query against it fails.
      const created = new RegExp(`create table public\\.${table}\\b`);
      expect(migrations.some((m) => created.test(m.sql))).toBe(true);
    },
  );
});

describe("row level security", () => {
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
  // Every file, not just SCHEMA.sql: a migration is what actually runs.
  const sources = [{ name: "docs/SCHEMA.sql", sql: schema }, ...migrations];

  const definers = sources.flatMap(({ name, sql }) =>
    [...sql.matchAll(/security definer([\s\S]{0,200}?)as \$\$/g)].map(
      (match, index) => ({ label: `${name} #${index}`, body: match[1] }),
    ),
  );

  it("finds the definer functions", () => {
    expect(definers.length).toBeGreaterThan(0);
  });

  it.each(definers.map((d) => [d.label, d.body] as const))(
    "pins search_path (%s)",
    (_label, body) => {
      // A security definer function without an explicit search_path can be
      // hijacked by creating a shadowing object in a schema earlier on the
      // caller's path. This is the standard Postgres privilege-escalation
      // route and it is one line to close.
      expect(body).toMatch(/set search_path\s*=/);
    },
  );
});

describe("enum assignments in plpgsql", () => {
  // The 42804 that broke save_item: `case when ... then 'ready' else 'pending'
  // end` assigned to an enum column. Both branches are unknown-type literals,
  // so the CASE resolves to text and the assignment fails — at runtime, on the
  // conflict path only. Cheap to assert, expensive to rediscover.
  //
  // Scoped to SCHEMA.sql, deliberately. Applied migrations are frozen, and
  // 0001 still contains the original bug — that is the correct state of
  // history, and linting it would fail forever with nothing to fix. SCHEMA.sql
  // describes the schema as it now stands, so it is the thing that must be
  // clean, and every migration has to land there anyway.
  const sources = [{ name: "docs/SCHEMA.sql", sql: schema }];

  it.each(sources.map((s) => [s.name, s.sql] as const))(
    "casts enum literals in CASE branches (%s)",
    (_name, rawSql) => {
      const sql = stripSqlComments(rawSql);
      const enumColumns = ["status", "fail_reason", "state"];

      for (const column of enumColumns) {
        const assignments = [
          ...sql.matchAll(
            new RegExp(`${column}\\s*=\\s*case([\\s\\S]*?)\\bend\\b`, "g"),
          ),
        ];

        for (const [, body] of assignments) {
          const bareLiteral = /\b(?:then|else)\s+'[^']*'(?!\s*::)/.exec(body);
          expect(bareLiteral?.[0] ?? null).toBeNull();
        }
      }
    },
  );
});

describe("the save limit in SQL", () => {
  // The route's check explains the wait; enforce_save_limit is the one a
  // direct PostgREST call cannot skip. Two copies of one number drift unless
  // something fails when they do.
  const body =
    /function public\.enforce_save_limit[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(
      schema,
    )?.[1];

  it("matches lib/rate-limit.ts", () => {
    expect(body).toBeDefined();
    const limit = /\)\s*>=\s*(\d+)\s+then/.exec(body ?? "")?.[1];
    const hours = /interval '(\d+) hour'/.exec(body ?? "")?.[1];
    expect(Number(limit)).toBe(SAVE_LIMIT);
    expect(Number(hours) * 60 * 60 * 1000).toBe(SAVE_WINDOW_MS);
    expect(body).toContain(`sqlstate '${SAVE_LIMIT_SQLSTATE}'`);
  });

  it("is spent by every save entry point", () => {
    for (const fn of ["save_item_impl", "retry_item"]) {
      const fnBody = new RegExp(
        `function public\\.${fn}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`,
      ).exec(schema)?.[1];
      expect(fnBody).toContain("perform public.enforce_save_limit(v_user)");
    }
  });
});

describe("highlights (0010)", () => {
  const migration = migrations.find((m) => m.name.startsWith("0010_"))?.sql;

  it.each([
    ["docs/SCHEMA.sql", schema],
    ["0010", migration ?? ""],
  ])(
    "%s caps quote and note at the lengths lib/highlights.ts checks",
    (_name, sql) => {
      expect(sql).toContain(`check (char_length(quote) <= ${QUOTE_MAX})`);
      expect(sql).toContain(
        `check (note is null or char_length(note) <= ${NOTE_MAX})`,
      );
    },
  );

  it.each([
    ["docs/SCHEMA.sql", schema],
    ["0010", migration ?? ""],
  ])("%s lets a session update the note and nothing else", (_name, sql) => {
    // Supabase grants every column by default; the revoke has to come first.
    const revoke = sql.indexOf(
      "revoke insert, update on table public.highlights from anon, authenticated;",
    );
    const grant = sql.indexOf(
      "grant update (note) on public.highlights to authenticated;",
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(
      /grant update \((?!note\))[^)]*\) on public\.highlights/,
    );
  });
});

describe("dollar quoting in docs/SCHEMA.sql", () => {
  // SETUP.md builds a fresh project by pasting this whole file, and one bad
  // quote makes Postgres reject all of it. A single `$` once slipped in when
  // a script used String.replace, whose replacement string treats `$$` as `$`.
  it("opens and closes every function body with $$", () => {
    const lines = schema.split("\n");
    expect(lines.filter((l) => /^as \$$/.test(l) || /^\$;$/.test(l))).toEqual(
      [],
    );
    const opens = lines.filter((l) => /\bas \$\$$/.test(l)).length;
    const closes = lines.filter((l) => /^\$\$;$/.test(l)).length;
    expect(opens).toBe(closes);
  });
});
