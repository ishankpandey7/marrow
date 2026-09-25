import { describe, expect, it } from "vitest";
import {
  NOTE_MAX,
  QUOTE_MAX,
  anchorQuote,
  cleanNote,
  highlightFits,
  isUuid,
} from "./highlights";

const text = "The river bends here. The river rests. A bird 🐦 sings.";

describe("highlightFits", () => {
  it("accepts a span whose text is exactly the quote", () => {
    expect(highlightFits(text, 4, 9, "river")).toBe(true);
  });

  it("refuses a quote that is not the text at those offsets", () => {
    expect(highlightFits(text, 4, 9, "rivet")).toBe(false);
    expect(highlightFits(text, 5, 10, "river")).toBe(false);
  });

  it("refuses offsets outside the text or out of order", () => {
    expect(highlightFits(text, -1, 4, "The ")).toBe(false);
    expect(highlightFits(text, 9, 4, "river")).toBe(false);
    expect(highlightFits(text, 50, 50 + 20, "x")).toBe(false);
    expect(highlightFits(text, 4.5, 9, "river")).toBe(false);
    expect(highlightFits(text, "4", 9, "river")).toBe(false);
  });

  it("refuses a quote with whitespace at an end", () => {
    expect(highlightFits(text, 3, 9, " river")).toBe(false);
  });

  it("refuses a span that cuts a surrogate pair in half", () => {
    const bird = text.indexOf("🐦");
    expect(highlightFits(text, bird, bird + 2, "🐦")).toBe(true);
    expect(highlightFits(text, bird, bird + 1, text[bird])).toBe(false);
    expect(highlightFits(text, bird + 1, bird + 2, text[bird + 1])).toBe(false);
  });

  it("refuses a quote over the cap", () => {
    const long = "a".repeat(QUOTE_MAX + 1);
    expect(highlightFits(long, 0, long.length, long)).toBe(false);
    const fits = "a".repeat(QUOTE_MAX);
    expect(highlightFits(fits, 0, fits.length, fits)).toBe(true);
  });
});

describe("anchorQuote", () => {
  it("keeps offsets that still hold the quote", () => {
    expect(
      anchorQuote(text, { quote: "river", start_offset: 26, end_offset: 31 }),
    ).toEqual({ start: 26, end: 31 });
  });

  it("follows a quote that moved to the occurrence nearest its old place", () => {
    const moved = `A ${text}`;
    expect(
      anchorQuote(moved, { quote: "river", start_offset: 26, end_offset: 31 }),
    ).toEqual({ start: 28, end: 33 });
    expect(
      anchorQuote(moved, { quote: "river", start_offset: 4, end_offset: 9 }),
    ).toEqual({ start: 6, end: 11 });
    const unique = `Added a sentence. ${text}`;
    expect(
      anchorQuote(unique, {
        quote: "river rests",
        start_offset: 26,
        end_offset: 37,
      }),
    ).toEqual({ start: 44, end: 55 });
  });

  it("does not anchor a quote that is no longer there", () => {
    expect(
      anchorQuote(text, { quote: "ocean", start_offset: 4, end_offset: 9 }),
    ).toBeNull();
  });
});

describe("cleanNote", () => {
  it("trims, and an empty note is no note", () => {
    expect(cleanNote("  a thought  ")).toBe("a thought");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(null)).toBeNull();
  });

  it("refuses what is not a note or is over the cap", () => {
    expect(cleanNote(42)).toBeUndefined();
    expect(cleanNote(undefined)).toBeUndefined();
    expect(cleanNote("a".repeat(NOTE_MAX + 1))).toBeUndefined();
    expect(cleanNote("a".repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
  });
});

describe("isUuid", () => {
  it("accepts only a UUID string", () => {
    expect(isUuid("12345678-1234-1234-1234-123456789abc")).toBe(true);
    expect(isUuid("12345678-1234-1234-1234-123456789abcd")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
