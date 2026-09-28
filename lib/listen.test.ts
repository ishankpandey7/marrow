import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { selectedText, textIndex } from "./highlight-dom";
import {
  DEFAULT_LISTEN,
  LISTEN_RATES,
  SENTENCE_CAP,
  chosenVoice,
  firstBelow,
  languageKey,
  listenPreference,
  orderVoices,
  punctuationSentences,
  sentencePlan,
  spokenSentences,
  withVoice,
} from "./listen";

vi.mock("server-only", () => ({}));
import { ArticleBody } from "@/components/reader/article-body";

/** The article as the reader renders it, image placeholders included. */
function rendered(html: string, title = "A title") {
  const markup = renderToStaticMarkup(createElement(ArticleBody, { html }));
  const { document } = parseHTML(
    `<!doctype html><html><body><h1>${title}</h1>${markup}</body></html>`,
  );
  const heading = document.querySelector("h1");
  const prose = document.querySelector(".reader-prose");
  if (!heading || !prose) throw new Error("nothing rendered");
  return { heading, prose };
}
const texts = (html: string) =>
  spokenSentences([rendered(html).prose], "en").map((s) => s.text);

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const FIXTURES: [string, string][] = [
  ["longform", read("components/reader/fixtures/longform.html")],
  ["news article", read("test/fixtures/news-article.html")],
  ["bare title", read("test/fixtures/bare-title.html")],
];

describe("the sentences Listen reads", () => {
  it("ends a sentence at every block, so a heading never runs on", () => {
    expect(
      texts(
        "<h2>Heading</h2><p>First sentence. Second one!</p><ul><li>one</li><li>two</li></ul>",
      ),
    ).toEqual(["Heading", "First sentence.", "Second one!", "one", "two"]);
  });

  it("skips code, lone punctuation, the image placeholder and noscript", () => {
    const spoken = texts(
      [
        "<p>Before.</p>",
        "<pre>const a = 1;\nreturn a;</pre>",
        "<p>—</p>",
        '<figure><img src="https://images.example/heron.png" alt="A heron at dawn" width="600" height="400">',
        "<figcaption>A caption.</figcaption></figure>",
        "<p>After.</p>",
      ].join(""),
    );
    expect(spoken).toEqual(["Before.", "A caption.", "After."]);
  });

  it("reads the title first, then the article", () => {
    const { heading, prose } = rendered("<p>Body text.</p>", "The headline");
    expect(spokenSentences([heading, prose], null).map((s) => s.text)).toEqual([
      "The headline",
      "Body text.",
    ]);
  });

  it.each(FIXTURES)(
    "%s: every sentence is capped and paints exactly its own text",
    (_name, html) => {
      const { prose } = rendered(html);
      const spoken = spokenSentences([prose], "en");
      expect(spoken.length).toBeGreaterThan(0);
      const index = textIndex(prose);
      for (const sentence of spoken) {
        expect(sentence.text.length).toBeLessThanOrEqual(SENTENCE_CAP);
        expect(sentence.text).not.toMatch(/Load image/);
        expect(selectedText(index, sentence.points)?.quote).toBe(sentence.text);
      }
    },
  );

  it("splits a long sentence after a comma, else at a space, else hard", () => {
    const clause = "a clause of words that goes on for a while";
    const long = `${[clause, clause, clause, clause, clause, clause].join(", ")}.`;
    const [first, ...rest] = sentencePlan(long, [], [], "en");
    expect(long.slice(first.start, first.end).endsWith(",")).toBe(true);
    for (const span of [first, ...rest]) {
      expect(span.end - span.start).toBeLessThanOrEqual(SENTENCE_CAP);
      expect(long.slice(span.start, span.end)).toBe(
        long.slice(span.start, span.end).trim(),
      );
    }
    expect(
      [first, ...rest].map((s) => long.slice(s.start, s.end)).join(" "),
    ).toBe(long);

    const words = `${"word ".repeat(80)}end.`;
    for (const span of sentencePlan(words, [], [], "en"))
      expect(words.slice(span.start, span.end)).toMatch(
        /^(word )*(word|end\.)$/,
      );

    // No comma, no space: a hard cut that keeps the emoji whole.
    const solid = `${"x".repeat(SENTENCE_CAP - 1)}🐦${"y".repeat(50)}`;
    const cut = sentencePlan(solid, [], [], "en");
    expect(cut[0].end).toBe(SENTENCE_CAP - 1);
    expect(solid.slice(cut[1].start, cut[1].start + 2)).toBe("🐦");
  });

  it("drops a piece the cap leaves with nothing to say", () => {
    // French puts a space before "?"; here the cut falls right on it.
    const french = `${"mot ".repeat(49)}fin ?`;
    expect(french.length).toBe(SENTENCE_CAP + 1);
    expect(
      sentencePlan(french, [], [], "fr").map((s) =>
        french.slice(s.start, s.end),
      ),
    ).toEqual([`${"mot ".repeat(49)}fin`]);
  });

  it("survives a language tag the publisher got wrong", () => {
    expect(
      sentencePlan("One. Two.", [], [], "not a tag!!").map((s) => s.start),
    ).toEqual([0, 5]);
  });

  it("falls back to punctuation where Intl.Segmenter is missing", () => {
    expect(
      punctuationSentences("She said “Stop.” Then left! Why? Tail").map(
        (piece) => piece.segment.trim(),
      ),
    ).toEqual(["She said “Stop.”", "Then left!", "Why?", "Tail"]);
  });
});

describe("where Listen starts", () => {
  const bottoms = [100, 200, 300, 400];
  const bottom = (index: number) => bottoms[index];

  it("is the first sentence below the toolbar", () => {
    expect(firstBelow(4, bottom, 64)).toBe(0);
    expect(firstBelow(4, bottom, 250)).toBe(2);
    expect(firstBelow(4, bottom, 300)).toBe(3);
  });

  it("starts again from the top once everything is above it", () => {
    expect(firstBelow(4, bottom, 400)).toBe(0);
    expect(firstBelow(0, bottom, 0)).toBe(0);
  });
});

describe("the per-device preference", () => {
  it("falls back to the defaults for anything damaged", () => {
    expect(listenPreference(null)).toEqual(DEFAULT_LISTEN);
    expect(listenPreference("{nope")).toEqual(DEFAULT_LISTEN);
    expect(listenPreference("42")).toEqual(DEFAULT_LISTEN);
    expect(listenPreference('{"rate": 9}')).toEqual(DEFAULT_LISTEN);
  });

  it("keeps an offered rate and only well-formed voices", () => {
    const stored = JSON.stringify({
      rate: 1.5,
      voices: {
        en: "Google UK",
        hi: "",
        "en-US": "x",
        fr: 7,
        de: "x".repeat(501),
      },
    });
    expect(listenPreference(stored)).toEqual({
      rate: 1.5,
      voices: { en: "Google UK" },
    });
    for (const rate of LISTEN_RATES)
      expect(listenPreference(JSON.stringify({ rate })).rate).toBe(rate);
  });

  it("stores a voice per language and clears it with null", () => {
    let preference = withVoice(DEFAULT_LISTEN, "en-GB", "Daniel");
    preference = withVoice(preference, "hi", "Lekha");
    preference = withVoice(preference, null, "Default-ish");
    expect(preference.voices).toEqual({
      en: "Daniel",
      hi: "Lekha",
      "": "Default-ish",
    });
    expect(withVoice(preference, "en", null).voices).toEqual({
      hi: "Lekha",
      "": "Default-ish",
    });
    let many = DEFAULT_LISTEN;
    for (let i = 0; i < 40; i += 1)
      many = withVoice(
        many,
        `l${String.fromCharCode(97 + (i % 26))}${i >= 26 ? "x" : ""}`,
        "v",
      );
    expect(Object.keys(many.voices)).toHaveLength(24);
  });

  it("keys languages by their primary subtag, Android's form included", () => {
    expect(languageKey("en-US")).toBe("en");
    expect(languageKey("en_IN")).toBe("en");
    expect(languageKey("HI")).toBe("hi");
    expect(languageKey(null)).toBe("");
    expect(languageKey("!!")).toBe("");
  });
});

describe("voices", () => {
  const voices = [
    { voiceURI: "b-en", name: "Bee", lang: "en-US" },
    { voiceURI: "a-hi", name: "Ay", lang: "hi_IN" },
    { voiceURI: "c-hi", name: "Cee", lang: "hi-IN" },
    { voiceURI: "a-en", name: "Aa", lang: "en-GB" },
  ];

  it("lists the article's language first", () => {
    expect(orderVoices(voices, "hi").map((v) => v.voiceURI)).toEqual([
      "a-hi",
      "c-hi",
      "a-en",
      "b-en",
    ]);
    expect(orderVoices(voices, null).map((v) => v.voiceURI)).toEqual([
      "a-en",
      "a-hi",
      "b-en",
      "c-hi",
    ]);
  });

  it("uses a stored voice only for its language, and only if it is still there", () => {
    const preference = withVoice(DEFAULT_LISTEN, "en", "b-en");
    expect(chosenVoice(voices, preference, "en-US")?.name).toBe("Bee");
    expect(chosenVoice(voices, preference, "hi")).toBeNull();
    expect(chosenVoice([], preference, "en")).toBeNull();
    expect(chosenVoice(voices, DEFAULT_LISTEN, "en")).toBeNull();
  });
});
