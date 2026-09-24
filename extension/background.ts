import {
  capturePage,
  extensionApi,
  showFeedback,
  type Tab,
} from "./browser.js";
import { APP_NAME, API_ORIGIN, RETRY_ALARM, STORAGE_KEY } from "./config.js";
import { createSaveController } from "./core.js";

const api = extensionApi();
const controller = createSaveController({
  now: Date.now,
  fetch: globalThis.fetch.bind(globalThis),
  read: async () => (await api.storage.local.get(STORAGE_KEY))[STORAGE_KEY],
  write: (state) => api.storage.local.set({ [STORAGE_KEY]: state }),
  show: (feedback) => showFeedback(api, feedback),
  endpoint: `${API_ORIGIN}/api/save`,
  schedule: async () => {
    if (!(await api.alarms.get(RETRY_ALARM))) {
      await api.alarms.create(RETRY_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
    }
  },
});

function run(work: Promise<unknown>) {
  void work
    .catch(() =>
      showFeedback(api, {
        status: "error",
        message:
          "Extension storage or browser access failed. Open Options, then retry.",
      }),
    )
    .catch(() => undefined);
}

async function installMenu() {
  await api.contextMenus.removeAll();
  api.contextMenus.create({
    id: "save-link",
    title: `Save link to ${APP_NAME}`,
    contexts: ["link"],
  });
}

// The open page goes with the save; a link from the context menu was never
// opened, so it is saved as a link and fetched by the server.
async function saveTab(tab: Tab | undefined) {
  return controller.save(tab?.url, await capturePage(api, tab));
}

api.action.onClicked.addListener((tab) => run(saveTab(tab)));
api.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "save-link") run(controller.save(info.linkUrl));
});
api.commands.onCommand.addListener((command) => {
  if (command === "save-current-tab") {
    run(
      api.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => saveTab(tab)),
    );
  }
});
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) run(controller.resume());
});
api.runtime.onInstalled.addListener(() => {
  run(installMenu());
  run(controller.resume());
});
api.runtime.onStartup.addListener(() => run(controller.resume()));
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== api.runtime.id ||
    sender.url !== api.runtime.getURL("popup/index.html") ||
    !message ||
    typeof message !== "object" ||
    !("type" in message)
  )
    return;
  let work: Promise<unknown>;
  if (message.type === "status") work = controller.status();
  else if (
    message.type === "configure" &&
    "token" in message &&
    (typeof message.token === "string" || message.token === null)
  )
    work = controller.configure(message.token);
  else if (message.type === "retry") work = controller.resume();
  else return;
  void work
    .then((state) => respond({ ok: true, state }))
    .catch(() =>
      respond({
        ok: false,
        message:
          "Could not update the extension. Check the token and try again.",
      }),
    );
  return true;
});

// Firefox has no access-level API; no content scripts or external messaging
// are registered, and options never receives the stored bearer credential.
if (api.storage.local.setAccessLevel)
  run(api.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
run(controller.resume());
