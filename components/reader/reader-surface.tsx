"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  clampProgress,
  originalUrl,
  progressWriter,
  readerSettings,
  readingProgress,
  restoredScroll,
  type ReaderSettings,
} from "@/lib/reading";
import { saveReaderSettings, saveReadingProgress } from "./actions";

const preferenceEvent = "reader-preferences-changed";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(preferenceEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(preferenceEvent, callback);
  };
}
function localValue(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storeValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function ReaderSurface({
  id,
  storageScope,
  initialSettings,
  initialProgress,
  url,
  readable,
  preview = false,
  restorePosition = true,
  tools,
  children,
}: {
  id: string;
  storageScope: string;
  initialSettings: ReaderSettings;
  initialProgress: number;
  url: string;
  readable: boolean;
  preview?: boolean;
  /** False when a deep link names a highlight to scroll to instead. */
  restorePosition?: boolean;
  /** Extra toolbar controls, placed before the appearance menu. */
  tools?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const root = useRef<HTMLElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const settingsKey = `reader:${storageScope}:settings`;
  const positionKey = `reader:${storageScope}:position:${id}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => (preview ? localValue(settingsKey) : null),
    () => null,
  );
  const [settings, setSettings] = useState(initialSettings);
  const [note, setNote] = useState("");
  const [hidden, setHidden] = useState(false);
  const [progress, setProgress] = useState(initialProgress);
  const settingsQueue = useRef(Promise.resolve());
  const settingsRevision = useRef(0);
  // Server Action revalidation may return an older saved position while a reader
  // is still moving. Restoration belongs to opening an article, not every write.
  const openingProgress = useRef(initialProgress);
  let effectiveSettings = settings;
  if (raw) {
    try {
      effectiveSettings = readerSettings(JSON.parse(raw));
    } catch {
      /* Ignore damaged browser storage. */
    }
  }

  function choose(next: ReaderSettings) {
    const article = root.current?.querySelector<HTMLElement>(
      "[data-reader-article]",
    );
    const before = article
      ? readingProgress(
          window.scrollY,
          article.getBoundingClientRect().top + window.scrollY,
          article.offsetHeight,
          window.innerHeight,
        )
      : 0;
    setSettings(next);
    if (preview) {
      const stored = storeValue(settingsKey, JSON.stringify(next));
      window.dispatchEvent(new Event(preferenceEvent));
      setNote(
        stored
          ? "Saved in this browser for the preview."
          : "Browser storage is unavailable. These settings last until you leave.",
      );
    } else {
      const revision = ++settingsRevision.current;
      setNote("Saving…");
      settingsQueue.current = settingsQueue.current
        .catch(() => undefined)
        .then(() => saveReaderSettings(next))
        .then(() => {
          if (revision === settingsRevision.current)
            setNote("Reading settings saved.");
        })
        .catch(() => {
          if (revision === settingsRevision.current)
            setNote("Could not save settings. Choose again to retry.");
        });
    }
    requestAnimationFrame(() => {
      if (article && before > 0)
        window.scrollTo({
          top: restoredScroll(
            before,
            article.getBoundingClientRect().top + window.scrollY,
            article.offsetHeight,
            window.innerHeight,
          ),
          behavior: "instant",
        });
    });
  }

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const article = element.querySelector<HTMLElement>("[data-reader-article]");
    const back = preview ? "/reader-preview/longform" : "/inbox";
    const writer = progressWriter(async (value) => {
      if (preview) return;
      try {
        await saveReadingProgress(id, value);
        // A later scroll may already have replaced the unsynced local value.
        if (localValue(positionKey) === String(value)) {
          try {
            localStorage.removeItem(positionKey);
          } catch {
            /* The server copy is already saved. */
          }
        }
      } catch {
        setNote("Position kept in this browser. Sync will retry as you read.");
      }
    });
    let lastScroll = window.scrollY;
    let frame = 0;
    let active = false;
    let previousProgress = -1;
    const saved = localValue(positionKey);
    const resume =
      saved === null ? openingProgress.current : clampProgress(Number(saved));
    let secondRestoreFrame = 0;
    const restoreFrame = requestAnimationFrame(() => {
      secondRestoreFrame = requestAnimationFrame(() => {
        if (
          article &&
          readable &&
          restorePosition &&
          resume > 0 &&
          !window.location.hash
        ) {
          window.scrollTo({
            top: restoredScroll(
              resume,
              article.getBoundingClientRect().top + window.scrollY,
              article.offsetHeight,
              window.innerHeight,
            ),
            behavior: "instant",
          });
          setProgress(resume);
        }
        lastScroll = window.scrollY;
        active = true;
      });
    });
    function record() {
      if (!active || !readable || !article) return;
      const value =
        Math.round(
          readingProgress(
            window.scrollY,
            article.getBoundingClientRect().top + window.scrollY,
            article.offsetHeight,
            window.innerHeight,
          ) * 10000,
        ) / 10000;
      if (value === previousProgress) return;
      previousProgress = value;
      setProgress(value);
      if (!storeValue(positionKey, String(value)) && preview)
        setNote(
          "Browser storage is unavailable. Your position cannot be remembered.",
        );
      writer.schedule(value);
    }
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const current = window.scrollY;
        if (!options.current?.open && Math.abs(current - lastScroll) > 3)
          setHidden(current > lastScroll && current > 120);
        lastScroll = current;
        record();
      });
    }
    function flush() {
      record();
      void writer.flush().catch(() => undefined);
    }
    function visibility() {
      if (document.visibilityState === "hidden") flush();
    }
    function keydown(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (options.current?.open) {
          options.current.open = false;
          options.current.querySelector("summary")?.focus();
        } else router.push(back);
        return;
      }
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, button, summary, a"))
      )
        return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        window.scrollBy({
          top: (event.key === "j" ? 1 : -1) * window.innerHeight * 0.55,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
      }
    }
    function reveal(event: MouseEvent) {
      if (window.getSelection()?.toString()) return;
      if (
        event.target instanceof Element &&
        event.target.closest("a, button, details, .reader-image, .reader-table")
      )
        return;
      setHidden(false);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("keydown", keydown);
    element.addEventListener("click", reveal);
    return () => {
      flush();
      active = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(secondRestoreFrame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("keydown", keydown);
      element.removeEventListener("click", reveal);
    };
  }, [id, positionKey, preview, readable, restorePosition, router]);

  const href = originalUrl(url);
  return (
    <section
      ref={root}
      className="reader"
      data-theme={effectiveSettings.theme}
      data-family={effectiveSettings.family}
      style={
        {
          "--reader-size": `${effectiveSettings.size}px`,
        } as React.CSSProperties
      }
    >
      <a className="reader-skip" href="#reader-content">
        Skip to article
      </a>
      <header className="reader-toolbar" data-hidden={hidden}>
        <nav aria-label="Reader controls">
          <a
            className="reader-back"
            href={preview ? "/reader-preview/longform" : "/inbox"}
          >
            ← <span>{preview ? "Samples" : "Library"}</span>
          </a>
          {readable && (
            <span className="reader-progress" aria-label="Reading progress">
              {Math.round(progress * 100)}
              <span>%</span>
            </span>
          )}
          {tools}
          <details ref={options} className="reader-options">
            <summary aria-label="Reading appearance">Aa</summary>
            <div className="reader-options-panel">
              <p className="reader-options-title">Make yourself comfortable.</p>
              <fieldset>
                <legend>Typeface</legend>
                <div className="reader-choices">
                  {(["serif", "sans"] as const).map((family) => (
                    <button
                      key={family}
                      type="button"
                      aria-pressed={effectiveSettings.family === family}
                      className={
                        family === "serif" ? "reader-serif-choice" : ""
                      }
                      onClick={() => choose({ ...effectiveSettings, family })}
                    >
                      {family === "serif" ? "Serif" : "Sans"}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Text size</legend>
                <div className="reader-choices">
                  {[18, 20, 22, 24].map((size) => (
                    <button
                      key={size}
                      type="button"
                      aria-label={`${size} pixels`}
                      aria-pressed={effectiveSettings.size === size}
                      onClick={() => choose({ ...effectiveSettings, size })}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Page colour</legend>
                <div className="reader-choices reader-theme-choices">
                  {(["light", "dark", "sepia"] as const).map((theme) => (
                    <button
                      type="button"
                      key={theme}
                      data-swatch={theme}
                      aria-pressed={effectiveSettings.theme === theme}
                      onClick={() => choose({ ...effectiveSettings, theme })}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
                <button
                  className="reader-system-choice"
                  type="button"
                  aria-pressed={effectiveSettings.theme === "system"}
                  onClick={() =>
                    choose({ ...effectiveSettings, theme: "system" })
                  }
                >
                  Use device appearance{" "}
                  {effectiveSettings.theme === "system" ? "✓" : ""}
                </button>
              </fieldset>
              {href && (
                <a
                  className="reader-original"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Open original ↗
                </a>
              )}
              <p className="reader-keyboard-hint">
                J / K to scroll · Esc to return
              </p>
              <p className="reader-save-note" role="status">
                {note}
              </p>
              <noscript>
                <p>
                  Appearance controls need JavaScript. The article is available
                  below.
                </p>
              </noscript>
            </div>
          </details>
        </nav>
      </header>
      {children}
    </section>
  );
}
