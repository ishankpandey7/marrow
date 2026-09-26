import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { BacklogEntry } from "@/lib/backlog";

const actions = vi.hoisted(() => ({ notNow: vi.fn() }));
vi.mock("@/components/backlog-actions", () => ({ notNow: actions.notNow }));
import { BacklogStrip } from "@/components/backlog-strip";

const entry: BacklogEntry = {
  id: "12345678-1234-1234-1234-123456789abc",
  title: "An old article",
  site: "Example",
  why: "Saved 3 weeks ago · 12 min · 40% read",
};
const second: BacklogEntry = {
  ...entry,
  id: "12345678-1234-1234-1234-123456789def",
  title: '<img src=x onerror="alert(1)">',
};

let root: Root;
let container: HTMLElement;

async function render(entries: BacklogEntry[]) {
  await act(async () => {
    root.render(createElement(BacklogStrip, { entries }));
  });
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}
function notNowButtons() {
  return [...container.querySelectorAll("button")].filter(
    (element) => element.textContent === "Not now",
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { window: browser } = parseHTML(
    "<html><body><div id='root'></div></body></html>",
  );
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", browser.document);
  vi.stubGlobal("HTMLElement", browser.HTMLElement);
  vi.stubGlobal("Node", browser.Node);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.getElementById("root")!;
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  vi.unstubAllGlobals();
});

describe("the backlog strip", () => {
  it("renders nothing when no item qualifies", async () => {
    await render([]);
    expect(container.innerHTML).toBe("");
  });

  it("links each item into the reader, says why it is there, and states the rule", async () => {
    await render([entry, second]);
    const links = [...container.querySelectorAll("li a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/read/${entry.id}`,
      `/read/${second.id}`,
    ]);
    expect(container.querySelector("li")?.textContent).toContain(
      "Example · Saved 3 weeks ago · 12 min · 40% read",
    );
    expect(container.querySelector("section p")?.textContent).toBe(
      "Articles you saved over 14 days ago and haven't finished. A new pick every Monday.",
    );
  });

  it("shows a hostile title as text", async () => {
    await render([second]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("li a")?.textContent).toBe(second.title);
  });

  it("names the item on each Not now button", async () => {
    await render([entry]);
    expect(notNowButtons()[0].getAttribute("aria-label")).toBe(
      "Not now: An old article",
    );
  });

  it("puts off the item it belongs to", async () => {
    actions.notNow.mockResolvedValueOnce({ ok: true, message: null });
    await render([entry, second]);
    await click(notNowButtons()[1]);
    expect(actions.notNow).toHaveBeenCalledWith(second.id);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("shows a refusal, and a lost connection, as an alert", async () => {
    await render([entry]);
    actions.notNow.mockResolvedValueOnce({
      ok: false,
      message: "That item is no longer in your library.",
    });
    await click(notNowButtons()[0]);
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "That item is no longer in your library.",
    );
    actions.notNow.mockRejectedValueOnce(new Error("offline"));
    await click(notNowButtons()[0]);
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Connection lost",
    );
  });
});
