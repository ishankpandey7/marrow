# ROADMAP.md

Nine slices. Each one ends with something that works and is deployed — not a
layer, not a "foundation". If a slice ends and there is nothing you can click,
the slice was drawn wrong.

Read `ARCHITECTURE.md` before starting any slice. Read the slice's **Gotcha**
before writing code, not after. The gotchas are the specific things that get
built wrong the first time.

`AGENT-PROMPTS.md` in the repo root has the ready-to-paste prompt for every
slice below, and says which agent runs it.

**Tick a box only when the thing is done and verified.** A ticked box you did
not check is worse than an unticked one, because next session it gets skipped.

---

## Where things stand

Kept current at the end of every session. Read this first; it is the handoff.

**Last updated: 2026-09-10, end of Slice 4.**

- **Implemented:** Slices 0–4, with the outstanding verification below.
  Slice 2 shipped `lib/fetcher.ts` with all thirteen section 5 guards and 127 offline tests,
  `lib/sanitize.ts` with the XSS corpus, `lib/extract.ts` with fixtures, and
  `POST /api/extract`. The
  pipeline was run against live URLs; results in Notes from the field.
- **Slice 3 shipped in `999d425`:** the server-rendered reading view at
  `/read/[id]`, with re-sanitized article HTML, deliberate typography, adjustable
  font family and size, light/dark/sepia themes, device appearance until an
  explicit choice, profile settings persistence, throttled reading progress
  with restoration and a visibility-change flush, reserved image frames,
  contained tables, designed failure states, keyboard controls and article text
  without JavaScript. Build, typecheck, lint and all 322 tests have been
  independently verified; no Slice 2 file was changed.
- **Slice 4 shipped in `98e3c49`:** archive/unarchive, favourites, soft delete
  with undo that stays available while the page is open, and optimistic
  mutations that reconcile with server state and visibly roll back on failure.
  Tags support normalized identity, creation, cached autocomplete, removal and
  rename. State, tag and read-status filters live in the URL; the list has
  50-row pagination, shift-click ranges, bulk archive/tag and keyboard triage.
  `a`, then `e`, archives a page; `/` finds within the current page, with
  full-library search still reserved for Slice 5. All 389 tests, typecheck,
  lint and build have been independently verified, and no Slice 2 or Slice 3
  file was touched.
- **Slice 4 index box deliberately remains unticked:** run all 18 filter
  variants in `docs/SLICE-4-EXPLAIN.sql` with real Supabase credentials and
  representative saved items under authenticated RLS. Confirm the expected
  `items_inbox_idx`, `items_archive_idx` and `items_favourites_idx` paths; a
  sequential scan on `items` must be reviewed, not hidden with a planner switch
  or an index added outside a migration.
- **Slice 4 pagination box deliberately remains unticked:** page-20 query
  bounds are tested, but closing this box needs live pagination latency at
  1,000 saved items and the 200-unread-items-in-two-minutes keyboard triage
  check. `docs/SLICE-4-VERIFY.md` also carries the remaining live persistence,
  rollback, undo and phone/browser focus checks.
- **Slice 3 image limitation:** publisher images need a tap to load and connect
  directly to the source. Automatic proxied loading waits for the guarded
  `/api/img` endpoint in Slice 8; the reserved frames already prevent layout
  shifts.
- **The reader preview is public and permanent:** `/reader-preview/[id]` is a
  shipped fixture route, including on production, not a throwaway local page.
  It needs no credentials and writes only to its own browser-storage namespace.
  Start at `/reader-preview/longform`; the selector includes the existing
  extraction fixtures, pending and all ten failure states. Slice 8 now requires
  an explicit decision to keep or remove this route before launch.
- **Extraction is still waiting for Slice 7:** _nothing drives `/api/extract`
  yet._ `save_item` queues a `fetch_jobs` row and the cron that claims it is
  Slice 7,
  so on the deployed site a saved item stays `pending` and the row keeps saying
  "Fetching the article" until extraction is invoked manually or Slice 7 ships.
  Extraction itself resolves every item it is asked to process; it is simply
  never asked automatically. The reader does not change this.
- **Next: Slice 5 cannot start until there are real saved, extracted items.**
  Getting those needs Slice 7 to drive the extraction queue. The likely order
  is **4 → 7 → 5 → 6**; search ranking needs real content to verify.
- **Not verified by hand:** `POST /api/extract` has never run against the real
  database. Its columns and enum values were checked against `docs/SCHEMA.sql`
  by eye and it typechecks, but the RLS read, the service-role write to
  `item_content`, and the `items` check constraint have not been exercised. See
  "What to verify by hand" under Slice 2.
- **User-Agent decision settled:** no, we will not imitate a browser. Keep the
  descriptive product-identifying agent required by ARCHITECTURE §5. Sites
  that blackhole it may return `unreachable`; this is accepted behavior, not a
  pending decision or a reason to disguise the fetcher.
- **Slice 1 session-refresh box remains unticked:** open `/inbox` more than an
  hour after signing in and tick it only if the session refreshed without a
  fresh sign-in. Still blocks nothing.
- **Slice 3 human hand checks:** read the 3,000-word fixture at phone width and
  judge comfort; try Aa's families, sizes and three themes, device appearance
  and a persisted explicit choice; scroll and reopen to check restoration;
  check receding/reachable controls, J/K/Esc, tables scrolling within their own
  container, image loading/unavailable states and complete text with JavaScript
  disabled. The fixture catalogue uses browser persistence; checking live
  profile settings and item progress requires `/read/<item UUID>` with actual
  extracted content. The detailed hand-check guide remains under Slice 3.
- **Carrying forward, both tracked below:** `lib/types.ts` is hand-written and
  must be replaced by generated types once `SUPABASE_DB_URL` works; and the
  first `supabase db push` will need `migration repair`, because the schema was
  applied through the SQL Editor.

**Live:** <https://marrow-bice.vercel.app> · **Repo:** `ishankpandey7/marrow`

---

## Slice 0 — skeleton, deployed

**Agent:** Claude Code (needs real credentials and the Supabase CLI)
**Files:** `package.json`, `lib/db/`, `lib/env.ts`, `lib/constants.ts`, `app/page.tsx`,
`app/globals.css`, `.env.example`, `supabase/migrations/0001_init.sql`,
`.github/workflows/ci.yml`, `sentry.*.config.ts`, `next.config.ts`
**New dependencies (pre-approved):** `@supabase/supabase-js`, `@supabase/ssr`,
`server-only`, `@sentry/nextjs`, `prettier`, `vitest`

### Done when

- [x] Next.js 16 + TypeScript strict + Tailwind v4 scaffolded, `npm run dev` serves.
- [x] `docs/ARCHITECTURE.md`, `docs/SCHEMA.sql`, `docs/ROADMAP.md` on disk.
- [x] `supabase/migrations/0001_init.sql` exists and matches `SCHEMA.sql`.
- [x] Migration applied to the real Supabase project.
- [x] `select tablename, rowsecurity from pg_tables where schemaname='public'`
      run against the real database, every row `t`, output pasted into this file
      under Notes from the field.
- [x] `lib/db/` exports three clients: browser (anon), server (anon + cookies),
      service-role. The service-role module imports `server-only`. (Three files,
      not one — see the decisions log in ARCHITECTURE §13.)
- [x] Importing the service-role client from a `'use client'` file fails the build.
- [x] `.env.example` lists every variable in ARCHITECTURE §8, all values empty.
- [x] `.env.local` is gitignored; `.env.example` is not.
- [x] `lib/env.ts` throws at import time, naming the variable, when a required
      Supabase env var is missing. No placeholder fallbacks anywhere.
- [x] `npm run build` succeeds from a clean checkout with **no** credentials, so
      CI and a sandboxed agent can both verify their own work.
- [x] CI asserts the RLS invariant without a database: `test/schema.test.ts`
      fails if a table is added without `enable row level security` or without a
      policy, and if `docs/SCHEMA.sql` drifts from the applied migration.
- [x] `test/env-example.test.ts` fails if the code reads an environment variable
      that `.env.example` does not document, or if `.env.example` ever contains
      a value.
- [x] Landing page: dark, minimal, product name and one line of what it does.
- [x] Sentry configured for client + server + edge, `/api/debug-sentry` throws,
      and the error appears in the Sentry dashboard. Confirmed on the deployed
      site: the live client bundle carries the SDK and the DSN, and the error
      landed in Sentry.
- [x] Scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `format`, `test`.
- [x] `.github/workflows/ci.yml` runs install, typecheck, lint, test, build on PR.
- [x] Pushed to `main` on GitHub (`ishankpandey7/marrow`, private).
- [ ] Deployed on Vercel, custom domain attached, HTTPS working. Vercel project
      exists and env vars are set; the custom domain is deliberately deferred to
      launch, so this box stays open until Slice 8.

### Gotcha

`NEXT_PUBLIC_` is not a namespace. Anything behind it is compiled into the
JavaScript bundle every visitor downloads. Put `SUPABASE_SERVICE_ROLE_KEY`
behind it once and you have published a key that reads every user's data and
bypasses RLS entirely. The `server-only` import in `lib/db/service.ts` is the
guard — verify it actually fails the build rather than assuming it does.

Second: `/api/debug-sentry` is a route that throws on request. **Delete it in
Slice 8.** It is listed there as a checkbox.

---

## Slice 1 — auth, save a URL, list view

**Agent:** Either. Recommend Claude Code — it needs a live Supabase Auth project
to test the magic-link round trip.
**Files:** `app/auth/`, `app/(app)/layout.tsx`, `app/(app)/inbox/page.tsx`,
`app/api/save/route.ts`, `lib/canonical.ts`, `lib/canonical.test.ts`,
`components/save-form.tsx`, `components/item-row.tsx`, `proxy.ts`
**New dependencies:** none expected.

### Done when

- [x] Magic-link sign-in works end to end: enter email, receive mail, click,
      land signed in. No password, no OAuth. Confirmed by hand on the deployed
      site, including the re-save path: a saved link shows "Fetching the
      article", and saving it again reports it was brought back to the top
      rather than erroring or duplicating.
- [ ] `proxy.ts` (Next 16 renamed `middleware.ts`) refreshes the session
      cookie; a signed-in user is not logged out after an hour of use. Wired,
      building, and signing in works — but a Supabase access token lasts an
      hour, so the refresh path cannot be proven in the same sitting. Tick this
      the first time `/inbox` opens without a fresh sign-in on a later day.
- [x] Server code uses `supabase.auth.getUser()`, never `getSession()`.
- [x] Visiting `/inbox` signed out redirects to sign-in and returns to `/inbox`
      after the link is clicked.
- [x] `lib/canonical.ts` is pure — no network, no env, no database — and has
      tests: tracking params stripped, query order normalised, fragment dropped,
      default port dropped, trailing slash handled, hash is stable across all of
      them.
- [x] Save form accepts a URL, validates it client-side, and posts to
      `/api/save`.
- [x] `/api/save` calls the `save_item` RPC. It does not hand-roll the upsert.
- [x] The saved item appears in the list immediately, in `pending` state.
- [x] The list renders on mobile first and looks deliberate at 375 px.
      Checked at 375 px and at desktop width against fixtures covering a
      pending, a ready and a failed row, plus the empty state.
- [x] Empty state tells you what to do next, with an actual affordance. Not the
      words "No items".
- [x] Signing in as a second user shows none of the first user's items.

### Gotcha — the re-save conflict case. Not optional.

Save `https://example.com/post?utm_source=twitter`. Archive it. Now save
`https://example.com/post`. Both canonicalise to the same `url_hash`, and
`items` has a unique index on `(user_id, url_hash)` that deliberately spans
archived and soft-deleted rows.

The naive insert throws a 23505 unique violation and the user sees a 500 for
what should be a no-op. The naive fix — catch the violation and update — is a
race: two taps of the extension button and both branches insert.

The correct behaviour, which `public.save_item` in `SCHEMA.sql` already
implements as a single atomic statement:

- Re-saving an existing item is **not an error**. It returns the existing item.
- It clears `archived_at` and `deleted_at` — the item comes back to the inbox.
- It leaves `read_progress`, `read_at`, `favourite`, tags and highlights
  **untouched**. Re-saving something is not "forget everything about it".
- It re-queues extraction only if `status <> 'ready'`. An article you already
  have is not re-fetched.

Test all four of those. The one that gets missed is the third: someone writes
an upsert that resets the row and quietly destroys the user's reading position.

---

## Slice 2 — extraction pipeline

**Agent:** Claude Code. Security-critical, and needs real network access to
verify against live URLs.
**Files:** `lib/fetcher.ts`, `lib/fetcher.test.ts`, `lib/extract.ts`,
`lib/extract.test.ts`, `lib/sanitize.ts`, `lib/sanitize.test.ts`,
`app/api/extract/route.ts`, `test/fixtures/`
**New dependencies (pre-approved):** `@mozilla/readability`, `linkedom`,
`sanitize-html`, `@types/sanitize-html`

### Done when

- [x] `lib/fetcher.ts` implements **every** guard in ARCHITECTURE §5. Not a
      subset.
- [x] Its tests were written before the implementation and cover, at minimum:
      private IPv4 ranges; IPv6 loopback and ULA; an IPv4-mapped IPv6 address;
      a redirect from a public host to `127.0.0.1`; a redirect chain longer
      than 3; a body exceeding 5 MB; a host that times out; a non-HTML
      content type; a URL with embedded credentials.
- [x] No test touches the network. DNS and the HTTP agent are injected.
- [x] Every route that calls the fetcher declares `runtime = 'nodejs'`.
- [x] `lib/sanitize.ts` has an XSS corpus that must not survive: `<script>`,
      `onerror=`, `javascript:` href, `data:text/html` href, `<iframe>`,
      `<svg onload>`, `<form>`, a `style` with `expression()`.
- [x] `lib/extract.ts` produces title, author, site, publish date, lead image,
      lang, word count and reading time from HTML fixtures, offline.
- [x] All ten `fail_reason` values are reachable, and each has user-facing copy.
- [x] A failed extraction still leaves a saved item with its URL and a usable
      title. Never a ghost row, never a spinner that never resolves.
- [x] Run against four live URLs and record what happened for each in Notes
      from the field: a normal news article, a hard paywall, a JavaScript-only
      SPA, and a URL that 404s. All four must fail gracefully or succeed
      cleanly — no crash, no hang, no leaked internal error.

### Gotcha

The redirect case is the one that gets missed. Validating the URL the user typed
and then calling `fetch` with `redirect: 'follow'` means the runtime follows a
302 to `http://169.254.169.254/latest/meta-data/` on your behalf, and every
guard you wrote is bypassed by a single header on someone else's server. Set
`redirect: 'manual'` and re-run the full check on each hop.

Second: `Content-Length` is supplied by the party you are defending against. A
5 MB cap enforced by reading the header is not a cap. Count bytes as they
arrive and abort mid-stream.

Third: do not tell the user _why_ a URL was blocked. "Blocked: connection
refused to 10.0.0.7" is a working port scanner with a nice UI.

### What to verify by hand

The route has never run against the real database. Sign in on the deployed
site, save any URL, take its item id from `/inbox`, and:

```
curl -X POST https://marrow-bice.vercel.app/api/extract   -H 'content-type: application/json'   -b 'sb-…-auth-token=…'   -d '{"itemId":"<the uuid>"}'
```

Then check, in the SQL editor: the `items` row went to `ready` with a title,
`word_count` and `reading_minutes`, and `fail_reason` is null; there is an
`item_content` row for it with `extractor = 'readability@0.6.0'`; and the
`fetch_jobs` row for that item is `done` rather than still `queued`. Repeat
with a URL that 404s and confirm the row goes to `failed` with `not_found` and
keeps its URL.

---

## Slice 3 — the reading view

**Agent:** Codex. Self-contained UI over fixtures, no credentials needed.
**Files:** `app/(app)/read/[id]/page.tsx`, `components/reader/`,
`app/globals.css`, `lib/reading.ts`, `lib/reading.test.ts`
**New dependencies:** none expected. Ask before adding a typography library.

### Done when

- [x] The article renders server-side. Extracted HTML never enters the client
      bundle.
- [x] Typography is actually good: a measure of 60–75 characters, generous line
      height, real vertical rhythm between block elements. Read a 3,000-word
      article on a phone and it should be pleasant.
- [x] Font size, family (serif / sans) and theme (light / dark / sepia) are
      user-adjustable and persist to `profiles.settings`.
- [x] Theme follows `prefers-color-scheme` until the user chooses; an explicit
      choice wins and persists.
- [x] Reading progress is tracked as you scroll, throttled, and written back to
      `items.read_progress`. Re-opening restores the position.
- [x] Images lazy-load, are width-constrained, and never cause layout shift.
      Publisher images require a tap until the guarded proxy ships (Slice 8).
- [x] Code blocks, blockquotes, tables and figures all have deliberate styles.
      Tables scroll horizontally inside their own container rather than making
      the page scroll.
- [x] Every `fail_reason` renders its own designed state with the copy from
      ARCHITECTURE §6 and a sensible action — retry, or open the original.
- [x] Keyboard: `j`/`k` scroll, `Esc` back to the list.
- [x] Works with JavaScript disabled, at least to the extent of showing the
      article text.

### Verification and hand check

`npm run build`, `npm run typecheck`, `npm run lint`, and `npm test` pass.
The suite has 322 tests, including reader geometry, throttling, serial writes,
HTML sanitization, server-rendered article text, all failure copy and actions,
and session-scoped settings/progress/retry writes using offline fixtures.
No live Supabase verification was requested or used for this slice.

Run `npm run dev` and open `/reader-preview/longform`. The sample contains over
3,000 words, a local illustration, a wide table, a blockquote and a code block.
The sample selector links to `news-article`, `bare-title`, `pending`, and every
failure code. Paywall, JavaScript-required and no-content states run the
existing `paywalled.html`, `spa.html`, and `empty-shell.html` through extraction.

By hand: read at phone width; use Aa to try all three themes, serif/sans and
four sizes; reload after scrolling; check that controls recede downward and
return on upward scroll, a tap or keyboard focus. Try J/K and Esc (Esc first
closes appearance controls). Pan the table without moving the page sideways.
Disable JavaScript and check that the complete text remains. The authenticated
route is `/read/<item UUID>`; this slice does not change inbox row navigation.

### Gotcha

The extracted HTML is attacker-controlled. It arrives sanitised, but the
renderer must not undo that: no `dangerouslySetInnerHTML` on anything that has
not been through `lib/sanitize.ts`, and no "just this once" exception for
embeds. If a publisher's markup looks broken, fix the sanitiser allowlist
deliberately and add a test — do not widen it in the component.

Second: reading progress written on every scroll event will hammer the database
and burn a rate limit. Throttle it, and flush on `visibilitychange` so closing
the tab does not lose the position.

---

## Slice 4 — organise: tags, archive, favourites, filters

**Agent:** Codex. Pure UI plus straightforward queries.
**Files:** `app/(app)/inbox/page.tsx`, `components/tag-input.tsx`,
`components/filter-bar.tsx`, `lib/tags.ts`, `lib/tags.test.ts`,
`app/(app)/actions.ts`
**New dependencies:** none expected.

### Done when

- [x] Archive, un-archive, favourite and delete all work from the list.
- [x] Every one of them is optimistic: the row changes instantly and reconciles
      on the server response, with a rollback and a visible message on failure.
- [x] Delete is a soft delete and offers undo for at least 10 seconds.
- [x] Tags: create by typing, autocomplete from existing tags, remove, and
      rename. `lib/tags.ts` slug normalisation is pure and tested — two tags
      differing only by case or spacing are one tag.
- [x] Filter by tag, by state (inbox / archive / favourites), and by read
      status. Filters are in the URL and survive a refresh and a share.
- [x] Bulk select with shift-click ranges, then bulk archive or tag.
- [x] Keyboard shortcuts: `e` archive, `f` favourite, `#` delete, `t` tag,
      `/` focus search, `?` shows the shortcut sheet.
- [ ] Every list query is served by one of the partial indexes in `SCHEMA.sql`.
      Check with `explain analyze`; a sequential scan on `items` is a bug.
      **Left:** run `docs/SLICE-4-EXPLAIN.sql` with real credentials; all 18 variants and expected indexes are supplied.
- [ ] Pagination or infinite scroll that holds up at 1,000 items.
      **Left:** 50-row pages and page-20 query bounds are tested; verify live latency at 1,000 items and the two-minute triage goal.

Implementation is covered by offline pure, action and rendered-component tests.
Live persistence, phone/browser focus and timing checks remain with the owner;
follow `docs/SLICE-4-VERIFY.md`. No dependencies or migrations were added.

### Gotcha

Optimistic UI that never reconciles is a lie. If the server rejects an archive,
the row must come back and the user must be told. The common failure is a
`catch` that logs and moves on, leaving the UI showing a state the database does
not have — and the user finds out when they refresh tomorrow.

Second: tag autocomplete that queries on every keystroke without debouncing
will fire a request per character. Debounce, and cache the user's tag list
client-side — it is small and changes rarely.

---

## Slice 5 — search

**Agent:** Claude Code. Needs a live database with real rows to tune ranking.
**Files:** `app/(app)/search/page.tsx`, `lib/search.ts`, `lib/search.test.ts`,
`supabase/migrations/0002_search.sql`, `components/search-input.tsx`

### Done when

- [ ] Full-text search across title, excerpt, author, site name and body, using
      the `search_tsv` columns and GIN indexes already in the schema.
- [ ] Ranking is weighted: a title match outranks a body match. Verified with
      real saved articles, not with three fixtures.
- [ ] The query parser is pure and tested: quoted phrases, `-exclusion`, and
      `tag:foo` are understood, and a user typing `?` or `&` or an unbalanced
      quote does not produce a Postgres syntax error. Never interpolate user
      input into `to_tsquery`; use `websearch_to_tsquery`.
- [ ] Result snippets show the match in context with the term highlighted, via
      `ts_headline`.
- [ ] Search combines with the Slice 4 filters rather than replacing them.
- [ ] Empty result state suggests something useful.
- [ ] `explain analyze` on a search over 1,000+ items shows the GIN index in use
      and runs under 100 ms. Paste the plan into Notes from the field.
- [ ] Searching returns only your own items. Verified with two accounts.

### Gotcha

`to_tsquery` throws on malformed input, and user input is always malformed
eventually. `websearch_to_tsquery` accepts anything a person would type into a
search box and never throws. Use it.

Second: a GIN index is only used if the query shape matches. `where search_tsv
@@ query` uses it; wrapping the column in a function does not. Check the plan
rather than trusting that the index exists.

---

## Slice 6 — browser extension

**Agent:** Codex. Self-contained, unit-testable, no repo credentials required.
**Files:** `extension/` (own `package.json`), `extension/manifest.json`,
`extension/background.ts`, `extension/popup/`, `app/api/save/route.ts` (CORS +
token), `app/(app)/settings/extension/page.tsx`

### Done when

- [ ] Manifest V3. Works in Chrome and Firefox from the same source.
- [ ] One click on the toolbar icon saves the current tab. Success and failure
      are both visible without opening the popup — badge or icon state.
- [ ] Context menu: "Save link to Marrow" on any link.
- [ ] Keyboard shortcut, user-rebindable.
- [ ] Auth is a long-lived token generated in the web app settings page, pasted
      once into the extension. No cookie sharing, no OAuth flow.
- [ ] The token is stored in `chrome.storage.local`, never in `localStorage`,
      and is revocable from the web app.
- [ ] `/api/save` accepts the token, sets a tight CORS policy, and rate-limits
      per user exactly as the web path does.
- [ ] Saving the same page twice is a no-op that reports "already saved",
      exercising the Slice 1 gotcha through a second entry point.
- [ ] Offline: the save is queued and retried when the network returns.
- [ ] `extension/` builds with its own script and is not bundled into the
      Next.js app.

### Gotcha

The extension's host permissions are the whole security story. Requesting
`<all_urls>` gets the extension rejected from review and is not needed: it only
needs `activeTab` — the current tab's URL, at the moment the user clicks — plus
the origin of your own API. Ask for the minimum, and be able to explain each
permission in one sentence in the store listing.

Second: an extension token is a bearer credential sitting in a browser profile.
Scope it to save-only. It must not be able to read the user's list, delete
anything, or change settings.

---

## Slice 7 — background jobs, retries, limits

**Agent:** Claude Code. Needs real cron, real Sentry, and a real database.
**Files:** `app/api/cron/extract/route.ts`, `app/api/cron/purge/route.ts`,
`lib/queue.ts`, `lib/rate-limit.ts`, `lib/rate-limit.test.ts`, `vercel.json`,
`supabase/migrations/0003_jobs.sql`

### Done when

- [ ] `/api/cron/extract` claims a batch with `for update skip locked` and
      processes it. Two overlapping invocations never process the same job.
- [ ] Retries: 3 attempts, backoff 1 / 5 / 25 minutes, and **only** for
      `unreachable` and `server_error`. A 404 is never retried.
- [ ] A job stuck in `running` with a stale `locked_at` is reclaimed.
- [ ] `/api/cron/purge` hard-deletes items soft-deleted more than 30 days ago.
- [ ] Every cron route rejects a request without `Authorization: Bearer
${CRON_SECRET}` — verified by calling it from outside with curl and
      getting a 401.
- [ ] `vercel.json` schedules both jobs and they are visible as running in the
      Vercel dashboard.
- [ ] Rate limit on `/api/save`, counted in Postgres per user, with a documented
      limit and a `Retry-After` header on rejection. `lib/rate-limit.ts` is
      tested with an injected clock, not with `setTimeout`.
- [ ] A save while over the limit gives a clear message, not a generic 500.
- [ ] Extraction failures reach Sentry with the URL and the failure code.
- [ ] `blocked_url` events are logged and countable — a spike means someone is
      probing the fetcher.

### Gotcha

`for update skip locked` is the whole design. Without it, two cron invocations
that overlap — and on a one-minute schedule with a slow fetch, they will —
process the same job, fetch the same URL twice, and race on the write. With it,
the second invocation simply sees fewer rows.

Second: a cron route with no auth is a public endpoint that anyone can invoke as
fast as they like. Test the 401 by actually calling it from outside.

---

## Slice 8 — hardening and launch

**Agent:** Either.
**Files:** across the app; plus `app/(marketing)/`, `app/robots.ts`,
`app/sitemap.ts`, `app/manifest.ts`, `next.config.ts`

### Done when

- [ ] Split `components/filter-bar.tsx` (872 lines) before launch.
- [ ] Implement the guarded `/api/img` proxy from ARCHITECTURE §7 and switch
      reader images from opt-in source requests to automatic proxied lazy
      loading. Preserve the reserved frames, SSRF guards and failure states.
- [ ] **`/api/debug-sentry` is deleted.** (Added in Slice 0 for exactly this.)
- [ ] **Decide whether `/reader-preview/[id]` stays or is removed before
      launch.** It is currently a public, permanent fixture route on production;
      record the decision and carry it out deliberately.
- [ ] Content-Security-Policy set, with no `unsafe-inline` for scripts. Verified
      on the deployed site with the console open and no violations.
- [ ] Security headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
      `X-Frame-Options` / `frame-ancestors`.
- [ ] Accessibility: axe clean on the list, the reader and the settings pages.
      Keyboard-only navigation works throughout; focus is visible and never
      trapped.
- [ ] Colour contrast passes AA in every theme, including sepia.
- [ ] Lighthouse: performance and accessibility both above 90 on mobile for the
      list and the reader.
- [ ] Every route has a designed loading state and a designed error boundary.
      No raw Next.js error pages in production.
- [ ] 404 and 500 pages are designed.
- [ ] Export: download everything as JSON, including content and tags.
- [ ] Account deletion actually deletes, verified by checking the tables.
- [ ] Privacy policy and terms exist and are honest about what is stored.
- [ ] PWA: installable, correct icons, offline shell.
- [ ] `robots.txt` and `sitemap.xml` for the marketing pages only. The app is
      `noindex`.
- [ ] README explains how to run it locally from a clean checkout, and that
      procedure has been followed on a clean checkout.

### Gotcha

Adding a CSP at the end always breaks something that has been silently relying
on an inline script or style. Next.js needs a nonce for its own inline scripts;
budget real time for this and test on the deployed site, not just locally —
`next dev` and `next start` do not behave identically here.

Second: "account deletion" that leaves rows in `item_content` because the
cascade was never tested is the kind of thing that turns into a compliance
problem. Delete an account and then query every table for its `user_id`.

---

## Notes from the field

Append surprises here as they happen: parser quirks, provider limits, deploy
traps. Be specific and date each entry. Future-you has no memory of this
session, and the whole value of this section is that it records the things that
are true but not written down anywhere else.

### 2026-09-09 — Slice 4

- **An Undo needs its own row snapshot.** A successful delete response no
  longer contains the row. Replaying an already queued Undo over that response
  otherwise makes the restored row disappear again while its write is pending.
  Pending restores carry their original rows; rejected restores revert to the
  server list and keep Undo available for another attempt.
- **Refreshes can arrive out of order with writes.** Snapshots carry the server
  read's start time. An older route refresh cannot replace a newer confirmed
  mutation response. Each response also replays the remaining serialized queue,
  so one rejected archive does not roll back the next article's action.
- **A lost response is not proof of a rejected write.** When saved state cannot
  be read back, return to the last confirmed view, cancel unsent queued intent,
  show the uncertainty, and require a successful reload before further triage.
- **Filtering an embedded relationship also filters its displayed rows.** The
  tag filter uses a separate `matched_tags:item_tags!inner(tag_id)` embed, so
  the normal `item_tags(tag_id)` embed still includes every tag on each item.
- **Archive has a different leading sort index.** Use `archived_at desc` for
  archive and `created_at desc` for inbox/favourites, with `id desc` for ties.
  Every state/read/tag variant has an eligible existing partial index path;
  actual plans remain unverified without Supabase credentials.
- **Tag identity and attachment are separate writes.** Conflict-safe creation
  preserves the first display name. A rejected association can leave an unused
  real tag; the error and refreshed catalogue make that visible. Rename to an
  existing slug is rejected, preserving both tags and their associations.
- **Autocomplete needs no debounce when it needs no requests.** The complete
  tag catalogue is fetched in capped pages, cached in client state and refreshed
  with server responses. Native datalist suggestions run entirely locally.
- **Full-library search belongs to Slice 5.** `/` focuses a working title/URL
  finder within the current page. `a`, then `e`, archives a page of 50 in two
  keystrokes; `j`/`k` move and `x` selects individual rows.

### 2026-09-09 — Slice 3

- **A fixture inside the authenticated route group still needs credentials.**
  Both the app layout and proxy verify a session before the page is rendered.
  The lasting review surface is `/reader-preview/[id]`, outside that layout,
  with an explicit proxy exception for only that public fixture namespace.
  The production `/read/[id]` path keeps both session checks and RLS.
- **The existing image fixture intentionally points at a reserved domain.**
  It cannot prove successful loading. The long-form fixture has an original
  local SVG, while the news fixture exercises missing dimensions, consent and
  unavailable-image behavior. Both keep the same frame before and after load.
- **The proxy in the architecture was a plan, not an endpoint.** Avoided
  inventing a second fetch boundary in this UI slice. Images connect to a
  publisher only after an explicit tap; automatic proxy loading is tracked in
  Slice 8 and the temporary behavior is documented in ARCHITECTURE §7.
- **A five-second timer is not enough on its own.** Pending writes must flush
  when the page becomes hidden, and slow requests must remain ordered. The
  reader also keeps a local recovery position because the browser can abort a
  final network request during shutdown.
- **Phone fixture checks:** no page-wide horizontal overflow, a separately
  scrolling table, restored position after reload, persistent sepia/text size,
  receding toolbar, and a readable paywall state. Article copy is also asserted
  in server-only HTML rendering tests, without JavaScript or a database.

### 2026-09-09 — Slice 2

- **The pinned lookup was broken and no offline test could see it.** Guard 7
  hands `node:http` a custom `lookup` so the socket connects to the address we
  judged. Node calls that hook with `{ all: true }` and expects an **array**
  back whenever `autoSelectFamily` is on, which it has been by default since
  Node 20; the older bare-string shape fails every single request with
  `Invalid IP address: undefined`. Every test injects a transport, so all 124
  of them passed against a fetcher that could not fetch anything. It was the
  live-URL run in this checklist that found it. `pinnedLookup` is now its own
  exported function with its own tests for both call shapes.

- **A descriptive `User-Agent` gets us blackholed by Akamai.** npr.org does not
  refuse us and does not answer us: it accepts the TCP connection and sends
  nothing, so we sit until the timeout and report `unreachable`. Isolated to
  the header — the same request with no `User-Agent` gets a 301 in 250 ms, and
  `Accept-Encoding: identity` is not the trigger. Guard 12 requires being
  identifiable, so this is a product decision, not a bug: imitating Chrome
  would get us in, and it is detection evasion. **Decision settled at the end
  of Slice 3: no browser impersonation.** Keep the descriptive `User-Agent`;
  sites behind that kind of bot management fail gracefully as `unreachable`
  with a retry offered. This behavior is accepted.

- **A paywall teaser is not always short.** The New York Times wraps its notice
  in advertising furniture and the whole thing extracts as 435 words, past any
  sane threshold for "stub", and was stored as a clean two-minute article whose
  entire content was "You have a preview view of this article while we are
  checking your access." Length is not the signal; the body is now asked what
  it _is_ before it is asked how big.

- **linkedom lies twice, quietly, and the DOM types agree with it.**
  `document.baseURI` and `documentURI` are unset after `parseHTML`, so
  Readability resolves nothing and every relative link in a stored article
  points at _our_ origin. And `parseHTML("<body>…</body>")` on a bare fragment
  produces a document whose `body.textContent` is `""` — wrap the fragment in a
  whole `<html>` document or the word count is silently zero. Neither shows up
  as an error, and `document.documentElement` can be null where the DOM types
  promise it cannot.

- **schema.org `headline` is not always the headline.** Wikipedia puts the
  title in `name` and the one-line description in `headline`, so taking
  `headline` first filed "Common kingfisher" in the library under "species of
  bird". `name` is read first now. Readability solves the same problem with a
  text-similarity check against `<title>`, which is worth stealing if a site
  turns up that breaks the simpler order.

- **`sanitize-html` does not judge a URL with no scheme.** `allowedSchemes`
  only inspects a URL that has one, so `href="/settings"` and
  `href="//evil.example/x"` both survive it — and both resolve against our own
  origin when the reading view renders them. `href` and `src` are now required
  to be absolute http or https, which subsumes the scheme allowlist.

- **Live results, the four required cases.** Guardian article: clean success,
  1075 words, 5 min, full metadata. NYT: `paywalled`, title and link kept.
  excalidraw.com: `js_required`. A missing Wikipedia page: `not_found`. No
  crash, no hang, nothing internal in any user-facing string. The FT served a
  free article on the first run and returned 403 (`forbidden`) on the third,
  which is its own useful data point about repeated fetches.

- **The Slice 2 fixtures are safe to reuse.** `test/fixtures/` has a news
  article with a full metadata ladder, a paywall teaser, an SPA shell, a
  bare-`<title>` post and a page with no article at all. Slice 3 will want the
  first one.

### 2026-09-09 — Slice 1

- **`save_item` was broken for its entire reason to exist.** `case when ...
then 'ready' else 'pending' end` assigned to an enum column raises 42804:
  both branches are unknown-type literals, the CASE resolves to `text`, and
  Postgres will not assign text to an enum. It never fired on a first save —
  that takes the INSERT path and skips the CASE — so it only appeared on a
  re-save, which is precisely the gotcha this slice is about. Fixed in
  `0002_save_item_enum_cast.sql`; `test/schema.test.ts` now fails on an
  uncast enum literal in a CASE branch.

- **The verification that found it needs no email.**
  `admin.generateLink({ type: 'magiclink' })` returns a `hashed_token`, and
  `anon.verifyOtp({ token_hash, type: 'magiclink' })` turns that into a real
  session. Two throwaway users, real JWTs, RLS genuinely in force. This is the
  way to test anything user-scoped in later slices — reach for it before
  reaching for the service role, which bypasses the thing you are testing.

- **That same trick cannot drive the browser through sign-in.**
  `generateLink` creates no PKCE challenge, so Supabase returns the session in
  a URL _fragment_, which never reaches the server, while `/auth/callback`
  expects `?code=` from the PKCE flow the app actually uses. End-to-end
  sign-in therefore needs a real inbox.

- **PKCE ties a magic link to one browser.** The exchange needs the code
  verifier cookie written when the link was requested, so requesting on a
  laptop and opening on a phone fails. The sign-in and callback copy both say
  so, because the raw error sends people looking at their email provider.

- **A `"use server"` module may only export async functions.** Exporting the
  form's initial-state object from `app/auth/actions.ts` failed the build with
  "found object". Constants and types moved to `app/auth/state.ts`.

- **Next 16 renamed `middleware.ts` to `proxy.ts`** (function `middleware` to
  `proxy`); the old name builds with a deprecation warning.
  `npx @next/codemod@canary middleware-to-proxy .` does it automatically.

- **Env validation had to become lazy.** Slice 0 validated at module load,
  which was invisible while nothing imported `lib/db/`. Once real pages did,
  `next build` — which walks every module — would have failed without
  credentials, breaking both CI and any agent working without access to this
  project. Getters move the throw to first use: still loud, still names the
  variable, no longer at build time.

- **Two lint-style tests have now been fooled by their own comments.** The
  `.env.example` scanner found `NEXT_PUBLIC_X` in prose, and the enum-cast
  scanner found the broken CASE inside the header explaining the fix. Strip
  comments before scanning source for patterns.

- **Applied migrations are frozen, so lints must not scan them.** `0001` still
  contains the original uncast CASE, correctly — that is history. The enum lint
  runs against `docs/SCHEMA.sql`, which is the current schema and where every
  migration has to land anyway.

- **Checking a signed-in screen without signing in.** A throwaway page under
  `app/` that renders the real components against fixture rows, screenshotted
  at 375 px and then deleted, is enough to judge the layout — and it caught a
  duplicated hostname (`en.wikipedia.org · en.wikipedia.org · just now`) that
  only appears before extraction has run, which is every row in Slice 1. This
  is also the shape Slice 3 needs, since Codex has no credentials.

- **Deleting a page leaves a stale type behind.** `.next/dev/types/validator.ts`
  keeps importing the route that no longer exists, and `npm run typecheck`
  fails with TS2307 on a file you did not write. `rm -rf .next` and rebuild.

- **Word takes an exclusive lock on a `.md` file.** Any write fails with
  `EPERM: operation not permitted, rename ...`. To find the culprit:
  `Get-Process | Where-Object { $_.MainWindowTitle -match 'FILENAME' }`. Read
  markdown in Notepad or VS Code; Word also leaves `~$` junk beside the file.

- **CI failed on every push since Slice 0, and nothing local ever showed it.**
  `PageProps` and `LayoutProps` are globals Next generates into `.next/types/`,
  so `tsc --noEmit` cannot resolve them on a clean checkout — which is exactly
  what CI has. Locally a build had always run first and left the types behind.
  The fix is to make the script self-sufficient:
  `"typecheck": "next typegen && tsc --noEmit"`. The lesson generalises: a
  script that only works because of a previous command's leftovers is not a
  check, and the way to find those is to run `rm -rf .next` before the suite.

### 2026-09-06 — Slice 0 setup, environment facts

- `create-next-app@latest` now scaffolds **Next 16.3.4 / React 19.2.8**, not 15.
  Kept it. Recorded in ARCHITECTURE §2 and §13.
- Node 24.19 is what is installed locally. The scaffold pins
  `@types/node@^20`, which **conflicts with Vitest 5** — Vitest wants
  `^22 || >=24`. `npm i -D vitest` fails with ERESOLVE until you bump
  `@types/node` to `^24`. Do that rather than reaching for `--legacy-peer-deps`.
- npm 11 gates postinstall scripts. `@sentry/cli` and `unrs-resolver` are held
  back with an `allow-scripts` warning. Harmless until you set
  `SENTRY_AUTH_TOKEN` and want source-map upload, which needs the `sentry-cli`
  binary that postinstall fetches. Run `npm approve-scripts @sentry/cli` when
  you get to that.
- The project directory is `C:\Users\LOQ\kuch bada` — **it has a space in it**.
  `create-next-app .` refuses to scaffold in place because npm package names
  cannot contain spaces; the app was scaffolded elsewhere as `marrow` and
  copied in. If any tool behaves strangely, the space is the first suspect.
- Tailwind v4 has no `tailwind.config.js`. Theme tokens go in `app/globals.css`
  under `@theme`. Do not create the config file expecting it to be read.
- The Next.js scaffold writes `AGENTS.md` (and a `CLAUDE.md` that just includes
  it) and **re-adds its own block on every `next dev`**. Do not fight it —
  house rules were appended below that block, not in place of it.
- Next 16 **removed the `eslint` key from `next.config.ts`** along with
  `next lint`. Leaving `eslint: { ignoreDuringBuilds: false }` in the config is
  not ignored: it is a TypeScript error against `NextConfig` and the build
  fails. Linting is its own script and its own CI step now.
- `vitest.config.ts` is loaded as CommonJS and warns about ESM syntax. Renaming
  it to `vitest.config.mts` fixes it cleanly; setting `"type": "module"` in
  package.json would drag the whole project along for no reason.
- `*.sql` is in `.prettierignore` on purpose. Prettier reformatting
  `docs/SCHEMA.sql` but not `supabase/migrations/0001_init.sql` would break the
  byte-identity test between them.
- **2026-09-09 — schema applied and verified against the live project.**
  `pg_tables` output, all eight tables, every one with RLS on:

  ```
  tablename     | rowsecurity
  --------------+------------
  fetch_jobs    | true
  highlights    | true
  item_content  | true
  item_tags     | true
  items         | true
  profiles      | true
  save_events   | true
  tags          | true
  ```

  Also verified over PostgREST: all eight tables reachable with the service
  role; `items` with the anon key returns `200 []` (policies are `to
authenticated`, so an anonymous reader sees nothing); and `save_item()` called
  with valid arguments but no session returns `401 / 42501 / not authenticated`,
  which proves in one call that the function exists, its signature matches what
  the app will call, and its `auth.uid()` guard fires.

- **2026-09-09 — Sentry was silently disabled, and the bug was ours.**
  `next.config.ts` applied `withSentryConfig` only when `SENTRY_ORG` and
  `SENTRY_PROJECT` were set. Those two are needed **only to upload source
  maps**, but the wrapper is what pulls `instrumentation-client.ts` into the
  client bundle and configures server instrumentation. With them unset, the SDK
  was inert while every other signal looked healthy: the DSN was correct,
  `/api/debug-sentry` returned a textbook 500, and the Sentry project stayed
  empty. Wrap unconditionally; gate only the upload, via
  `sourcemaps.disable`.

  The cheap way to tell the difference: `grep -rl sentry .next/static/chunks/*.js`
  after a build. If the client bundle has no Sentry in it, the wrapper is not
  running, and no amount of DSN-checking will help.

  On the deployed site the same check works, but the path is different: Vercel
  serves chunks from `/_next/static/immutable/chunks/`, not
  `/_next/static/chunks/` as a local build does. Grepping the local path against
  production returns nothing and looks exactly like "Sentry is missing".

- **Two Sentry deprecations on 10.x.** Import `withSentryConfig` from
  `@sentry/nextjs/config`, not `@sentry/nextjs`. Drop `disableLogger` — its
  replacement (`webpack.treeshake.removeDebugLogging`) does nothing under
  Turbopack, which is what Next 16 builds with.

- **`kill` on an `npm start` leaves the server running.** It kills the npm
  wrapper, not the node child, and the next test then hits a stale build and
  proves nothing. On Windows:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen` to find the real PID.
  Verify which build is being served by matching the chunk hash in the HTML
  against the one on disk.

- **Applying the schema needed no database password.** Supabase SQL Editor,
  paste `docs/SCHEMA.sql`, Run. Worth knowing because `supabase db push` needs a
  connection string and the CLI never got one working here.
- **Supabase pooler hostnames carry an index.** A connection string with
  `aws-ap-south-1.pooler.supabase.com` does not resolve; the real hosts are
  `aws-0-ap-south-1...` and `aws-1-ap-south-1...`. If DNS says ENOTFOUND, the
  hostname is wrong, not the network.
- **Direct connection (`db.<ref>.supabase.co`) resolves to IPv6 only** on this
  project. On an IPv4-only home connection it will never connect. Use the
  session pooler for migrations.
- **Because the schema went in through the SQL Editor, the CLI's
  `supabase_migrations.schema_migrations` table does not know about 0001.** The
  first time `supabase db push` runs — Slice 5 — it will try to re-apply
  0001_init.sql and fail on `type "item_status" already exists`. Fix at that
  point with `supabase migration repair --status applied 0001`, do not delete
  the migration file.
- **Two Supabase projects existed briefly and their values got mixed.** The app
  keys pointed at the live project while `SUPABASE_DB_URL` still held a deleted
  one. Nothing catches this except trying to connect — the app keys work fine on
  their own. If a connection error names a project ref that is not in
  `NEXT_PUBLIC_SUPABASE_URL`, that is the bug.
- `next build` **does not need any environment variable**, and it should stay
  that way: `lib/env.ts` validates at module load, but nothing on the public
  landing path imports it. That is what lets CI build without secrets. If a
  build ever starts requiring a key, something on a static route has started
  importing the database layer.
