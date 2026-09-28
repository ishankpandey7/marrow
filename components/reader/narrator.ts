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

export interface SpeechEvents {
  end(): void;
  error(code: string): void;
  /** A word is starting, at this UTF-16 offset into the text spoken. */
  word(at: number): void;
}

export interface Speech {
  speak(text: string, options: SpeechOptions, events: SpeechEvents): void;
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
  /** Applies at once: a changed setting restarts from the word being spoken. */
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
  // How far into the current sentence the voice has got, by its word
  // events. Resume and a changed setting start from that word, as a reader
  // would expect. Where no word events arrive (Android is reported to send
  // none) it stays at 0, and they start from the sentence's beginning.
  let heard = 0;

  function publish(problem: string | null = null) {
    onChange({ status, index, problem });
  }
  function silence() {
    generation += 1;
    speech.cancel();
  }
  function speakAt(next: number, from = 0) {
    index = next;
    // A word event at the very end would leave nothing to say, and an
    // empty utterance may never end.
    heard = sentences[index].slice(from).trim() ? from : 0;
    const start = heard;
    status = "playing";
    const mine = ++generation;
    publish();
    speech.speak(sentences[index].slice(start), options, {
      word(at) {
        if (mine === generation) heard = start + at;
      },
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
      if (status === "paused") speakAt(index, heard);
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
        heard = 0;
        publish();
      }
    },
    configure(next) {
      const changed =
        next.rate !== options.rate ||
        next.lang !== options.lang ||
        next.voice !== options.voice;
      options = { ...next };
      // Heard at once, not from the next sentence: sentences run for five
      // or ten seconds, and a tap that changes nothing for that long reads
      // as a tap that did nothing (Ishank's phone check, 2026-09-28).
      if (changed && status === "playing") {
        silence();
        speakAt(index, heard);
      }
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
 * After a cancel that interrupted speech, how long the next utterance waits.
 * Chrome on Android stops the system voice asynchronously: an utterance
 * spoken straight behind `cancel()` was lost in that stop and reported as
 * ended, so a speed change or a skip jumped to the following sentence
 * instead (Ishank's phone, 2026-09-28). The page's own `speaking` flag
 * clears at once, so there is nothing to poll; a short wait is the fix.
 */
export const SETTLE_MS = 350;

/**
 * `Speech` over the browser's `speechSynthesis`. It keeps the current
 * utterance referenced: Chrome has been known to drop the events of an
 * utterance nothing holds on to, and without its `end` the queue stalls.
 */
export function browserSpeech(synth: SpeechSynthesis): Speech {
  let current: SpeechSynthesisUtterance | null = null;
  let settledAt = 0;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  function start(text: string, options: SpeechOptions, events: SpeechEvents) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate;
    const voice = options.voice
      ? synth.getVoices().find((each) => each.voiceURI === options.voice)
      : undefined;
    if (voice) {
      utterance.voice = voice;
      // Chrome on Android chooses its voice by language, so the utterance
      // carries the chosen voice's language, not the article's. Android
      // also reports en_US for en-US.
      utterance.lang = voice.lang.replace(/_/g, "-");
    } else if (options.lang) utterance.lang = options.lang;
    utterance.onend = () => {
      if (current === utterance) current = null;
      events.end();
    };
    utterance.onboundary = (event) => {
      if (event.name !== "sentence") events.word(event.charIndex);
    };
    utterance.onerror = (event) => {
      if (current === utterance) current = null;
      events.error(event.error);
    };
    current = utterance;
    synth.speak(utterance);
  }
  return {
    speak(text, options, events) {
      clearTimeout(waiting);
      waiting = undefined;
      const wait = settledAt - Date.now();
      // Nothing was interrupted, so speak now: the first speak() must stay
      // inside the tap for iPhone Safari.
      if (wait <= 0) start(text, options, events);
      else
        waiting = setTimeout(() => {
          waiting = undefined;
          start(text, options, events);
        }, wait);
    },
    cancel() {
      clearTimeout(waiting);
      waiting = undefined;
      const interrupting = synth.speaking || synth.pending;
      current = null;
      synth.cancel();
      if (interrupting) settledAt = Date.now() + SETTLE_MS;
    },
    stalled() {
      if (waiting !== undefined) return false;
      return synth.paused || (!synth.speaking && !synth.pending);
    },
  };
}
