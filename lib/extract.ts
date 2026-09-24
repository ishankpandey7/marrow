import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { InvalidUrlError, canonicalise } from "@/lib/canonical";
import { sanitiseArticleHtml } from "@/lib/sanitize";
import type { FailReason } from "@/lib/types";

/**
 * HTML to article. Pure: no network, no database, no environment access. Given
 * a fetch result it returns either an article or a typed failure, and given the
 * same input it returns the same answer forever — which is what lets this file
 * be tested from fixtures on a machine with no credentials and no internet.
 *
 * ARCHITECTURE.md section 6 is the specification, including the priority order
 * for each metadata field and the failure taxonomy.
 */

/** ARCHITECTURE.md section 6 step 6. */
export const WORDS_PER_MINUTE = 200;

/**
 * Below this, a body is a stub rather than an article, and the reason it is a
 * stub decides which failure the reader sees. Above it, a page is an article
 * even if it is a strange one.
 */
export const THIN_ARTICLE_WORDS = 250;

/**
 * Kept in step with the installed dependency by extract.test.ts, which reads
 * the version out of node_modules and fails when they drift. Stored on every
 * row so that a library upgrade which changes the output can be traced to the
 * items that need re-extracting.
 */
export const EXTRACTOR = "readability@0.6.0";

/**
 * The floor for "Readability returned nothing usable", in characters, and the
 * same number we hand Readability as its own charThreshold so that the two
 * cannot disagree.
 *
 * Readability's default floor is 500, which throws away short posts that are
 * perfectly real. Our stub detection is 250 *words*, far above this, so the
 * lower floor lets a short article through while the checks below still catch
 * a paywall teaser and a members directory.
 */
const MIN_ARTICLE_CHARS = 200;

/** schema.org types that mean "this node describes the article". */
const ARTICLE_TYPES = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "reportagenewsarticle",
  "scholarlyarticle",
  "techarticle",
  "liveblogposting",
  "socialmediaposting",
  "webpage",
]);

/**
 * Phrases that appear in the extracted body itself when what we extracted is
 * an interstitial rather than an article.
 *
 * Checked regardless of length, because a teaser is not always short: the New
 * York Times wraps its paywall notice in advertising furniture and the whole
 * thing comes back as four hundred words, comfortably past any threshold for
 * "stub", and would otherwise be stored as a two-minute read whose entire
 * content is "we are checking your access".
 *
 * Deliberately narrow. These are sentences a publisher writes to a reader who
 * cannot see the article, and prose that happens to be *about* paywalls does
 * not phrase things this way.
 */
const PAYWALL_BODY_PHRASES = [
  "you have a preview view of this article",
  "subscribe to continue reading",
  "to continue reading this article",
  "this article is for subscribers",
  "already a subscriber? sign in",
  "already a subscriber? log in",
  "register to continue reading",
  "create an account to continue reading",
  "you have reached your article limit",
  "subscribe to read the full",
];

/**
 * Read as substrings of the lowercased markup. Every one of these is a phrase
 * a page shows *instead of* the article, so they are only consulted once the
 * body has already come back too thin to be one.
 */
const PAYWALL_MARKERS = [
  "paywall",
  "regwall",
  "subscribe to continue",
  "subscribe to read",
  "subscription required",
  "subscribers only",
  "already a subscriber",
  "for subscribers",
  "create a free account to continue",
  "sign in to read",
  "log in to read",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractInput {
  /** The URL that answered, after redirects. Relative links resolve to it. */
  readonly url: string;
  readonly html: string;
}

export interface ArticleMetadata {
  readonly canonicalUrl: string;
  readonly urlHash: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly siteName: string | null;
  readonly excerpt: string | null;
  readonly leadImageUrl: string | null;
  readonly lang: string | null;
  /** ISO 8601, UTC. Null when the page gave us nothing we could parse. */
  readonly publishedAt: string | null;
}

export interface ArticleContent {
  /** Sanitised. Never the raw Readability output. */
  readonly html: string;
  readonly text: string;
  readonly wordCount: number;
  readonly readingMinutes: number;
  readonly extractor: string;
}

/** The subset of the section 6 taxonomy extraction can produce. */
export type ExtractFailReason = Extract<
  FailReason,
  "paywalled" | "js_required" | "no_content"
>;

/**
 * Metadata is present on both branches on purpose. A failed extraction still
 * has to leave a saved item with its URL and a usable title: a row that keeps
 * only "https://…/2f8a1c" is a row nobody can find again.
 */
export type ExtractOutcome =
  | {
      readonly ok: true;
      readonly metadata: ArticleMetadata;
      readonly content: ArticleContent;
    }
  | {
      readonly ok: false;
      readonly reason: ExtractFailReason;
      readonly metadata: ArticleMetadata;
    };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed;
}

/** First non-empty wins, per field, independently. Section 6 step 4. */
function firstNonEmpty(...candidates: (string | null | undefined)[]) {
  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text !== null) return text;
  }
  return null;
}

/** A name, whether the page wrote a string, an object, or a list of either. */
function nameOf(value: unknown): string | null {
  const direct = asText(value);
  if (direct !== null) return direct;

  if (Array.isArray(value)) {
    const names = value
      .map(nameOf)
      .filter((name): name is string => name !== null);
    return names.length > 0 ? names.join(", ") : null;
  }

  const record = asRecord(value);
  return record ? asText(record.name) : null;
}

function urlOf(value: unknown): string | null {
  const direct = asText(value);
  if (direct !== null) return direct;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = urlOf(entry);
      if (found !== null) return found;
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) return null;
  return asText(record.url) ?? asText(record.contentUrl);
}

/** Absolute http(s) only. Anything else is dropped rather than stored. */
function resolveUrl(value: string | null, base: string): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function toIsoDate(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return null;
  // A publication date outside this range is a parsing accident — a bare year,
  // a Unix epoch zero, a template that never got filled in — and storing it
  // sorts the library wrongly forever.
  const year = parsed.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return parsed.toISOString();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Elements whose end is a word boundary. Without a separator at each one,
 * "…world</p><p>Second…" reads back as "worldSecond", which is one word where
 * there were two — and the word count is what the reading time is built from.
 */
const BLOCK_ELEMENTS =
  "p,div,br,hr,li,ul,ol,dl,dt,dd,h1,h2,h3,h4,h5,h6,blockquote,pre," +
  "figure,figcaption,section,article,aside,table,caption,tr,th,td";

/** Plain text of the HTML we are actually going to store, for search. */
function toPlainText(html: string): string {
  if (html.trim() === "") return "";

  // Wrapped as a whole document on purpose: linkedom builds no body for a bare
  // fragment, and document.body.textContent is then silently empty.
  const { document } = parseHTML(
    `<!doctype html><html><body>${html}</body></html>`,
  );
  const body = document.body;
  if (body === null) return "";

  for (const element of [...body.querySelectorAll(BLOCK_ELEMENTS)]) {
    element.after(" ");
  }

  return (body.textContent ?? "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Document metadata
// ---------------------------------------------------------------------------

type Doc = ReturnType<typeof parseHTML>["document"];

function metaContent(document: Doc, selector: string): string | null {
  return asText(document.querySelector(selector)?.getAttribute("content"));
}

interface JsonLd {
  /** The first node that describes the article itself, if there is one. */
  readonly article: Record<string, unknown> | null;
  /** Every node, for signals that can live anywhere in the graph. */
  readonly nodes: readonly Record<string, unknown>[];
}

function readJsonLd(document: Doc): JsonLd {
  const queue: unknown[] = [];
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      queue.push(JSON.parse(script.textContent ?? ""));
    } catch {
      // One malformed block is not a reason to abandon the page. Sites ship
      // broken JSON-LD constantly and the article is still there.
    }
  }

  const nodes: Record<string, unknown>[] = [];
  let article: Record<string, unknown> | null = null;

  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    const record = asRecord(node);
    if (!record) continue;
    nodes.push(record);

    const graph = record["@graph"];
    if (Array.isArray(graph)) queue.push(...graph);

    if (article === null && isArticleNode(record["@type"])) {
      article = record;
    }
  }

  return { article, nodes };
}

function isArticleNode(type: unknown): boolean {
  if (typeof type === "string") return ARTICLE_TYPES.has(type.toLowerCase());
  if (Array.isArray(type)) return type.some(isArticleNode);
  return false;
}

/**
 * The `rel=canonical` of the fetched document, but only when it points at the
 * same site.
 *
 * An off-domain canonical is how a scraper steals identity: a copy of an
 * article declares the original's URL, and following it would fold the copy
 * and the original into one row belonging to whoever we fetched second.
 *
 * "Same site" here is exact host, or one host being a subdomain of the other.
 * The document says registrable domain, which needs the Public Suffix List and
 * therefore a dependency we do not have; this test is strictly narrower, so it
 * never accepts a canonical the fuller test would reject. The cost is that
 * m.example.com pointing at www.example.com is not honoured, which loses a
 * dedupe rather than gaining a hole.
 */
function sameSiteCanonical(
  href: string | null,
  pageUrl: string,
): string | null {
  if (href === null) return null;

  let candidate: URL;
  let page: URL;
  try {
    candidate = new URL(href, pageUrl);
    page = new URL(pageUrl);
  } catch {
    return null;
  }

  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
    return null;
  }

  const a = candidate.hostname;
  const b = page.hostname;
  const sameSite = a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

  return sameSite ? candidate.toString() : null;
}

// ---------------------------------------------------------------------------
// Failure signals
// ---------------------------------------------------------------------------

/** The body we are about to store is the paywall, not the article. */
function bodyIsPaywallNotice(text: string): boolean {
  const lower = text.toLowerCase();
  return PAYWALL_BODY_PHRASES.some((phrase) => lower.includes(phrase));
}

function hasPaywallSignal(html: string, jsonLd: JsonLd): boolean {
  // schema.org's own marker, and the only one publishers agree on. Written as
  // a boolean by most and as a string by some.
  for (const node of jsonLd.nodes) {
    const free = node.isAccessibleForFree;
    if (
      free === false ||
      (typeof free === "string" && free.toLowerCase() === "false")
    ) {
      return true;
    }
  }

  const lower = html.toLowerCase();
  return PAYWALL_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * "Mostly script" measured literally: more characters inside script elements
 * than outside them. A single-page app ships its content as a JSON blob in a
 * script tag and an empty root div, which is exactly this shape.
 */
function isScriptHeavy(document: Doc): boolean {
  let scriptChars = 0;
  for (const script of document.querySelectorAll("script")) {
    scriptChars += (script.textContent ?? "").length;
  }

  const totalChars = (document.documentElement.textContent ?? "").length;
  const proseChars = Math.max(0, totalChars - scriptChars);

  return scriptChars > proseChars;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Tell the parsed document where it came from.
 *
 * Readability resolves every relative href and src against `document.baseURI`,
 * and linkedom leaves both baseURI and documentURI unset. Without them, every
 * link and image in a stored article is relative to *our* origin by the time
 * the reading view renders it — "/nature/rivers" becomes a link into Marrow.
 *
 * defineProperty rather than assignment because both are accessors on
 * linkedom's prototype, and assigning to an accessor with no setter throws in
 * a module, which is every file in this project.
 */
function setDocumentUrl(document: Doc, url: string): void {
  for (const property of ["baseURI", "documentURI"]) {
    Object.defineProperty(document, property, {
      value: url,
      configurable: true,
      writable: true,
    });
  }
}

/** All we can say about a page that turned out not to be a document. */
function bareMetadata(url: string): ArticleMetadata {
  const { canonicalUrl, urlHash } = canonicalise(url);
  return {
    canonicalUrl,
    urlHash,
    title: null,
    author: null,
    siteName: null,
    excerpt: null,
    leadImageUrl: null,
    lang: null,
    publishedAt: null,
  };
}

/**
 * Turn a fetched page into an article, or say which failure it is.
 *
 * Does not throw over the page: a page that cannot be extracted is an expected
 * outcome with copy attached, not an exception. See FAIL_REASON_COPY in
 * lib/constants.ts. `input.url` is canonicalised, though, so a URL that is not
 * http(s) throws InvalidUrlError. Every caller today passes the fetcher's final
 * URL, which has passed section 5; a caller with content but no fetched URL
 * (an email, an import) must not assume otherwise.
 */
export function extractArticle(input: ExtractInput): ExtractOutcome {
  const { document } = parseHTML(input.html);

  // linkedom returns a document with no root element for input that is empty
  // or is not markup at all, where the DOM types promise one. Everything below
  // would throw on the null, and "there is no document here" is already a value
  // in the taxonomy.
  const root: HTMLElement | null = document.documentElement;
  if (root === null) {
    return {
      ok: false,
      reason: "no_content",
      metadata: bareMetadata(input.url),
    };
  }

  setDocumentUrl(document, input.url);

  const jsonLd = readJsonLd(document);
  const article = jsonLd.article ?? {};

  // Everything read from the original markup happens before Readability, which
  // rewrites the document it is given.
  const documentTitle = asText(document.title);
  const htmlLang = asText(root.getAttribute("lang"));
  const canonicalHref = asText(
    document.querySelector('link[rel~="canonical"]')?.getAttribute("href"),
  );

  const metaTitle = firstNonEmpty(
    // name before headline. Both are schema.org's, and plenty of sites put the
    // article title in one and something else entirely in the other —
    // Wikipedia's headline is its one-line description ("species of bird"),
    // which would land in the list as the title of the article.
    asText(article.name),
    asText(article.headline),
    metaContent(document, 'meta[property="og:title"]'),
    metaContent(document, 'meta[name="twitter:title"]'),
    metaContent(document, 'meta[property="twitter:title"]'),
    metaContent(document, 'meta[name="title"]'),
  );

  const metaAuthor = firstNonEmpty(
    nameOf(article.author),
    metaContent(document, 'meta[name="author"]'),
    metaContent(document, 'meta[property="article:author"]'),
    metaContent(document, 'meta[name="twitter:creator"]'),
  );

  const metaSiteName = firstNonEmpty(
    nameOf(article.publisher),
    metaContent(document, 'meta[property="og:site_name"]'),
    metaContent(document, 'meta[name="application-name"]'),
  );

  const metaExcerpt = firstNonEmpty(
    asText(article.description),
    metaContent(document, 'meta[property="og:description"]'),
    metaContent(document, 'meta[name="twitter:description"]'),
    metaContent(document, 'meta[name="description"]'),
  );

  const metaImage = firstNonEmpty(
    urlOf(article.image),
    metaContent(document, 'meta[property="og:image"]'),
    metaContent(document, 'meta[property="og:image:url"]'),
    metaContent(document, 'meta[name="twitter:image"]'),
  );

  const metaLang = firstNonEmpty(
    htmlLang,
    asText(article.inLanguage),
    metaContent(document, 'meta[property="og:locale"]'),
  );

  const metaPublished = firstNonEmpty(
    asText(article.datePublished),
    metaContent(document, 'meta[property="article:published_time"]'),
    metaContent(document, 'meta[name="article:published_time"]'),
    metaContent(document, 'meta[property="og:article:published_time"]'),
    metaContent(document, 'meta[name="date"]'),
    metaContent(document, 'meta[name="pubdate"]'),
    asText(document.querySelector("time[datetime]")?.getAttribute("datetime")),
  );

  const paywalled = hasPaywallSignal(input.html, jsonLd);
  const scriptHeavy = isScriptHeavy(document);

  let parsed: ReturnType<Readability["parse"]> = null;
  try {
    parsed = new Readability(document, {
      charThreshold: MIN_ARTICLE_CHARS,
    }).parse();
  } catch {
    // Readability throws on markup it cannot walk. That is a page we could not
    // extract, which is a value in the taxonomy, not an exception to raise.
    parsed = null;
  }

  const canonicalTarget = sameSiteCanonical(canonicalHref, input.url);
  const { canonicalUrl, urlHash } = canonicaliseOrFallback(
    canonicalTarget,
    input.url,
  );

  const metadata: ArticleMetadata = {
    canonicalUrl,
    urlHash,
    title: firstNonEmpty(metaTitle, parsed?.title, documentTitle),
    author: firstNonEmpty(metaAuthor, parsed?.byline),
    siteName: firstNonEmpty(metaSiteName, parsed?.siteName),
    excerpt: firstNonEmpty(metaExcerpt, parsed?.excerpt),
    leadImageUrl: resolveUrl(metaImage, input.url),
    lang: firstNonEmpty(metaLang, parsed?.lang),
    publishedAt: toIsoDate(firstNonEmpty(metaPublished, parsed?.publishedTime)),
  };

  // The sanitiser runs on whatever Readability produced, before anything is
  // measured, so the word count describes the HTML we actually store rather
  // than markup we threw away.
  const html = sanitiseArticleHtml(parsed?.content ?? "");
  const text = toPlainText(html);
  const wordCount = countWords(text);

  // Length is no help when the interstitial is padded out with advertising
  // furniture, so the body is asked what it is before it is asked how big.
  if (bodyIsPaywallNotice(text)) {
    return { ok: false, reason: "paywalled", metadata };
  }

  if (wordCount < THIN_ARTICLE_WORDS) {
    // Order matters. A paywall teaser is usually also script-heavy, and
    // "looks like a paywall" tells the reader something true and actionable
    // where "needs a browser" would not.
    if (paywalled) return { ok: false, reason: "paywalled", metadata };
    if (scriptHeavy) return { ok: false, reason: "js_required", metadata };
    if (text.length < MIN_ARTICLE_CHARS) {
      return { ok: false, reason: "no_content", metadata };
    }
  }

  return {
    ok: true,
    metadata,
    content: {
      html,
      text,
      wordCount,
      readingMinutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
      extractor: EXTRACTOR,
    },
  };
}

function canonicaliseOrFallback(preferred: string | null, fallback: string) {
  for (const candidate of [preferred, fallback]) {
    if (candidate === null) continue;
    try {
      return canonicalise(candidate);
    } catch (error) {
      // The fetched URL has already been through the section 5 guards, so only
      // a canonical the page supplied can land here.
      if (!(error instanceof InvalidUrlError)) throw error;
    }
  }
  return canonicalise(fallback);
}
