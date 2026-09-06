import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * .env.example is only useful if it is complete. The failure mode it prevents
 * is a variable added in one slice, set in the author's .env.local, and missing
 * from every other environment until production quietly misbehaves.
 *
 * This test reads the source for `process.env.SOMETHING` and asserts each one
 * is either documented in .env.example or on the allowlist below.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

/** Supplied by the platform, not by us. Nothing to document. */
const PROVIDED_BY_PLATFORM = new Set([
  "NODE_ENV",
  "CI",
  "NEXT_RUNTIME",
  "VERCEL_ENV",
  "VERCEL_URL",
]);

const SEARCH_DIRS = ["app", "lib", "components"];
const SEARCH_FILES = [
  "next.config.ts",
  "instrumentation.ts",
  "instrumentation-client.ts",
  "sentry.server.config.ts",
  "sentry.edge.config.ts",
];

/**
 * Comments are documentation, and documentation talks about environment
 * variables by name. Scanning them produces phantom requirements — the first
 * run of this test flagged `NEXT_PUBLIC_X` from a comment in lib/env.ts
 * explaining why NEXT_PUBLIC_ lookups must be literal.
 *
 * `//` is only treated as a comment when it is not preceded by a colon, so
 * that a URL inside a string literal does not swallow the rest of its line.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // Directory does not exist yet; a later slice creates it.
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = [
  ...SEARCH_DIRS.flatMap((dir) => walk(join(root, dir))),
  ...SEARCH_FILES.map((file) => join(root, file)),
];

const referenced = new Set<string>();
for (const file of sourceFiles) {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue; // Listed in SEARCH_FILES but not created yet.
  }
  for (const match of stripComments(contents).matchAll(
    /process\.env\.([A-Z0-9_]+)/g,
  )) {
    referenced.add(match[1]);
  }
}

const example = readFileSync(join(root, ".env.example"), "utf8");
const documented = new Set(
  [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]),
);

describe(".env.example", () => {
  it("finds source files to scan", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(referenced.size).toBeGreaterThan(0);
  });

  it("documents every environment variable the app reads", () => {
    const undocumented = [...referenced]
      .filter((name) => !PROVIDED_BY_PLATFORM.has(name))
      .filter((name) => !documented.has(name))
      .sort();

    expect(undocumented).toEqual([]);
  });

  it("holds no values", () => {
    // A real value committed here is a leaked secret, and "it is only the dev
    // one" is how that happens. Every line must be NAME= and nothing more.
    const withValues = example
      .split("\n")
      .filter((line) => /^[A-Z0-9_]+=.+$/.test(line));

    expect(withValues).toEqual([]);
  });
});
