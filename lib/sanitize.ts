import sanitize from "sanitize-html";

/**
 * The allowlist untrusted HTML has to survive.
 *
 * A security boundary, not a formatting step. We store HTML that a stranger
 * wrote and render it into our own origin on the reading view, so a surviving
 * `<script>` or `onerror=` is stored XSS against every reader of that item.
 * ARCHITECTURE.md section 6 step 5; the corpus that must not survive is in
 * sanitize.test.ts.
 *
 * Pure: no network, no environment, no database. Given the same string it
 * returns the same answer forever.
 *
 * Sanitisation is not allowed to be the only layer — a CSP without
 * unsafe-inline for scripts is the second, and it is not this file's job.
 */

/**
 * Structure and semantics, nothing else. Anything that loads a resource,
 * submits, or executes is absent, and absent is the point: this is an
 * allowlist, so a tag invented next year is denied without anyone editing
 * this file.
 */
const ALLOWED_TAGS = [
  // Blocks
  "p",
  "div",
  "br",
  "hr",
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
  "article",
  "section",
  "aside",
  // Lists
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  // Inline
  "a",
  "em",
  "strong",
  "i",
  "b",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "small",
  "sub",
  "sup",
  "code",
  "kbd",
  "samp",
  "var",
  "abbr",
  "cite",
  "q",
  "dfn",
  "time",
  "span",
  "wbr",
  // Media
  "img",
  // Tables
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
];

/**
 * Removed along with everything inside them.
 *
 * The default list is script, style, textarea and option. Without the
 * additions, stripping `<form>` but keeping its children leaves "Password"
 * sitting in the middle of the article, and stripping `<style>` but keeping
 * its text pastes a stylesheet into the prose.
 */
const NON_TEXT_TAGS = [
  "script",
  "style",
  "textarea",
  "option",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "template",
  "svg",
  "math",
  "canvas",
  "audio",
  "video",
  "map",
  "select",
  "button",
];

const FORCED_LINK_REL = "noopener noreferrer nofollow";

/**
 * The value of a URL attribute, if it is an absolute http or https URL, and
 * null otherwise.
 *
 * allowedSchemes only judges a URL that has a scheme, so it says nothing about
 * "/settings" or "//evil.example/x". Both resolve against *our* origin when the
 * reading view renders them: the first is a link into our own app wearing an
 * article's clothes, the second inherits our scheme and reads as same-origin at
 * a glance. Extraction absolutises every URL against the page it came from, so
 * anything still relative by the time it arrives here did not come from the
 * document we fetched.
 */
function absoluteHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function withoutHref(attribs: sanitize.Attributes): sanitize.Attributes {
  const rest: sanitize.Attributes = { ...attribs };
  delete rest.href;
  return rest;
}

export const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: ALLOWED_TAGS,

  // No `style`, so `expression()` has nowhere to live. No `class`, because an
  // article that can name classes can collide with the reading view's own
  // styles or imitate our chrome. Every `on*` handler is absent by
  // construction: this is an allowlist, and they are not on it.
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    blockquote: ["cite"],
    q: ["cite"],
    ol: ["start", "reversed", "type"],
    li: ["value"],
    time: ["datetime"],
    abbr: ["title"],
    dfn: ["title"],
    th: ["colspan", "rowspan", "scope", "headers"],
    td: ["colspan", "rowspan", "headers"],
    col: ["span"],
    colgroup: ["span"],
    "*": ["lang", "dir", "id"],
  },

  // ARCHITECTURE section 6 step 5: http and https, nothing else. mailto and
  // tel are deliberately absent — this is the list the document says it is.
  allowedSchemes: ["http", "https"],
  allowedSchemesAppliedToAttributes: ["href", "src", "cite"],

  // "//evil.example/x" inherits our scheme and reads as same-origin at a
  // glance. Extraction absolutises every URL before this runs, so anything
  // still relative when it arrives here did not come from the document.
  allowProtocolRelative: false,

  allowedClasses: {},
  nonTextTags: NON_TEXT_TAGS,
  disallowedTagsMode: "discard",

  // The article body is a fragment, not a document. Without this, a fragment
  // containing no <html> would be discarded wholesale.
  enforceHtmlBoundary: false,

  transformTags: {
    // Every link leaves our origin. rel is forced rather than merged: an
    // author-supplied rel="opener" hands window.opener to the page we linked
    // to, and trusting it is trusting the party we are defending against.
    // A link we cannot resolve loses its href and keeps its text, because the
    // sentence it sits in is still the article.
    a: (_tagName, attribs) => {
      const href = absoluteHttpUrl(attribs.href);
      const base = href ? { ...attribs, href } : withoutHref(attribs);
      return {
        tagName: "a",
        attribs: { ...base, rel: FORCED_LINK_REL, target: "_blank" },
      };
    },
    img: (_tagName, attribs) => ({
      tagName: "img",
      attribs: { ...attribs, src: absoluteHttpUrl(attribs.src) ?? "" },
    }),
  },

  // An <img> with no usable source renders as a broken-image box in the middle
  // of the prose, which looks like our bug rather than the page's.
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};

/** Run untrusted article HTML through the allowlist. */
export function sanitiseArticleHtml(dirty: string): string {
  return sanitize(dirty, SANITIZE_OPTIONS);
}
