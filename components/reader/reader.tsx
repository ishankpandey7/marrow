import "server-only";

import type { ReactNode } from "react";
import type { SavedHighlight } from "@/lib/highlights";
import {
  DEFAULT_READER_SETTINGS,
  originalUrl,
  type ReaderItem,
  type ReaderSettings,
} from "@/lib/reading";
import { ArticleBody } from "./article-body";
import { Highlights } from "./highlights";
import { ReaderState } from "./reader-state";
import { ReaderSurface } from "./reader-surface";

export function Reader({
  item,
  html,
  settings = DEFAULT_READER_SETTINGS,
  storageScope,
  preview = false,
  fixtureNavigation,
  highlights = null,
  focusHighlight = null,
}: {
  item: ReaderItem;
  html: string | null;
  settings?: ReaderSettings;
  storageScope: string;
  preview?: boolean;
  fixtureNavigation?: ReactNode;
  /** Null when they could not be read, or for the database-less previews. */
  highlights?: SavedHighlight[] | null;
  focusHighlight?: string | null;
}) {
  const readable = item.status === "ready" && Boolean(html);
  const href = originalUrl(item.url);
  const source =
    item.site_name ||
    (href ? new URL(href).hostname.replace(/^www\./, "") : "Saved link");
  const date = item.published_at ? new Date(item.published_at) : null;
  return (
    <ReaderSurface
      key={item.id}
      id={item.id}
      storageScope={storageScope}
      initialSettings={settings}
      initialProgress={item.read_progress}
      url={item.fail_reason === "blocked_url" ? "" : item.url}
      readable={readable}
      preview={preview}
      restorePosition={!focusHighlight}
      lang={item.lang}
      tools={
        readable && !preview && highlights ? (
          <Highlights
            itemId={item.id}
            initial={highlights}
            focusId={focusHighlight}
          />
        ) : null
      }
    >
      <main id="reader-content" className="reader-main" tabIndex={-1}>
        {fixtureNavigation}
        <div className="reader-measure">
          <header className="reader-heading">
            <p className="reader-eyebrow">{source}</p>
            <h1>{item.title || "Your saved link"}</h1>
            <div className="reader-byline">
              {item.author && <span>By {item.author}</span>}
              {date && Number.isFinite(date.getTime()) && (
                <time dateTime={item.published_at ?? undefined}>
                  {new Intl.DateTimeFormat("en", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(date)}
                </time>
              )}
              {readable && item.reading_minutes !== null && (
                <span>{item.reading_minutes} min read</span>
              )}
            </div>
          </header>
          {readable && html ? (
            <>
              <article
                data-reader-article=""
                lang={item.lang ?? undefined}
                aria-label={item.title ?? "Saved article"}
              >
                <ArticleBody html={html} fixtureImages={preview} />
              </article>
              <footer className="reader-ending">
                <span aria-hidden="true">◆</span>
                <p>All read. A little more yours.</p>
                <a href={preview ? "/reader-preview/longform" : "/inbox"}>
                  {preview ? "Back to samples" : "Back to library"} ←
                </a>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    Visit original ↗
                  </a>
                )}
              </footer>
            </>
          ) : (
            <ReaderState
              id={item.id}
              reason={
                item.status === "pending"
                  ? "pending"
                  : (item.fail_reason ?? "missing")
              }
              url={item.url}
              preview={preview}
            />
          )}
        </div>
      </main>
    </ReaderSurface>
  );
}
