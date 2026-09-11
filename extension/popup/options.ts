import { extensionApi } from "../browser.js";
import { APP_NAME, API_ORIGIN } from "../config.js";
import type { PublicState } from "../core.js";

function element<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const value = document.getElementById(id);
  if (!(value instanceof type))
    throw new Error(`Missing options control: ${id}`);
  return value;
}

const api = extensionApi();
const token = element("token", HTMLInputElement);
const status = element("status", HTMLParagraphElement);
const connection = element("connection", HTMLParagraphElement);
const buttons = Array.from(document.querySelectorAll("button"));
document.title = `${APP_NAME} extension options`;
element("heading", HTMLHeadingElement).textContent = `Connect ${APP_NAME}`;
for (const id of ["settings", "revoke"])
  element(id, HTMLAnchorElement).href = `${API_ORIGIN}/settings/extension`;

function isState(value: unknown): value is PublicState {
  return (
    typeof value === "object" &&
    value !== null &&
    "configured" in value &&
    typeof value.configured === "boolean" &&
    "queued" in value &&
    typeof value.queued === "number" &&
    "feedback" in value &&
    typeof value.feedback === "object" &&
    value.feedback !== null &&
    "message" in value.feedback &&
    typeof value.feedback.message === "string"
  );
}

async function send(message: object) {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    const result = await api.runtime.sendMessage(message);
    if (
      result &&
      typeof result === "object" &&
      "ok" in result &&
      !result.ok &&
      "message" in result &&
      typeof result.message === "string"
    ) {
      status.textContent = result.message;
      return;
    }
    if (
      !result ||
      typeof result !== "object" ||
      !("ok" in result) ||
      !result.ok ||
      !("state" in result) ||
      !isState(result.state)
    ) {
      throw new Error(
        "The extension could not update its settings. Check the token and try again.",
      );
    }
    connection.textContent = `${result.state.configured ? "Connected" : "Not connected"} · ${result.state.queued} pending saves`;
    status.textContent = result.state.feedback.message;
    token.value = "";
  } catch {
    status.textContent =
      "Could not reach the extension. Reload this page and check that it is enabled.";
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

element("token-form", HTMLFormElement).addEventListener("submit", (event) => {
  event.preventDefault();
  void send({ type: "configure", token: token.value.trim() });
});
element("disconnect", HTMLButtonElement).addEventListener("click", () => {
  void send({ type: "configure", token: null });
});
element("retry", HTMLButtonElement).addEventListener("click", () => {
  void send({ type: "retry" });
});
void send({ type: "status" });
