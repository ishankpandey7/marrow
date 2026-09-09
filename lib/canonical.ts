import { createHash } from "node:crypto";

/**
 * URL normalisation and the dedupe hash. Pure: no network, no environment, no
 * database. Given the same string it returns the same answer forever, which is
 * what lets `items` carry a unique index on (user_id, url_hash) and what makes
 * this file testable without credentials.
 *
 * The `rel=canonical` step described in ARCHITECTURE.md section 6 is not here.
 * It needs the fetched document, so it belongs to the extraction pipeline in
 * Slice 2 and would drag a network dependency into a pure module.
 */

export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUrlError";
  }
}

/** Prefix-matched. Covers utm_source, utm_medium, and whatever marketing adds next. */
const TRACKING_PARAM_PREFIXES = ["utm_"];

/** Exact matches. From ARCHITECTURE.md section 6. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref",
  "ref_src",
  "_hsenc",
  "_hsmi",
  "yclid",
  "msclkid",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    TRACKING_PARAMS.has(lower) ||
    TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

/**
 * The normalised form of a URL. Two spellings of the same article produce the
 * same string; two different articles never do.
 *
 * Throws InvalidUrlError rather than returning null, because every caller has
 * to handle the bad-input case and a null return is the one that gets ignored.
 */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidUrlError("That does not look like a web address.");
  }

  // Only http and https. A file: or javascript: URL has no business reaching
  // the database, and rejecting it here means the fetcher in Slice 2 is the
  // second line of defence rather than the only one.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidUrlError("Only http and https links can be saved.");
  }

  // The URL parser already lowercases the scheme and host and removes a default
  // port, so those rules from section 6 are enforced by construction.
  url.hash = "";
  url.username = "";
  url.password = "";

  const kept = [...url.searchParams.entries()].filter(
    ([name]) => !isTrackingParam(name),
  );

  // Sorted by name, then by value, so ?t=b&t=a and ?t=a&t=b agree. Comparing
  // with < rather than localeCompare keeps the order locale-independent — a
  // machine in a different locale must produce the same hash.
  kept.sort(([nameA, valueA], [nameB, valueB]) =>
    nameA === nameB
      ? valueA < valueB
        ? -1
        : valueA > valueB
          ? 1
          : 0
      : nameA < nameB
        ? -1
        : 1,
  );

  const search = new URLSearchParams(kept);
  url.search = search.toString();

  // Trailing slash goes, except on the root, where "/" is the path. Dropping it
  // there would produce a string that grows a slash back the next time it is
  // parsed, making the hash depend on how often the value had round-tripped.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/** SHA-256 of the normalised URL, lowercase hex. Matches the schema's `^[0-9a-f]{64}$`. */
export function hashCanonicalUrl(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl, "utf8").digest("hex");
}

export interface Canonical {
  canonicalUrl: string;
  urlHash: string;
}

export function canonicalise(input: string): Canonical {
  const canonicalUrl = normaliseUrl(input);
  return { canonicalUrl, urlHash: hashCanonicalUrl(canonicalUrl) };
}
