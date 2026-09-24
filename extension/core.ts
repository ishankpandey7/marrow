import { SAVE_BODY_MAX_BYTES } from "./config.js";

export type SaveStatus =
  "idle" | "saving" | "saved" | "already" | "queued" | "error" | "auth";

export interface Feedback {
  status: SaveStatus;
  message: string;
}

export interface QueuedSave {
  id: number;
  url: string;
  attempts: number;
  nextAt: number;
}

export interface SaveState {
  version: 1;
  token: string | null;
  nextId: number;
  queue: QueuedSave[];
  feedback: Feedback;
}

export interface PublicState {
  configured: boolean;
  queued: number;
  feedback: Feedback;
}

export interface Dependencies {
  now(): number;
  fetch: typeof fetch;
  read(): Promise<unknown>;
  write(state: SaveState): Promise<void>;
  show(feedback: Feedback): Promise<void>;
  schedule(): Promise<void>;
  endpoint: string;
}

const RETRY_DELAY = 60_000;
const MAX_QUEUE = 100;
const EMPTY_FEEDBACK: Feedback = {
  status: "idle",
  message: "Ready to save a page.",
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isFeedback(value: unknown): value is Feedback {
  return (
    record(value) &&
    typeof value.message === "string" &&
    ["idle", "saving", "saved", "already", "queued", "error", "auth"].includes(
      String(value.status),
    )
  );
}

function isJob(value: unknown): value is QueuedSave {
  return (
    record(value) &&
    typeof value.url === "string" &&
    Number.isSafeInteger(value.id) &&
    Number.isSafeInteger(value.attempts) &&
    typeof value.nextAt === "number" &&
    Number.isFinite(value.nextAt)
  );
}

function decode(value: unknown): SaveState {
  if (value === undefined) {
    return {
      version: 1,
      token: null,
      nextId: 1,
      queue: [],
      feedback: EMPTY_FEEDBACK,
    };
  }
  if (
    !record(value) ||
    value.version !== 1 ||
    !(value.token === null || typeof value.token === "string") ||
    !Number.isSafeInteger(value.nextId) ||
    !Array.isArray(value.queue) ||
    !value.queue.every(isJob) ||
    !isFeedback(value.feedback)
  ) {
    throw new Error(
      "Saved extension settings could not be read. Remove the extension and set it up again.",
    );
  }
  return value as unknown as SaveState;
}

function validUrl(value: string | undefined): value is string {
  if (!value || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * The page travels with the first attempt only (Slice 10). It is never put in
 * the durable queue: storage.local holds about 10 MB in all, and a queue of
 * pages would fill it and then fail every write after it, the token included.
 * A replay therefore sends the link, and the server fetches it.
 *
 * Too big for the server's cap means the page is dropped, never the save.
 */
function saveBody(url: string, html: string | undefined): string {
  if (html) {
    const withPage = JSON.stringify({ url, html });
    if (new TextEncoder().encode(withPage).byteLength <= SAVE_BODY_MAX_BYTES)
      return withPage;
  }
  return JSON.stringify({ url });
}

/**
 * Fifteen seconds for a link, plus one per 100 kB of page. The whole upload
 * happens inside this timeout, and the page cannot be retried: it is never
 * stored, so a slow uplink that timed out at 15 s lost it. At SAVE_BODY_MAX_BYTES
 * this is 45 s, inside the save route's 60 s ceiling.
 */
function uploadTimeout(body: string): number {
  const bytes = new TextEncoder().encode(body).byteLength;
  return 15_000 + Math.ceil(bytes / 100_000) * 1_000;
}

function retryDelay(response: Response, now: number): number {
  const header = response.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - now;
    if (Number.isFinite(delay) && delay > 0)
      return Math.max(RETRY_DELAY, delay);
  }
  return RETRY_DELAY;
}

export function createSaveController(deps: Dependencies) {
  // All storage changes have one writer, including options messages. This keeps
  // an old request from restoring a token or queue after the user replaces it.
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }

  async function publish(state: SaveState, feedback: Feedback) {
    state.feedback = feedback;
    await deps.write(state);
    await deps.show(feedback);
  }

  function publicState(state: SaveState): PublicState {
    return {
      configured: state.token !== null,
      queued: state.queue.length,
      feedback: state.feedback,
    };
  }

  async function attempt(state: SaveState, job: QueuedSave, html?: string) {
    if (!state.token) return;
    job.attempts += 1;
    // Persist before sending. A worker may disappear after the server commits;
    // replay then deliberately uses the API's atomic re-save semantics.
    job.nextAt = deps.now() + RETRY_DELAY;
    await publish(state, { status: "saving", message: "Saving…" });
    const requestBody = saveBody(job.url, html);
    let response: Response;
    try {
      response = await deps.fetch(deps.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.token}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(uploadTimeout(requestBody)),
      });
    } catch {
      job.nextAt =
        deps.now() +
        Math.min(
          RETRY_DELAY * 2 ** Math.min(job.attempts - 1, 4),
          15 * RETRY_DELAY,
        );
      await publish(state, {
        status: "queued",
        message: "Connection unavailable. Queued; retrying automatically.",
      });
      return;
    }

    if (response.status === 401 || response.status === 403) {
      // A replacement can belong to another account. Keeping old saves would
      // silently send that account the previous account's browsing activity.
      state.token = null;
      state.queue = [];
      await publish(state, {
        status: "auth",
        message:
          "Token rejected or revoked. Pending saves discarded. Open extension options to reconnect.",
      });
      return;
    }
    if (response.status === 429 || response.status >= 500) {
      const delay =
        response.status === 429
          ? retryDelay(response, deps.now())
          : Math.min(
              RETRY_DELAY * 2 ** Math.min(job.attempts - 1, 4),
              15 * RETRY_DELAY,
            );
      job.nextAt = deps.now() + delay;
      // A per-user limit applies to the whole queue, not just the first URL.
      if (response.status === 429)
        for (const queued of state.queue)
          queued.nextAt = Math.max(queued.nextAt, job.nextAt);
      await publish(state, {
        status: "queued",
        message:
          response.status === 429
            ? "Save limit reached. Queued until the limit resets."
            : "Server unavailable. Queued; retrying automatically.",
      });
      return;
    }

    if (response.status !== 200 && response.status !== 201) {
      state.queue = state.queue.filter((queued) => queued.id !== job.id);
      await publish(state, {
        status: "error",
        message:
          "This link could not be saved. Try a public HTTP or HTTPS page.",
      });
      return;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      await publish(state, {
        status: "queued",
        message: "Save response was incomplete. Queued for a safe retry.",
      });
      return;
    }
    if (
      !record(body) ||
      typeof body.alreadySaved !== "boolean" ||
      !record(body.item) ||
      typeof body.item.id !== "string"
    ) {
      await publish(state, {
        status: "queued",
        message: "Save response was incomplete. Queued for a safe retry.",
      });
      return;
    }
    state.queue = state.queue.filter((queued) => queued.id !== job.id);
    await publish(
      state,
      body.alreadySaved
        ? {
            status: "already",
            message: "Already saved — back in your inbox. Reading state kept.",
          }
        : { status: "saved", message: "Saved to your inbox." },
    );
  }

  return {
    status: () => serial(async () => publicState(decode(await deps.read()))),
    configure: (token: string | null) =>
      serial(async () => {
        const state = decode(await deps.read());
        const cleanToken = token?.trim() || null;
        if (cleanToken && !/^mrx_[A-Za-z0-9_-]{43}$/.test(cleanToken))
          throw new Error(
            "Paste the complete save token from web app settings.",
          );
        if (state.token !== cleanToken) state.queue = [];
        state.token = cleanToken;
        await publish(
          state,
          cleanToken
            ? {
                status: "idle",
                message: "Token stored on this device. Ready to save.",
              }
            : {
                status: "auth",
                message: "Disconnected. Pending saves discarded.",
              },
        );
        await deps.schedule();
        return publicState(state);
      }),
    save: (url: string | undefined, html?: string) =>
      serial(async () => {
        const state = decode(await deps.read());
        if (!state.token) {
          await publish(state, {
            status: "auth",
            message:
              "Connect first: right-click the extension icon and open Options.",
          });
          return publicState(state);
        }
        if (!validUrl(url)) {
          await publish(state, {
            status: "error",
            message:
              "Only HTTP or HTTPS pages can be saved. Browser settings and local files cannot.",
          });
          return publicState(state);
        }
        if (state.queue.some((job) => job.url === url)) {
          await publish(state, {
            status: "queued",
            message: "This page is already queued. Retrying automatically.",
          });
          return publicState(state);
        }
        if (state.queue.length >= MAX_QUEUE) {
          await publish(state, {
            status: "error",
            message:
              "The offline queue is full (100 pages). Reconnect before saving more.",
          });
          return publicState(state);
        }
        const job = {
          id: state.nextId++,
          url,
          attempts: 0,
          nextAt: deps.now(),
        };
        state.queue.push(job);
        await deps.write(state);
        await deps.schedule();
        await attempt(state, job, html);
        return publicState(state);
      }),
    resume: () =>
      serial(async () => {
        await deps.schedule();
        const state = decode(await deps.read());
        if (state.token) {
          // One request per wake leaves room inside the service worker lifetime;
          // the repeating alarm resumes the next durable entry after termination.
          const job = state.queue.find((queued) => queued.nextAt <= deps.now());
          if (job) await attempt(state, job);
          else await deps.show(state.feedback);
        } else await deps.show(state.feedback);
        return publicState(state);
      }),
  };
}
