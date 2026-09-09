import type { FailReason } from "@/lib/types";

/**
 * The product name lives here and nowhere else. Renaming the product is a
 * change to this file plus a domain purchase. See ARCHITECTURE.md section 1.
 */
export const APP_NAME = "Marrow";

export const APP_TAGLINE = "Save anything. Read it clean, later.";

export const APP_DESCRIPTION =
  "A read-it-later app that fetches the page on the server, strips it back to " +
  "the article, and keeps a clean copy you own.";

export interface FailReasonCopy {
  /** Shown on the item. Complete sentences; no codes, no internal detail. */
  readonly message: string;
  /**
   * Whether to offer the reader a retry. ARCHITECTURE.md section 6 marks two
   * reasons as worth retrying, and section 10 retries exactly those
   * automatically. Offering it anywhere else asks someone to keep pressing a
   * button that cannot work.
   */
  readonly offerRetry: boolean;
}

/**
 * Copy for the failure taxonomy in ARCHITECTURE.md section 6. Every value of
 * the fail_reason enum has an entry, and adding a value to the enum without
 * adding one here will not compile.
 *
 * Extraction fails constantly and that is normal. A failed save is still a
 * saved item, so this copy is read far more often than it looks.
 *
 * `blocked_url` says nothing about what was wrong on purpose. "Blocked:
 * connection refused to 10.0.0.7" is a working port scanner with a nice UI.
 */
export const FAIL_REASON_COPY: Record<FailReason, FailReasonCopy> = {
  blocked_url: { message: "That link can't be saved.", offerRetry: false },
  unreachable: { message: "Couldn't reach that site.", offerRetry: true },
  not_found: { message: "That page is gone.", offerRetry: false },
  forbidden: { message: "That site blocked us.", offerRetry: false },
  paywalled: {
    message: "Looks like a paywall — saved the link only.",
    offerRetry: false,
  },
  too_large: { message: "That page is too big.", offerRetry: false },
  unsupported_type: { message: "Only web pages for now.", offerRetry: false },
  js_required: {
    message: "This page needs a browser to render. Saved the link.",
    offerRetry: false,
  },
  no_content: {
    message: "Couldn't find an article here. Saved the link.",
    offerRetry: false,
  },
  server_error: {
    message: "Something went wrong on our end.",
    offerRetry: true,
  },
};
