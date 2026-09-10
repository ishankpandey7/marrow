import { describe, expect, it } from "vitest";

import {
  EMPTY_SEARCH,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  highlightSegments,
  parseQuery,
  resolveTags,
  searchUrl,
} from "./search";
import type { Filters, Tag } from "./tags";

/**
 * The parser is the half of search that can be checked without a database, so
 * it is checked hard here. The ranking half is tuned against the real articles
 * and written up in ROADMAP.md under Notes from the field; there is nothing
 * useful to assert about relevance against invented fixtures.
 *
 * The invariant underneath most of these: whatever someone types, what leaves
 * this module is either a string `websearch_to_tsquery` will accept or nothing
 * at all. Postgres is never asked to parse syntax we did not build.
 */

const filters: Filters = {
  state: "inbox",
  read: "all",
  tag: "",
  page: 1,
};

describe("bare terms", () => {
  it("keeps the words and drops the spacing", () => {
    const parsed = parseQuery("  quantum   material  ");
    expect(parsed.include).toBe("quantum material");
    expect(parsed.terms).toEqual(["quantum", "material"]);
    expect(parsed.isEmpty).toBe(false);
  });

  it("treats a non-string as an empty search", () => {
    expect(parseQuery(undefined)).toEqual(EMPTY_SEARCH);
    expect(parseQuery(null)).toEqual(EMPTY_SEARCH);
    expect(parseQuery(["quantum"])).toEqual(EMPTY_SEARCH);
    expect(parseQuery("")).toEqual(EMPTY_SEARCH);
  });

  it("keeps hyphenated words whole", () => {
    // lithium-ion is one word to a reader and three lexemes to Postgres, and
    // the dash here is not the exclusion operator: that is only a leading one.
    const parsed = parseQuery("lithium-ion batteries");
    expect(parsed.include).toBe("lithium-ion batteries");
    expect(parsed.excludedTerms).toEqual([]);
  });
});

describe("quoted phrases", () => {
  it("keeps a phrase together and quoted", () => {
    const parsed = parseQuery('"quantum material" physics');
    expect(parsed.include).toBe('"quantum material" physics');
    expect(parsed.phrases).toEqual(["quantum material"]);
    expect(parsed.terms).toEqual(["physics"]);
  });

  it("closes an unbalanced quote at the end of the input", () => {
    // to_tsquery is where this would have thrown. Here it is just a phrase
    // someone has not finished typing, and searching for it is the useful
    // answer.
    const parsed = parseQuery('bosonic "quantum operations');
    expect(parsed.include).toBe('bosonic "quantum operations"');
    expect(parsed.phrases).toEqual(["quantum operations"]);
  });

  it("survives a quote in the middle of a word", () => {
    const parsed = parseQuery('rock"n"roll');
    expect(parsed.include).not.toContain('""');
    expect(parsed.isEmpty).toBe(false);
  });

  it("drops a quote containing nothing searchable", () => {
    expect(parseQuery('"   "').isEmpty).toBe(true);
    expect(parseQuery('""').isEmpty).toBe(true);
  });
});

describe("exclusion", () => {
  it("carries excluded terms separately from the ones that must match", () => {
    // Not folded into `include` as `-nvidia`: the metadata scan and the body
    // scan are separate index scans, and a negation inside one of them says
    // nothing about the other. See the note at the top of search.ts.
    const parsed = parseQuery("radeon -nvidia");
    expect(parsed.include).toBe("radeon");
    expect(parsed.exclude).toBe("nvidia");
    expect(parsed.excludedTerms).toEqual(["nvidia"]);
  });

  it("joins several exclusions with or, so any one of them removes an item", () => {
    const parsed = parseQuery("gpu -nvidia -intel");
    expect(parsed.exclude).toBe("nvidia or intel");
  });

  it("excludes a phrase", () => {
    const parsed = parseQuery('gpu -"ray tracing"');
    expect(parsed.include).toBe("gpu");
    expect(parsed.exclude).toBe('"ray tracing"');
  });

  it("refuses to run an exclusion on its own", () => {
    const parsed = parseQuery("-nvidia");
    expect(parsed.exclusionOnly).toBe(true);
    expect(parsed.isEmpty).toBe(false);
    expect(parsed.include).toBe("");
  });

  it("treats a lone dash as a dash", () => {
    expect(parseQuery("- - -").isEmpty).toBe(true);
    expect(parseQuery("gpu - nvidia").exclude).toBe("");
    expect(parseQuery("gpu - nvidia").include).toBe("gpu nvidia");
  });

  it("collapses repeated dashes rather than double-negating", () => {
    const parsed = parseQuery("gpu --nvidia");
    expect(parsed.exclude).toBe("nvidia");
  });
});

describe("tag:", () => {
  it("takes tags out of the text query", () => {
    // Left in, websearch_to_tsquery turns tag:physics into 'tag' & 'physics'
    // and the search silently looks for the word "tag". Verified against the
    // real database.
    const parsed = parseQuery("quantum tag:physics");
    expect(parsed.include).toBe("quantum");
    expect(parsed.tags).toEqual(["physics"]);
  });

  it("slugs a tag the same way the tag editor does", () => {
    expect(parseQuery('tag:"Machine Learning"').tags).toEqual([
      "machine-learning",
    ]);
    expect(parseQuery("tag:Physics").tags).toEqual(["physics"]);
  });

  it("is case-insensitive in the prefix", () => {
    expect(parseQuery("TAG:physics").tags).toEqual(["physics"]);
  });

  it("excludes a tag", () => {
    const parsed = parseQuery("gpu -tag:archive-me");
    expect(parsed.excludedTags).toEqual(["archive-me"]);
    expect(parsed.tags).toEqual([]);
    expect(parsed.exclude).toBe("");
  });

  it("drops a tag name that cannot be a slug", () => {
    // normalizeTag rejects it; a search is not the place to raise that as an
    // error, so it becomes a tag nothing carries.
    const parsed = parseQuery("tag:!!!");
    expect(parsed.tags).toEqual([]);
    expect(parsed.isEmpty).toBe(true);
  });

  it("ignores a bare tag: with nothing after it", () => {
    expect(parseQuery("tag:").isEmpty).toBe(true);
    expect(parseQuery("tag: physics").tags).toEqual([]);
    expect(parseQuery("tag: physics").terms).toEqual(["physics"]);
  });

  it("searches on a tag alone", () => {
    const parsed = parseQuery("tag:physics");
    expect(parsed.isEmpty).toBe(false);
    expect(parsed.exclusionOnly).toBe(false);
  });

  it("does not repeat a tag asked for twice", () => {
    expect(parseQuery("tag:physics tag:physics").tags).toEqual(["physics"]);
  });
});

describe("or", () => {
  it("passes the operator through", () => {
    const parsed = parseQuery("radeon or nvidia");
    expect(parsed.include).toBe("radeon or nvidia");
    expect(parsed.terms).toEqual(["radeon", "nvidia"]);
  });

  it("is case-insensitive", () => {
    expect(parseQuery("radeon OR nvidia").include).toBe("radeon or nvidia");
  });

  it("drops a dangling or a doubled operator", () => {
    expect(parseQuery("radeon or").include).toBe("radeon");
    expect(parseQuery("or radeon").include).toBe("radeon");
    expect(parseQuery("radeon or or nvidia").include).toBe("radeon or nvidia");
    expect(parseQuery("or").isEmpty).toBe(true);
  });

  it("keeps a quoted or as a phrase", () => {
    expect(parseQuery('"or"').phrases).toEqual(["or"]);
  });

  it("never emits a bare or into the excluded query", () => {
    // A bare `or` in `exclude` would act as an operator there too, and
    // `nvidia or or intel` is not a query anyone typed.
    const parsed = parseQuery("gpu -or -nvidia");
    expect(parsed.exclude).toBe("nvidia");
  });
});

describe("junk never reaches Postgres as syntax", () => {
  it.each([
    "?",
    "&",
    "'",
    "!",
    "|",
    "()",
    ":*",
    "<->",
    "***",
    "\\",
    '"',
    "?&'",
    "   ",
  ])("treats %j as an empty search", (input) => {
    const parsed = parseQuery(input);
    expect(parsed.include).toBe("");
    expect(parsed.exclude).toBe("");
    expect(parsed.isEmpty).toBe(true);
  });

  it("keeps the searchable part of a mixed token", () => {
    // C++ and a query with a stray ampersand are both things people type, and
    // both are safe: websearch_to_tsquery treats every one of these
    // characters as text, never as an operator.
    expect(parseQuery("c++").include).toBe("c++");
    expect(parseQuery("postgres & mysql").include).toBe("postgres mysql");
    expect(parseQuery("what's new?").include).toBe("what's new?");
  });

  it("strips control characters, including the headline markers", () => {
    // A marker that survived the round trip would come back inside a snippet
    // and be rendered as a highlight of whatever followed it.
    const parsed = parseQuery(`quantum${HIGHLIGHT_START}material`);
    expect(parsed.include).toBe("quantum material");
    expect(parsed.include).not.toContain(HIGHLIGHT_START);
  });

  it("removes a NUL rather than passing one to a text column", () => {
    const parsed = parseQuery(`radeon${String.fromCharCode(0)}nvidia`);
    expect(parsed.include).toBe("radeon nvidia");
  });
});

describe("bounds", () => {
  it("truncates a pasted essay at the character cap, not at the token cap", () => {
    // The distinctive word sits past 200 characters but well inside the first
    // sixteen tokens, so only the length cap can remove it.
    const parsed = parseQuery(`${"padding ".repeat(4)}sasquatch`);
    expect(parsed.terms).toContain("sasquatch");
    expect(parseQuery(`${"padding ".repeat(30)}sasquatch`).terms).not.toContain(
      "sasquatch",
    );
  });

  it("stops after a fixed number of tokens", () => {
    const parsed = parseQuery(
      Array.from({ length: 40 }, (_, index) => `w${index}`).join(" "),
    );
    expect(parsed.terms).toHaveLength(16);
    expect(parsed.terms[15]).toBe("w15");
  });

  it("caps a single enormous term", () => {
    const parsed = parseQuery("q".repeat(500));
    expect(parsed.include).toHaveLength(64);
  });

  it("always emits balanced quotes, whatever went in", () => {
    // The one structural invariant of the rebuilt string. An odd number of
    // quotes is the shape that makes websearch_to_tsquery read the rest of a
    // query as one phrase, which is a wrong answer rather than an error and
    // so would never show up as a failure anywhere else.
    const inputs = [
      '"',
      '""',
      '"""',
      'a"b"c"d',
      '-"unclosed',
      'tag:"x -"y',
      '"a" "b',
      'or "or',
      '""""""""""',
    ];
    for (const input of inputs) {
      const parsed = parseQuery(input);
      for (const query of [parsed.include, parsed.exclude]) {
        expect([...query].filter((c) => c === '"').length % 2).toBe(0);
      }
    }
  });

  it("does not hang on a string of quotes and dashes", () => {
    // The scanner advances on every branch; this is the shape that would
    // catch it if one branch ever stopped doing so.
    expect(parseQuery('-"-"-"-"-"-').isEmpty).toBe(true);
    expect(parseQuery('"'.repeat(50)).isEmpty).toBe(true);
    expect(parseQuery("-".repeat(50)).isEmpty).toBe(true);
    expect(parseQuery("tag:".repeat(50)).isEmpty).toBe(true);
  });
});

describe("composing with the Slice 4 filters", () => {
  it("carries every filter into the search URL", () => {
    const url = searchUrl("quantum", {
      state: "archive",
      read: "unread",
      tag: "3f1b7c2e-0f4a-4f2e-9c5d-1a2b3c4d5e6f",
      page: 3,
    });
    const params = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/search?")).toBe(true);
    expect(params.get("q")).toBe("quantum");
    expect(params.get("state")).toBe("archive");
    expect(params.get("read")).toBe("unread");
    expect(params.get("tag")).toBe("3f1b7c2e-0f4a-4f2e-9c5d-1a2b3c4d5e6f");
    expect(params.get("page")).toBe("3");
  });

  it("omits the filters that are already at their defaults", () => {
    expect(searchUrl("quantum", filters)).toBe(
      "/search?state=inbox&read=all&q=quantum",
    );
  });

  it("escapes a query that would otherwise change the URL", () => {
    const url = searchUrl("a&b=c tag:x", filters);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("q")).toBe("a&b=c tag:x");
    expect(params.get("state")).toBe("inbox");
  });
});

describe("resolveTags", () => {
  const tags: Tag[] = [
    { id: "1e7f", name: "Physics", slug: "physics" },
    { id: "2a9c", name: "Machine Learning", slug: "machine-learning" },
  ];

  it("maps slugs to the ids the query needs", () => {
    expect(resolveTags(["physics", "machine-learning"], tags)).toEqual({
      ids: ["1e7f", "2a9c"],
      missing: [],
    });
  });

  it("reports an unknown tag rather than ignoring it", () => {
    // Dropping it silently would widen the search to the whole library, which
    // looks like a working search returning the wrong answer.
    expect(resolveTags(["physics", "reciepes"], tags)).toEqual({
      ids: ["1e7f"],
      missing: ["reciepes"],
    });
  });

  it("handles a library with no tags at all", () => {
    expect(resolveTags(["physics"], [])).toEqual({
      ids: [],
      missing: ["physics"],
    });
  });
});

describe("highlightSegments", () => {
  const mark = (text: string) => `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}`;

  it("splits a snippet into plain and matched runs", () => {
    expect(highlightSegments(`a ${mark("quantum")} state`)).toEqual([
      { text: "a ", match: false },
      { text: "quantum", match: true },
      { text: " state", match: false },
    ]);
  });

  it("handles several matches", () => {
    expect(highlightSegments(`${mark("AMD")} and ${mark("Radeon")}`)).toEqual([
      { text: "AMD", match: true },
      { text: " and ", match: false },
      { text: "Radeon", match: true },
    ]);
  });

  it("returns a plain snippet as one run", () => {
    expect(highlightSegments("nothing matched here")).toEqual([
      { text: "nothing matched here", match: false },
    ]);
  });

  it("returns nothing for an empty snippet", () => {
    expect(highlightSegments("")).toEqual([]);
  });

  it("leaves an unpaired marker unhighlighted rather than swallowing the rest", () => {
    // Only reachable if the article itself contains the marker character. A
    // missing highlight beats a paragraph rendered entirely as a match.
    const segments = highlightSegments(`safe ${HIGHLIGHT_START}rest of it`);
    expect(segments).toEqual([{ text: "safe  rest of it", match: false }]);
    expect(segments.some((segment) => segment.match)).toBe(false);
  });

  it("never leaks a marker into the rendered text", () => {
    const segments = highlightSegments(
      `${HIGHLIGHT_END}odd ${mark("bit")}${HIGHLIGHT_START}`,
    );
    for (const segment of segments) {
      expect(segment.text).not.toContain(HIGHLIGHT_START);
      expect(segment.text).not.toContain(HIGHLIGHT_END);
    }
  });

  it("merges runs so React is not handed a fragment per character", () => {
    const segments = highlightSegments(`${mark("a")}${mark("b")}`);
    expect(segments).toEqual([{ text: "ab", match: true }]);
  });
});
