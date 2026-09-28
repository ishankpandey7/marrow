/**
 * The speech queue behind Listen: one sentence per utterance, spoken in
 * turn. It talks to the engine through `Speech`, so it can be tested with a
 * fake that fires events as late as real browsers do.
 *
 * It is built for the worst reported behaviour, none of it verified yet:
 * Chrome cutting long utterances, Android turning pause into cancel and
 * sending no word boundaries, iOS stopping on lock. So Pause cancels and
 * Resume speaks the same sentence again from its start, and the reader is
 * told which sentence is current when it is queued, not by `boundary`.
 */

export type NarratorStatus = "idle" | "playing" | "paused" | "finished";

export interface NarratorView {
  status: NarratorStatus;
  /** The current sentence: being spoken, or where Resume will start. */
  index: number;
  /** Why speech stopped, when the device stopped it rather than the reader. */
  problem: string | null;
}

export interface SpeechOptions {
  rate: number;
  /** The article's language, so the device picks a voice for it. */
  lang: string | null;
  /** A `voiceURI`; null leaves the device's default for `lang`. */
  voice: string | null;
}

export interface Speech {
  speak(
    text: string,
    options: SpeechOptions,
    events: { end(): void; error(code: string): void },
  ): void;
  cancel(): void;
  /** True when the device has stopped on its own: nothing speaking or queued, or paused. */
  stalled(): boolean;
}

export interface Narrator {
  play(
    sentences: readonly string[],
    from: number,
    options: SpeechOptions,
  ): void;
  pause(): void;
  resume(): void;
  skip(delta: -1 | 1): void;
  /** Applies from the next sentence; the current one finishes as it began. */
  configure(options: SpeechOptions): void;
  stop(): void;
  /** Call when the page is visible again: the system may have stopped speech. */
  reconcile(): void;
}

const PROBLEMS: Record<string, string> = {
  "not-allowed": "Your browser wants a tap before it speaks. Press Resume.",
  "language-unavailable":
    "This device has no voice for this language. Choose another voice.",
  "voice-unavailable": "That voice is not available now. Choose another voice.",
  interrupted: "Speech was interrupted. Press Resume to carry on.",
  canceled: "Speech was interrupted. Press Resume to carry on.",
};
const PROBLEM = "Your device could not read this sentence. Resume, or skip it.";
const STOPPED = "Speech stopped while the page was hidden. Press Resume.";

export function createNarrator(
  speech: Speech,
  onChange: (view: NarratorView) => void,
): Narrator {
  let sentences: readonly string[] = [];
  let index = 0;
  let status: NarratorStatus = "idle";
  let options: SpeechOptions = { rate: 1, lang: null, voice: null };
  // Every cancel answers late: the cancelled utterance's `end` or `error`
  // arrives after the next sentence has been queued. An event from any
  // utterance but the newest is from one we already gave up on.
  let generation = 0;

  function publish(problem: string | null = null) {
    onChange({ status, index, problem });
  }
  function silence() {
    generation += 1;
    speech.cancel();
  }
  function speakAt(next: number) {
    index = next;
    status = "playing";
    const mine = ++generation;
    publish();
    speech.speak(sentences[index], options, {
      end() {
        if (mine !== generation) return;
        if (index + 1 < sentences.length) speakAt(index + 1);
        else {
          generation += 1;
          status = "finished";
          publish();
        }
      },
      error(code) {
        if (mine !== generation) return;
        generation += 1;
        status = "paused";
        publish(PROBLEMS[code] ?? PROBLEM);
      },
    });
  }
  const clamp = (value: number) =>
    Math.min(Math.max(value, 0), sentences.length - 1);

  return {
    play(list, from, next) {
      silence();
      sentences = list;
      options = { ...next };
      if (sentences.length === 0) {
        status = "idle";
        index = 0;
        publish();
        return;
      }
      speakAt(clamp(from));
    },
    pause() {
      if (status !== "playing") return;
      silence();
      status = "paused";
      publish();
    },
    resume() {
      if (status === "paused") speakAt(index);
    },
    skip(delta) {
      if (status !== "playing" && status !== "paused") return;
      const next = index + delta;
      if (next >= sentences.length) {
        silence();
        status = "finished";
        publish();
      } else if (status === "playing") {
        silence();
        speakAt(clamp(next));
      } else {
        index = clamp(next);
        publish();
      }
    },
    configure(next) {
      options = { ...next };
    },
    stop() {
      silence();
      if (status === "idle") return;
      status = "idle";
      publish();
    },
    reconcile() {
      if (status !== "playing" || !speech.stalled()) return;
      silence();
      status = "paused";
      publish(STOPPED);
    },
  };
}

/**
 * `Speech` over the browser's `speechSynthesis`. It keeps the current
 * utterance referenced: Chrome has been known to drop the events of an
 * utterance nothing holds on to, and without its `end` the queue stalls.
 */
export function browserSpeech(synth: SpeechSynthesis): Speech {
  let current: SpeechSynthesisUtterance | null = null;
  return {
    speak(text, options, events) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = options.rate;
      if (options.lang) utterance.lang = options.lang;
      const voice = options.voice
        ? synth.getVoices().find((each) => each.voiceURI === options.voice)
        : undefined;
      if (voice) utterance.voice = voice;
      utterance.onend = () => {
        if (current === utterance) current = null;
        events.end();
      };
      utterance.onerror = (event) => {
        if (current === utterance) current = null;
        events.error(event.error);
      };
      current = utterance;
      synth.speak(utterance);
    },
    cancel() {
      current = null;
      synth.cancel();
    },
    stalled() {
      return synth.paused || (!synth.speaking && !synth.pending);
    },
  };
}
