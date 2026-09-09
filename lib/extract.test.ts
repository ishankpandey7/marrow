import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FAIL_REASON_COPY } from "@/lib/constants";
import {
  EXTRACTOR,
  THIN_ARTICLE_WORDS,
  WORDS_PER_MINUTE,
  extractArticle,
  type ExtractOutcome,
} from "@/lib/extract";

/**
 * Extraction is pure, so all of this runs from fixtures on disk with no network
 * and no credentials. ARCHITECTURE.md section 6 is the specification: the
 * per-field priority order in step 4, and the failure taxonomy underneath it.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(root, "test/fixtures", name), "utf8");
}

function extractFixture(name: string, url: string): ExtractOutcome {
  return extractArticle({ url, html: fixture(name) });
}

function expectOk(outcome: ExtractOutcome) {
  if (!outcome.ok) {
    throw new Error(`expected an article, got ${outcome.reason}`);
  }
  return outcome;
}

function expectFailed(outcome: ExtractOutcome) {
  if (outcome.ok) {
    throw new Error("expected a failure");
  }
  return outcome;
}

const ARTICLE_URL =
  "https://www.riverside-chronicle.example/2026/05/kingfishers-return";

// ---------------------------------------------------------------------------
// A normal article
// ---------------------------------------------------------------------------

describe("a normal news article", () => {
  const outcome = expectOk(extractFixture("news-article.html", ARTICLE_URL));
  const { metadata, content } = outcome;

  it("takes the title from JSON-LD, ahead of OpenGraph and <title>", () => {
    expect(metadata.title).toBe("Kingfishers return to the Lea");
  });

  it("takes the author from JSON-LD, ahead of the meta tag", () => {
    // The fixture's <meta name="author"> says something else on purpose: first
    // non-empty wins per field, and JSON-LD is first in the order.
    expect(metadata.author).toBe("Priya Raman");
  });

  it("takes the site name", () => {
    expect(metadata.siteName).toBe("The Riverside Chronicle");
  });

  it("takes the excerpt", () => {
    expect(metadata.excerpt).toContain("two decades of absence");
  });

  it("takes the language from the html element", () => {
    expect(metadata.lang).toBe("en-GB");
  });

  it("normalises the publish date to ISO 8601", () => {
    expect(metadata.publishedAt).toBe("2026-05-14T09:30:00.000Z");
  });

  it("takes the lead image and makes it absolute", () => {
    expect(metadata.leadImageUrl).toBe(
      "https://cdn.riverside-chronicle.example/kingfisher.jpg",
    );
  });

  it("honours rel=canonical and strips its tracking parameters", () => {
    // The fixture's canonical carries ?utm_source=newsletter, which must not
    // survive into the hash or two spellings of one article become two rows.
    expect(metadata.canonicalUrl).toBe(ARTICLE_URL);
    expect(metadata.urlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the article prose and drops the chrome", () => {
    expect(content.text).toContain("breeding pair of kingfishers");
    expect(content.text).not.toContain("All rights reserved");
    expect(content.html).toContain("<p>");
  });

  it("resolves relative links and images against the page URL", () => {
    expect(content.html).toContain(
      'href="https://www.riverside-chronicle.example/nature/river-restoration"',
    );
    expect(content.html).toContain(
      'src="https://www.riverside-chronicle.example/media/kingfisher-bank.jpg"',
    );
  });

  it("stores sanitised HTML, never the raw extractor output", () => {
    expect(content.html).not.toContain("<script");
    expect(content.html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("counts words and derives a reading time at 200 wpm", () => {
    expect(content.wordCount).toBeGreaterThan(THIN_ARTICLE_WORDS);
    expect(content.readingMinutes).toBe(
      Math.max(1, Math.round(content.wordCount / WORDS_PER_MINUTE)),
    );
  });

  it("records which extractor produced it", () => {
    expect(content.extractor).toBe(EXTRACTOR);
  });
});

// ---------------------------------------------------------------------------
// The metadata fallback chain
// ---------------------------------------------------------------------------

describe("metadata fallbacks", () => {
  it("falls back to <title> when a page offers nothing else", () => {
    const outcome = expectOk(
      extractFixture("bare-title.html", "https://smallholding.example/hedge"),
    );

    expect(outcome.metadata.title).toBe("Notes on rebuilding a hedge");
    expect(outcome.metadata.author).toBeNull();
    expect(outcome.metadata.siteName).toBeNull();
    expect(outcome.metadata.publishedAt).toBeNull();
    expect(outcome.metadata.leadImageUrl).toBeNull();
  });

  it("falls back to the fetched URL when there is no canonical", () => {
    const outcome = expectOk(
      extractFixture("bare-title.html", "https://smallholding.example/hedge/"),
    );
    // Normalised by lib/canonical.ts: the trailing slash goes.
    expect(outcome.metadata.canonicalUrl).toBe(
      "https://smallholding.example/hedge",
    );
  });

  it("ignores a canonical that points at another site", () => {
    // An off-domain canonical is how a scraper steals identity: honouring it
    // would fold the copy and the original into one row.
    const outcome = extractArticle({
      url: "https://scraper.example/stolen-post",
      html:
        "<html><head><title>Stolen</title>" +
        '<link rel="canonical" href="https://www.originalpaper.example/real-post">' +
        "</head><body><p>Body.</p></body></html>",
    });

    expect(outcome.metadata.canonicalUrl).toBe(
      "https://scraper.example/stolen-post",
    );
  });

  it("honours a canonical on a subdomain of the same site", () => {
    const outcome = extractArticle({
      url: "https://m.paper.example/post?utm_medium=social",
      html:
        "<html><head><title>Post</title>" +
        '<link rel="canonical" href="https://paper.example/post">' +
        "</head><body><p>Body.</p></body></html>",
    });

    expect(outcome.metadata.canonicalUrl).toBe("https://paper.example/post");
  });

  it("ignores a javascript: canonical", () => {
    const outcome = extractArticle({
      url: "https://paper.example/post",
      html:
        "<html><head><title>Post</title>" +
        '<link rel="canonical" href="javascript:alert(1)">' +
        "</head><body><p>Body.</p></body></html>",
    });

    expect(outcome.metadata.canonicalUrl).toBe("https://paper.example/post");
  });

  it("drops a publish date that did not parse", () => {
    const outcome = extractArticle({
      url: "https://paper.example/post",
      html:
        "<html><head><title>Post</title>" +
        '<meta property="article:published_time" content="not a date">' +
        "</head><body><p>Body.</p></body></html>",
    });

    expect(outcome.metadata.publishedAt).toBeNull();
  });

  it("survives malformed JSON-LD without losing the rest of the page", () => {
    const outcome = extractArticle({
      url: "https://paper.example/post",
      html:
        "<html><head><title>Fallback title</title>" +
        '<script type="application/ld+json">{ this is not json }</script>' +
        '<meta property="og:title" content="OpenGraph title">' +
        "</head><body><p>Body.</p></body></html>",
    });

    expect(outcome.metadata.title).toBe("OpenGraph title");
  });
});

// ---------------------------------------------------------------------------
// The failure taxonomy
// ---------------------------------------------------------------------------

describe("failures", () => {
  it("calls a paywall teaser paywalled, not empty", () => {
    const outcome = expectFailed(
      extractFixture(
        "paywalled.html",
        "https://ledgerweekly.example/reinsurance",
      ),
    );
    expect(outcome.reason).toBe("paywalled");
  });

  it("calls a script-only page js_required", () => {
    const outcome = expectFailed(
      extractFixture("spa.html", "https://threadline.example/t/8813"),
    );
    expect(outcome.reason).toBe("js_required");
  });

  it("calls a page with no article no_content", () => {
    const outcome = expectFailed(
      extractFixture("empty-shell.html", "https://institute.example/members"),
    );
    expect(outcome.reason).toBe("no_content");
  });

  it("keeps a usable title and URL on every failure", () => {
    // A failed save is still a saved item. A row that keeps only its hash is a
    // row nobody can find again.
    const cases: [string, string][] = [
      ["paywalled.html", "https://ledgerweekly.example/reinsurance"],
      ["spa.html", "https://threadline.example/t/8813"],
      ["empty-shell.html", "https://institute.example/members"],
    ];

    for (const [name, url] of cases) {
      const outcome = expectFailed(extractFixture(name, url));
      expect(outcome.metadata.title).toBeTruthy();
      expect(outcome.metadata.canonicalUrl).toBeTruthy();
      expect(outcome.metadata.urlHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("prefers paywalled over js_required when a teaser is also script-heavy", () => {
    // Nearly every paywall is also a pile of script. "Looks like a paywall" is
    // true and actionable; "needs a browser" would send the reader nowhere.
    const outcome = extractArticle({
      url: "https://paper.example/post",
      html:
        "<html><head><title>Post</title>" +
        '<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>' +
        `<script>window.__DATA__=${JSON.stringify("x".repeat(4000))}</script>` +
        "</head><body><p>One short teaser paragraph.</p></body></html>",
    });

    expect(expectFailed(outcome).reason).toBe("paywalled");
  });

  it("does not call a genuinely short post a failure", () => {
    // Under 250 words with no paywall marker and no wall of script is just a
    // short article, and calling it broken would be worse than storing it.
    const outcome = expectOk(
      extractFixture("bare-title.html", "https://smallholding.example/hedge"),
    );

    expect(outcome.content.wordCount).toBeGreaterThan(0);
    expect(outcome.content.wordCount).toBeLessThan(THIN_ARTICLE_WORDS * 2);
    expect(outcome.content.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it("never throws on markup that is barely markup", () => {
    for (const html of [
      "",
      "   ",
      "<html>",
      "not html at all",
      "<html><body>" + "<div>".repeat(500) + "</body></html>",
      "<html><head><title></title></head><body></body></html>",
    ]) {
      expect(() =>
        extractArticle({ url: "https://paper.example/x", html }),
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Copy for the taxonomy
// ---------------------------------------------------------------------------

describe("failure copy", () => {
  it("has copy for every one of the ten reasons", () => {
    // The Record<FailReason, ...> type makes a missing entry a compile error;
    // this catches an entry that exists but says nothing.
    const reasons = Object.keys(FAIL_REASON_COPY);
    expect(reasons).toHaveLength(10);

    for (const [reason, copy] of Object.entries(FAIL_REASON_COPY)) {
      expect(copy.message.length, reason).toBeGreaterThan(0);
      expect(copy.message.trim(), reason).toBe(copy.message);
    }
  });

  it("offers a retry only where retrying can work", () => {
    const retryable = Object.entries(FAIL_REASON_COPY)
      .filter(([, copy]) => copy.offerRetry)
      .map(([reason]) => reason)
      .sort();

    expect(retryable).toEqual(["server_error", "unreachable"]);
  });

  it("says nothing about why a link was blocked", () => {
    // "Blocked: connection refused to 10.0.0.7" is a working port scanner
    // with a nice UI.
    const message = FAIL_REASON_COPY.blocked_url.message.toLowerCase();
    for (const leak of [
      "dns",
      "ip",
      "port",
      "refused",
      "private",
      "internal",
    ]) {
      expect(message).not.toContain(leak);
    }
  });
});

// ---------------------------------------------------------------------------
// The extractor stamp
// ---------------------------------------------------------------------------

describe("the extractor stamp", () => {
  it("matches the installed dependency", () => {
    // SCHEMA.sql keeps this on every row so a library upgrade that changes the
    // output can be traced to the items needing re-extraction. That only works
    // if the constant moves when the dependency does.
    const installed: unknown = JSON.parse(
      readFileSync(
        join(root, "node_modules/@mozilla/readability/package.json"),
        "utf8",
      ),
    );
    const version =
      typeof installed === "object" && installed !== null
        ? (installed as { version?: string }).version
        : undefined;

    expect(EXTRACTOR).toBe(`readability@${version}`);
  });
});
