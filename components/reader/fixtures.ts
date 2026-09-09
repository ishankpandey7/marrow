import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { extractArticle } from "@/lib/extract";
import { FAIL_REASON_COPY } from "@/lib/constants";
import type { ReaderItem } from "@/lib/reading";
import type { FailReason } from "@/lib/types";

export const READER_FIXTURES = [
  "longform",
  "news-article",
  "bare-title",
  "pending",
  ...Object.keys(FAIL_REASON_COPY),
] as const;

export async function readerFixture(
  id: string,
): Promise<{ item: ReaderItem; html: string | null } | null> {
  if (!READER_FIXTURES.includes(id)) return null;
  const item: ReaderItem = {
    id,
    url: "https://reader-fixture.example/a-mile-beside-the-water",
    title: "A mile beside the water",
    author: "Reader sample",
    site_name: "The reading room",
    published_at: "2026-09-09T00:00:00Z",
    reading_minutes: null,
    status: "ready",
    fail_reason: null,
    read_progress: 0,
    lang: "en",
  };
  if (id === "longform") {
    const html = await readFile(
      join(process.cwd(), "components/reader/fixtures/longform.html"),
      "utf8",
    );
    const { document } = parseHTML(`<html><body>${html}</body></html>`);
    const words = document.body.textContent?.trim().split(/\s+/).length ?? 0;
    return {
      item: { ...item, reading_minutes: Math.max(1, Math.round(words / 200)) },
      html,
    };
  }
  const file =
    id === "news-article" || id === "bare-title"
      ? `${id}.html`
      : id === "paywalled"
        ? "paywalled.html"
        : id === "js_required"
          ? "spa.html"
          : id === "no_content"
            ? "empty-shell.html"
            : null;
  if (file) {
    const html = await readFile(
      join(process.cwd(), "test/fixtures", file),
      "utf8",
    );
    const outcome = extractArticle({
      url: `https://reader-fixture.example/${id}`,
      html,
    });
    const metadata = outcome.metadata;
    return {
      item: {
        ...item,
        title: metadata.title,
        author: metadata.author,
        site_name: metadata.siteName,
        url: metadata.canonicalUrl,
        published_at: metadata.publishedAt,
        lang: metadata.lang,
        reading_minutes: outcome.ok ? outcome.content.readingMinutes : null,
        status: outcome.ok ? "ready" : "failed",
        fail_reason: outcome.ok ? null : outcome.reason,
      },
      html: outcome.ok ? outcome.content.html : null,
    };
  }
  return {
    item: {
      ...item,
      status: id === "pending" ? "pending" : "failed",
      fail_reason: id === "pending" ? null : (id as FailReason),
    },
    html: null,
  };
}
