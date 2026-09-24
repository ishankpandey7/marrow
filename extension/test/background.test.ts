import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionApi } from "../browser";
import type { Dependencies } from "../core";
import { readFileSync } from "node:fs";

const controller = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue({}),
  resume: vi.fn().mockResolvedValue({}),
  status: vi.fn().mockResolvedValue({ configured: true, queued: 0 }),
  configure: vi.fn().mockResolvedValue({}),
}));
const createController = vi.hoisted(() => vi.fn());
vi.mock("../core.js", () => ({ createSaveController: createController }));

function event<T extends (...args: never[]) => unknown>() {
  const listeners: T[] = [];
  return {
    listeners,
    addListener: (listener: T) => {
      listeners.push(listener);
    },
  };
}

function browserFixture() {
  return {
    action: {
      onClicked: event<(tab: { id?: number; url?: string }) => void>(),
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ saveState: { version: 1 } }),
        set: vi.fn().mockResolvedValue(undefined),
        setAccessLevel: vi.fn().mockResolvedValue(undefined),
      },
    },
    alarms: {
      get: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      onAlarm: event<(alarm: { name: string }) => void>(),
    },
    tabs: {
      query: vi
        .fn()
        .mockResolvedValue([{ id: 7, url: "https://example.com/active" }]),
    },
    scripting: {
      executeScript: vi
        .fn()
        .mockImplementation(
          async ({ target }: { target: { tabId: number } }) => [
            {
              result: {
                url:
                  target.tabId === 3
                    ? "https://example.com/current#section"
                    : "https://example.com/active",
                html: "<html><body>page</body></html>",
              },
            },
          ],
        ),
    },
    contextMenus: {
      removeAll: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockReturnValue("save-link"),
      onClicked:
        event<
          (info: { menuItemId: string | number; linkUrl?: string }) => void
        >(),
    },
    commands: { onCommand: event<(command: string) => void>() },
    runtime: {
      id: "test-extension-id",
      getURL: (name: string) => `chrome-extension://test-extension-id/${name}`,
      onInstalled: event<() => void>(),
      onStartup: event<() => void>(),
      onMessage:
        event<
          Parameters<ExtensionApi["runtime"]["onMessage"]["addListener"]>[0]
        >(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  } satisfies ExtensionApi;
}

describe("browser event wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    createController.mockReturnValue(controller);
  });

  async function load(namespace: "chrome" | "browser" = "chrome") {
    const api = browserFixture();
    vi.stubGlobal(namespace, api);
    await import("../background");
    return api;
  }

  it.each(["chrome", "browser"] as const)(
    "handles a toolbar click in the %s namespace without opening a popup",
    async (namespace) => {
      const api = await load(namespace);
      api.action.onClicked.listeners[0]({
        id: 3,
        url: "https://example.com/current",
      });
      await vi.waitFor(() =>
        expect(controller.save).toHaveBeenCalledWith(
          "https://example.com/current",
          "<html><body>page</body></html>",
        ),
      );
      // The clicked tab only; activeTab grants nothing wider.
      expect(api.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({ target: { tabId: 3 } }),
      );
    },
  );

  it("drops the page when the tab moved on between the click and the read", async () => {
    const api = await load();
    api.scripting.executeScript.mockResolvedValue([
      { result: { url: "https://example.com/other", html: "<p>other</p>" } },
    ]);
    api.action.onClicked.listeners[0]({
      id: 5,
      url: "https://example.com/clicked",
    });
    await vi.waitFor(() =>
      expect(controller.save).toHaveBeenCalledWith(
        "https://example.com/clicked",
        undefined,
      ),
    );
  });

  it("still saves the link when the browser will not let it read the page", async () => {
    const api = await load();
    api.scripting.executeScript.mockRejectedValue(
      new Error("Cannot access a chrome:// URL"),
    );
    api.action.onClicked.listeners[0]({
      id: 4,
      url: "https://chromewebstore.google.com/detail/x",
    });
    await vi.waitFor(() =>
      expect(controller.save).toHaveBeenCalledWith(
        "https://chromewebstore.google.com/detail/x",
        undefined,
      ),
    );
  });

  it("passes the context-menu link instead of the containing page", async () => {
    const api = await load();
    api.contextMenus.onClicked.listeners[0]({
      menuItemId: "save-link",
      linkUrl: "https://example.com/link",
    });
    expect(controller.save).toHaveBeenCalledWith("https://example.com/link");
    // A link that was never opened has no page to send.
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
    api.runtime.onInstalled.listeners[0]();
    await Promise.resolve();
    expect(api.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ contexts: ["link"] }),
    );
  });

  it("queries the user-invoked active tab for the rebindable command", async () => {
    const api = await load();
    api.commands.onCommand.listeners[0]("save-current-tab");
    await Promise.resolve();
    expect(api.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    await vi.waitFor(() =>
      expect(controller.save).toHaveBeenCalledWith(
        "https://example.com/active",
        "<html><body>page</body></html>",
      ),
    );
  });

  it("restores alarms on worker start and consumes named retry alarms", async () => {
    const api = await load();
    expect(controller.resume).toHaveBeenCalledTimes(1);
    api.alarms.onAlarm.listeners[0]({ name: "retry-saves" });
    expect(controller.resume).toHaveBeenCalledTimes(2);
    api.alarms.onAlarm.listeners[0]({ name: "unrelated" });
    expect(controller.resume).toHaveBeenCalledTimes(2);
    const dependencies = createController.mock.calls[0][0] as Dependencies;
    await dependencies.schedule();
    expect(api.alarms.create).toHaveBeenCalledWith("retry-saves", {
      delayInMinutes: 1,
      periodInMinutes: 1,
    });
  });

  it("uses extension local storage and restricts it to trusted Chrome contexts", async () => {
    const api = await load();
    const dependencies = createController.mock.calls[0][0] as Dependencies;
    expect(await dependencies.read()).toEqual({ version: 1 });
    expect(api.storage.local.get).toHaveBeenCalledWith("saveState");
    expect(api.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  });

  it("accepts options messages only from the exact internal options document", async () => {
    const api = await load();
    const listener = api.runtime.onMessage.listeners[0];
    const respond = vi.fn();
    const message = { type: "status" };
    expect(
      listener(
        message,
        { id: "other-extension", url: api.runtime.getURL("popup/index.html") },
        respond,
      ),
    ).toBeUndefined();
    expect(
      listener(
        message,
        { id: api.runtime.id, url: "https://example.com/" },
        respond,
      ),
    ).toBeUndefined();
    expect(controller.status).not.toHaveBeenCalled();
    expect(
      listener(
        message,
        { id: api.runtime.id, url: api.runtime.getURL("popup/index.html") },
        respond,
      ),
    ).toBe(true);
    await Promise.resolve();
    expect(respond).toHaveBeenCalledWith({
      ok: true,
      state: { configured: true, queued: 0 },
    });
  });

  it("requests only the permissions needed by the checklist", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    );
    expect(manifest.permissions).toEqual([
      "activeTab",
      "scripting",
      "storage",
      "contextMenus",
      "alarms",
    ]);
    expect(manifest.host_permissions).toEqual([
      "https://marrow-bice.vercel.app/*",
    ]);
    expect(manifest.action).not.toHaveProperty("default_popup");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest.commands["save-current-tab"].suggested_key.default).toBe(
      "Alt+Shift+S",
    );
  });
});
