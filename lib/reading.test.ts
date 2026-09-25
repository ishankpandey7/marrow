import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampProgress,
  DEFAULT_READER_SETTINGS,
  imageDimensions,
  mergeReaderSettings,
  originalUrl,
  progressWriter,
  readerSettings,
  readingProgress,
  restoredScroll,
} from "./reading";
import { FAIL_REASON_COPY } from "./constants";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { ArticleBody } from "@/components/reader/article-body";
import { ReaderState } from "@/components/reader/reader-state";
import { Reader } from "@/components/reader/reader";
import { readerFixture } from "@/components/reader/fixtures";

afterEach(() => vi.useRealTimers());

describe("reader settings and scroll geometry", () => {
  it("follows the device until a valid explicit choice is saved", () => {
    expect(readerSettings(null)).toEqual(DEFAULT_READER_SETTINGS);
    expect(
      readerSettings({ theme: "sepia", family: "sans", size: 24 }),
    ).toEqual({ theme: "sepia", family: "sans", size: 24 });
    expect(
      readerSettings({ theme: "purple", family: "comic", size: Infinity }),
    ).toEqual(DEFAULT_READER_SETTINGS);
    expect(readerSettings({ theme: "system" }).theme).toBe("system");
  });
  it("preserves unrelated profile settings", () => {
    expect(
      mergeReaderSettings(
        { digest: false, reader: { theme: "dark" } },
        DEFAULT_READER_SETTINGS,
      ),
    ).toEqual({ digest: false, reader: DEFAULT_READER_SETTINGS });
  });
  it("round trips positions and adapts to a changed text size", () => {
    const offset = restoredScroll(0.6, 400, 5000, 800);
    expect(readingProgress(offset, 400, 5000, 800)).toBeCloseTo(0.6);
    expect(
      readingProgress(restoredScroll(0.6, 400, 7000, 800), 400, 7000, 800),
    ).toBeCloseTo(0.6);
    expect(restoredScroll(0, 400, 5000, 800)).toBe(0);
  });
  it("handles a short article, overscroll and malformed saved values", () => {
    expect(readingProgress(0, 100, 400, 800)).toBe(1);
    expect(readingProgress(0, 600, 400, 800)).toBe(0);
    expect(readingProgress(-100, 100, 5000, 800)).toBe(0);
    expect(readingProgress(9000, 100, 5000, 800)).toBe(1);
    expect(clampProgress(NaN)).toBe(0);
    expect(clampProgress(Infinity)).toBe(0);
  });
});

describe("progress writes", () => {
  it("coalesces hundreds of scrolls and flushes the latest position when hidden", async () => {
    vi.useFakeTimers();
    const write = vi
      .fn<(value: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    const writer = progressWriter(write);
    for (let i = 0; i < 500; i++) writer.schedule(i / 1000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledExactlyOnceWith(0.499);
    writer.schedule(0.7);
    await writer.flush();
    expect(write).toHaveBeenLastCalledWith(0.7);
    await vi.advanceTimersByTimeAsync(10000);
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("serializes slow requests and recovers after a rejected write", async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi
      .fn<(value: number) => Promise<void>>()
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const writer = progressWriter(write);
    writer.schedule(0.1);
    const first = writer.flush();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    writer.schedule(0.4);
    const second = writer.flush();
    const rejection = expect(second).rejects.toThrow("offline");
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await first;
    await rejection;
    writer.schedule(0.8);
    await writer.flush();
    expect(write.mock.calls.map((call) => call[0])).toEqual([0.1, 0.4, 0.8]);
  });
});

describe("the server rendering boundary", () => {
  it("sanitizes before rendering and never restores publisher controls or executable URLs", () => {
    const html = renderToStaticMarkup(
      createElement(ArticleBody, {
        html: '<p id="reader-content" class="reader-toolbar" style="position:fixed">Keep the words<script>alert(1)</script><a href="javascript:alert(1)">a link</a><img src="https://publisher.example/image" onerror="alert(1)"></p><iframe src="https://publisher.example"></iframe><form><button>Sign in</button></form>',
      }),
    );
    expect(html).toContain("Keep the words");
    expect(html).not.toMatch(
      /<script|<iframe|<form|onerror|javascript:|position:fixed|id="reader-content"|class="reader-toolbar"/,
    );
    expect(html).not.toContain('<img src="https://publisher.example/image"');
    expect(html).toContain("Connects to the source site.");
  });
  it("preserves link protections and gives a table a keyboard reachable scroll container", () => {
    const html = renderToStaticMarkup(
      createElement(ArticleBody, {
        html: '<p><a href="https://publisher.example/story" rel="opener">Source</a></p><table><caption>Survey</caption><tr><th scope="col">Date</th><td>Tuesday</td></tr></table>',
      }),
    );
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(
      'class="reader-table" role="region" aria-label="Survey" tabindex="0"',
    );
    expect(html).toContain('<th scope="col">Date</th>');
  });
  it("reserves image space regardless of missing or hostile dimensions", () => {
    expect(imageDimensions(null, null)).toEqual({ width: 1200, height: 800 });
    expect(imageDimensions("400", "800")).toEqual({ width: 400, height: 800 });
    expect(imageDimensions("1", "999999")).toEqual({
      width: 1200,
      height: 800,
    });
    expect(imageDimensions("0.1", "0.1")).toEqual({ width: 1200, height: 800 });
    const html = renderToStaticMarkup(
      createElement(ArticleBody, {
        fixtureImages: true,
        html: '<img src="https://reader-fixture.example/river.svg" width="1200" height="800" alt="The river">',
      }),
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('width="1200" height="800"');
    expect(html).toContain("aspect-ratio:1200 / 800");
    expect(html).toContain('src="/reader-fixture-river.svg"');
  });
  it.each(Object.keys(FAIL_REASON_COPY) as (keyof typeof FAIL_REASON_COPY)[])(
    "renders the specified %s copy and action",
    (reason) => {
      const html = renderToStaticMarkup(
        createElement(ReaderState, {
          reason,
          id: reason,
          url: "https://publisher.example/article",
          preview: true,
        }),
      );
      const { document } = parseHTML(`<html><body>${html}</body></html>`);
      expect(document.querySelector("h2")?.textContent).toBe(
        FAIL_REASON_COPY[reason].message,
      );
      expect(document.body.textContent).toContain(
        FAIL_REASON_COPY[reason].offerRetry
          ? "Try again"
          : reason === "blocked_url"
            ? "Back to sample article"
            : "Open original",
      );
    },
  );
  it("rejects executable originals and embedded credentials", () => {
    expect(originalUrl("javascript:alert(1)")).toBeUndefined();
    expect(originalUrl("https://user:password@example.com/")).toBeUndefined();
    expect(originalUrl("https://example.com/story")).toBe(
      "https://example.com/story",
    );
  });
  it("renders a complete 3,000-word article without JavaScript or credentials", async () => {
    const fixture = await readerFixture("longform");
    expect(fixture).not.toBeNull();
    if (!fixture) throw new Error("Missing longform fixture");
    const raw = readFileSync(
      join(process.cwd(), "components/reader/fixtures/longform.html"),
      "utf8",
    );
    const { document } = parseHTML(`<html><body>${raw}</body></html>`);
    expect(
      document.body.textContent?.split(/\s+/).length,
    ).toBeGreaterThanOrEqual(3000);
    const html = renderToStaticMarkup(
      createElement(Reader, {
        ...fixture,
        storageScope: "test",
        preview: true,
      }),
    );
    expect(html).toContain("At the end of the street");
    expect(html.replace(/\s+/g, " ")).toContain(
      "It is enough that I was there to see it.",
    );
    expect(html).toContain('data-theme="system"');
    expect(html).toContain("Skip to article");
  });
  it("offers highlights on a readable signed-in article only", async () => {
    const fixture = await readerFixture("longform");
    if (!fixture) throw new Error("Missing longform fixture");
    const saved = [
      {
        id: "87654321-4321-4321-4321-cba987654321",
        quote: "At the end of the street",
        note: "Opening line",
        start_offset: 0,
        end_offset: 24,
        created_at: "2026-09-25T00:00:00Z",
      },
    ];
    const render = (overrides: Record<string, unknown>) =>
      renderToStaticMarkup(
        createElement(Reader, {
          ...fixture,
          storageScope: "test",
          highlights: saved,
          ...overrides,
        }),
      );
    const signedIn = render({});
    expect(signedIn).toContain('aria-label="Highlights, 1"');
    // Server HTML carries the list for the panel, never marks in the article.
    expect(signedIn).toContain("Opening line");
    expect(signedIn).not.toMatch(/<mark|marrow-highlight/);
    expect(render({ preview: true })).not.toContain("Highlights,");
    expect(render({ highlights: null })).not.toContain("Highlights,");
    expect(
      render({ item: { ...fixture.item, status: "pending" } }),
    ).not.toContain("Highlights,");
  });
  it("runs earlier extraction fixtures through the actual extraction pipeline", async () => {
    expect((await readerFixture("news-article"))?.item.title).toBe(
      "Kingfishers return to the Lea",
    );
    expect((await readerFixture("bare-title"))?.item.author).toBeNull();
    for (const reason of ["paywalled", "js_required", "no_content"]) {
      expect((await readerFixture(reason))?.item.fail_reason).toBe(reason);
    }
    expect(await readerFixture("../../.env.local")).toBeNull();
  });
});
