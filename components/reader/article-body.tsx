import "server-only";

import { createElement, type ReactNode } from "react";
import { parseHTML } from "linkedom";
import { sanitiseArticleHtml } from "@/lib/sanitize";
import { imageDimensions } from "@/lib/reading";
import { ReaderImage } from "./reader-image";

const reactAttributes: Record<string, string> = {
  colspan: "colSpan",
  rowspan: "rowSpan",
  datetime: "dateTime",
};

export function ArticleBody({
  html,
  fixtureImages = false,
}: {
  html: string;
  fixtureImages?: boolean;
}) {
  // Even old stored copies cross today's allowlist. Parsing happens only after sanitisation.
  const { document } = parseHTML(
    `<html><body>${sanitiseArticleHtml(html)}</body></html>`,
  );
  function render(node: ChildNode, key: number): ReactNode {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return null;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const attributes: Record<string, string | boolean | number> = { key };
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "id") continue;
      attributes[reactAttributes[attribute.name] ?? attribute.name] =
        attribute.name === "reversed" ? true : attribute.value;
    }
    if (tag === "img") {
      const src = element.getAttribute("src") ?? "";
      // Only this fixed fixture URL maps to a local asset; publisher input cannot pick a local route.
      const local =
        fixtureImages && src === "https://reader-fixture.example/river.svg";
      return (
        <ReaderImage
          key={key}
          src={local ? "/reader-fixture-river.svg" : src}
          alt={element.getAttribute("alt") ?? ""}
          {...imageDimensions(
            element.getAttribute("width"),
            element.getAttribute("height"),
          )}
          local={local}
        />
      );
    }
    const children = Array.from(element.childNodes).map(render);
    const result = createElement(tag, attributes, ...children);
    if (tag === "table") {
      return (
        <div
          className="reader-table"
          role="region"
          aria-label={
            element.querySelector("caption")?.textContent || "Article table"
          }
          tabIndex={0}
          key={key}
        >
          {result}
        </div>
      );
    }
    return result;
  }
  return (
    <div className="reader-prose">
      {Array.from(document.body.childNodes).map(render)}
    </div>
  );
}
