import type { ItemListRow } from "@/lib/types";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function savedAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * A pending item has no title yet — extraction lands in Slice 2. Showing the
 * host and a working indicator reads as "on its way"; an empty row with a
 * spinner reads as broken, and the difference is the whole first impression.
 */
export function ItemRow({ item }: { item: ItemListRow }) {
  const host = hostOf(item.url);
  const pending = item.status === "pending";
  const failed = item.status === "failed";

  // Both the headline and the source fall back to the host, and until
  // extraction runs neither has anything else to show. Printing it twice —
  // "en.wikipedia.org · en.wikipedia.org · just now" — is the kind of small
  // sloppiness that makes a list look unfinished.
  const headline = item.title ?? host;
  const source = item.site_name ?? host;
  const showSource = source !== headline;

  return (
    <li className="border-b border-edge last:border-b-0">
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block px-1 py-4 transition-colors hover:bg-ground-raised"
      >
        <p className="text-base leading-snug font-medium text-pretty text-ink">
          {headline}
        </p>

        {item.excerpt && (
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-dim">
            {item.excerpt}
          </p>
        )}

        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
          {showSource && (
            <>
              <span>{source}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{savedAgo(item.created_at)}</span>

          {item.reading_minutes !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span>{item.reading_minutes} min</span>
            </>
          )}

          {pending && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 text-accent">
                <span
                  aria-hidden="true"
                  className="inline-block size-1.5 animate-pulse rounded-full bg-accent"
                />
                Fetching the article
              </span>
            </>
          )}

          {failed && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-ink-dim">Saved as a link only</span>
            </>
          )}
        </p>
      </a>
    </li>
  );
}
