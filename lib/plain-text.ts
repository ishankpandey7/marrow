/**
 * Elements whose end is a word boundary in an article's plain text.
 *
 * Shared by `toPlainText` in `lib/extract.ts`, which makes the text that
 * search, word counts and highlight offsets are measured in, and by
 * `lib/highlight-dom.ts`, which has to count the rendered article the same
 * way. Kept apart from both so the client can import it without pulling the
 * extractor into its bundle. Change it and every stored highlight offset
 * moves; the quote re-anchors them, but only if the list changes in both
 * places at once, which is why there is one list.
 *
 * Without a separator at each one, "…world</p><p>Second…" reads back as
 * "worldSecond", which is one word where there were two — and the word count
 * is what the reading time is built from.
 */
export const BLOCK_TAGS: readonly string[] = [
  "p",
  "div",
  "br",
  "hr",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "section",
  "article",
  "aside",
  "table",
  "caption",
  "tr",
  "th",
  "td",
];
