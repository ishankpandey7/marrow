import type { Feedback } from "./core.js";
import { APP_NAME } from "./config.js";

export interface Tab {
  id?: number;
  url?: string;
}
interface ExtensionEvent<T extends (...args: never[]) => unknown> {
  addListener(listener: T): void;
}

export interface ExtensionApi {
  action: {
    onClicked: ExtensionEvent<(tab: Tab) => void>;
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    setTitle(details: { title: string }): Promise<void>;
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
      setAccessLevel?(details: {
        accessLevel: "TRUSTED_CONTEXTS";
      }): Promise<void>;
    };
  };
  alarms: {
    get(name: string): Promise<{ name: string } | undefined>;
    create(
      name: string,
      info: { delayInMinutes: number; periodInMinutes: number },
    ): Promise<void> | void;
    onAlarm: ExtensionEvent<(alarm: { name: string }) => void>;
  };
  tabs: { query(query: { active: true; currentWindow: true }): Promise<Tab[]> };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      func: () => { url: string; html: string };
    }): Promise<{ result?: unknown }[]>;
  };
  contextMenus: {
    removeAll(): Promise<void>;
    create(details: {
      id: string;
      title: string;
      contexts: ["link"];
    }): string | number;
    onClicked: ExtensionEvent<
      (
        info: { menuItemId: string | number; linkUrl?: string },
        tab?: Tab,
      ) => void
    >;
  };
  commands: { onCommand: ExtensionEvent<(command: string) => void> };
  runtime: {
    id: string;
    getURL(path: string): string;
    onInstalled: ExtensionEvent<() => void>;
    onStartup: ExtensionEvent<() => void>;
    onMessage: ExtensionEvent<
      (
        message: unknown,
        sender: { id?: string; url?: string },
        respond: (response: unknown) => void,
      ) => boolean | undefined
    >;
    sendMessage(message: unknown): Promise<unknown>;
  };
}

export function extensionApi(): ExtensionApi {
  const environment = globalThis as typeof globalThis & {
    browser?: ExtensionApi;
    chrome?: ExtensionApi;
  };
  const api = environment.browser ?? environment.chrome;
  if (!api) throw new Error("Open this page through the installed extension.");
  return api;
}

/**
 * The open tab's markup, read at the moment of the click (Slice 10).
 *
 * Publishers that refuse our server (Akamai, Cloudflare bot rules) have
 * already served this page to the reader, so sending it is how those saves
 * work at all. activeTab grants this tab only, only for this gesture. Null
 * when the browser forbids it — Web Store, browser pages, the PDF viewer —
 * and the save then goes ahead as a link.
 *
 * The page reports its own address alongside its markup, and the markup is
 * used only if that address is the one being saved. The worker may start
 * after the click, and a single-page app can change route in between; a URL
 * paired with another page's article would be stored for good, because a
 * ready item keeps its body.
 */
export async function capturePage(
  api: ExtensionApi,
  tab: Tab | undefined,
): Promise<string | undefined> {
  if (tab?.id === undefined || !tab.url) return undefined;
  try {
    const [frame] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        url: location.href,
        html: document.documentElement.outerHTML,
      }),
    });
    const page = frame?.result as { url?: unknown; html?: unknown } | undefined;
    if (typeof page?.url !== "string" || typeof page.html !== "string")
      return undefined;
    return samePage(page.url, tab.url) ? page.html : undefined;
  } catch {
    return undefined;
  }
}

/** Same document, ignoring only the fragment, which never changes the page. */
function samePage(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = "";
    right.hash = "";
    return left.href === right.href;
  } catch {
    return false;
  }
}

export async function showFeedback(
  api: ExtensionApi,
  feedback: Feedback,
): Promise<void> {
  const display: Record<Feedback["status"], { text: string; color: string }> = {
    idle: { text: "", color: "#31483B" },
    saving: { text: "…", color: "#586D89" },
    saved: { text: "OK", color: "#236342" },
    already: { text: "HAVE", color: "#236342" },
    queued: { text: "Q", color: "#916312" },
    error: { text: "!", color: "#A73030" },
    auth: { text: "AUTH", color: "#A73030" },
  };
  await Promise.all([
    api.action.setBadgeText({ text: display[feedback.status].text }),
    api.action.setBadgeBackgroundColor({
      color: display[feedback.status].color,
    }),
    api.action.setTitle({ title: `${APP_NAME}: ${feedback.message}` }),
  ]);
}
