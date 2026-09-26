import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { TrashEntry } from "@/lib/trash";

const actions = vi.hoisted(() => ({
  restore: vi.fn(),
  forever: vi.fn(),
  empty: vi.fn(),
}));
vi.mock("@/app/(app)/trash/actions", () => ({
  restoreFromTrash: actions.restore,
  deleteForever: actions.forever,
  emptyTrash: actions.empty,
}));
import { TrashList } from "@/components/trash-list";

const entry: TrashEntry = {
  id: "12345678-1234-1234-1234-123456789abc",
  url: "https://example.com/first",
  title: "First article",
  site: "Example",
  deleted: "Deleted 2 days ago",
  kept: "Kept for 27 more days",
};
const second: TrashEntry = {
  ...entry,
  id: "12345678-1234-1234-1234-123456789def",
  title: "Second article",
};
const cutoff = "2026-09-26T08:15:02.123456+00:00";

let root: Root;
let container: HTMLElement;

function buttons(label: string) {
  return [...container.querySelectorAll("button")].filter(
    (element) => element.textContent === label,
  );
}
function button(label: string) {
  const [result] = buttons(label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(element: Element, detail = 1) {
  await act(async () => {
    const event = new window.Event("click", { bubbles: true });
    // A mouse click's count within the double-click interval.
    Object.defineProperty(event, "detail", { value: detail });
    element.dispatchEvent(event);
  });
}
// linkedom has no modal dialogs; stand in for the browser's.
function modalDialog() {
  const dialog = container.querySelector("dialog");
  if (!dialog) throw new Error("Missing dialog");
  const shown = vi.fn();
  Object.assign(dialog, {
    showModal: () => {
      shown();
      dialog.setAttribute("open", "");
    },
    close: () => dialog.removeAttribute("open"),
  });
  Object.defineProperty(dialog, "open", {
    get: () => dialog.hasAttribute("open"),
  });
  return { dialog, shown };
}
async function render(props: Partial<Parameters<typeof TrashList>[0]> = {}) {
  await act(async () => {
    root.render(
      createElement(TrashList, {
        entries: [entry, second],
        page: 1,
        hasMore: false,
        total: 2,
        cutoff,
        ...props,
      }),
    );
  });
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
  await render();
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  vi.unstubAllGlobals();
});

describe("the Trash list", () => {
  it("shows each row's time in words and never links into the reader", async () => {
    const rows = container.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("First article");
    expect(rows[0].textContent).toContain(
      "Example · Deleted 2 days ago · Kept for 27 more days",
    );
    expect(container.querySelector("a[href^='/read']")).toBeNull();
    const original = rows[0].querySelector("a");
    expect(original?.getAttribute("href")).toBe(entry.url);
    expect(original?.getAttribute("target")).toBe("_blank");
    expect(original?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(container.textContent).toContain(
      "Deleted items wait here for 30 days",
    );
  });

  it("restores one row and shows what the server said", async () => {
    actions.restore.mockResolvedValueOnce({
      ok: true,
      message: "Restored. It is back in your library, where it was before.",
    });
    await click(buttons("Restore")[1]);
    expect(actions.restore).toHaveBeenCalledWith([second.id]);
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Restored. It is back in your library, where it was before.",
    );
  });

  it("asks before deleting forever, says what goes, and can be cancelled", async () => {
    await click(buttons("Delete forever")[0]);
    expect(actions.forever).not.toHaveBeenCalled();
    expect(buttons("Yes, delete forever")).toHaveLength(1);
    expect(container.querySelectorAll("li")[0].textContent).toContain(
      "highlights and notes",
    );
    await click(button("Cancel"));
    expect(buttons("Yes, delete forever")).toHaveLength(0);
    expect(buttons("Delete forever")).toHaveLength(2);
    expect(actions.forever).not.toHaveBeenCalled();
  });

  it("deletes forever on the second press, for that row only", async () => {
    actions.forever.mockResolvedValueOnce({
      ok: true,
      message: "Deleted forever.",
    });
    await click(buttons("Delete forever")[0]);
    await click(button("Yes, delete forever"));
    expect(actions.forever).toHaveBeenCalledTimes(1);
    expect(actions.forever).toHaveBeenCalledWith([entry.id]);
    expect(container.querySelector("[role='status']")?.textContent).toBe(
      "Deleted forever.",
    );
  });

  it("shows a refusal as an alert", async () => {
    actions.restore.mockResolvedValueOnce({
      ok: false,
      message: "Could not restore that. Try again.",
    });
    await click(buttons("Restore")[0]);
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "Could not restore that. Try again.",
    );
  });

  it("refuses the second click of a double-click as a confirmation", async () => {
    await click(buttons("Delete forever")[0], 1);
    await click(button("Yes, delete forever"), 2);
    expect(actions.forever).not.toHaveBeenCalled();
    expect(buttons("Yes, delete forever")).toHaveLength(1);
    actions.forever.mockResolvedValueOnce({ ok: true, message: "Deleted." });
    await click(button("Yes, delete forever"), 1);
    expect(actions.forever).toHaveBeenCalledWith([entry.id]);
  });

  it("confirms from the keyboard, but not with a held Enter", async () => {
    await click(buttons("Delete forever")[0], 0);
    const confirm = button("Yes, delete forever");
    let repeated: Event | undefined;
    await act(async () => {
      repeated = new window.Event("keydown", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(repeated, "key", { value: "Enter" });
      Object.defineProperty(repeated, "repeat", { value: true });
      confirm.dispatchEvent(repeated);
    });
    expect(repeated?.defaultPrevented).toBe(true);
    actions.forever.mockResolvedValueOnce({ ok: true, message: "Deleted." });
    await click(confirm, 0);
    expect(actions.forever).toHaveBeenCalledWith([entry.id]);
  });

  it("ties the warning to the confirming button for screen readers", async () => {
    await click(buttons("Delete forever")[0]);
    const described = button("Yes, delete forever").getAttribute(
      "aria-describedby",
    );
    expect(described).toBe(`warning-${entry.id}`);
    expect(
      container.querySelector(`[id='warning-${entry.id}']`)?.textContent,
    ).toContain("can't be undone");
    await click(button("Cancel"));
    expect(
      buttons("Delete forever")[0].getAttribute("aria-describedby"),
    ).toBeNull();
  });

  it("says the connection was lost when an action throws", async () => {
    actions.forever.mockRejectedValueOnce(new Error("offline"));
    await click(buttons("Delete forever")[0]);
    await click(button("Yes, delete forever"));
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Connection lost",
    );
  });
});

describe("Empty trash", () => {
  it("states the whole trash's count and sends back the cutoff it was shown", async () => {
    await render({ total: 37 });
    const { dialog, shown } = modalDialog();
    await click(button("Empty trash"));
    expect(shown).toHaveBeenCalledTimes(1);
    expect(dialog.textContent).toContain("37 items will be deleted forever");
    expect(dialog.textContent).toContain(
      "Anything deleted after this page loaded stays in Trash.",
    );
    expect(actions.empty).not.toHaveBeenCalled();
    actions.empty.mockResolvedValueOnce({
      ok: true,
      message: "Deleted 37 items forever.",
    });
    await click(button("Delete 37 items forever"));
    expect(actions.empty).toHaveBeenCalledWith(cutoff);
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("opens with Cancel focused, not the destructive button", async () => {
    const { dialog } = modalDialog();
    const keep = [...dialog.querySelectorAll("button")].find(
      (element) => element.textContent === "Cancel",
    );
    if (!keep) throw new Error("Missing Cancel");
    const focus = vi.spyOn(keep, "focus");
    await click(button("Empty trash"));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("closes on the backdrop but not on a click inside its box", async () => {
    const { dialog } = modalDialog();
    await click(button("Empty trash"));
    // In a browser a click in the dialog's own padding also targets the
    // dialog, so the padding has to live on a wrapper that holds everything.
    expect(dialog.className).toContain("p-0");
    expect(dialog.children).toHaveLength(1);
    const box = dialog.firstElementChild;
    if (!box) throw new Error("Missing dialog content");
    expect(box.className).toContain("p-5");
    await click(box);
    expect(dialog.hasAttribute("open")).toBe(true);
    // A click on the backdrop of a modal dialog targets the dialog itself.
    await click(dialog);
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(actions.empty).not.toHaveBeenCalled();
  });

  it("is disabled when there is nothing in the trash", async () => {
    await render({ entries: [], total: 0, cutoff: null });
    expect(button("Empty trash").disabled).toBe(true);
    expect(container.textContent).toContain("Trash is empty.");
  });
});

describe("paging", () => {
  it("links the neighbouring pages", async () => {
    await render({ page: 2, hasMore: true });
    const links = [...container.querySelectorAll("nav a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(links).toEqual(["/trash", "/trash?page=3"]);
  });

  it("offers the first page when a later one has emptied", async () => {
    await render({ entries: [], page: 3, total: 4 });
    expect(container.textContent).toContain("Nothing on this page.");
    expect(container.querySelector("a[href='/trash']")?.textContent).toBe(
      "Go to the first page",
    );
  });
});
