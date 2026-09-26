import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { toPlainText } from "./extract";
import { sanitiseArticleHtml } from "./sanitize";
import { boundaryPoints, selectedText, textIndex } from "./highlight-dom";

vi.mock("server-only", () => ({}));
import { ArticleBody } from "@/components/reader/article-body";

/**
 * The mapper is only correct if it reads the article the reader actually
 * sees exactly as the server's toPlainText reads the stored HTML. So these
 * tests render through the production ArticleBody, image placeholders and
 * table wrappers included, and compare against the server's own function.
 */
function rendered(html: string) {
  const markup = renderToStaticMarkup(createElement(ArticleBody, { html }));
  const { document } = parseHTML(
    `<!doctype html><html><body>${markup}</body></html>`,
  );
  const root = document.querySelector(".reader-prose");
  if (!root) throw new Error("ArticleBody rendered no .reader-prose");
  return root;
}

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const TRICKY = [
  "<p>Before the image.</p>",
  '<figure><img src="https://images.example/heron.png" alt="A heron at dawn" width="600" height="400">',
  "<figcaption>Caption   with\n spaces</figcaption></figure>",
  "<p>After&nbsp;the image, a 🐦 bird and ﬁ ligature.</p>",
  "<table><caption>Survey</caption><tr><th>Day</th><td>Tuesday</td></tr></table>tail text",
  "<ul><li>one</li><li><p>two</p></li></ul>",
  "<pre>  code\n    indented  </pre>",
  "<p>line<br>break <em>em</em><strong>strong</strong>joined</p>",
  "<blockquote>  quoted  </blockquote><h2>Heading</h2><p>Last.</p>",
].join("");

const corpus: [string, string][] = [
  ["tricky", TRICKY],
  ["longform fixture", read("components/reader/fixtures/longform.html")],
  ["news article", read("test/fixtures/news-article.html")],
  ["paywalled", read("test/fixtures/paywalled.html")],
  ["bare title", read("test/fixtures/bare-title.html")],
];

describe("the rendered article reads back as the server's plain text", () => {
  it.each(corpus)("%s", (_name, html) => {
    const expected = toPlainText(sanitiseArticleHtml(html));
    expect(expected.length).toBeGreaterThan(0);
    expect(textIndex(rendered(html)).text).toBe(expected);
  });

  it("does not count the image placeholder, which the stored HTML never had", () => {
    const root = rendered(TRICKY);
    expect(root.textContent).toContain("Load image");
    const { text } = textIndex(root);
    expect(text).not.toContain("Load image");
    expect(text).not.toContain("A heron at dawn");
    expect(text).toContain("Before the image. Caption with spaces After");
  });

  it("skips noscript", () => {
    const root = rendered("<p>Kept</p>");
    const noscript = root.ownerDocument.createElement("noscript");
    noscript.textContent = "Enable JavaScript";
    root.appendChild(noscript);
    expect(textIndex(root).text).toBe("Kept");
  });
});

describe("offsets and DOM boundary points map both ways", () => {
  it("turns every word-bounded span into points and back into the same span", () => {
    const root = rendered(TRICKY);
    const index = textIndex(root);
    const words = [...index.text.matchAll(/\S+/g)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
    }));
    for (let i = 0; i < words.length; i += 1) {
      for (let j = i; j < Math.min(words.length, i + 6); j += 1) {
        const span = { start: words[i].start, end: words[j].end };
        const points = boundaryPoints(index, span);
        expect(points).not.toBeNull();
        expect(selectedText(index, points!)).toEqual({
          ...span,
          quote: index.text.slice(span.start, span.end),
        });
      }
    }
  });

  it("keeps a surrogate pair whole", () => {
    const index = textIndex(rendered("<p>a 🐦 b</p>"));
    const start = index.text.indexOf("🐦");
    const points = boundaryPoints(index, { start, end: start + 2 });
    expect(selectedText(index, points!)?.quote).toBe("🐦");
  });

  it("trims whitespace a selection picked up at either end", () => {
    const root = rendered("<p>first</p><p>second</p>");
    const index = textIndex(root);
    const [first, second] = Array.from(root.querySelectorAll("p"));
    // From the end of "first" to the start of "second" is only the separator.
    expect(
      selectedText(index, {
        startContainer: first,
        startOffset: 1,
        endContainer: second,
        endOffset: 0,
      }),
    ).toBeNull();
    // Element-level points around the whole of both paragraphs.
    expect(
      selectedText(index, {
        startContainer: root,
        startOffset: 0,
        endContainer: root,
        endOffset: root.childNodes.length,
      }),
    ).toEqual({ start: 0, end: 12, quote: "first second" });
  });

  it("treats a point inside the image placeholder as the placeholder's place in the text", () => {
    const root = rendered(TRICKY);
    const index = textIndex(root);
    const button = root.querySelector(".reader-image button");
    const after = Array.from(root.querySelectorAll("p"))[1];
    const selected = selectedText(index, {
      startContainer: button!.firstChild!,
      startOffset: 2,
      endContainer: after.firstChild!,
      endOffset: 5,
    });
    expect(selected?.quote).toBe("Caption with spaces After");
  });

  it("clamps a selection that runs past the article to the article's end", () => {
    const root = rendered("<p>first</p><p>last one</p>");
    const footer = root.ownerDocument.createElement("footer");
    footer.textContent = "All read.";
    root.ownerDocument.body.appendChild(footer);
    const index = textIndex(root);
    const last = Array.from(root.querySelectorAll("p"))[1];
    // What Chromium reports for a triple-click on the last paragraph.
    expect(
      selectedText(index, {
        startContainer: last.firstChild!,
        startOffset: 0,
        endContainer: footer,
        endOffset: 0,
      }),
    ).toEqual({ start: 6, end: 14, quote: "last one" });
  });

  it("clamps a selection that starts above the article, and one that holds it through an ancestor", () => {
    const root = rendered("<p>inside words</p>");
    const heading = root.ownerDocument.createElement("h1");
    heading.textContent = "Title";
    root.ownerDocument.body.insertBefore(heading, root);
    const index = textIndex(root);
    const text = root.querySelector("p")!.firstChild!;
    expect(
      selectedText(index, {
        startContainer: heading.firstChild!,
        startOffset: 1,
        endContainer: text,
        endOffset: 6,
      }),
    ).toEqual({ start: 0, end: 6, quote: "inside" });
    const parent = root.parentNode!;
    const at = Array.prototype.indexOf.call(parent.childNodes, root);
    expect(
      selectedText(index, {
        startContainer: parent,
        startOffset: at,
        endContainer: parent,
        endOffset: at + 1,
      }),
    ).toEqual({ start: 0, end: 12, quote: "inside words" });
  });

  it("refuses a selection wholly outside the article", () => {
    const root = rendered("<p>inside</p>");
    const outside = root.ownerDocument.createElement("p");
    outside.textContent = "outside";
    root.ownerDocument.body.appendChild(outside);
    const index = textIndex(root);
    expect(
      selectedText(index, {
        startContainer: outside.firstChild!,
        startOffset: 0,
        endContainer: outside.firstChild!,
        endOffset: 3,
      }),
    ).toBeNull();
  });

  it("has no points for a span made only of block separators", () => {
    const index = textIndex(rendered("<p>a</p><p>b</p>"));
    expect(index.text).toBe("a b");
    expect(index.nodes[1]).toBeNull();
    expect(boundaryPoints(index, { start: 1, end: 2 })).toBeNull();
  });
});
