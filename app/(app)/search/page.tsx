import { redirect } from "next/navigation";

import { SearchInput } from "@/components/search-input";
import { createServerSupabase } from "@/lib/db/server";
import {
  highlightSegments,
  parseQuery,
  resolveTags,
  searchUrl,
  type ParsedSearch,
  type SearchHit,
} from "@/lib/search";
import { filterUrl, PAGE_SIZE, parseFilters, type Filters } from "@/lib/tags";
import type { Tag } from "@/lib/tags";

export const metadata = { title: "Search" };
export const dynamic = "force-dynamic";

const panelClass = "rounded-lg border border-edge p-4";
const linkClass = "text-accent underline underline-offset-2";

/**
 * `search_items` returns the snippet with matches wrapped in two control
 * characters. Splitting on them and rendering `<mark>` elements is the whole
 * reason it is done that way: the snippet is text lifted out of somebody
 * else's web page, and the one thing it must never be is HTML we render.
 */
function Snippet({ text }: { text: string }) {
  return (
    <p className="mt-1 text-sm leading-relaxed text-ink-dim">
      {highlightSegments(text).map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded bg-accent/20 px-0.5 text-ink not-italic"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

const MATCH_LABEL: Record<string, string> = {
  body: "Matched in the article",
  excerpt: "Matched in the summary",
  title: "Matched in the title",
};

function Result({ hit }: { hit: SearchHit }) {
  const host = (() => {
    try {
      return new URL(hit.url).hostname.replace(/^www\./, "");
    } catch {
      return hit.url;
    }
  })();
  return (
    <li className="border-b border-edge py-4 last:border-b-0">
      <a
        href={`/read/${hit.id}`}
        className="font-medium break-words hover:underline"
      >
        {hit.title ?? host}
      </a>
      {hit.snippet && <Snippet text={hit.snippet} />}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
        <span>{hit.site_name ?? host}</span>
        <span aria-hidden="true">·</span>
        <span>{MATCH_LABEL[hit.snippet_source] ?? "Matched"}</span>
        {hit.reading_minutes !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{hit.reading_minutes} min</span>
          </>
        )}
        {hit.favourite && (
          <>
            <span aria-hidden="true">·</span>
            <span>★ Favourite</span>
          </>
        )}
        {hit.archived_at && (
          <>
            <span aria-hidden="true">·</span>
            <span>Archived</span>
          </>
        )}
        {hit.status === "pending" && (
          <>
            <span aria-hidden="true">·</span>
            <span>Article not fetched yet</span>
          </>
        )}
        {hit.status === "failed" && (
          <>
            <span aria-hidden="true">·</span>
            <span>Saved as a link only</span>
          </>
        )}
      </p>
    </li>
  );
}

/**
 * "No results" is a dead end. Every branch here names the specific thing that
 * narrowed the search to nothing and offers the URL that widens it again,
 * because the reader cannot see which of four filters is the culprit.
 *
 * The last branch is the one worth keeping: a `pending` item has no article
 * text yet, and on the Hobby plan's daily cron it can stay that way for a
 * day. Someone searching for a phrase they remember from a page they saved an
 * hour ago is not looking at a broken search, and should be told so.
 */
function NoResults({
  query,
  parsed,
  filters,
  pendingCount,
}: {
  query: string;
  parsed: ParsedSearch;
  filters: Filters;
  pendingCount: number;
}) {
  const narrowed =
    filters.state !== "inbox" || filters.read !== "all" || !!filters.tag;
  return (
    <div className={`${panelClass} mt-6 space-y-3 text-sm`}>
      <p className="text-ink">Nothing matched that.</p>
      <ul className="list-disc space-y-2 pl-5 text-ink-dim">
        {narrowed && (
          <li>
            The filters are still on.{" "}
            <a
              className={linkClass}
              href={searchUrl(query, {
                state: "inbox",
                read: "all",
                tag: "",
                page: 1,
              })}
            >
              Search the inbox with no filters
            </a>
            .
          </li>
        )}
        {parsed.excludedTerms.length > 0 && (
          <li>
            Excluding{" "}
            {parsed.excludedTerms.map((term) => `“${term}”`).join(", ")} may be
            removing what you wanted.
          </li>
        )}
        {parsed.phrases.length > 0 && (
          <li>
            A quoted phrase has to appear word for word. Try{" "}
            <a
              className={linkClass}
              href={searchUrl(
                [...parsed.phrases, ...parsed.terms].join(" "),
                filters,
              )}
            >
              the same words unquoted
            </a>
            .
          </li>
        )}
        {parsed.tags.length > 0 && (
          <li>
            Items must carry{" "}
            {parsed.tags.length > 1 ? "all of these tags" : "that tag"}:{" "}
            {parsed.tags.join(", ")}.
          </li>
        )}
        {pendingCount > 0 && (
          <li>
            {pendingCount === 1
              ? "One saved link has not been fetched yet"
              : `${pendingCount} saved links have not been fetched yet`}
            , so their article text cannot be searched. Extraction runs once a
            day.
          </li>
        )}
        <li>
          Titles, summaries, authors and site names are searched for every item;
          the full article text only once it has been fetched.
        </li>
      </ul>
    </div>
  );
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const query = typeof params.q === "string" ? params.q : "";
  const parsed = parseQuery(query);

  const db = await createServerSupabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    redirect(
      `/auth/sign-in?next=${encodeURIComponent(searchUrl(query, filters))}`,
    );
  }

  // Bounded on purpose, and it is the dropdown's list rather than the search's:
  // `tag:foo` is resolved by the exact query below, so a library with more
  // tags than this loses a few options in a select and no results.
  const catalogue = await db
    .from("tags")
    .select("id, name, slug")
    .order("name")
    .limit(500);
  const tags = (catalogue.data ?? []) as Tag[];

  const wanted = [...parsed.tags, ...parsed.excludedTags];
  const named = wanted.length
    ? await db.from("tags").select("id, name, slug").in("slug", wanted)
    : null;
  const namedTags = (named?.data ?? []) as Tag[];
  const required = resolveTags(parsed.tags, namedTags);
  const forbidden = resolveTags(parsed.excludedTags, namedTags);

  let hits: SearchHit[] = [];
  let hasMore = false;
  let failed = false;
  // A required tag that does not exist matches nothing, and running the query
  // to discover that would report "nothing matched" where "no such tag" is
  // the honest answer. A *forbidden* tag that does not exist forbids nothing,
  // so it is simply dropped.
  const runnable =
    !parsed.isEmpty && !parsed.exclusionOnly && required.missing.length === 0;

  if (runnable) {
    const { data, error } = await db.rpc("search_items", {
      include_query: parsed.include,
      exclude_query: parsed.exclude,
      required_tags: required.ids,
      forbidden_tags: forbidden.ids,
      library_state: filters.state,
      read_filter: filters.read,
      // One row past the page, the same lookahead the library uses, so "Next"
      // is only offered when there is something on the other side of it.
      limit_count: PAGE_SIZE + 1,
      offset_count: (filters.page - 1) * PAGE_SIZE,
    });
    if (error) failed = true;
    else {
      const rows = (data ?? []) as SearchHit[];
      hasMore = rows.length > PAGE_SIZE;
      hits = rows.slice(0, PAGE_SIZE);
    }
  }

  // Only asked for when it is about to be used, and only as a count.
  const pending =
    runnable && hits.length === 0
      ? await db
          .from("items")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null)
          .eq("status", "pending")
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-6">
      <h1 className="mb-5 text-xl font-medium">Search</h1>
      <SearchInput query={query} filters={filters} tags={tags} />

      <p className="mt-4 text-xs text-ink-faint">
        <code>&quot;a phrase&quot;</code> · <code>-exclude</code> ·{" "}
        <code>tag:name</code> · <code>or</code>. Filters above apply to the
        results and stay with you when you go{" "}
        <a className={linkClass} href={filterUrl(filters)}>
          back to the library
        </a>
        .
      </p>

      {failed && (
        <p role="alert" className={`${panelClass} mt-6 text-red-400`}>
          Could not run that search. Try again.
        </p>
      )}

      {!failed && parsed.isEmpty && (
        <div className={`${panelClass} mt-6 space-y-2 text-sm text-ink-dim`}>
          <p className="text-ink">Search everything you have saved.</p>
          <p>
            Titles, summaries, authors and site names are always searched. The
            full text of an article is searched once it has been fetched.
          </p>
          <p>
            <code>&quot;quantum material&quot;</code> matches that phrase
            exactly, <code>gpu -nvidia</code> leaves out anything mentioning
            nvidia, and <code>tag:physics</code> narrows to one tag.
          </p>
        </div>
      )}

      {!failed && parsed.exclusionOnly && (
        <div className={`${panelClass} mt-6 space-y-2 text-sm text-ink-dim`}>
          <p className="text-ink">
            That only says what to leave out, not what to look for.
          </p>
          <p>
            Add something to search for —{" "}
            <code>
              gpu {parsed.excludedTerms.map((term) => `-${term}`).join(" ")}
            </code>{" "}
            rather than{" "}
            <code>
              {parsed.excludedTerms.map((term) => `-${term}`).join(" ")}
            </code>
            .
          </p>
        </div>
      )}

      {!failed && required.missing.length > 0 && (
        <div className={`${panelClass} mt-6 space-y-2 text-sm text-ink-dim`}>
          <p className="text-ink">
            {required.missing.length > 1
              ? "No tags called "
              : "There is no tag called "}
            {required.missing.map((slug) => `“${slug}”`).join(", ")}.
          </p>
          <p>
            {tags.length
              ? `Tags you have: ${tags.map((tag) => tag.slug).join(", ")}.`
              : "You have not created any tags yet."}
          </p>
        </div>
      )}

      {!failed && runnable && hits.length === 0 && (
        <NoResults
          query={query}
          parsed={parsed}
          filters={filters}
          pendingCount={pending?.count ?? 0}
        />
      )}

      {hits.length > 0 && (
        <>
          <p role="status" className="mt-6 text-sm text-ink-dim">
            {hits.length} result{hits.length === 1 ? "" : "s"}
            {hasMore || filters.page > 1 ? ` on page ${filters.page}` : ""}
          </p>
          <ul aria-label="Search results" className="mt-1">
            {hits.map((hit) => (
              <Result key={hit.id} hit={hit} />
            ))}
          </ul>
          {(hasMore || filters.page > 1) && (
            <nav
              aria-label="Pagination"
              className="my-6 flex items-center justify-between gap-3"
            >
              {filters.page > 1 ? (
                <a
                  className="rounded-md border border-edge px-3 py-2 text-sm hover:bg-ground-raised"
                  href={searchUrl(query, {
                    ...filters,
                    page: filters.page - 1,
                  })}
                >
                  Previous
                </a>
              ) : (
                <span />
              )}
              <span className="text-sm text-ink-dim">Page {filters.page}</span>
              {hasMore ? (
                <a
                  className="rounded-md border border-edge px-3 py-2 text-sm hover:bg-ground-raised"
                  href={searchUrl(query, {
                    ...filters,
                    page: filters.page + 1,
                  })}
                >
                  Next
                </a>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
