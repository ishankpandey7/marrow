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
