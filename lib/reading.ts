import type { Item } from "@/lib/types";

export type ReaderTheme = "system" | "light" | "dark" | "sepia";
export interface ReaderSettings {
  theme: ReaderTheme;
  family: "serif" | "sans";
  size: number;
}

export type ReaderItem = Pick<
  Item,
  | "id"
  | "url"
  | "title"
  | "author"
  | "site_name"
  | "published_at"
  | "reading_minutes"
  | "status"
  | "fail_reason"
  | "read_progress"
  | "lang"
>;

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: "system",
  family: "serif",
  size: 20,
};
export const PROGRESS_INTERVAL = 5000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readerSettings(value: unknown): ReaderSettings {
  const settings = isRecord(value) ? value : {};
  return {
    theme:
      settings.theme === "light" ||
      settings.theme === "dark" ||
      settings.theme === "sepia"
        ? settings.theme
        : "system",
    family: settings.family === "sans" ? "sans" : "serif",
    size:
      typeof settings.size === "number" &&
      [18, 20, 22, 24].includes(settings.size)
        ? settings.size
        : 20,
  };
}

export function mergeReaderSettings(
  profile: unknown,
  settings: ReaderSettings,
) {
  return {
    ...(isRecord(profile) ? profile : {}),
    reader: readerSettings(settings),
  };
}

export function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function readingProgress(
  scroll: number,
  start: number,
  height: number,
  viewport: number,
) {
  const distance = height - viewport;
  if (distance <= 0) return scroll + viewport >= start + height ? 1 : 0;
  return clampProgress((scroll - start) / distance);
}

export function restoredScroll(
  progress: number,
  start: number,
  height: number,
  viewport: number,
) {
  return progress <= 0
    ? 0
    : start + clampProgress(progress) * Math.max(0, height - viewport);
}

export function originalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    ) {
      return url.href;
    }
  } catch {
    /* A saved malformed URL must remain text, never an executable link. */
  }
  return undefined;
}

export function imageDimensions(width: string | null, height: string | null) {
  const w = Number(width);
  const h = Number(height);
  if (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w > 0 &&
    h > 0 &&
    w / h >= 0.25 &&
    w / h <= 4
  ) {
    return {
      width: Math.round(Math.min(w, 4096)),
      height: Math.round((Math.min(w, 4096) * h) / w),
    };
  }
  return { width: 1200, height: 800 };
}

/** A trailing throttle with a serial queue: slow writes cannot overtake newer positions. */
export function progressWriter(
  write: (progress: number) => Promise<void>,
  interval = PROGRESS_INTERVAL,
) {
  let latest: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (latest === undefined) return chain;
    const value = latest;
    latest = undefined;
    chain = chain.catch(() => undefined).then(() => write(value));
    return chain;
  };
  return {
    schedule(value: number) {
      latest = clampProgress(value);
      timer ??= setTimeout(() => {
        void flush().catch(() => undefined);
      }, interval);
    },
    flush,
  };
}
