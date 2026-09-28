"use client";

import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { loadLibrary, mutateLibrary } from "@/app/(app)/actions";
import { SaveForm } from "@/components/save-form";
import { TagInput } from "@/components/tag-input";
import { PURGE_AFTER_DAYS } from "@/lib/constants";
import {
  applyOptimistic,
  filterUrl,
  matchesFilters,
  normalizeTag,
  rangeSelection,
  replayPending,
  type Filters,
  type LibrarySnapshot,
  type Mutation,
  type MutationResult,
  type Tag,
} from "@/lib/tags";

// Shortcuts that act on the page rather than on the selected rows.
const PAGE_WIDE_KEYS = ["?", "/", "Escape"];

const buttonClass =
  "rounded-md border border-edge px-3 py-2 text-sm hover:bg-ground-raised disabled:opacity-40";

export function FilterBar({
  filters,
  tags,
  disabled,
}: {
  filters: Filters;
  tags: Tag[];
  disabled: boolean;
}) {
  const router = useRouter();
  function change(patch: Partial<Filters>) {
    router.push(filterUrl({ ...filters, ...patch, page: 1 }), {
      scroll: false,
    });
  }
  return (
    <fieldset
      disabled={disabled}
      className="flex flex-wrap gap-3 disabled:opacity-50"
    >
      <legend className="sr-only">Filter library</legend>
      <label className="text-sm">
        State
        <select
          aria-label="State"
          value={filters.state}
          onChange={(e) =>
            change({ state: e.target.value as Filters["state"] })
          }
          className={`${buttonClass} ml-2 bg-ground`}
        >
          <option value="inbox">Inbox</option>
          <option value="archive">Archive</option>
          <option value="favourites">Favourites</option>
        </select>
      </label>
      <label className="text-sm">
        Read status
        <select
          aria-label="Read status"
          value={filters.read}
          onChange={(e) => change({ read: e.target.value as Filters["read"] })}
          className={`${buttonClass} ml-2 bg-ground`}
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </label>
      <label className="text-sm">
        Tag
        <select
          aria-label="Tag filter"
          value={filters.tag}
          onChange={(e) => change({ tag: e.target.value })}
          className={`${buttonClass} ml-2 max-w-48 bg-ground`}
        >
          <option value="">All tags</option>
          {filters.tag && !tags.some((tag) => tag.id === filters.tag) && (
            <option value={filters.tag}>Unavailable tag</option>
          )}
          {tags
            .filter((tag) => !tag.id.startsWith("pending:"))
            .map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
        </select>
      </label>
    </fieldset>
  );
}

interface Pending {
  id: number;
  mutation: Mutation;
  restoreItems?: LibrarySnapshot["items"];
}
interface Undo {
  id: number;
  ids: string[];
  items: LibrarySnapshot["items"];
}

export function OrganiseInbox({
  initial,
  filters,
  backlog,
}: {
  initial: LibrarySnapshot;
  filters: Filters;
  backlog?: ReactNode;
}) {
  const router = useRouter();
  const [previous, setPrevious] = useState(initial);
  const [previousFilters, setPreviousFilters] = useState(filterUrl(filters));
  const [confirmed, setConfirmed] = useState(initial);
  const [pending, setPending] = useState<Pending[]>([]);
  const queue = useRef<Pending[]>([]);
  const running = useRef(false);
  const sequence = useRef(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [uncertain, setUncertain] = useState(false);
  const [undo, setUndo] = useState<Undo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [tagging, setTagging] = useState<string[] | null>(null);
  const [help, setHelp] = useState(false);
  const [rename, setRename] = useState<Tag | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [find, setFind] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const hasBacklog = Boolean(backlog);
  const hadBacklog = useRef(hasBacklog);
  const filterKey = filterUrl(filters);
  const currentFilterKey = useRef(filterKey);
  useEffect(() => {
    currentFilterKey.current = filterKey;
  }, [filterKey]);

  if (previous !== initial || previousFilters !== filterKey) {
    setPrevious(initial);
    setPreviousFilters(filterKey);
    // A refresh begun before a write can arrive after its response. Do not
    // let that older read undo a mutation we have already confirmed.
    if (previousFilters !== filterKey || initial.loadedAt >= confirmed.loadedAt)
      setConfirmed(initial);
    if (previousFilters !== filterKey) {
      setSelected([]);
      setActive(null);
    }
  }

  const optimistic = replayPending(confirmed, pending);
  const items = optimistic.items
    .filter((item) => matchesFilters(item, filters))
    .sort((a, b) => {
      const field = filters.state === "archive" ? "archived_at" : "created_at";
      return (
        (b[field] ?? "").localeCompare(a[field] ?? "") ||
        b.id.localeCompare(a.id)
      );
    });
  const visibleIds = items.map((item) => item.id);
  const selection = selected.filter((id) => visibleIds.includes(id));
  const activeId =
    active && visibleIds.includes(active) ? active : visibleIds[0];
  const targets = selection.length ? selection : activeId ? [activeId] : [];
  const busy = pending.length > 0;
  const modalOpen = help || tagging !== null || rename !== null;

  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body)
      surface.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    // Not now on the strip's last item removes the strip, and the focused
    // button with it. Focus would fall to <body>, where the shortcuts on the
    // surface no longer hear the keyboard, so give it a place that stays.
    if (
      hadBacklog.current &&
      !hasBacklog &&
      (!document.activeElement || document.activeElement === document.body)
    )
      heading.current?.focus();
    hadBacklog.current = hasBacklog;
  }, [hasBacklog]);

  useEffect(() => {
    const element = dialog.current;
    if (modalOpen) {
      if (element && !element.open) {
        element.showModal();
        element.querySelector<HTMLInputElement>("input")?.focus();
      }
    } else if (element?.open) element.close();
  }, [modalOpen]);

  function closeDialog() {
    setHelp(false);
    setTagging(null);
    setRename(null);
    surface.current?.focus();
  }
  function focusRow(id: string | undefined) {
    if (!id) {
      surface.current?.focus();
      return;
    }
    setActive(id);
    list.current?.querySelector<HTMLElement>(`[data-row="${id}"]`)?.focus();
  }

  async function drain() {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const entry = queue.current[0];
      let result: MutationResult;
      try {
        result = await mutateLibrary(entry.mutation, filters);
      } catch {
        result = {
          ok: false,
          snapshot: null,
          message:
            "Connection lost. The change could not be confirmed. Reload before continuing.",
        };
      }
      queue.current = queue.current.filter((next) => next.id !== entry.id);
      if (result.snapshot) {
        // Back/forward navigation may complete during a write. Never install
        // the old view's snapshot into the new URL's filters.
        if (currentFilterKey.current === filterKey)
          setConfirmed(result.snapshot);
        else router.refresh();
      } else {
        const cancelled = queue.current.map((next) => next.id);
        setUndo((records) =>
          records.filter((record) => !cancelled.includes(record.id)),
        );
        queue.current = [];
        setUncertain(true);
        if (cancelled.length)
          setErrors((messages) => [
            ...messages,
            `${cancelled.length} queued change(s) were cancelled before being sent.`,
          ]);
      }
      if (result.message)
        setErrors((previousErrors) => [...previousErrors, result.message!]);
      if (!result.ok && result.snapshot && entry.mutation.kind === "delete") {
        const savedIds = result.snapshot.items.map((item) => item.id);
        setUndo((previousUndo) =>
          previousUndo.filter(
            (record) =>
              record.id !== entry.id ||
              !record.ids.every((id) => savedIds.includes(id)),
          ),
        );
      }
      if (result.ok && entry.mutation.kind === "restore")
        setUndo((previousUndo) =>
          previousUndo.filter(
            (record) =>
              !record.ids.every(
                (id) =>
                  entry.mutation.kind === "restore" &&
                  entry.mutation.ids.includes(id),
              ),
          ),
        );
      setPending([...queue.current]);
    }
    running.current = false;
  }

  function enqueue(
    mutation: Mutation,
    restoreItems?: LibrarySnapshot["items"],
  ) {
    if (uncertain) return;
    const entry = { id: ++sequence.current, mutation, restoreItems };
    if (mutation.kind === "delete")
      setUndo((records) => [
        ...records,
        {
          id: entry.id,
          ids: mutation.ids,
          items: optimistic.items.filter((item) =>
            mutation.ids.includes(item.id),
          ),
        },
      ]);
    queue.current.push(entry);
    setPending([...queue.current]);
    const after = applyOptimistic(optimistic, mutation).items.filter((item) =>
      matchesFilters(item, filters),
    );
    const currentIndex = Math.max(
      0,
      items.findIndex((item) => item.id === activeId),
    );
    if (!after.some((item) => item.id === activeId)) {
      const nextId = after[Math.min(currentIndex, after.length - 1)]?.id;
      setActive(nextId ?? null);
      requestAnimationFrame(() => focusRow(nextId));
    }
    startTransition(() => {
      void drain();
    });
  }

  async function reload() {
    try {
      const result = await loadLibrary(filters);
      if (result.snapshot) {
        setConfirmed(result.snapshot);
        setUncertain(false);
        setErrors([]);
      } else
        setErrors((messages) => [
          ...messages,
          result.message ?? "Could not reload.",
        ]);
    } catch {
      setErrors((messages) => [
        ...messages,
        "Still offline. Reconnect and reload the saved state.",
      ]);
    }
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest(
        "input:not([type='checkbox']), textarea, select, [contenteditable]:not([contenteditable='false']), dialog",
      ) ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.key === "?") {
      event.preventDefault();
      setHelp(true);
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      search.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      setSelected([]);
      return;
    }
    if (
      event.key === "j" ||
      event.key === "ArrowDown" ||
      event.key === "k" ||
      event.key === "ArrowUp"
    ) {
      event.preventDefault();
      const step = event.key === "j" || event.key === "ArrowDown" ? 1 : -1;
      focusRow(
        visibleIds[
          Math.max(
            0,
            Math.min(
              visibleIds.length - 1,
              visibleIds.indexOf(activeId) + step,
            ),
          )
        ],
      );
      return;
    }
    if (!targets.length || uncertain || event.repeat) return;
    if (["e", "f", "#", "t", "x", "a"].includes(event.key))
      event.preventDefault();
    if (event.key === "a")
      setSelected(selection.length === items.length ? [] : visibleIds);
    if (event.key === "e")
      enqueue({
        kind: "archive",
        ids: targets,
        value: filters.state !== "archive",
      });
    if (event.key === "f")
      enqueue({
        kind: "favourite",
        ids: targets,
        value: !items
          .filter((item) => targets.includes(item.id))
          .every((item) => item.favourite),
      });
    if (event.key === "#") enqueue({ kind: "delete", ids: targets });
    if (event.key === "t") setTagging(targets);
    if (event.key === "x" && activeId) {
      setSelected(
        rangeSelection(
          visibleIds,
          selection,
          anchor.current,
          activeId,
          event.shiftKey,
        ),
      );
      anchor.current = activeId;
    }
  }

  return (
    <div
      ref={surface}
      tabIndex={-1}
      onKeyDown={keyboard}
      className="outline-none"
    >
      <SaveForm
        isEmpty={
          confirmed.items.length === 0 &&
          filters.state === "inbox" &&
          !filters.tag &&
          filters.read === "all"
        }
      />
      {backlog && (
        // Most shortcuts act on the list's selected rows, and a key pressed
        // on the strip's links and buttons is not meant for them. The
        // page-wide ones still get through.
        <div
          onKeyDown={(event) => {
            if (!PAGE_WIDE_KEYS.includes(event.key)) event.stopPropagation();
          }}
        >
          {backlog}
        </div>
      )}
      <div className="my-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-xl font-medium outline-none"
          >
            Your library
          </h1>
          <div className="flex gap-2">
            <a href="/stats" className={buttonClass}>
              Stats
            </a>
            <a href="/trash" className={buttonClass}>
              Trash
            </a>
            <button className={buttonClass} onClick={() => setHelp(true)}>
              Shortcuts ?
            </button>
          </div>
        </div>
        <FilterBar
          filters={filters}
          tags={optimistic.tags}
          disabled={busy || uncertain}
        />
        <p className="text-xs text-ink-faint">
          a select page · e archive · j/k move · t tag
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const start = visibleIds.indexOf(activeId);
            const ordered = [
              ...items.slice(start + 1),
              ...items.slice(0, start + 1),
            ];
            const match = ordered.find((item) =>
              `${item.title ?? ""} ${item.url}`
                .toLowerCase()
                .includes(find.toLowerCase()),
            );
            if (match) focusRow(match.id);
            else
              setErrors((messages) => [
                ...messages,
                "No matching title or URL on this page.",
              ]);
          }}
        >
          <input
            ref={search}
            aria-label="Find on this page"
            placeholder="Find on this page · /"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") focusRow(activeId);
            }}
            className="min-w-0 flex-1 rounded-lg border border-edge bg-ground-raised px-3 py-2 text-sm"
          />
          <button className={buttonClass} disabled={!find.trim()}>
            Find next
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={buttonClass}
            disabled={!items.length || uncertain}
            onClick={() =>
              setSelected(selection.length === items.length ? [] : visibleIds)
            }
          >
            {selection.length === items.length && items.length
              ? "Clear selection"
              : "Select page"}
          </button>
          <span className="text-sm text-ink-dim">
            {selection.length} selected
          </span>
          <button
            className={buttonClass}
            disabled={!selection.length || uncertain}
            onClick={() =>
              enqueue({
                kind: "archive",
                ids: selection,
                value: filters.state !== "archive",
              })
            }
          >
            {filters.state === "archive"
              ? "Unarchive selected"
              : "Archive selected"}
          </button>
          <button
            className={buttonClass}
            disabled={!selection.length || uncertain}
            onClick={() => setTagging(selection)}
          >
            Tag selected
          </button>
          <span role="status" className="text-sm text-ink-faint">
            {busy
              ? `Saving ${pending.length} change${pending.length === 1 ? "" : "s"}…`
              : ""}
          </span>
        </div>
      </div>
      {errors.length > 0 && (
        <div
          role="alert"
          className="mb-4 space-y-2 rounded-lg border border-red-400 p-3 text-sm text-red-400"
        >
          {errors.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
          <button
            className={buttonClass}
            onClick={() => {
              if (uncertain)
                startTransition(() => {
                  void reload();
                });
              else setErrors([]);
            }}
          >
            {uncertain ? "Reload saved state" : "Dismiss"}
          </button>
        </div>
      )}
      {undo.length > 0 && (
        <div
          className="mb-4 space-y-2 rounded-lg border border-edge p-3"
          aria-live="polite"
        >
          {undo.map((record) => (
            <div
              key={record.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                Moved {record.ids.length} item
                {record.ids.length === 1 ? "" : "s"} to Trash
              </span>
              <button
                className={buttonClass}
                disabled={
                  uncertain ||
                  pending.some(
                    (entry) =>
                      entry.mutation.kind === "restore" &&
                      entry.mutation.ids.some((id) => record.ids.includes(id)),
                  )
                }
                onClick={() => {
                  // Retain the deleted rows locally so Undo is instant even after the
                  // server's filtered snapshot no longer contains them.
                  enqueue({ kind: "restore", ids: record.ids }, record.items);
                }}
              >
                Undo delete
              </button>
            </div>
          ))}
          <p className="text-xs text-ink-faint">
            Undo stays available while you keep this page open. After that,
            restore from{" "}
            <a href="/trash" className="underline">
              Trash
            </a>
            , which keeps items for {PURGE_AFTER_DAYS} days.
          </p>
        </div>
      )}
      <ul ref={list} aria-label="Saved items" className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            data-row={item.id}
            tabIndex={activeId === item.id ? 0 : -1}
            onFocus={() => setActive(item.id)}
            className="rounded-lg border border-edge p-3 focus-within:border-accent focus:outline-2 focus:outline-accent"
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label={`Select ${item.title ?? item.url}`}
                checked={selection.includes(item.id)}
                disabled={uncertain}
                onChange={(event) => {
                  const shift =
                    "shiftKey" in event.nativeEvent &&
                    event.nativeEvent.shiftKey === true;
                  setSelected(
                    rangeSelection(
                      visibleIds,
                      selection,
                      anchor.current,
                      item.id,
                      shift,
                    ),
                  );
                  anchor.current = item.id;
                }}
                className="mt-1 size-5 shrink-0 accent-accent"
              />
              <div className="min-w-0 flex-1">
                <a
                  href={`/read/${item.id}`}
                  className="font-medium break-words hover:underline"
                >
                  {item.title ?? item.url}
                </a>
                {item.excerpt && (
                  <p className="mt-1 line-clamp-2 text-sm text-ink-dim">
                    {item.excerpt}
                  </p>
                )}
                <p className="mt-1 text-xs text-ink-faint">
                  {item.site_name ?? new URL(item.url).hostname} ·{" "}
                  {item.read_at ? "Read" : "Unread"}
                  {item.reading_minutes !== null
                    ? ` · ${item.reading_minutes} min`
                    : ""}
                  {item.status === "pending"
                    ? " · Fetching article"
                    : item.status === "failed"
                      ? " · Saved as a link"
                      : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.item_tags.map((link) => {
                    const tag = optimistic.tags.find(
                      (tag) => tag.id === link.tag_id,
                    );
                    return tag ? (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 rounded bg-ground-raised px-2 py-1 text-xs"
                      >
                        <span>{tag.name}</span>
                        <button
                          aria-label={`Remove ${tag.name} from ${item.title ?? item.url}`}
                          disabled={uncertain || tag.id.startsWith("pending:")}
                          onClick={() =>
                            enqueue({
                              kind: "untag",
                              ids: [item.id],
                              tagId: tag.id,
                            })
                          }
                          className="px-2 py-1 disabled:opacity-40"
                        >
                          ×
                        </button>
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className={buttonClass}
                disabled={uncertain}
                onClick={() =>
                  enqueue({
                    kind: "archive",
                    ids: [item.id],
                    value: !item.archived_at,
                  })
                }
              >
                {item.archived_at ? "Unarchive" : "Archive"}
              </button>
              <button
                className={buttonClass}
                disabled={uncertain}
                aria-pressed={item.favourite}
                onClick={() =>
                  enqueue({
                    kind: "favourite",
                    ids: [item.id],
                    value: !item.favourite,
                  })
                }
              >
                {item.favourite ? "★ Favourite" : "☆ Favourite"}
              </button>
              <button
                className={buttonClass}
                disabled={uncertain}
                onClick={() => setTagging([item.id])}
              >
                Tag
              </button>
              <button
                className={buttonClass}
                disabled={uncertain}
                onClick={() => enqueue({ kind: "delete", ids: [item.id] })}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!items.length && (
        <p className="py-12 text-center text-ink-dim">
          {busy ? "Clearing this page…" : "No items in this view."}
        </p>
      )}
      <nav
        aria-label="Pagination"
        className="my-6 flex items-center justify-between gap-3"
      >
        <button
          className={buttonClass}
          disabled={filters.page === 1 || busy || uncertain}
          onClick={() =>
            router.push(filterUrl({ ...filters, page: filters.page - 1 }))
          }
        >
          Previous
        </button>
        <span className="text-sm text-ink-dim">
          Page {filters.page} · {items.length} items
        </span>
        <button
          className={buttonClass}
          disabled={!confirmed.hasMore || busy || uncertain}
          onClick={() =>
            router.push(filterUrl({ ...filters, page: filters.page + 1 }))
          }
        >
          Next
        </button>
      </nav>
      <details className="border-t border-edge py-4">
        <summary className="cursor-pointer text-sm text-ink-dim">
          Manage tags
        </summary>
        <ul className="mt-3 flex flex-wrap gap-2">
          {optimistic.tags.map((tag) => (
            <li key={tag.id}>
              <button
                className={buttonClass}
                disabled={uncertain || tag.id.startsWith("pending:")}
                onClick={() => {
                  setRename(tag);
                  setRenameValue(tag.name);
                }}
              >
                Rename {tag.name}
              </button>
            </li>
          ))}
        </ul>
        {!optimistic.tags.length && (
          <p className="mt-2 text-sm text-ink-faint">
            Add your first tag from an item.
          </p>
        )}
      </details>
      <dialog
        ref={dialog}
        aria-labelledby="triage-dialog-title"
        onCancel={closeDialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-edge bg-ground p-5 text-ink backdrop:bg-black/60"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="triage-dialog-title" className="font-medium">
            {help
              ? "Keyboard shortcuts"
              : rename
                ? "Rename tag everywhere"
                : `Tag ${tagging?.length ?? 0} item(s)`}
          </h2>
          <button className={buttonClass} onClick={closeDialog}>
            Close
          </button>
        </div>
        {help && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
            {[
              ["j / ↓", "Next item"],
              ["k / ↑", "Previous item"],
              ["x", "Select item"],
              ["a", "Select / clear page"],
              ["Shift-click", "Select a range"],
              ["e", "Archive (unarchive in Archive)"],
              ["f", "Toggle favourite"],
              ["#", "Move to Trash"],
              ["t", "Add tag"],
              ["/", "Find on this page"],
              ["?", "Show shortcuts"],
              ["Esc", "Close dialog / clear selection"],
            ].map(([key, label]) => (
              <div key={key} className="contents">
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        )}
        {tagging && (
          <TagInput
            tags={optimistic.tags}
            autoFocus
            onTag={(name) => {
              enqueue({ kind: "tag", ids: tagging, name });
              closeDialog();
            }}
          />
        )}
        {rename && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const normalized = normalizeTag(renameValue);
                enqueue({
                  kind: "rename",
                  tagId: rename.id,
                  name: normalized.name,
                });
                closeDialog();
              } catch (cause) {
                setErrors((messages) => [
                  ...messages,
                  cause instanceof Error ? cause.message : "Invalid tag.",
                ]);
                closeDialog();
              }
            }}
            className="space-y-3"
          >
            <label className="block text-sm">
              Tag name
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                className="mt-2 block w-full rounded-lg border border-edge bg-ground-raised px-3 py-2"
              />
            </label>
            <button className={buttonClass} disabled={!renameValue.trim()}>
              Rename
            </button>
          </form>
        )}
      </dialog>
    </div>
  );
}
