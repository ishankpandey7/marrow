"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  boundaryPoints,
  selectedText,
  textIndex,
  type Selected,
  type TextIndex,
} from "@/lib/highlight-dom";
import {
  NOTE_MAX,
  QUOTE_MAX,
  anchorQuote,
  type SavedHighlight,
  type Span,
} from "@/lib/highlights";
import {
  addHighlight,
  deleteHighlight,
  saveHighlightNote,
} from "./highlight-actions";

/**
 * Highlights are painted with the CSS Custom Highlight API. The article is
 * server-rendered sanitised HTML and nothing here writes into it: no <mark>,
 * no wrapper spans. Mutating it would put React's DOM and ours out of step
 * and move the very text nodes the offsets are counted over.
 */
const PAINT = "marrow-highlight";
const PAINT_NOTED = "marrow-highlight-noted";
const PAINT_ACTIVE = "marrow-highlight-active";
const NOTICE_MS = 8000;

type Anchors = Record<string, Span | null>;
interface Notice {
  message: string;
  noteFor?: string;
}

function registry(): HighlightRegistry | null {
  return typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight === "function"
    ? CSS.highlights
    : null;
}

const indexes = new WeakMap<Element, TextIndex>();

/** The article's text index, rebuilt only if React has replaced its text. */
function articleIndex(): TextIndex | null {
  const root = document.querySelector("[data-reader-article] .reader-prose");
  if (!root) return null;
  const cached = indexes.get(root);
  if (
    cached &&
    Array.from(cached.boundaries).every(
      ([node, map]) =>
        node.isConnected && (node as Text).data.length === map.length - 1,
    )
  )
    return cached;
  const fresh = textIndex(root);
  indexes.set(root, fresh);
  return fresh;
}

function toRange(index: TextIndex, span: Span): Range | null {
  const points = boundaryPoints(index, span);
  if (!points) return null;
  const range = document.createRange();
  range.setStart(points.startContainer, points.startOffset);
  range.setEnd(points.endContainer, points.endOffset);
  return range;
}

function anchorAll(text: string, list: SavedHighlight[]): Anchors {
  return Object.fromEntries(list.map((h) => [h.id, anchorQuote(text, h)]));
}

function scrollToRange(range: Range) {
  const rect = range.getBoundingClientRect();
  window.scrollTo({
    top: Math.max(0, rect.top + window.scrollY - window.innerHeight / 3),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
}

function without<T>(record: Record<string, T>, key: string) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

export function Highlights({
  itemId,
  initial,
  focusId,
}: {
  itemId: string;
  initial: SavedHighlight[];
  focusId: string | null;
}) {
  const [highlights, setHighlights] = useState(initial);
  // Null until the article has been measured after mount.
  const [anchors, setAnchors] = useState<Anchors | null>(null);
  const [selection, setSelection] = useState<Selected | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const ranges = useRef(new Map<string, Range>());
  const pendingFocus = useRef(focusId);
  const noticeTimer = useRef(0);

  function say(message: string, noteFor?: string) {
    window.clearTimeout(noticeTimer.current);
    setNotice({ message, noteFor });
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }

  // Measure after layout, and again whenever the list changes. A deep link
  // is honoured on the first measurement only; ReaderSurface skipped its
  // saved-position restore so the two do not fight over the scroll.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setPortal(panel.current?.closest<HTMLElement>(".reader") ?? null);
      const index = articleIndex();
      const measured = index ? anchorAll(index.text, highlights) : {};
      setAnchors(measured);
      const focus = pendingFocus.current;
      pendingFocus.current = null;
      const span = focus ? measured[focus] : null;
      const range = index && span ? toRange(index, span) : null;
      if (focus && range) {
        setActiveId(focus);
        scrollToRange(range);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [highlights]);

  useEffect(() => {
    const index = articleIndex();
    const made = new Map<string, Range>();
    for (const highlight of highlights) {
      const span = anchors?.[highlight.id];
      const range = index && span ? toRange(index, span) : null;
      if (range) made.set(highlight.id, range);
    }
    ranges.current = made;
    const css = registry();
    if (!css) return;
    const plain: Range[] = [];
    const noted: Range[] = [];
    const active: Range[] = [];
    for (const highlight of highlights) {
      const range = made.get(highlight.id);
      if (!range) continue;
      (highlight.note ? noted : plain).push(range);
      if (highlight.id === activeId) active.push(range);
    }
    const emphasis = new Highlight(...active);
    emphasis.priority = 1;
    css.set(PAINT, new Highlight(...plain));
    css.set(PAINT_NOTED, new Highlight(...noted));
    css.set(PAINT_ACTIVE, emphasis);
    return () => {
      css.delete(PAINT);
      css.delete(PAINT_NOTED);
      css.delete(PAINT_ACTIVE);
    };
  }, [anchors, highlights, activeId]);

  useEffect(() => {
    let frame = 0;
    let clear = 0;
    function read() {
      frame = 0;
      const current = document.getSelection();
      if (!current || current.isCollapsed || current.rangeCount === 0) {
        // Tapping the Highlight button can collapse the selection before
        // the click arrives (iPhone Safari), so the offer outlives it briefly.
        if (!clear)
          clear = window.setTimeout(() => {
            clear = 0;
            setSelection(null);
          }, 600);
        return;
      }
      window.clearTimeout(clear);
      clear = 0;
      const index = articleIndex();
      setSelection(index ? selectedText(index, current.getRangeAt(0)) : null);
    }
    function changed() {
      if (!frame) frame = requestAnimationFrame(read);
    }
    document.addEventListener("selectionchange", changed);
    return () => {
      document.removeEventListener("selectionchange", changed);
      cancelAnimationFrame(frame);
      window.clearTimeout(clear);
    };
  }, []);

  // There is no element to click on a painted highlight, so hit-test the
  // ranges' boxes. Works everywhere, including iPhone Safari, which has no
  // highlightsFromPoint; the panel lists everything regardless.
  useEffect(() => {
    const article = document.querySelector("[data-reader-article]");
    if (!article) return;
    function click(event: Event) {
      if (!(event instanceof MouseEvent)) return;
      if (!document.getSelection()?.isCollapsed) return;
      if (
        event.target instanceof Element &&
        event.target.closest("a, button, .reader-image")
      )
        return;
      let hit: string | null = null;
      let size = Infinity;
      for (const [id, range] of ranges.current) {
        const inside = Array.from(range.getClientRects()).some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        );
        // Overlapping highlights: the shorter one is the one being pointed at.
        const length = range.toString().length;
        if (inside && length < size) {
          hit = id;
          size = length;
        }
      }
      if (hit) {
        setActiveId(hit);
        setPanelOpen(true);
      }
    }
    article.addEventListener("click", click);
    return () => article.removeEventListener("click", click);
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    if (activeId)
      panel.current
        ?.querySelector(`[data-highlight="${activeId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    // Captured before ReaderSurface's handler, which would leave the page on
    // Escape; closing the panel is what Escape means while it is open.
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPanelOpen(false);
      summary.current?.focus();
    }
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [panelOpen, activeId]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  function clearSelection() {
    document.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function openNote(id: string) {
    setActiveId(id);
    setPanelOpen(true);
    requestAnimationFrame(() =>
      document.getElementById(`highlight-note-${id}`)?.focus(),
    );
  }

  async function highlight() {
    const chosen = selection;
    if (!chosen || busy) return;
    if (chosen.quote.length > QUOTE_MAX) return;
    const existing = highlights.find(
      (h) =>
        anchors?.[h.id]?.start === chosen.start &&
        anchors?.[h.id]?.end === chosen.end,
    );
    if (existing) {
      clearSelection();
      openNote(existing.id);
      return;
    }
    setBusy(true);
    try {
      const result = await addHighlight(
        itemId,
        chosen.start,
        chosen.end,
        chosen.quote,
      );
      if (result.ok) {
        setHighlights((list) => [...list, result.highlight]);
        clearSelection();
        say("Highlighted.", result.highlight.id);
      } else
        say(
          result.reason === "changed"
            ? "This article changed since you opened it. Reload the page and try again."
            : "This article can't be highlighted.",
        );
    } catch {
      say("Could not save the highlight. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(highlight: SavedHighlight) {
    setBusy(true);
    try {
      const note = await saveHighlightNote(
        highlight.id,
        drafts[highlight.id] ?? highlight.note ?? "",
      );
      setHighlights((list) =>
        list.map((h) => (h.id === highlight.id ? { ...h, note } : h)),
      );
      setDrafts((current) => without(current, highlight.id));
      say(note ? "Note saved." : "Note removed.");
    } catch {
      say("Could not save the note. Your words are still here; try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(highlight: SavedHighlight) {
    // A note can be long; losing it takes a second, deliberate press.
    if (highlight.note && confirming !== highlight.id) {
      setConfirming(highlight.id);
      return;
    }
    setConfirming(null);
    setBusy(true);
    try {
      await deleteHighlight(highlight.id);
      setHighlights((list) => list.filter((h) => h.id !== highlight.id));
      setDrafts((current) => without(current, highlight.id));
      if (activeId === highlight.id) setActiveId(null);
      say("Highlight deleted.");
    } catch {
      say("Could not delete the highlight. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function goTo(id: string) {
    const range = ranges.current.get(id);
    if (!range) return;
    setActiveId(id);
    setPanelOpen(false);
    scrollToRange(range);
  }

  async function copyLink(id: string) {
    const link = `${window.location.origin}/read/${itemId}?h=${id}`;
    try {
      await navigator.clipboard.writeText(link);
      say("Link copied.");
    } catch {
      say(`Copy this link: ${link}`);
    }
  }

  const ordered = [...highlights].sort((a, b) => {
    const left = anchors?.[a.id]?.start ?? Infinity;
    const right = anchors?.[b.id]?.start ?? Infinity;
    return left === right
      ? a.created_at.localeCompare(b.created_at)
      : left - right;
  });
  const tooLong = selection !== null && selection.quote.length > QUOTE_MAX;

  const bar =
    !panelOpen && (selection || notice) ? (
      <div
        className="reader-highlight-bar"
        role="region"
        aria-label="Highlight"
      >
        {selection ? (
          tooLong ? (
            <p>
              That&apos;s more than one highlight can hold (
              {QUOTE_MAX.toLocaleString("en")} characters).
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              // Keep the selection: a mouse press on a button would clear it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={highlight}
            >
              {busy ? "Saving…" : "Highlight"}
            </button>
          )
        ) : (
          notice && (
            <>
              <p role="status">{notice.message}</p>
              {notice.noteFor && (
                <button
                  type="button"
                  onClick={() => notice.noteFor && openNote(notice.noteFor)}
                >
                  Add a note
                </button>
              )}
            </>
          )
        )}
      </div>
    ) : null;

  return (
    <>
      <details
        ref={panel}
        className="reader-options reader-highlights"
        open={panelOpen}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setPanelOpen(open);
          if (open)
            for (const other of event.currentTarget
              .closest("nav")
              ?.querySelectorAll("details[open]") ?? [])
              if (other !== event.currentTarget)
                (other as HTMLDetailsElement).open = false;
        }}
      >
        <summary ref={summary} aria-label={`Highlights, ${highlights.length}`}>
          <span aria-hidden="true">✎</span>
          {highlights.length > 0 && (
            <span className="reader-highlights-count" aria-hidden="true">
              {highlights.length}
            </span>
          )}
        </summary>
        <div className="reader-options-panel reader-highlights-panel">
          <p className="reader-options-title">Highlights</p>
          {notice && panelOpen && (
            <p className="reader-save-note" role="status">
              {notice.message}
            </p>
          )}
          {ordered.length === 0 ? (
            <p className="reader-highlights-empty">
              Select a passage and choose Highlight. Notes stay with it.
            </p>
          ) : (
            <ol className="reader-highlights-list">
              {ordered.map((h) => {
                const draft = drafts[h.id] ?? h.note ?? "";
                const dirty = draft.trim() !== (h.note ?? "");
                const lost = anchors !== null && !anchors[h.id];
                return (
                  <li
                    key={h.id}
                    data-highlight={h.id}
                    data-active={h.id === activeId}
                  >
                    <blockquote>{h.quote}</blockquote>
                    {lost && (
                      <p className="reader-highlight-lost">
                        Not found in this copy of the article.
                      </p>
                    )}
                    <label htmlFor={`highlight-note-${h.id}`}>Note</label>
                    <textarea
                      id={`highlight-note-${h.id}`}
                      rows={3}
                      maxLength={NOTE_MAX}
                      value={draft}
                      placeholder="Add a thought…"
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDrafts((current) => ({ ...current, [h.id]: value }));
                      }}
                    />
                    <div className="reader-highlight-actions">
                      {dirty && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => saveNote(h)}
                        >
                          Save note
                        </button>
                      )}
                      {!lost && anchors !== null && (
                        <button type="button" onClick={() => goTo(h.id)}>
                          Go to
                        </button>
                      )}
                      <button type="button" onClick={() => copyLink(h.id)}>
                        Copy link
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(h)}
                      >
                        {confirming === h.id ? "Delete with note?" : "Delete"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </details>
      {portal && bar && createPortal(bar, portal)}
    </>
  );
}
