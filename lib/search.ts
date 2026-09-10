import { filterUrl, normalizeTag, type Filters, type Tag } from "@/lib/tags";
import type { FailReason, ItemStatus } from "@/lib/types";

/**
 * The query language, parsed offline.
 *
 * Pure: no network, no database, no environment. Everything a person can type
 * into the search box is turned into structure here, and only structure
 * reaches Postgres — never a string that Postgres has to parse as syntax.
 *
 * That is the point of this file. `to_tsquery` throws on malformed input, and
 * user input is malformed eventually: an unbalanced quote, a stray `&`, a
 * colon. `websearch_to_tsquery` never throws, so it is the only entry point we
 * use, and the strings handed to it are rebuilt from parsed tokens rather than
 * passed through — a term that happens to read like an operator therefore
 * cannot change what the query means.
 *
 * Two things this parser must own rather than leave to
 * `websearch_to_tsquery`, both checked against the real database:
 *
 *   - `tag:foo` is a filter, not text. Left in place it becomes `'tag' &
 *     'foo'`: a silent search for the word "tag" that finds nothing and
 *     explains nothing.
 *   - `-nvidia` cannot ride along inside the positive query. Search runs as
 *     two index scans over two tables (see `0004_search.sql`), and a
 *     `!nvidia` inside the metadata scan only means "the title does not say
 *     nvidia" — the body remains free to say it. Exclusion has to be asked of
 *     the whole item, so it is parsed out and carried separately.
 */

/**
 * Caps. A search box is not a query console: every token becomes a node in a
 * tsquery Postgres has to evaluate, and the URL has to survive being shared.
 * Truncation is silent on purpose — an error about query length is a worse
 * answer than searching for the first two hundred characters of what was
 * pasted.
 */
const MAX_QUERY_LENGTH = 200;
const MAX_TOKENS = 16;
const MAX_TERM_LENGTH = 64;

/**
 * The markers `ts_headline` wraps matches in, and why they are control
 * characters rather than `<mark>`: a snippet is content taken from a page we
 * did not write. It is rendered as React text nodes and never as HTML, so the
 * marker only has to be something an article will not contain. STX and ETX
 * qualify, and if one ever does appear the worst case is a missing highlight
 * rather than an injection.
 *
 * Written as code points because these characters have to survive being
 * copied between a source file, a SQL migration and a test without anyone
 * having to notice they are there.
 */
export const HIGHLIGHT_START = String.fromCharCode(2);
export const HIGHLIGHT_END = String.fromCharCode(3);

export interface ParsedSearch {
  /** Handed to `websearch_to_tsquery` as the terms that must match. */
  include: string;
  /** Handed to `websearch_to_tsquery` as the terms that must not match. */
  exclude: string;
  /** Tag slugs the item must carry, from `tag:foo`. */
  tags: string[];
  /** Tag slugs the item must not carry, from `-tag:foo`. */
  excludedTags: string[];
  /** What was understood, in the order typed, for the page to echo back. */
  terms: string[];
  phrases: string[];
  excludedTerms: string[];
  /** True when nothing at all survived parsing. */
  isEmpty: boolean;
  /** True when the only thing typed takes results away, which is not a search. */
  exclusionOnly: boolean;
}

export const EMPTY_SEARCH: ParsedSearch = {
  include: "",
  exclude: "",
  tags: [],
  excludedTags: [],
  terms: [],
  phrases: [],
  excludedTerms: [],
  isEmpty: true,
  exclusionOnly: false,
};

interface Token {
  kind: "term" | "phrase" | "tag" | "or";
  value: string;
  negated: boolean;
}

/** Anything with no letter and no digit cannot match a lexeme, in any script. */
const SEARCHABLE = /[\p{L}\p{N}]/u;

/**
 * Control characters become spaces. This is what stops the headline markers
 * surviving a round trip through the query and back out into a snippet, and
 * it is written as a code point test because a regex range over control
 * characters is unreadable and easy to mistype into a range over something
 * else entirely.
 */
function stripControls(value: string): string {
  return [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("");
}

/**
 * Strip what we are about to use as syntax ourselves: double quotes delimit
 * the phrases in the string we rebuild.
 */
function cleanText(value: string): string {
  return stripControls(value)
    .replace(/"/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_TERM_LENGTH)
    .trim();
}

/**
 * `tag:Machine Learning` and the tag named "Machine Learning" must arrive at
 * the same slug, so this defers to the Slice 4 normaliser rather than
 * reimplementing it. That normaliser throws on a name it cannot slug; here an
 * unusable name is a search that finds nothing rather than an exception, so
 * the throw becomes an empty string and the page reports it.
 */
function tagSlug(value: string): string {
  try {
    return normalizeTag(value).slug;
  } catch {
    return "";
  }
}

function scan(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length && tokens.length < MAX_TOKENS) {
    if (input[index] === " ") {
      index += 1;
      continue;
    }
    let negated = false;
    while (input[index] === "-") {
      negated = true;
      index += 1;
    }
    // A dash with nothing attached is a dash, not an operator.
    if (index >= input.length || input[index] === " ") continue;

    let isTag = false;
    if (input.slice(index, index + 4).toLowerCase() === "tag:") {
      isTag = true;
      index += 4;
      if (index >= input.length || input[index] === " ") continue;
    }

    let quoted = false;
    let value: string;
    if (input[index] === '"') {
      quoted = true;
      const end = input.indexOf('"', index + 1);
      // An unterminated quote takes the rest of the line. Someone typing a
      // phrase has not finished typing it, and refusing to search until the
      // quote is balanced is worse than searching for what is there.
      value = end === -1 ? input.slice(index + 1) : input.slice(index + 1, end);
      index = end === -1 ? input.length : end + 1;
    } else {
      const end = input.indexOf(" ", index);
      value = end === -1 ? input.slice(index) : input.slice(index, end);
      index = end === -1 ? input.length : end;
    }

    if (isTag) {
      const slug = tagSlug(value);
      if (slug) tokens.push({ kind: "tag", value: slug, negated });
      continue;
    }

    const text = cleanText(value);
    if (!text || !SEARCHABLE.test(text)) continue;
    // Unquoted `or` is the operator whether or not someone put a dash on it:
    // `-or` cannot mean anything else, and letting it through as a term would
    // emit a bare `or` into the excluded query, where it would act as one
    // anyway. A quoted "or" stays a phrase.
    if (!quoted && text.toLowerCase() === "or") {
      tokens.push({ kind: "or", value: "or", negated: false });
      continue;
    }
    tokens.push({ kind: quoted ? "phrase" : "term", value: text, negated });
  }
  return tokens;
}

/** A phrase keeps its quotes; everything else is emitted as typed. */
function emit(token: Token): string {
  return token.kind === "phrase" ? `"${token.value}"` : token.value;
}

/**
 * Rebuild the `websearch_to_tsquery` input for the terms that must match.
 * A dangling or doubled `or` has no second operand: Postgres drops it
 * quietly, and dropping it here keeps what we echo back to the reader honest.
 */
function includeQuery(tokens: Token[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.kind === "tag") continue;
    if (token.kind === "or") {
      if (parts.length && parts[parts.length - 1] !== "or") parts.push("or");
      continue;
    }
    parts.push(emit(token));
  }
  if (parts[parts.length - 1] === "or") parts.pop();
  return parts.join(" ");
}

export function parseQuery(input: unknown): ParsedSearch {
  if (typeof input !== "string") return EMPTY_SEARCH;
  const normalized = stripControls(input.normalize("NFKC"))
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/\s+/gu, " ")
    .trim();
  const tokens = scan(normalized);
  const positive = tokens.filter((token) => !token.negated);
  const negative = tokens.filter((token) => token.negated);

  const include = includeQuery(positive);
  // Joined with `or`, because any one of these appearing is enough to drop the
  // item. The default AND would only exclude items unlucky enough to contain
  // every excluded word at once, which is the opposite of what a minus means.
  const exclude = negative
    .filter((token) => token.kind !== "tag")
    .map(emit)
    .join(" or ");
  const tags = [
    ...new Set(
      positive
        .filter((token) => token.kind === "tag")
        .map((token) => token.value),
    ),
  ];
  const excludedTags = [
    ...new Set(
      negative
        .filter((token) => token.kind === "tag")
        .map((token) => token.value),
    ),
  ];

  // A tag on its own is a search. An exclusion on its own is not: it asks for
  // every item that does not say a word, which is nearly all of them, and is
  // never what anyone meant. The page says so rather than running it.
  const narrows = include !== "" || tags.length > 0;
  const removes = exclude !== "" || excludedTags.length > 0;

  return {
    include,
    exclude,
    tags,
    excludedTags,
    terms: positive
      .filter((token) => token.kind === "term")
      .map((token) => token.value),
    phrases: positive
      .filter((token) => token.kind === "phrase")
      .map((token) => token.value),
    excludedTerms: negative
      .filter((token) => token.kind !== "tag")
      .map((token) => token.value),
    isEmpty: !narrows && !removes,
    exclusionOnly: !narrows && removes,
  };
}

/**
 * Slugs to IDs, against the tag catalogue the page already holds. Unknown
 * slugs come back separately rather than being dropped: `tag:reciepes` should
 * say that no such tag exists, not quietly return the whole library.
 */
export function resolveTags(
  slugs: string[],
  tags: Tag[],
): { ids: string[]; missing: string[] } {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const tag = tags.find((candidate) => candidate.slug === slug);
    if (tag) ids.push(tag.id);
    else missing.push(slug);
  }
  return { ids, missing };
}

/**
 * Search adds a parameter to the Slice 4 filters; it does not replace them.
 * `state`, `read`, `tag` and `page` keep the names and the meanings
 * `parseFilters` already gives them — this is built on `filterUrl` precisely
 * so the two cannot drift — which is what lets someone move between the
 * library and the results without losing what they had narrowed down.
 */
export function searchUrl(query: string, filters: Filters): string {
  const params = new URLSearchParams(filterUrl(filters).split("?")[1] ?? "");
  params.set("q", query);
  return `/search?${params}`;
}

/**
 * One row of `public.search_items`, in the order that function declares it.
 * Hand-written for the same reason lib/types.ts is, and it must be kept in
 * step with `public.search_hit` by hand until `supabase gen types` runs.
 */
export interface SearchHit {
  id: string;
  url: string;
  title: string | null;
  site_name: string | null;
  excerpt: string | null;
  reading_minutes: number | null;
  status: ItemStatus;
  fail_reason: FailReason | null;
  created_at: string;
  favourite: boolean;
  archived_at: string | null;
  read_at: string | null;
  rank: number;
  meta_rank: number;
  body_rank: number;
  snippet: string | null;
  /** Which field the snippet was cut from: `body`, `excerpt` or `title`. */
  snippet_source: string;
}

export interface Segment {
  text: string;
  match: boolean;
}

/**
 * Split a `ts_headline` snippet into plain and highlighted runs, so the page
 * can render `<mark>` as elements rather than parsing HTML out of a string
 * that came from someone else's web page.
 *
 * An unpaired opening marker leaves the rest of the snippet unhighlighted
 * instead of swallowing it. The only way to get one is for the article itself
 * to contain the marker character, and in that case a missing highlight is a
 * smaller wrong answer than a paragraph rendered entirely as a match.
 */
export function highlightSegments(snippet: string): Segment[] {
  const segments: Segment[] = [];
  const push = (text: string, match: boolean) => {
    const cleaned = stripControls(text);
    if (!cleaned) return;
    const last = segments[segments.length - 1];
    if (last && last.match === match) last.text += cleaned;
    else segments.push({ text: cleaned, match });
  };

  let index = 0;
  while (index < snippet.length) {
    const start = snippet.indexOf(HIGHLIGHT_START, index);
    if (start === -1) break;
    const end = snippet.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) break;
    push(snippet.slice(index, start), false);
    push(snippet.slice(start + 1, end), true);
    index = end + 1;
  }
  push(snippet.slice(index), false);
  return segments;
}
