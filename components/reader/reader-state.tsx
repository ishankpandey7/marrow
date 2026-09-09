import { FAIL_REASON_COPY } from "@/lib/constants";
import type { FailReason } from "@/lib/types";
import { originalUrl } from "@/lib/reading";
import { RetryButton } from "./retry-button";

const details: Record<FailReason, { label: string; detail: string }> = {
  blocked_url: {
    label: "Saved link",
    detail: "You can return to your library and save another link.",
  },
  unreachable: {
    label: "A little out of reach",
    detail:
      "Your link is safe here. The site may be available if you try again.",
  },
  not_found: {
    label: "A page that moved on",
    detail:
      "The address is kept in your library. Visit the original to see whether the publisher has moved it.",
  },
  forbidden: {
    label: "Read at the source",
    detail:
      "The publisher isn't letting us make a reading copy. You may still be able to read it on their site.",
  },
  paywalled: {
    label: "Behind a subscription",
    detail:
      "Your link has a place here. Open the original and sign in with the publisher to continue reading.",
  },
  too_large: {
    label: "More than we can hold",
    detail: "We kept the link. You can read the full page at the source.",
  },
  unsupported_type: {
    label: "A different kind of link",
    detail:
      "This reader is made for web articles. Open the original to view this file in your browser.",
  },
  js_required: {
    label: "Best in a browser",
    detail:
      "The story is assembled by the site's own scripts. Follow your saved link to read it there.",
  },
  no_content: {
    label: "A link worth keeping",
    detail:
      "Some pages don't have a separate article to extract. Your original link is still here whenever you need it.",
  },
  server_error: {
    label: "Give us another moment",
    detail:
      "Your link is safe. Try making a reading copy again, or carry on at the source.",
  },
};

export function ReaderState({
  reason,
  id,
  url,
  preview = false,
}: {
  reason: FailReason | "pending" | "missing";
  id: string;
  url: string;
  preview?: boolean;
}) {
  const href = originalUrl(url);
  if (reason === "pending" || reason === "missing")
    return (
      <section className="reader-state" aria-labelledby="reader-state-title">
        <span className="reader-state-mark" aria-hidden="true">
          {reason === "pending" ? "◌" : "◇"}
        </span>
        <p className="reader-eyebrow">
          {reason === "pending" ? "Link saved" : "Your library"}
        </p>
        <h2 id="reader-state-title">
          {reason === "pending"
            ? "Making room for the words."
            : "This reading copy isn't available."}
        </h2>
        <p>
          {reason === "pending"
            ? "We're preparing your article. Come back in a moment, or start reading at the source."
            : "It may have been removed, or we couldn't load it just now. Your library is a good place to start."}
        </p>
        <div className="reader-state-actions">
          {reason === "pending" && (
            <a href={preview ? `/reader-preview/${id}` : `/read/${id}`}>
              Check again
            </a>
          )}
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              Open original ↗
            </a>
          )}
          <a href={preview ? "/reader-preview/longform" : "/inbox"}>
            {preview ? "Back to sample article" : "Back to library"}
          </a>
        </div>
      </section>
    );
  const copy = FAIL_REASON_COPY[reason];
  return (
    <section className="reader-state" aria-labelledby="reader-state-title">
      <span className="reader-state-mark" aria-hidden="true">
        {reason === "paywalled" ? "⌑" : "◇"}
      </span>
      <p className="reader-eyebrow">{details[reason].label}</p>
      <h2 id="reader-state-title">{copy.message}</h2>
      <p>{details[reason].detail}</p>
      <div className="reader-state-actions">
        {copy.offerRetry && <RetryButton id={id} preview={preview} />}
        {href && reason !== "blocked_url" && (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            Open original ↗
          </a>
        )}
        <a href={preview ? "/reader-preview/longform" : "/inbox"}>
          {preview ? "Back to sample article" : "Back to library"}
        </a>
      </div>
    </section>
  );
}
