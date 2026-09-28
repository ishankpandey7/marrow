"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_LISTEN,
  LISTEN_RATES,
  chosenVoice,
  firstBelow,
  listenPreference,
  orderVoices,
  spokenSentences,
  withVoice,
  type ListenPreference,
  type Spoken,
} from "@/lib/listen";
import {
  browserSpeech,
  createNarrator,
  type Narrator,
  type NarratorView,
  type SpeechOptions,
} from "./narrator";

const PAINT = "marrow-listen";
const IDLE: NarratorView = { status: "idle", index: 0, problem: null };
const NO_VOICES: readonly SpeechSynthesisVoice[] = [];

interface Plan {
  sentences: Spoken[];
  ranges: (Range | undefined)[];
}

function speechAvailable() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}
const unsubscribed = () => () => undefined;

// getVoices() returns a new array on every call; hand React the same one
// until the list really changes, or it re-renders forever.
let cachedVoices: readonly SpeechSynthesisVoice[] = NO_VOICES;
function voicesSnapshot() {
  if (!speechAvailable()) return NO_VOICES;
  const next = window.speechSynthesis.getVoices();
  if (
    next.length !== cachedVoices.length ||
    next.some((voice, i) => voice.voiceURI !== cachedVoices[i].voiceURI)
  )
    cachedVoices = next;
  return cachedVoices;
}
function subscribeVoices(callback: () => void) {
  if (!speechAvailable()) return () => undefined;
  // Chrome's list is empty until this fires; Safari's may never fire.
  window.speechSynthesis.addEventListener("voiceschanged", callback);
  return () =>
    window.speechSynthesis.removeEventListener("voiceschanged", callback);
}

function registry(): HighlightRegistry | null {
  return typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight === "function"
    ? CSS.highlights
    : null;
}

/** The sentences on this page, rebuilt if React has replaced the article's text. */
function currentPlan(
  cache: { current: Plan | null },
  page: Element | null | undefined,
  lang: string | null,
): Plan {
  const cached = cache.current;
  if (
    cached &&
    cached.sentences.every(
      ({ points }) =>
        points.startContainer.isConnected && points.endContainer.isConnected,
    )
  )
    return cached;
  const roots = [
    page?.querySelector(".reader-heading h1"),
    page?.querySelector("[data-reader-article] .reader-prose"),
  ].filter((root): root is Element => Boolean(root));
  cache.current = { sentences: spokenSentences(roots, lang), ranges: [] };
  return cache.current;
}

function rangeAt(plan: Plan, index: number): Range | null {
  const sentence = plan.sentences[index];
  if (!sentence) return null;
  let range = plan.ranges[index];
  if (!range) {
    range = document.createRange();
    range.setStart(sentence.points.startContainer, sentence.points.startOffset);
    range.setEnd(sentence.points.endContainer, sentence.points.endOffset);
    plan.ranges[index] = range;
  }
  return range;
}

/** The toolbar's lower edge: text above it is behind the toolbar. */
function toolbarLine(from: Element | null) {
  const bar = from?.closest(".reader-toolbar");
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
}

function speechOptions(
  preference: ListenPreference,
  voices: readonly SpeechSynthesisVoice[],
  lang: string | null,
): SpeechOptions {
  return {
    rate: preference.rate,
    lang,
    voice: chosenVoice(voices, preference, lang)?.voiceURI ?? null,
  };
}

const LABELS: Record<NarratorView["status"], string> = {
  idle: "Listen from here",
  playing: "Pause",
  paused: "Resume",
  finished: "Listen again",
};

export function Listen({
  storageKey,
  lang,
  onPlayingChange,
}: {
  storageKey: string;
  lang: string | null;
  /** The reader keeps its toolbar in view while this is true, so Pause stays reachable. */
  onPlayingChange: (playing: boolean) => void;
}) {
  const available = useSyncExternalStore(
    unsubscribed,
    speechAvailable,
    () => false,
  );
  const voices = useSyncExternalStore(
    subscribeVoices,
    voicesSnapshot,
    () => NO_VOICES,
  );
  const [preference, setPreference] = useState<ListenPreference>(() => {
    try {
      return listenPreference(localStorage.getItem(storageKey));
    } catch {
      // No storage (or no window, on the server): the defaults.
      return DEFAULT_LISTEN;
    }
  });
  const [view, setView] = useState<NarratorView>(IDLE);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const narratorRef = useRef<Narrator | null>(null);
  const plan = useRef<Plan | null>(null);

  function narrator() {
    narratorRef.current ??= createNarrator(
      browserSpeech(window.speechSynthesis),
      setView,
    );
    return narratorRef.current;
  }

  // Everything up to speak() runs synchronously inside the tap: iPhone
  // Safari refuses speech that does not start from a user gesture.
  function start(fromTop: boolean) {
    const page = panel.current?.closest(".reader");
    const current = currentPlan(plan, page, lang);
    const line = toolbarLine(panel.current);
    const from = fromTop
      ? 0
      : firstBelow(
          current.sentences.length,
          (index) =>
            rangeAt(current, index)?.getBoundingClientRect().bottom ?? 0,
          line,
        );
    narrator().play(
      current.sentences.map((sentence) => sentence.text),
      from,
      speechOptions(preference, voices, lang),
    );
  }

  function toggle() {
    if (view.status === "playing") narrator().pause();
    else if (view.status === "paused") narrator().resume();
    else start(view.status === "finished");
  }

  function remember(next: ListenPreference) {
    setPreference(next);
    // Inside the tap, not in the effect below: a restarted sentence is a
    // new speak(), and iPhone Safari wants those to come from a gesture.
    narratorRef.current?.configure(speechOptions(next, voices, lang));
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Kept for this visit only; the choice is per device anyway.
    }
  }

  useEffect(() => {
    narratorRef.current?.configure(speechOptions(preference, voices, lang));
  }, [preference, voices, lang]);

  useEffect(() => {
    onPlayingChange(view.status === "playing");
  }, [view.status, onPlayingChange]);

  // Tint the current sentence, and bring it into view while speaking.
  useEffect(() => {
    const css = registry();
    const active = view.status === "playing" || view.status === "paused";
    const current = active && plan.current ? plan.current : null;
    const range = current ? rangeAt(current, view.index) : null;
    if (!range) {
      css?.delete(PAINT);
      return;
    }
    css?.set(PAINT, new Highlight(range));
    if (view.status !== "playing") return;
    const box = range.getBoundingClientRect();
    const line = toolbarLine(panel.current);
    if (box.height === 0) return;
    if (box.top >= line && box.bottom <= window.innerHeight - 32) return;
    window.scrollTo({
      top: window.scrollY + box.top - line - window.innerHeight * 0.2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [view.index, view.status]);

  // speechSynthesis belongs to the window, not to this component: leaving
  // the article by Esc or Back is a client navigation, and without this the
  // voice would carry on over the library.
  useEffect(() => {
    function hide() {
      narratorRef.current?.stop();
    }
    function visible() {
      if (document.visibilityState === "visible")
        narratorRef.current?.reconcile();
    }
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visible);
      narratorRef.current?.stop();
      registry()?.delete(PAINT);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Captured before ReaderSurface's handler, which would leave the page on
    // Escape; closing the panel is what Escape means while it is open.
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      setOpen(false);
      summary.current?.focus();
    }
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open]);

  if (!available) return null;
  const active = view.status === "playing" || view.status === "paused";
  const ordered = orderVoices(voices, lang);
  const chosen = chosenVoice(voices, preference, lang);
  return (
    <>
      {active && (
        <button
          type="button"
          className="reader-listen-toggle"
          aria-label={
            view.status === "playing" ? "Pause listening" : "Resume listening"
          }
          onClick={toggle}
        >
          {view.status === "playing" ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}
      <details
        ref={panel}
        className="reader-options reader-listen"
        open={open}
        onToggle={(event) => {
          const self = event.currentTarget;
          setOpen(self.open);
          if (!self.open) return;
          // One toolbar panel at a time; they open in the same place.
          for (const other of self
            .closest("nav")
            ?.querySelectorAll<HTMLDetailsElement>("details[open]") ?? [])
            if (other !== self) other.open = false;
        }}
      >
        <summary ref={summary} aria-label="Listen">
          <SpeakerIcon />
        </summary>
        <div className="reader-options-panel reader-listen-panel">
          <p className="reader-options-title">Listen to this article.</p>
          <div className="reader-listen-controls">
            <button
              type="button"
              aria-label="Previous sentence"
              disabled={!active}
              onClick={() => narrator().skip(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="reader-listen-main"
              onClick={toggle}
            >
              {LABELS[view.status]}
            </button>
            <button
              type="button"
              aria-label="Next sentence"
              disabled={!active}
              onClick={() => narrator().skip(1)}
            >
              ›
            </button>
          </div>
          <p className="reader-listen-problem" role="status">
            {view.problem}
          </p>
          <fieldset>
            <legend>Speed</legend>
            <div className="reader-choices reader-listen-rates">
              {LISTEN_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  aria-pressed={preference.rate === rate}
                  onClick={() => remember({ ...preference, rate })}
                >
                  {rate}×
                </button>
              ))}
            </div>
          </fieldset>
          <label className="reader-listen-voice">
            <span>Voice</span>
            <select
              value={chosen?.voiceURI ?? ""}
              onChange={(event) =>
                remember(
                  withVoice(preference, lang, event.target.value || null),
                )
              }
            >
              <option value="">Device default</option>
              {ordered.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>
          <p className="reader-listen-note">
            Read by your device&apos;s own voices; nothing is sent anywhere. On
            a phone, speech stops when the screen locks or you leave the
            browser.
          </p>
        </div>
      </details>
    </>
  );
}

function SpeakerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M3 8.5h3.5L11 5v12l-4.5-3.5H3z" fill="currentColor" />
      <path
        d="M14 8a4.2 4.2 0 0 1 0 6M16.5 5.5a7.8 7.8 0 0 1 0 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="5" y="4" width="3.5" height="12" rx="1" fill="currentColor" />
      <rect x="11.5" y="4" width="3.5" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4l10 6-10 6z" fill="currentColor" />
    </svg>
  );
}
