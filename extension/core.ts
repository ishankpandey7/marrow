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

  async function attempt(state: SaveState, job: QueuedSave) {
    if (!state.token) return;
    job.attempts += 1;
    // Persist before sending. A worker may disappear after the server commits;
    // replay then deliberately uses the API's atomic re-save semantics.
    job.nextAt = deps.now() + RETRY_DELAY;
    await publish(state, { status: "saving", message: "Saving…" });
    let response: Response;
    try {
      response = await deps.fetch(deps.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: job.url }),
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(15_000),
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
    save: (url: string | undefined) =>
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
        await attempt(state, job);
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
