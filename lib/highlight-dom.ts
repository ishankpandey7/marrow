import { BLOCK_TAGS } from "@/lib/plain-text";
import type { Span } from "@/lib/highlights";

/**
 * The rendered article, read back as the plain text highlight offsets are
 * counted in, with a map in both directions between that text and the DOM.
 *
 * It has to reproduce `toPlainText` in `lib/extract.ts` exactly: a separator
 * after every block element, every run of whitespace collapsed to one space,
 * and the ends trimmed. The rendered DOM is not the HTML `toPlainText` saw,
 * so two things are skipped outright. The image placeholder renders "Load
 * image ↗" and the alt text, which the stored HTML never contained; counting
 * them would shift every highlight after the first image. And `noscript`,
 * whose text the browser never shows.
 *
 * Works on the browser DOM and on linkedom, so it can be tested against the
 * server's own rendering.
 */

const BLOCKS = new Set(BLOCK_TAGS);
// The same class `\s` means in `.replace(/\s+/g, " ")` and `.trim()`.
const WHITESPACE = /\s/;

export interface TextIndex {
  readonly root: Node;
  readonly text: string;
  /** Per code unit of `text`: the text node it came from, null for a block separator. */
  readonly nodes: readonly (Text | null)[];
  readonly offsets: readonly number[];
  /** Per walked text node: the text index at each of its code-unit boundaries. */
  readonly boundaries: ReadonlyMap<Node, Int32Array>;
  /** Per walked element (and comment): where its contents start and end in `text`. */
  readonly spans: ReadonlyMap<Node, readonly [number, number]>;
}

export interface BoundaryPoints {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
}

function skipped(element: Element) {
  return (
    element.tagName.toLowerCase() === "noscript" ||
    element.classList.contains("reader-image")
  );
}

export function textIndex(root: Node): TextIndex {
  const parts: string[] = [];
  const nodes: (Text | null)[] = [];
  const offsets: number[] = [];
  const boundaries = new Map<Node, Int32Array>();
  const spans = new Map<Node, readonly [number, number]>();
  let length = 0;
  // A space is written only once a character follows it, which is what
  // collapsing runs and trimming the end amount to.
  let pending = false;
  let pendingNode: Text | null = null;
  let pendingOffset = 0;

  const here = () => length + (pending ? 1 : 0);

  function whitespace(node: Text | null, offset: number) {
    // Nothing written yet: this is leading whitespace, which trim removes.
    if (length === 0) return;
    if (!pending) {
      pending = true;
      pendingNode = node;
      pendingOffset = offset;
    } else if (pendingNode === null && node !== null) {
      // Prefer a real character to stand for the space, so a range can end on it.
      pendingNode = node;
      pendingOffset = offset;
    }
  }

  function character(value: string, node: Text, offset: number) {
    if (pending) {
      parts.push(" ");
      nodes.push(pendingNode);
      offsets.push(pendingOffset);
      length += 1;
      pending = false;
      pendingNode = null;
    }
    parts.push(value);
    nodes.push(node);
    offsets.push(offset);
    length += 1;
  }

  function walk(node: Node) {
    if (node.nodeType === 3) {
      const text = node as Text;
      const data = text.data;
      const map = new Int32Array(data.length + 1);
      for (let index = 0; index < data.length; index += 1) {
        map[index] = here();
        const value = data[index];
        if (WHITESPACE.test(value)) whitespace(text, index);
        else character(value, text, index);
      }
      map[data.length] = here();
      boundaries.set(text, map);
      return;
    }
    if (node.nodeType !== 1) {
      // Comments and the like add no text, but a selection can still start in one.
      spans.set(node, [here(), here()]);
      return;
    }
    const element = node as Element;
    const start = here();
    if (skipped(element)) {
      spans.set(element, [start, start]);
      return;
    }
    for (const child of Array.from(element.childNodes)) walk(child);
    spans.set(element, [start, here()]);
    if (BLOCKS.has(element.tagName.toLowerCase())) whitespace(null, 0);
  }

  for (const child of Array.from(root.childNodes)) walk(child);
  spans.set(root, [0, here()]);
  return {
    root,
    text: parts.join(""),
    nodes,
    offsets,
    boundaries,
    spans,
  };
}

/** Where a DOM boundary point falls in the text, or null outside the article. */
function textPosition(index: TextIndex, container: Node, offset: number) {
  const clamp = (value: number) => Math.min(value, index.text.length);
  const map = index.boundaries.get(container);
  if (map) return clamp(map[Math.max(0, Math.min(offset, map.length - 1))]);
  const span = index.spans.get(container);
  if (span) {
    const child = container.childNodes[offset];
    if (!child) return clamp(span[1]);
    const childMap = index.boundaries.get(child);
    if (childMap) return clamp(childMap[0]);
    // Every child of a walked element is recorded; only the children of a
    // skipped one are not, and a skipped element's start is also its end.
    return clamp(index.spans.get(child)?.[0] ?? span[1]);
  }
  // Deeper inside a skipped element: the first recorded ancestor is it.
  for (
    let ancestor = container.parentNode;
    ancestor;
    ancestor = ancestor.parentNode
  ) {
    const ancestorSpan = index.spans.get(ancestor);
    if (ancestorSpan) return clamp(ancestorSpan[0]);
  }
  return null;
}

export interface Selected extends Span {
  quote: string;
}

// Node.compareDocumentPosition bits, spelled out: linkedom has no Node global.
const DISCONNECTED = 1;
const PRECEDING = 2;
const FOLLOWING = 4;
const CONTAINS = 8;

/**
 * A boundary point outside the article, clamped to the article's nearer end:
 * 0 before it, the text's length after it, null if it is not in the document.
 */
function edgePosition(index: TextIndex, node: Node, nodeOffset: number) {
  let container = node;
  let offset = nodeOffset;
  // Compare the element holding a text node instead of the text node itself.
  // It lies on the same side of the article, and linkedom (which the tests
  // run on) misplaces text inside a preceding element as following.
  if (container.nodeType !== 1 && container.parentNode) {
    offset = Array.prototype.indexOf.call(
      container.parentNode.childNodes,
      container,
    );
    container = container.parentNode;
  }
  const relation = index.root.compareDocumentPosition(container);
  if (relation & DISCONNECTED) return null;
  if (relation & CONTAINS) {
    // An ancestor of the article: the offset says which side of it the point is.
    let child: Node = index.root;
    while (child.parentNode && child.parentNode !== container)
      child = child.parentNode;
    const at = Array.prototype.indexOf.call(container.childNodes, child);
    return offset <= at ? 0 : index.text.length;
  }
  if (relation & FOLLOWING) return index.text.length;
  if (relation & PRECEDING) return 0;
  return null;
}

/**
 * The text a selection covers, trimmed of the spaces at its ends. An end
 * outside the article is clamped to the article's edge: Chromium ends a
 * triple-click on the last paragraph at the start of the footer, and drags
 * overshoot. Null when nothing but whitespace of the article is selected,
 * which includes a selection that misses the article altogether.
 */
export function selectedText(
  index: TextIndex,
  points: BoundaryPoints,
): Selected | null {
  const position = (container: Node, offset: number) =>
    index.root.contains(container)
      ? textPosition(index, container, offset)
      : edgePosition(index, container, offset);
  let start = position(points.startContainer, points.startOffset);
  let end = position(points.endContainer, points.endOffset);
  if (start === null || end === null) return null;
  while (start < end && index.text[start] === " ") start += 1;
  while (end > start && index.text[end - 1] === " ") end -= 1;
  if (end <= start) return null;
  return { start, end, quote: index.text.slice(start, end) };
}

/**
 * The DOM boundary points that paint `text.slice(start, end)`. Separators
 * that stand for a block boundary have no characters of their own, so the
 * range starts at the first real character and ends after the last one.
 */
export function boundaryPoints(
  index: TextIndex,
  span: Span,
): BoundaryPoints | null {
  let first = Math.max(0, span.start);
  let last = Math.min(index.text.length, span.end) - 1;
  while (first <= last && index.nodes[first] === null) first += 1;
  while (last >= first && index.nodes[last] === null) last -= 1;
  const startNode = index.nodes[first];
  const endNode = index.nodes[last];
  if (first > last || !startNode || !endNode) return null;
  return {
    startContainer: startNode,
    startOffset: index.offsets[first],
    endContainer: endNode,
    endOffset: index.offsets[last] + 1,
  };
}
