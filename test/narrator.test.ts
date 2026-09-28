import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserSpeech,
  createNarrator,
  type NarratorView,
  type Speech,
  type SpeechOptions,
} from "@/components/reader/narrator";

interface Call {
  text: string;
  options: SpeechOptions;
  events: { end(): void; error(code: string): void };
}

/** A speech engine whose events fire only when the test says so, as late as it likes. */
function fakeSpeech() {
  const calls: Call[] = [];
  let cancels = 0;
  let stalled = false;
  const speech: Speech = {
    speak(text, options, events) {
      calls.push({ text, options: { ...options }, events });
    },
    cancel() {
      cancels += 1;
    },
    stalled: () => stalled,
  };
  return {
    speech,
    calls,
    cancels: () => cancels,
    stall(value: boolean) {
      stalled = value;
    },
    last: () => calls[calls.length - 1],
  };
}

const SENTENCES = ["Zero.", "One.", "Two."];
const OPTIONS: SpeechOptions = { rate: 1, lang: "en", voice: null };

function setup() {
  const engine = fakeSpeech();
  const views: NarratorView[] = [];
  const narrator = createNarrator(engine.speech, (view) => views.push(view));
  const view = () => views[views.length - 1];
  return { engine, narrator, view };
}

describe("the narrator", () => {
  it("reads from the start sentence to the end, one utterance each", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 1, OPTIONS);
    expect(engine.calls.map((c) => c.text)).toEqual(["One."]);
    expect(view()).toEqual({ status: "playing", index: 1, problem: null });
    engine.last().events.end();
    expect(view().index).toBe(2);
    engine.last().events.end();
    expect(view()).toEqual({ status: "finished", index: 2, problem: null });
    expect(engine.calls.map((c) => c.text)).toEqual(["One.", "Two."]);
  });

  it("pauses by cancelling and resumes the same sentence from its start", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 0, OPTIONS);
    const first = engine.last();
    // play() cancels too, so count from here.
    const cancels = engine.cancels();
    narrator.pause();
    expect(engine.cancels()).toBe(cancels + 1);
    expect(view()).toMatchObject({ status: "paused", index: 0 });
    // Chrome sends the cancelled utterance's end; Safari an interrupted error.
    first.events.end();
    first.events.error("interrupted");
    expect(engine.calls).toHaveLength(1);
    expect(view()).toMatchObject({ status: "paused", index: 0, problem: null });
    narrator.resume();
    expect(engine.calls.map((c) => c.text)).toEqual(["Zero.", "Zero."]);
    expect(view().status).toBe("playing");
  });

  it("ignores a late end after the next sentence has started", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 0, OPTIONS);
    const skipped = engine.last();
    narrator.skip(1);
    expect(engine.last().text).toBe("One.");
    skipped.events.end();
    skipped.events.error("canceled");
    expect(engine.calls.map((c) => c.text)).toEqual(["Zero.", "One."]);
    expect(view()).toMatchObject({ status: "playing", index: 1 });
  });

  it("skips within the article: back at the first sentence restarts it, forward past the last finishes", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 0, OPTIONS);
    narrator.skip(-1);
    expect(engine.calls.map((c) => c.text)).toEqual(["Zero.", "Zero."]);
    expect(view()).toMatchObject({ status: "playing", index: 0 });
    narrator.play(SENTENCES, 2, OPTIONS);
    const calls = engine.calls.length;
    narrator.skip(1);
    expect(view().status).toBe("finished");
    expect(engine.calls).toHaveLength(calls);
  });

  it("moves the place without speaking while paused", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 0, OPTIONS);
    narrator.pause();
    narrator.skip(1);
    expect(view()).toMatchObject({ status: "paused", index: 1 });
    expect(engine.calls).toHaveLength(1);
    narrator.resume();
    expect(engine.last().text).toBe("One.");
  });

  it("does nothing on skip, pause or resume when nothing is playing", () => {
    const { engine, narrator } = setup();
    narrator.skip(1);
    narrator.pause();
    narrator.resume();
    expect(engine.calls).toHaveLength(0);
  });

  it("stops on an error the device raised, at the same sentence, and says why", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 1, OPTIONS);
    engine.last().events.error("not-allowed");
    expect(view()).toEqual({
      status: "paused",
      index: 1,
      problem: "Your browser wants a tap before it speaks. Press Resume.",
    });
    engine.calls[0].events.end();
    expect(engine.calls).toHaveLength(1);
    narrator.resume();
    engine.last().events.error("synthesis-failed");
    expect(view().problem).toMatch(/could not read this sentence/);
  });

  it("applies a new rate or voice from the next sentence", () => {
    const { engine, narrator } = setup();
    narrator.play(SENTENCES, 0, OPTIONS);
    narrator.configure({ rate: 1.5, lang: "en", voice: "Daniel" });
    expect(engine.last().options.rate).toBe(1);
    engine.last().events.end();
    expect(engine.last().options).toEqual({
      rate: 1.5,
      lang: "en",
      voice: "Daniel",
    });
  });

  it("stops for good: a late end does not start it again", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 0, OPTIONS);
    narrator.stop();
    expect(view().status).toBe("idle");
    engine.last().events.end();
    expect(engine.calls).toHaveLength(1);
  });

  it("reads Resume after the system stopped speech in the background", () => {
    const { engine, narrator, view } = setup();
    narrator.play(SENTENCES, 1, OPTIONS);
    narrator.reconcile();
    expect(view().status).toBe("playing");
    engine.stall(true);
    narrator.reconcile();
    expect(view()).toMatchObject({ status: "paused", index: 1 });
    expect(view().problem).toMatch(/hidden/);
  });

  it("has nothing to play in an empty article", () => {
    const { engine, narrator, view } = setup();
    narrator.play([], 0, OPTIONS);
    expect(view().status).toBe("idle");
    expect(engine.calls).toHaveLength(0);
  });
});

describe("the browser engine", () => {
  afterEach(() => vi.unstubAllGlobals());

  class FakeUtterance {
    rate = 1;
    lang = "";
    voice: { voiceURI: string } | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    constructor(public text: string) {}
  }

  function fakeSynth() {
    const spoken: FakeUtterance[] = [];
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      spoken,
      speak: (utterance: FakeUtterance) => spoken.push(utterance),
      cancel: vi.fn(),
      getVoices: () => [{ voiceURI: "Daniel" }, { voiceURI: "Lekha" }],
    };
    return synth;
  }

  it("sets rate, language and a voice the device has, and relays its events", () => {
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const synth = fakeSynth();
    const speech = browserSpeech(synth as unknown as SpeechSynthesis);
    const end = vi.fn();
    const error = vi.fn();
    speech.speak(
      "Hello.",
      { rate: 1.25, lang: "hi", voice: "Lekha" },
      {
        end,
        error,
      },
    );
    const [utterance] = synth.spoken;
    expect(utterance).toMatchObject({
      text: "Hello.",
      rate: 1.25,
      lang: "hi",
      voice: { voiceURI: "Lekha" },
    });
    utterance.onend?.();
    utterance.onerror?.({ error: "network" });
    expect(end).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("network");

    speech.speak("Hi.", { rate: 1, lang: null, voice: "Gone" }, { end, error });
    expect(synth.spoken[1]).toMatchObject({ lang: "", voice: null });
  });

  it("counts a paused or silent engine as stalled", () => {
    const synth = fakeSynth();
    const speech = browserSpeech(synth as unknown as SpeechSynthesis);
    expect(speech.stalled()).toBe(true);
    synth.speaking = true;
    expect(speech.stalled()).toBe(false);
    synth.paused = true;
    expect(speech.stalled()).toBe(true);
    speech.cancel();
    expect(synth.cancel).toHaveBeenCalledOnce();
  });
});
