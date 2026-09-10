"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { searchUrl } from "@/lib/search";
import { filterUrl, type Filters, type Tag } from "@/lib/tags";

const buttonClass =
  "rounded-md border border-edge px-3 py-2 text-sm hover:bg-ground-raised disabled:opacity-40";

/**
 * The search box, and the Slice 4 filters alongside it.
 *
 * These are not `FilterBar` from components/filter-bar.tsx, and the reason is
 * one line inside it: every change there navigates to `filterUrl(...)`, which
 * is always `/inbox`. Reusing it here would drop the query on the first time
 * anyone touched a dropdown. Making it take a path is the obvious fix and it
 * is not this slice's to make — that file is 872 lines and Slice 8 owns
 * splitting it.
 *
 * What is shared is the part that matters: the URL. `searchUrl` builds on
 * `filterUrl`, so `state`, `read`, `tag` and `page` mean the same things in
 * both places and cannot drift apart.
 */
export function SearchInput({
  query,
  filters,
  tags,
}: {
  query: string;
  filters: Filters;
  tags: Tag[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [previous, setPrevious] = useState(query);

  // The URL is the source of truth. Following Back, or a link that changes
  // the query, re-renders this component without remounting it, so the input
  // has to be told. Same shape as the snapshot reconciliation in
  // components/filter-bar.tsx.
  if (previous !== query) {
    setPrevious(query);
    setValue(query);
  }

  function go(nextQuery: string, patch: Partial<Filters> = {}) {
    // Any change other than turning the page starts the results again from
    // page one; page 3 of a search nobody has run yet is an empty screen.
    router.push(
      searchUrl(nextQuery, { ...filters, ...patch, page: patch.page ?? 1 }),
      { scroll: false },
    );
  }

  return (
    <div className="space-y-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          go(value);
        }}
      >
        <input
          type="search"
          name="q"
          // Only on arrival with nothing typed. Turning to page 2 is a full
          // navigation, so an unconditional autoFocus would drag focus back
          // up to the box every time someone pages through their results.
          autoFocus={query === ""}
          aria-label="Search your library"
          placeholder="Search titles and article text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ground-raised px-3 py-2 text-sm"
        />
        <button className={buttonClass}>Search</button>
      </form>

      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="sr-only">Narrow these results</legend>
        <label className="text-sm">
          State
          <select
            aria-label="State"
            value={filters.state}
            onChange={(event) =>
              go(query, { state: event.target.value as Filters["state"] })
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
            onChange={(event) =>
              go(query, { read: event.target.value as Filters["read"] })
            }
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
            onChange={(event) => go(query, { tag: event.target.value })}
            className={`${buttonClass} ml-2 max-w-48 bg-ground`}
          >
            <option value="">All tags</option>
            {/* A tag filter can outlive the tag, in a URL someone bookmarked
                or was sent. Showing the value keeps the select honest about
                what is being applied instead of silently reading "All tags". */}
            {filters.tag && !tags.some((tag) => tag.id === filters.tag) && (
              <option value={filters.tag}>Unavailable tag</option>
            )}
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <a href={filterUrl(filters)} className={`${buttonClass} ml-auto`}>
          Back to library
        </a>
      </fieldset>
    </div>
  );
}
