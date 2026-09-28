import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/reader/actions", () => ({
  saveReaderSettings: vi.fn(),
  saveReadingProgress: vi.fn(async () => undefined),
}));
import { Listen } from "@/components/reader/listen";
import { ReaderSurface } from "@/components/reader/reader-surface";

class FakeUtterance {
  rate = 1;
  lang = "";
  voice: { voiceURI: string } | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth() {
  return {
    speaking: false,
    pending: false,
    paused: false,
    spoken: [] as FakeUtterance[],
    speak(utterance: FakeUtterance) {
      this.spoken.push(utterance);
    },
    cancel: vi.fn(),
    getVoices: () => [
      { voiceURI: "en-1", name: "Bee", lang: "en-US" },
      { voiceURI: "hi-1", name: "Ay", lang: "hi-IN" },
    ],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

const PAGE = `<section class="reader">
  <header class="reader-toolbar"><nav id="nav"></nav></header>
  <div class="reader-heading"><h1>The headline</h1></div>
  <article data-reader-article lang="en"><div class="reader-prose">
    <p>First sentence. Second sentence.</p><pre>code()</pre><p>Third.</p>
  </div></article>
</section>`;

let root: Root;
let container: HTMLElement;
let synth: ReturnType<typeof fakeSynth>;
let stored: Map<string, string>;
const playing = vi.fn();

function install(withSpeech: boolean) {
  const { window: browser } = parseHTML(
    `<!doctype html><html><body>${PAGE}</body></html>`,
  );
  synth = fakeSynth();
  if (withSpeech)
    Object.assign(browser, {
      speechSynthesis: synth,
      SpeechSynthesisUtterance: FakeUtterance,
    });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  Object.assign(browser, {
    innerHeight: 800,
    scrollY: 0,
    scrollTo: vi.fn(),
    matchMedia: () => ({ matches: false }),
  });
  // linkedom lays nothing out; every box is at the top of the page.
  const box = () => ({ top: 0, bottom: 0, height: 0, width: 0 });
  // linkedom's Range has no setStart or setEnd either.
  function setStart(this: Record<string, unknown>, node: Node, at: number) {
    Object.assign(this, { startContainer: node, startOffset: at });
  }
  function setEnd(this: Record<string, unknown>, node: Node, at: number) {
    Object.assign(this, { endContainer: node, endOffset: at });
  }
  Object.assign(Object.getPrototypeOf(browser.document.createRange()), {
    getBoundingClientRect: box,
    setStart,
    setEnd,
  });
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", browser.document);
  vi.stubGlobal("HTMLElement", browser.HTMLElement);
  vi.stubGlobal("Node", browser.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (next: () => void) =>
    setTimeout(next, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  container = document.getElementById("nav")!;
  root = createRoot(container);
}

async function render() {
  await act(async () => {
    root.render(
      createElement(Listen, {
        storageKey: "reader:user:listen",
        lang: "en",
        onPlayingChange: playing,
      }),
    );
  });
}
async function click(element: Element | null | undefined) {
  if (!element) throw new Error("no such control");
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent === text ||
      element.getAttribute("aria-label") === text,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("the Listen control", () => {
  it("is absent without speech, and from the server's render", async () => {
    install(false);
    await render();
    expect(container.innerHTML).toBe("");
    expect(
      renderToStaticMarkup(
        createElement(Listen, {
          storageKey: "k",
          lang: null,
          onPlayingChange: () => undefined,
        }),
      ),
    ).toBe("");
  });

  it("reads the title first from the top, and skips code", async () => {
    install(true);
    await render();
    expect(container.querySelector("summary")?.getAttribute("aria-label")).toBe(
      "Listen",
    );
    expect(button("Pause listening")).toBeUndefined();
    await click(button("Listen from here"));
    expect(synth.spoken.map((u) => u.text)).toEqual(["The headline"]);
    expect(synth.spoken[0].lang).toBe("en");
    expect(playing).toHaveBeenLastCalledWith(true);
    for (const expected of ["First sentence.", "Second sentence.", "Third."]) {
      await act(async () => synth.spoken[synth.spoken.length - 1].onend?.());
      expect(synth.spoken[synth.spoken.length - 1].text).toBe(expected);
    }
    await act(async () => synth.spoken[synth.spoken.length - 1].onend?.());
    expect(button("Listen again")).toBeDefined();
    expect(button("Pause listening")).toBeUndefined();
    expect(playing).toHaveBeenLastCalledWith(false);
  });

  it("pauses from the toolbar, ignores the late end, and resumes the same sentence", async () => {
    install(true);
    await render();
    await click(button("Listen from here"));
    const first = synth.spoken[0];
    await click(button("Pause listening"));
    expect(synth.cancel).toHaveBeenCalled();
    expect(button("Resume")).toBeDefined();
    await act(async () => first.onend?.());
    expect(synth.spoken).toHaveLength(1);
    await click(button("Resume listening"));
    expect(synth.spoken.map((u) => u.text)).toEqual([
      "The headline",
      "The headline",
    ]);
  });

  it("keeps rate and voice on this device and uses them from the next sentence", async () => {
    install(true);
    await render();
    const select = container.querySelector("select");
    expect(
      [...(select?.querySelectorAll("option") ?? [])].map((o) => o.textContent),
    ).toEqual(["Device default", "Bee (en-US)", "Ay (hi-IN)"]);
    await click(button("Listen from here"));
    await click(button("1.5×"));
    await act(async () => {
      if (!select) return;
      // linkedom's select.value has no setter; it reads the selected option.
      for (const option of select.querySelectorAll("option"))
        option.toggleAttribute("selected", option.value === "en-1");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(JSON.parse(stored.get("reader:user:listen") ?? "")).toEqual({
      rate: 1.5,
      voices: { en: "en-1" },
    });
    expect(synth.spoken[0].rate).toBe(1);
    await act(async () => synth.spoken[0].onend?.());
    expect(synth.spoken[1]).toMatchObject({
      rate: 1.5,
      voice: { voiceURI: "en-1" },
    });
  });

  it("stops speaking when the article closes", async () => {
    install(true);
    await render();
    await click(button("Listen from here"));
    synth.cancel.mockClear();
    await act(async () => root.unmount());
    expect(synth.cancel).toHaveBeenCalled();
    await act(async () => synth.spoken[0].onend?.());
    expect(synth.spoken).toHaveLength(1);
    root = createRoot(container);
  });
});

describe("the reader offers Listen", () => {
  async function surface(readable: boolean, preview: boolean) {
    const props: Omit<ComponentProps<typeof ReaderSurface>, "children"> = {
      id: "longform",
      storageScope: preview ? "fixture-preview" : "user",
      initialSettings: { theme: "system", family: "serif", size: 20 },
      initialProgress: 0,
      url: "https://reader-fixture.example/a",
      readable,
      preview,
      lang: "en",
    };
    await act(async () => {
      // The children come as createElement's third argument, which its
      // props type cannot see.
      root.render(
        createElement(
          ReaderSurface,
          props as ComponentProps<typeof ReaderSurface>,
          null,
        ),
      );
    });
  }

  it.each([true, false])(
    "for a readable article (preview: %s)",
    async (preview) => {
      install(true);
      await surface(true, preview);
      expect(container.querySelector('summary[aria-label="Listen"]')).not.toBe(
        null,
      );
    },
  );

  it("not for a pending or failed one", async () => {
    install(true);
    await surface(false, true);
    expect(container.querySelector('summary[aria-label="Listen"]')).toBe(null);
  });
});
