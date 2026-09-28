import { BLOCK_TAGS } from "@/lib/plain-text";
import {
  boundaryPoints,
  textIndex,
  type BoundaryPoints,
} from "@/lib/highlight-dom";
import type { Span } from "@/lib/highlights";

/**
 * Listen mode reads the rendered article aloud with the device's own voices.
 * This file is the part that needs no speech engine: which sentences there
 * are, where to start, and the per-device preference.
 */

/**
 * The longest stretch handed to the engine in one go, in UTF-16 code units.
 * Chrome has been reported to cut an utterance off after about 15 seconds,
 * which is roughly 200 characters at the slowest rate offered. One sentence
 * per utterance keeps almost everything under it; the rare longer sentence
 * is split rather than risk the cut.
 */
export const SENTENCE_CAP = 200;

export const LISTEN_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Stored voices are per language; more than this and the oldest go. */
const VOICE_LIMIT = 24;
const VOICE_URI_LIMIT = 500;

const BLOCKS = new Set(BLOCK_TAGS);
const SPEAKABLE = /[\p{L}\p{N}]/u;
// Where a long sentence breaks most naturally: after a comma, semicolon,
// colon, closing bracket or dash that a space follows.
const SOFT_BREAK = /[,;:)–—](?= )/g;
// Ends a sentence where Intl.Segmenter is missing (Firefox before 125):
// terminal punctuation, any closing quotes or brackets, then a space.
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?= )/g;

export interface Piece {
  index: number;
  segment: string;
}
type Splitter = (value: string) => Iterable<Piece>;

/** The fallback for browsers without `Intl.Segmenter`. */
export function punctuationSentences(value: string): Piece[] {
  const pieces: Piece[] = [];
  let from = 0;
  for (const match of value.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    pieces.push({ index: from, segment: value.slice(from, end) });
    from = end;
  }
  if (from < value.length)
    pieces.push({ index: from, segment: value.slice(from) });
  return pieces;
}

function sentenceSplitter(lang: string | null): Splitter {
  if (typeof Intl.Segmenter !== "function") return punctuationSentences;
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang ?? undefined, {
      granularity: "sentence",
    });
  } catch {
    // `lang` comes from the publisher's markup and may not be a valid tag.
    segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  }
  return (value) => segmenter.segment(value);
}

function trimmed(text: string, start: number, end: number): Span | null {
  while (start < end && text[start] === " ") start += 1;
  while (end > start && text[end - 1] === " ") end -= 1;
  return end > start ? { start, end } : null;
}

/** A sentence longer than the cap, split where it reads least badly. */
function capped(text: string, span: Span): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  // A break in the first third would leave a stub of a few words.
  const floor = Math.floor(SENTENCE_CAP / 3);
  while (span.end - start > SENTENCE_CAP) {
    const window = text.slice(start, start + SENTENCE_CAP);
    let cut = -1;
    for (const match of window.matchAll(SOFT_BREAK))
      if (match.index + 1 > floor) cut = match.index + 1;
    if (cut < 0) {
      const space = window.lastIndexOf(" ");
      if (space > floor) cut = space;
    }
    if (cut < 0) {
      cut = SENTENCE_CAP;
      // Never split a surrogate pair: half an emoji is not speakable.
      const code = text.charCodeAt(start + cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    const piece = trimmed(text, start, start + cut);
    if (piece) pieces.push(piece);
    start += cut;
  }
  const rest = trimmed(text, start, span.end);
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * The sentences of `text` as spans, in order. A sentence never crosses a
 * cut (the end of a block element, so a heading does not run into the
 * paragraph after it) and never enters a skipped span (code). A stretch
 * with no letter or digit, such as a lone dash, is not a sentence.
 */
export function sentencePlan(
  text: string,
  cuts: Iterable<number>,
  skips: readonly Span[],
  lang: string | null,
): Span[] {
  const clamp = (value: number) => Math.min(Math.max(value, 0), text.length);
  const edges = new Set([0, text.length]);
  for (const cut of cuts) edges.add(clamp(cut));
  for (const skip of skips) {
    edges.add(clamp(skip.start));
    edges.add(clamp(skip.end));
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const split = sentenceSplitter(lang);
  const plan: Span[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (skips.some((skip) => from >= skip.start && to <= skip.end)) continue;
    for (const { index, segment } of split(text.slice(from, to))) {
      const sentence = trimmed(
        text,
        from + index,
        from + index + segment.length,
      );
      if (sentence)
        // Checked again per piece: a cut can leave a tail like French
        // typography's " ?" that has nothing in it to say.
        for (const piece of capped(text, sentence))
          if (SPEAKABLE.test(text.slice(piece.start, piece.end)))
            plan.push(piece);
    }
  }
  return plan;
}

export interface Spoken {
  text: string;
  points: BoundaryPoints;
}

/**
 * What Listen reads, from the rendered page: each root in turn (the title,
 * then the article), sentence by sentence, with the DOM points that paint
 * each one.
 *
 * It reads through `textIndex`, the same walk highlights use, so the image
 * placeholder's "Load image" and alt text and anything in `noscript` are
 * never spoken. Not `item_content.text`: that string joins a heading to the
 * next paragraph with a single space, and a voice reads straight through it.
 */
export function spokenSentences(
  roots: readonly Element[],
  lang: string | null,
): Spoken[] {
  const spoken: Spoken[] = [];
  for (const root of roots) {
    const index = textIndex(root);
    const cuts: number[] = [];
    const skips: Span[] = [];
    for (const [node, [start, end]] of index.spans) {
      if (node.nodeType !== 1) continue;
      const tag = (node as Element).tagName.toLowerCase();
      // Code read aloud is punctuation read aloud.
      if (tag === "pre") skips.push({ start, end });
      else if (BLOCKS.has(tag)) cuts.push(start, end);
    }
    for (const span of sentencePlan(index.text, cuts, skips, lang)) {
      const points = boundaryPoints(index, span);
      if (points)
        spoken.push({ text: index.text.slice(span.start, span.end), points });
    }
  }
  return spoken;
}

/**
 * The first sentence whose bottom edge is below `line` (the toolbar's lower
 * edge): where the reader is scrolled. Sentences run down the page, so this
 * bisects rather than measuring every one. When every sentence is above the
 * line the reader has finished, and Listen starts from the top.
 */
export function firstBelow(
  count: number,
  bottom: (index: number) => number,
  line: number,
): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bottom(middle) > line) high = middle;
    else low = middle + 1;
  }
  return low < count ? low : 0;
}

export interface ListenPreference {
  rate: number;
  /** A chosen voice's `voiceURI` per language key; absent means the device default. */
  voices: Readonly<Record<string, string>>;
}

export const DEFAULT_LISTEN: ListenPreference = { rate: 1, voices: {} };

/**
 * The key a voice choice is stored under: the primary language subtag, so an
 * English voice picked on one article is not used to read a Hindi one.
 * Android reports voice languages as `en_US`, browsers as `en-US`.
 */
export function languageKey(lang: string | null | undefined): string {
  const primary = (lang ?? "").trim().split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2,8}$/.test(primary) ? primary : "";
}

/** The stored preference, or the defaults for anything damaged or foreign. */
export function listenPreference(raw: string | null): ListenPreference {
  let value: unknown;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return DEFAULT_LISTEN;
  }
  if (typeof value !== "object" || value === null) return DEFAULT_LISTEN;
  const record = value as Record<string, unknown>;
  const rate =
    typeof record.rate === "number" && LISTEN_RATES.includes(record.rate)
      ? record.rate
      : DEFAULT_LISTEN.rate;
  const voices: Record<string, string> = {};
  if (typeof record.voices === "object" && record.voices !== null)
    for (const [key, uri] of Object.entries(record.voices).slice(-VOICE_LIMIT))
      if (
        languageKey(key) === key &&
        typeof uri === "string" &&
        uri.length > 0 &&
        uri.length <= VOICE_URI_LIMIT
      )
        voices[key] = uri;
  return { rate, voices };
}

/** The preference with the voice for `lang` chosen, or cleared with null. */
export function withVoice(
  preference: ListenPreference,
  lang: string | null,
  uri: string | null,
): ListenPreference {
  const key = languageKey(lang);
  const voices = Object.fromEntries(
    Object.entries(preference.voices).filter(([other]) => other !== key),
  );
  if (uri && uri.length <= VOICE_URI_LIMIT) voices[key] = uri;
  const kept = Object.entries(voices).slice(-VOICE_LIMIT);
  return { rate: preference.rate, voices: Object.fromEntries(kept) };
}

export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
}

/** The article's language first, then the rest; each group by name. */
export function orderVoices<T extends VoiceLike>(
  voices: readonly T[],
  lang: string | null,
): T[] {
  const key = languageKey(lang);
  const matches = (voice: T) =>
    key !== "" && languageKey(voice.lang) === key ? 0 : 1;
  return [...voices].sort(
    (a, b) => matches(a) - matches(b) || a.name.localeCompare(b.name),
  );
}

/**
 * The voice stored for this article's language, if the device still has
 * it. Null otherwise, which leaves the choice to the device: it picks its
 * default voice for the utterance's `lang`.
 */
export function chosenVoice<T extends VoiceLike>(
  voices: readonly T[],
  preference: ListenPreference,
  lang: string | null,
): T | null {
  const uri = preference.voices[languageKey(lang)];
  return uri ? (voices.find((voice) => voice.voiceURI === uri) ?? null) : null;
}
