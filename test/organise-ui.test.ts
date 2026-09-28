import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  parseFilters,
  type LibrarySnapshot,
  type MutationResult,
  type OrganisedItem,
} from "@/lib/tags";

const actions = vi.hoisted(() => ({
  mutate: vi.fn(),
  load: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/(app)/actions", () => ({
  mutateLibrary: actions.mutate,
  loadLibrary: actions.load,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: actions.push, refresh: actions.refresh }),
}));
vi.mock("@/components/save-form", () => ({ SaveForm: () => null }));
import { OrganiseInbox } from "@/components/filter-bar";

const item: OrganisedItem = {
  id: "12345678-1234-1234-1234-123456789abc",
  url: "https://example.com/first",
  canonical_url: "https://example.com/first",
  title: "First article",
  site_name: "Example",
  excerpt: null,
  reading_minutes: 3,
  status: "ready",
  fail_reason: null,
  created_at: "2026-09-09T10:00:00Z",
  favourite: false,
  archived_at: null,
  deleted_at: null,
  read_at: null,
  item_tags: [],
};
const second = {
  ...item,
  id: "12345678-1234-1234-1234-123456789def",
  title: "Second article",
  created_at: "2026-09-09T09:00:00Z",
};
const initial: LibrarySnapshot = {
  loadedAt: 1,
  items: [item, second],
  tags: [],
  hasMore: false,
};
let root: Root;
let container: HTMLElement;

function deferred() {
  let finish: (result: MutationResult) => void = () => {
    throw new Error("Promise not initialized");
  };
  const promise = new Promise<MutationResult>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function row(id: string) {
  return container.querySelector(`[data-row="${id}"]`);
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}
async function key(keyValue: string) {
  await act(async () => {
    const event = new window.Event("keydown", { bubbles: true });
    Object.defineProperty(event, "key", { value: keyValue });
    (
      container.querySelector("[data-row][tabindex='0']") ??
      container.firstElementChild
    )?.dispatchEvent(event);
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
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  container = document.getElementById("root")!;
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(OrganiseInbox, { initial, filters: parseFilters({}) }),
    );
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  vi.unstubAllGlobals();
});

describe("rendered triage reconciliation with offline action responses", () => {
  it("preserves keyboard selection when reconciliation refreshes the route", async () => {
    await key("j");
    await key("x");
    await act(async () => {
      root.render(
        createElement(OrganiseInbox, {
          initial: { ...initial, loadedAt: 2 },
          filters: parseFilters({}),
        }),
      );
    });
    actions.mutate.mockResolvedValueOnce({
      ok: true,
      snapshot: { ...initial, loadedAt: 3, items: [item] },
      message: null,
    });
    await key("e");
    expect(actions.mutate.mock.calls[0][0]).toEqual({
      kind: "archive",
      ids: [second.id],
      value: true,
    });
  });
  it("cancels unsent changes and their undo notices after an uncertain response", async () => {
    const write = deferred();
    actions.mutate.mockReturnValueOnce(write.promise);
    await click(button("Delete"));
    await click(button("Delete"));
    expect(
      [...container.querySelectorAll("button")].filter(
        (element) => element.textContent === "Undo delete",
      ),
    ).toHaveLength(2);
    await act(async () => {
      write.finish({
        ok: false,
        snapshot: null,
        message: "Could not confirm the deletion.",
      });
    });
    expect(actions.mutate).toHaveBeenCalledTimes(1);
    expect(
      [...container.querySelectorAll("button")].filter(
        (element) => element.textContent === "Undo delete",
      ),
    ).toHaveLength(1);
    expect(row(second.id)).not.toBeNull();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "cancelled before being sent",
    );
  });
  it("does not let an older refresh overwrite a confirmed mutation", async () => {
    actions.mutate.mockResolvedValueOnce({
      ok: true,
      snapshot: { ...initial, loadedAt: 3, items: [second] },
      message: null,
    });
    await click(button("Archive"));
    await act(async () => {
      root.render(
        createElement(OrganiseInbox, {
          initial: { ...initial, loadedAt: 2 },
          filters: parseFilters({}),
        }),
      );
    });
    expect(row(item.id)).toBeNull();
  });
  it("archives a whole page with two keys", async () => {
    const write = deferred();
    actions.mutate.mockReturnValueOnce(write.promise);
    await key("a");
    await key("e");
    expect(actions.mutate.mock.calls[0][0]).toEqual({
      kind: "archive",
      ids: [item.id, second.id],
      value: true,
    });
    expect(container.querySelectorAll("[data-row]")).toHaveLength(0);
    await act(async () => {
      write.finish({
        ok: true,
        snapshot: { ...initial, items: [] },
        message: null,
      });
    });
  });
  it("restores a rejected archive and shows an error", async () => {
    const write = deferred();
    actions.mutate.mockReturnValueOnce(write.promise);
    await click(button("Archive"));
    expect(row(item.id)).toBeNull();
    await act(async () => {
      write.finish({
        ok: false,
        snapshot: initial,
        message: "Archive rejected. Saved state restored.",
      });
    });
    expect(row(item.id)).not.toBeNull();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Archive rejected",
    );
  });
  it("rapid archive shortcuts move to the next row while writes remain serialized", async () => {
    const firstWrite = deferred();
    const secondWrite = deferred();
    actions.mutate
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    await key("e");
    await key("e");
    expect(row(item.id)).toBeNull();
    expect(row(second.id)).toBeNull();
    expect(actions.mutate).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstWrite.finish({
        ok: false,
        snapshot: initial,
        message: "First archive rejected.",
      });
    });
    expect(actions.mutate).toHaveBeenCalledTimes(2);
    expect(row(item.id)).not.toBeNull();
    expect(row(second.id)).toBeNull();
    expect(actions.mutate.mock.calls[1][0]).toEqual({
      kind: "archive",
      ids: [second.id],
      value: true,
    });
    await act(async () => {
      secondWrite.finish({
        ok: true,
        snapshot: { ...initial, items: [item] },
        message: null,
      });
    });
    expect(row(item.id)).not.toBeNull();
    expect(row(second.id)).toBeNull();
  });
  it("reconciles favourite to the returned value, even when it differs from optimism", async () => {
    const write = deferred();
    actions.mutate.mockReturnValueOnce(write.promise);
    await click(button("☆ Favourite"));
    expect(button("★ Favourite").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      write.finish({ ok: true, snapshot: initial, message: null });
    });
    expect(button("☆ Favourite").getAttribute("aria-pressed")).toBe("false");
  });
  it("keeps an immediate undo visible through the pending delete response", async () => {
    const deletion = deferred();
    const restoration = deferred();
    actions.mutate
      .mockReturnValueOnce(deletion.promise)
      .mockReturnValueOnce(restoration.promise);
    await click(button("Delete"));
    expect(row(item.id)).toBeNull();
    await click(button("Undo delete"));
    expect(row(item.id)).not.toBeNull();
    await act(async () => {
      deletion.finish({
        ok: true,
        snapshot: { ...initial, items: [second] },
        message: null,
      });
    });
    expect(row(item.id)).not.toBeNull();
    await act(async () => {
      restoration.finish({
        ok: false,
        snapshot: { ...initial, items: [second] },
        message: "Undo rejected.",
      });
    });
    expect(row(item.id)).toBeNull();
    expect(button("Undo delete")).toBeDefined();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Undo rejected",
    );
  });
  it("puts the backlog slot above the list, out of reach of its shortcuts", async () => {
    await act(async () => {
      root.render(
        createElement(OrganiseInbox, {
          initial,
          filters: parseFilters({}),
          backlog: createElement("button", { id: "slot" }, "Not now"),
        }),
      );
    });
    const slot = container.querySelector("#slot");
    if (!slot) throw new Error("Missing slot");
    // Document order by index: linkedom's compareDocumentPosition is wrong
    // for some cases (see Notes from the field, Slice 11).
    const order = [...container.querySelectorAll("*")];
    const heading = container.querySelector("h1");
    if (!heading) throw new Error("Missing heading");
    expect(order.indexOf(slot)).toBeLessThan(order.indexOf(heading));
    for (const pressed of ["#", "e", "f"])
      await act(async () => {
        const event = new window.Event("keydown", { bubbles: true });
        Object.defineProperty(event, "key", { value: pressed });
        slot.dispatchEvent(event);
      });
    expect(actions.mutate).not.toHaveBeenCalled();
    expect(row(item.id)).not.toBeNull();
    // Page-wide shortcuts still work from the strip.
    const find = container.querySelector<HTMLInputElement>(
      "input[aria-label='Find on this page']",
    );
    if (!find) throw new Error("Missing find input");
    const focusFind = vi.spyOn(find, "focus");
    await act(async () => {
      const event = new window.Event("keydown", { bubbles: true });
      Object.defineProperty(event, "key", { value: "/" });
      slot.dispatchEvent(event);
    });
    expect(focusFind).toHaveBeenCalledTimes(1);
  });
  it("gives focus to the library heading when the strip's last item is put off", async () => {
    const withStrip = () =>
      createElement(OrganiseInbox, {
        initial,
        filters: parseFilters({}),
        backlog: createElement("button", { id: "slot" }, "Not now"),
      });
    await act(async () => {
      root.render(withStrip());
    });
    const heading = container.querySelector("h1");
    if (!heading) throw new Error("Missing heading");
    const focusHeading = vi.spyOn(heading, "focus");
    await act(async () => {
      root.render(withStrip());
    });
    expect(focusHeading).not.toHaveBeenCalled();
    await act(async () => {
      root.render(
        createElement(OrganiseInbox, { initial, filters: parseFilters({}) }),
      );
    });
    expect(focusHeading).toHaveBeenCalledTimes(1);
  });
  it("says a delete went to Trash, for how long, and links there", async () => {
    actions.mutate.mockReturnValueOnce(deferred().promise);
    expect(
      container.querySelector("a[href='/trash']")?.textContent?.trim(),
    ).toBe("Trash");
    expect(
      container.querySelector("a[href='/stats']")?.textContent?.trim(),
    ).toBe("Stats");
    await click(button("Delete"));
    const panel = button("Undo delete").closest("[aria-live]");
    expect(panel?.textContent).toContain("Moved 1 item to Trash");
    expect(panel?.textContent).toContain(
      "restore from Trash, which keeps items for 30 days.",
    );
    expect(panel?.querySelector("a[href='/trash']")).not.toBeNull();
  });
  it("clears an Undo that the server settled with a notice, and shows the notice", async () => {
    actions.mutate
      .mockResolvedValueOnce({
        ok: true,
        snapshot: { ...initial, items: [second] },
        message: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        snapshot: { ...initial, items: [second] },
        message: "That item was deleted forever and cannot come back.",
      });
    await click(button("Delete"));
    await click(button("Undo delete"));
    expect(
      [...container.querySelectorAll("button")].some(
        (element) => element.textContent === "Undo delete",
      ),
    ).toBe(false);
    expect(row(item.id)).toBeNull();
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "deleted forever",
    );
  });
  it("rolls back a transport failure and reloads before enabling more writes", async () => {
    actions.mutate.mockRejectedValueOnce(new Error("offline"));
    await click(button("Archive"));
    expect(row(item.id)).not.toBeNull();
    expect(button("Archive").disabled).toBe(true);
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "could not be confirmed",
    );
    actions.load.mockResolvedValueOnce({
      snapshot: { ...initial, items: [second] },
      signedOut: false,
      message: null,
    });
    await click(button("Reload saved state"));
    expect(row(item.id)).toBeNull();
    expect(button("Archive").disabled).toBe(false);
  });
  it("preserves URL filters when changing page", async () => {
    const filters = parseFilters({
      state: "favourites",
      read: "unread",
      page: "2",
    });
    await act(async () => {
      root.render(
        createElement(OrganiseInbox, {
          initial: { ...initial, items: [], hasMore: true },
          filters,
        }),
      );
    });
    await click(button("Next"));
    expect(actions.push).toHaveBeenCalledWith(
      "/inbox?state=favourites&read=unread&page=3",
    );
  });
});
