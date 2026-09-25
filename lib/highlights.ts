/**
 * Highlight rules shared by the reader (client) and its Server Actions.
 *
 * Pure: no DOM, no database. Offsets are UTF-16 code units into
 * `toPlainText(sanitiseArticleHtml(item_content.html))` computed at read
 * time; `lib/highlight-dom.ts` produces the same string from the rendered
 * article. The quote is the truth and the offsets are a hint, because a
 * re-extraction or a sanitiser change moves offsets without telling anyone.
 */

/** Mirrors highlights_quote_length in 0010. */
export const QUOTE_MAX = 2000;
/** Mirrors highlights_note_length in 0010. */
export const NOTE_MAX = 10000;

export const HIGHLIGHT_COLUMNS =
  "id, quote, note, start_offset, end_offset, created_at";

export interface SavedHighlight {
  id: string;
  quote: string;
  note: string | null;
  start_offset: number;
  end_offset: number;
  created_at: string;
}

export interface Span {
  start: number;
  end: number;
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

/** True when a boundary at `index` would cut a surrogate pair in half. */
function splitsPair(text: string, index: number) {
  return (
    index > 0 &&
    index < text.length &&
    isHighSurrogate(text.charCodeAt(index - 1)) &&
    isLowSurrogate(text.charCodeAt(index))
  );
}

/**
 * Whether a highlight the reader asked for really is this text. The server
 * runs it against the text it recomputes, so a client that counted
 * differently gets a refusal instead of a highlight on the wrong words.
 */
export function highlightFits(
  text: string,
  start: unknown,
  end: unknown,
  quote: unknown,
): boolean {
  return (
    typeof quote === "string" &&
    quote.length > 0 &&
    quote.length <= QUOTE_MAX &&
    quote.trim() === quote &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    (start as number) >= 0 &&
    (end as number) > (start as number) &&
    (end as number) <= text.length &&
    !splitsPair(text, start as number) &&
    !splitsPair(text, end as number) &&
    text.slice(start as number, end as number) === quote
  );
}

/**
 * Where a saved highlight sits in this copy of the text: its own offsets if
 * the quote is still there, otherwise the occurrence of the quote nearest to
 * where it used to be. Null when the quote is gone, because painting the
 * right length of the wrong sentence is worse than not painting at all.
 */
export function anchorQuote(
  text: string,
  highlight: Pick<SavedHighlight, "quote" | "start_offset" | "end_offset">,
): Span | null {
  const { quote, start_offset: start, end_offset: end } = highlight;
  if (quote === "") return null;
  if (text.slice(start, end) === quote) return { start, end };
  let best = -1;
  for (
    let index = text.indexOf(quote);
    index !== -1;
    index = text.indexOf(quote, index + 1)
  ) {
    if (best === -1 || Math.abs(index - start) < Math.abs(best - start))
      best = index;
    // Occurrences only move further away once they pass the old position.
    if (index > start) break;
  }
  return best === -1 ? null : { start: best, end: best + quote.length };
}

/**
 * A note as stored: trimmed, and an empty note is no note. Undefined means
 * the input is not a note at all and must be refused.
 */
export function cleanNote(input: unknown): string | null | undefined {
  if (input === null) return null;
  if (typeof input !== "string") return undefined;
  const note = input.trim();
  if (note.length > NOTE_MAX) return undefined;
  return note === "" ? null : note;
}
