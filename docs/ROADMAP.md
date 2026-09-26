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

**Last updated: 2026-09-26 — Slice 11 (highlights + notes) done and hand-checked; next is Slice 12, the Trash view.**

- **Slice 11 is deployed and done.** Migration 0010 is applied and verified
  live. Ishank ran the click-list on 2026-09-26 and reported it all fine
  ("sab thik hai"). Twelve of thirteen boxes are ticked. The open one is the
  "not found" panel entry, which cannot occur until the sanitiser or
  `toPlainText` changes. A reviewer workflow found six UI edge-case bugs
  before the push, and all six were fixed. Typecheck, lint, 691 tests and
  `next build` pass.
- **Next: Slice 12, the Trash view.** It is written below (files, Done-when
  and Gotcha) and was shown to Ishank on 2026-09-26; build only after his ok.
  What already exists: soft delete sets `items.deleted_at`, the daily purge
  cron hard-deletes rows deleted more than 30 days ago
  (`purge_deleted_items`), and re-saving a URL resurrects a deleted item
  (Slice 1). Trash means a list of deleted items with Restore and
  Delete-forever, and the delete copy should say how long an item waits.
- **After Slice 12, in order:** the "From your backlog" strip, listen mode,
  reading stats, Pocket/Instapaper import, and AI summary. Migrations
  continue from **0011**.
- **Still open from earlier:** Firefox with the rebuilt extension, and the
  Slice 6 browser checks further down.
- **Working notes for the next agent:**
  - Supabase CLI: `npm-cache/_npx/aa8e5c70f9d8d161/node_modules/.bin/supabase`,
    called by full path with the DB URL read from `.env.local` and never
    printed. It needs sandbox escalation. `db query --file` takes a single
    statement, so verify with a DO block that ends in `raise` (rolls back).
  - Push a migration **before** any code that calls a changed function.
  - Ishank pauses Supabase when idle.
  - Signed-in pages cannot be opened by an agent; hand the click-list over.
    The public `/reader-preview` pages can stand in for anything that only
    needs the article DOM.
  - A reviewer workflow costs a lot of Ishank's budget. Keep reviewers on
    the diff.

_Earlier on 2026-09-26 — the Slice 11 click-list Ishank ran:_ open a ready
article; ✎ beside Aa; select, Highlight, paint; add and save a note (dotted
underline); reload keeps it; triple-click the last paragraph offers
Highlight and Escape dismisses it; clicking a painted highlight opens the
panel; Copy link opens scrolled to it; Aa closes the panel; Delete with a
note asks twice; a highlight after an image survives reload; phone select
and panel.

_Earlier on 2026-09-25 — Slices 9 and 10 done and hand-checked:_

- **Slice 9 (fetch on save)** and **Slice 10 (the extension sends the open
  page)** are deployed. Their migrations 0006–0009 are applied, and every box
  is ticked with its evidence. Ishank confirmed both in Chrome: an /inbox save
  and NDTV saves from the extension were readable within seconds.

_Earlier on 2026-09-24:_

- **Slice 9 is implemented, migration 0008 is applied and verified, and the
  code is pushed.** Two boxes stay open: that an article is readable seconds
  after saving, and Ishank's hand check. Both need a signed-in session or
  the extension token. Typecheck, lint, **635 tests** and `next build` pass.
- **What Ishank must check by hand (about 3 minutes):**
  1. Save a new article URL from /inbox, wait about 15 s, and open it. The
     article is there, not "Making room for the words".
  2. Do the same with the extension toolbar button.
  3. Reload /inbox. Both rows show a reading time. The list does not
     auto-refresh until Slice 8, so reload it.
- **The earlier-slice bug pass below was hand-checked by Ishank on
  2026-09-24:** save, tag/untag, and Try again on an archived failed item all
  behaved.
- **Next:** Slice 10, save the page you are reading (agreed 2026-09-25, ahead of the feature list). After it, highlights + notes become Slice 11 and the rest shift by one.

_Earlier on 2026-09-24:_

- **Four earlier-slice bugs are fixed** (`fa8dea9`, `1d78275`, `c6eab02`),
  found by a read-only review on 2026-09-23 and re-verified before fixing:
  1. `save_item` bypassed the 60/hour limit over PostgREST. `0006` puts the
     limit in Postgres (`enforce_save_limit`, raises `PT429`).
  2. Try again un-archived items and skipped the limit. It now calls the new
     `retry_item`.
  3. `item_tags`/`highlights` did not check that the parent belongs to the
     row's owner. `0007` adds composite foreign keys.
  4. `POST /api/extract` had no caller and no limit, and could flip a ready
     item to failed. It is deleted.

  Stale "six minutes"/"every minute" docs are corrected, and the dead
  `ItemRow`/`EmptyState` components are deleted.
- **0006 and 0007 are applied and exercised on the real database** inside a
  DO block that ends in `raise`, so nothing was kept:
  - an under-limit save succeeds;
  - the 61st save raises `PT429`;
  - retry keeps `archived_at` and queues one job;
  - a cross-user `item_tags` insert fails with `23503`;
  - `enforce_save_limit` is executable by nobody, `retry_item` only by
    authenticated.

  Typecheck, lint, **626 tests** and `next build` pass.
- **What Ishank must check by hand for this pass (about 5 minutes):**
  1. Save a link from /inbox. It saves.
  2. Tag an item and untag it. Both work.
  3. On a failed item that is archived, press Try again in the reader. It
     says "Retry queued" and the item stays in Archive.
- **Supabase is up; Ishank pauses it deliberately when idle.** Restore it
  before any database work. The CLI re-resolved to the same path as before
  (`npm-cache/_npx/aa8e5c70f9d8d161/.../supabase`, 2.117.0). It still needs
  sandbox escalation. `db push --db-url ... --yes` answers the prompt.
  `db query --file` accepts one statement only; wrap multi-step checks in a
  DO block. The Vercel CLI was not re-resolved.
- **Next, agreed 2026-09-24:** write each of these as a slice (checklist and
  Gotcha) before building it, in this order:
  1. fetch on save (`after()` plus an item-scoped claim RPC)
  2. highlights + notes
  3. Trash view
  4. "From your backlog" strip
  5. listen mode
  6. reading stats
  7. Pocket/Instapaper import
  8. AI summary

  Migrations continue from **0008**.
- **Left in place on purpose:** `lib/db/browser.ts` and `optionalEnv` have no
  importers. They are the documented client-component client and the
  optional-key hook; Slice 8 removes them if nothing has used them by then.

_Previous handoff, 2026-09-23 — infrastructure paused; Slice 6 browser checks partly done:_

- **Supabase is PAUSED. Restore it before anything touches the database.**
  Checked 2026-09-23: the project hostname (`kdhj….supabase.co`) returns
  `ENOTFOUND` while `supabase.com` resolves, which is what a paused free-tier
  project looks like. Restoring needs the dashboard (Project → Restore
  project) — there is no Supabase access token in `.env.local`, so an agent
  cannot do it. The Vercel site itself answered 200.
- **Both CLIs have fallen out of the npx cache.** The Supabase binary path used
  in earlier sessions (`npm-cache/_npx/aa8e5c70f9d8d161/...`) no longer
  exists, and `npx vercel crons ls` failed with `npm error Invalid Version`.
  Re-resolve them before relying on either. Still call the Supabase CLI by
  full path, never through `npx`, so the DB password is not echoed.
- **Slice 6 hand-check progress (2026-09-13).** Token generated at
  `/settings/extension`, extension loaded unpacked in Chrome (ID
  `khdhlckkonndfphkflckcpgahikicpjc`, which passes the CORS shape check —
  preflight 204). `Alt+Shift+S` saved a page: the row appeared in `items`
  within a minute. The badge was invisible only because the extension was
  not pinned. **Not yet reported back:** HAVE on re-save, the context menu,
  revocation, and Firefox. Boxes stay unticked until those are seen.

_Previous handoff, still accurate below:_ **Last updated: 2026-09-11, Slice 6 deployed and server-side verified; browser hand checks remain open.**

- **Implemented:** Slices 0–7. Slice 6 has automated verification and its
  database migration is applied; deployed token authentication returns 500,
  and Chrome/Firefox and signed-in hand checks below are still open. Unrelated
  earlier slices were not re-verified or fixed.
- **Shipped code:** `fa6ff5b` (backend/shared save) and `03f2093` (extension)
  are pushed to `origin/main`. Vercel reports deployment
  `dpl_ERkWc5ewLa9i7gd1CvS3VBTBuTwR` Ready at commit `03f2093`.
- **That deployment issue is closed, 2026-09-11. It was an empty secret.**
  `EXTENSION_TOKEN_SECRET` was named in `.env.local` and on Vercel but held no
  value, so `extensionTokenSecret()` threw its 32-character check and the route
  caught it as a 500. That is why a *malformed* token answered 401 correctly —
  the format check rejects it before the secret is ever read — while a
  well-formed unknown one reached the secret and blew up. Ishank generated a
  64-hex value into `.env.local` and both Vercel environments and redeployed.
  Re-probed against the deployment since: unknown well-formed token 401,
  malformed token 401, no auth 401, foreign website origin 403, and OPTIONS
  204 from both a `chrome-extension://` and a `moz-extension://` origin with
  the exact origin echoed and `Retry-After` exposed.
- **The CORS allowlist pins no extension ID**, it matches the shape — Chrome
  IDs are 32 characters of a-p, Firefox a UUID. An unpacked extension's random
  ID therefore works with nothing to configure. Worth knowing before anyone
  tries to "fix" a 403: a test origin using letters past p is correctly
  rejected, and that is the regex doing its job, not a bug.
- **Slice 6 browser package:** `extension/` builds the same source into
  `dist/chrome` (MV3 module service worker) and `dist/firefox` (MV3 module event
  page). Toolbar save, link context menu, rebindable shortcut, persistent badge
  feedback, local token storage and durable offline retries are implemented.
  The only permissions are activeTab, storage, contextMenus, alarms and the
  single API host. No popup intercepts the toolbar click. Browser code and
  tests stay out of the Next/browser bundle; server/web helpers under the
  extension directory are explicitly separate from the extension build.
- **Slice 6 backend:** `/settings/extension` generates and revokes long-lived
  save-only tokens. Only HMAC-SHA256 hashes keyed with the existing
  `EXTENSION_TOKEN_SECRET` are stored in Postgres; plaintext is returned once.
  Only `/api/save` accepts these opaque tokens. Cookie authentication remains
  the web path; an invalid bearer never falls back to cookies. CORS and an
  explicit OPTIONS handler cover the extension path and its error responses.
- **Both reviewed changes are approved and implemented.** There is one SQL
  upsert body in service-role-only `save_item_impl(uuid,text,text,text)`;
  SECURITY DEFINER `save_item(text,text,text)` supplies `auth.uid()`.
  Re-saving through either door resurrects archive/delete state, preserves
  reading state/favourites/tags/highlights, and only requeues non-ready items.
  The extension reads the existing `alreadySaved` response field.
- **The shared limiter requires an explicit scope.** Session scope adds no
  user-id filter and preserves the existing RLS read. User scope requires
  the verified token owner's user id and always filters by it. The API uses
  that same scope for its implementation RPC. Both use unchanged
  `decideRateLimit` arithmetic and the same save_events counter. Two-user and
  mixed web/extension tests cover the isolation and shared allowance.
- **Migration 0005 is applied to the real database.** Dry run named only 0005;
  push applied only 0005 with vault/seed/role-file changes excluded. Read-only
  checks confirm RLS on all nine tables and three token policies; anon and
  authenticated cannot execute the implementation, service_role can, and the
  authenticated wrapper remains SECURITY DEFINER. Sessions can revoke tokens
  but cannot read hashes, change owners or delete tokens. The repeatable check
  is `extension/server/verify-schema.sql`; its results are in Notes below.
- **Verification:** root typecheck, lint (zero warnings), **620 tests**, and
  Next production build pass. The four extension scripts also pass, including
  **33 browser tests** and both output builds. Unit tests use injected fetch
  and clock, never network. The new settings route appears in the Next build.
  All review scratch is deleted; no new dependency was added.
- **What you must verify by hand:** follow `extension/README.md` in Chrome and
  Firefox: load the built package, generate/paste a token, save via toolbar,
  link menu and rebound shortcut; inspect success/failure badges; re-save an
  archived/deleted article with reading state; disconnect/reconnect network
  and reload the worker; verify revocation and the shared web/extension limit.
  These browser/signed-in checks are not claimed as performed.
- **Tooling:** use the existing npm CLI directly if the PowerShell shim points
  at inaccessible Roaming npm:
  `node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' ...`.
  The installed Supabase CLI lives at
  `C:/Users/LOQ/AppData/Local/npm-cache/_npx/aa8e5c70f9d8d161/node_modules/.bin/supabase.cmd`.
  It needed sandbox escalation to write local telemetry; its database commands
  then worked with the configured URL. Use `db query --db-url ... --file ...`
  instead of multiline positional SQL through the Windows command shim. Never
  invoke npx with credentials; they are redacted from all command output.
  Vercel CLI 59.15.1 is installed but its stored login was rejected as invalid;
  production environment names could not be listed through that CLI. The
  existing Vercel browser session did allow read-only deployment, environment
  name and request-log inspection.
- **Next:** resolve the deployed token-auth 500, then complete the hand checks
  before Slice 8. Existing known issues stay
  there: server-side Sentry is dead, crons are DAILY due to Vercel Hobby, the
  list does not auto-refresh, and nothing writes read_at. Do not fix them in
  Slice 6. Carry forward earlier session-refresh/reader/index/pagination hand
  checks, generated DB types, custom domain and reader-preview decisions.
  Slice 8 owns splitting filter-bar.tsx. Search was hand-verified by Ishank in
  Slice 5; body matches await extraction and `gpu`/`GPUs` stemming still differs.
  The prior database-password rotation remains closed; no credentials need
  to be requested from the user.

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
`supabase/migrations/0004_search.sql`, `components/search-input.tsx`

> **Numbering corrected 2026-09-10.** This said `0002_search.sql`, written
> before 0002 and 0003 existed. `test/schema.test.ts` fails on two migrations
> sharing a number, so the next free one is `0004` — and it is needed only if
> something is genuinely missing, because both `search_tsv` columns and both
> GIN indexes already ship in `0001_init.sql`.

### Done when

- [x] Full-text search across title, excerpt, author, site name and body, using
      the `search_tsv` columns and GIN indexes already in the schema.
- [x] Ranking is weighted: a title match outranks a body match. Verified with
      real saved articles, not with three fixtures.
- [x] The query parser is pure and tested: quoted phrases, `-exclusion`, and
      `tag:foo` are understood, and a user typing `?` or `&` or an unbalanced
      quote does not produce a Postgres syntax error. Never interpolate user
      input into `to_tsquery`; use `websearch_to_tsquery`.
- [x] Result snippets show the match in context with the term highlighted, via
      `ts_headline`.
- [x] Search combines with the Slice 4 filters rather than replacing them.
      _Ticked for the composition itself, which is what the box asks: every
      filter travels in the URL under the Slice 4 names, through the same
      `parseFilters`, into the query — `state=inbox` returns three for
      `quantum` and `state=archive` returns none, so the parameter demonstrably
      reaches the SQL. `page` and the lookahead are verified properly._
      **Read the limit before trusting this.** Nothing in the library is
      archived, favourited, read, or tagged, so `archive`, `favourites`,
      `read` and a required tag were only ever shown to return **nothing**.
      That proves each predicate fires; it does not prove any of them selects
      the right rows. Archive one item, mark one read, tag one, then repeat
      the four searches — that is the check this note is standing in for._
- [x] Empty result state suggests something useful.
      _Confirmed on the live site by Ishank, 2026-09-11. It names whichever
      filter, exclusion, phrase or tag narrowed the search to nothing, and
      says when a saved link has no article text yet._
- [ ] `explain analyze` on a search over 1,000+ items shows the GIN index in use
      and runs under 100 ms. Paste the plan into Notes from the field.
      _There are 9 extracted articles in the real database as of 2026-09-10, so
      the 1,000-item half of this cannot be honestly closed yet. Run the plan
      against what exists, paste it, and leave the box unticked with the row
      count written next to it. Do not seed a thousand fake rows to tick it —
      a plan tuned against generated text says nothing about real articles._
      **Done as instructed: both plans are in Notes from the field, taken at
      12 items and 9 bodies. At that size the planner picks sequential scans,
      as it should. With `enable_seqscan = off` the same query uses
      `items_search_idx` and `item_content_search_idx`, which settles the
      shape question in the Gotcha but not the size question in this box.**
- [x] Searching returns only your own items. Verified with two accounts.
      _Both real profiles, as the `authenticated` role carrying each one's JWT
      claim, so the actual RLS policies did the filtering: the account owning
      the nine articles got three hits for `quantum`, the second profile got
      none. `anon` and `service_role` are both refused the function outright
      over HTTP — see Notes from the field._

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

Automated checks and migration verification are complete. The deployed token
path returns 500 and remains open alongside browser and signed-in checks below;
the exact walkthrough is in "extension/README.md".

- [ ] Manifest V3. Works in Chrome and Firefox from the same source. Both builds pass; loading them in the actual browsers remains a hand check.
- [ ] One click on the toolbar icon saves the current tab. Success and failure
      are both visible without opening the popup — badge or icon state. Offline event/feedback tests pass; actual toolbar display remains a hand check.
- [ ] Context menu: "Save link to Marrow" on any link. Registration/destination tests pass; verify the real browser menu by hand.
- [ ] Keyboard shortcut, user-rebindable. Command tests pass; verify OS/browser rebinding by hand.
- [ ] Auth is a long-lived token generated in the web app settings page, pasted
      once into the extension. No cookie sharing, no OAuth flow. Hash issuance tests pass; signed-in generation/paste remains a hand check.
- [ ] The token is stored in `chrome.storage.local`, never in `localStorage`,
      and is revocable from the web app. Local storage tests and live DB grants pass; web revocation remains a hand check.
- [ ] `/api/save` accepts the token, sets a tight CORS policy, and rate-limits
      per user exactly as the web path does. Offline route/two-user/mixed-entry tests and deployed CORS pass; live token verification returns 500 (see handoff), so acceptance is not verified.
- [x] Saving the same page twice reports "already saved" with Slice 1 resurrection and reading-state preservation,
      exercising the Slice 1 gotcha through a second entry point. SQL body equality and response/argument tests pass; the real archive/delete walkthrough remains manual.
- [x] Offline: the save is queued and retried when the network returns. Injected fetch/clock tests cover durable replay, retries, rate-limit delay and token replacement; physical network/worker reload remains manual.
- [x] `extension/` builds with its own script and is not bundled into the
      Next.js app. Both builds and their standalone scripts pass; only explicitly separate server/web helpers are imported by the app.

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

- [x] `/api/cron/extract` claims a batch with `for update skip locked` and
      processes it. Two overlapping invocations never process the same job.
      Verified on the deployment: six jobs queued, two invocations fired at the
      same instant. One claimed `[16, 15, 13, 14, 17]`, the other claimed
      `[18]` — disjoint, every job claimed exactly once, both returned in 6.4 s
      with neither blocking on the other.
- [x] Retries: 3 attempts, backoff 1 / 5 / 25 minutes, and **only** for
      `unreachable` and `server_error`. A 404 is never retried.
      Verified on the deployment, whole lifecycle — see Notes from the field.
      The 25-minute step is unreachable while `max_attempts` is 3; that reading
      is deliberate and recorded in ARCHITECTURE section 13.
- [x] A job stuck in `running` with a stale `locked_at` is reclaimed.
      Verified on the deployment by backdating `locked_at` ten minutes — the
      only way to produce a crashed worker on demand. Both branches: a job with
      attempts left went back to `queued` and was picked up in the same run; a
      job whose attempts were spent closed as `failed` with `last_error =
    stalled` **and its item was resolved to `failed` / `server_error`**,
      which is the half that stops a permanent spinner.
- [x] `/api/cron/purge` hard-deletes items soft-deleted more than 30 days ago.
      Verified on the deployment in both directions, with `deleted_at`
      backdated by hand because this database is two days old. An item deleted
      31 days ago was purged and took its `item_content` and `fetch_jobs` rows
      with it through the cascade; an item deleted 5 days ago was left
      completely untouched, which is what makes undo mean anything.
- [x] Every cron route rejects a request without `Authorization: Bearer
${CRON_SECRET}` — verified by calling it from outside with curl and
      getting a 401. Both routes, and also for a wrong token and a wrong
      scheme. `lib/queue.test.ts` pins the shapes curl cannot easily send.
- [x] `vercel.json` schedules both jobs and they are visible as running in the
      Vercel dashboard. Both appear under Settings, Cron Jobs, enabled, and
      both have run — `GET /api/cron/purge` and `GET /api/cron/extract` are in
      the deployment's runtime logs. **The schedule is daily, not per minute:
      Hobby rejects anything more frequent. See the note below.**
- [x] Rate limit on `/api/save`, counted in Postgres per user, with a documented
      limit and a `Retry-After` header on rejection. `lib/rate-limit.ts` is
      tested with an injected clock, not with `setTimeout`.
      Sixty per rolling hour. Tripped deliberately on the deployment: `429`,
      `Retry-After: 3345`.
- [x] A save while over the limit gives a clear message, not a generic 500.
      "That is 60 saves in an hour, which is the limit. Try again in 55
      minutes." — shown in the save form, which already renders the error body.
- [ ] Extraction failures reach Sentry with the URL and the failure code.
      _Correct from a local run against the real database — `cron/extract:
    forbidden` is in Sentry with its URL. **Blocked on a Slice 0 fault, not a
      Slice 7 one: server-side Sentry is dead on the deployed app entirely.**
      `GET /api/debug-sentry` returns a 500 in production and produces no event
      either, and that route exists in order to answer exactly this question.
      Over 24 hours the project holds three events, all from localhost. Adding
      `await Sentry.flush(2000)` to the cron return paths was the first guess;
      it is correct practice for a serverless function and it is kept, but it
      is not the cause. **Do not chase this inside a feature slice — see the
      entry under Slice 8.**_
- [ ] `blocked_url` events are logged and countable — a spike means someone is
      probing the fetcher.
      _The failure path is verified on the deployment, twice: saving
      `127.0.0.1` produced `failed` / `blocked_url` on the first attempt with
      no retry, which is also the first live proof of the section 5 guards. The
      route raises this one to `warning` where every other reason is `info`, so
      a spike is countable. Whether the event actually arrives is the same
      Slice 0 fault as the item above, and unticks with it._

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

- [ ] Split `components/filter-bar.tsx` (872 lines) before launch. While it is
      open: give `filterUrl` a path so `/search` can use the real `FilterBar`
      instead of its own copy of three dropdowns, and offer "search everything
      for this" when the on-page find comes up empty. The two search
      affordances currently have nothing joining them, and the first person to
      use search typed four full-text queries into the wrong box.
- [ ] **`items.read_at` is never written by anything.** Found while verifying
      Slice 5. The column is declared in 0001, three filters read it, the
      library row and the search result both render "Read"/"Unread" from it —
      and no code anywhere sets it. Not the reader, not a button, not a
      function; `grep -rn read_at` finds no update, insert or upsert. So every
      item is permanently Unread and `read=read` can never return a row, in
      the library and in search alike. **This is a gap in Slice 3 or Slice 4,
      and it was deliberately not fixed inside Slice 5** — a fix to somebody
      else's slice buried in an unrelated diff is a fix nobody reviews. Decide
      where it belongs: the reader marking an article read at some scroll
      threshold, an explicit control on the row, or both.
- [ ] Implement the guarded `/api/img` proxy from ARCHITECTURE §7 and switch
      reader images from opt-in source requests to automatic proxied lazy
      loading. Preserve the reserved frames, SSRF guards and failure states.
- [ ] **Server-side Sentry does not work on the deployed app. Fix it before
      anything else here, and in its own change.** Found during Slice 7:
      `GET /api/debug-sentry` returns a 500 in production and no event ever
      arrives, while the identical code reports fine from `next dev`. The
      Sentry project holds only localhost events. Everything downstream of this
      is affected — extraction failures, `blocked_url` counting, and the two
      Slice 7 boxes that stay unticked because of it. `SENTRY_DSN` _is_ set on
      Production, so start elsewhere: whether `instrumentation.ts` `register()`
      actually runs on Vercel under Next 16's Turbopack build, and whether
      `withSentryConfig` instruments the server bundle there at all. Prove the
      fix with `/api/debug-sentry` **before** deleting it.
- [ ] **`/api/debug-sentry` is deleted** — after, and only after, it has been
      used to prove the box above. (Added in Slice 0 for exactly this.)
- [ ] **Stop Next buffering `/api/save` bodies in the proxy.** `proxy.ts`
      matches every route, and Next clones and buffers a request body for
      the proxy (up to `proxyClientMaxBodySize`, 10 MB) before the route's
      own byte cap runs. On Vercel the 4.5 MB request limit bounds it.
      Either exclude `/api/save` from the matcher, since the route
      authenticates itself, or set the limit just above
      `SAVE_BODY_MAX_BYTES`. Found by the Slice 10 review.
- [ ] **Decide what happens when a page's canonical URL is already saved.**
      `adoptCanonicalUrl` in `lib/queue.ts` swallows the unique-key collision,
      so the two items stay two items. Merging means choosing where read
      position, tags and highlights go. Earlier code said "tracked in
      ROADMAP.md", but it never was until 2026-09-24.
- [ ] **Launch decision on extraction latency.** ARCHITECTURE section 10: on
      Hobby's daily cron a save can wait a day to become readable, and a
      retriable failure waits a day per attempt. The fetch-on-save slice is
      the planned answer for the first save; retries still need a decision.
      This was also said to be tracked here and was not.
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
- [ ] **A `pending` item becomes `ready` on screen without a manual reload.**
      Today the list is server-rendered and never re-checks, so a row keeps
      saying "Fetching the article" until the reader presses F5 — even when the
      article arrived twenty minutes ago. Slice 7 made this visible rather than
      causing it: extraction now genuinely completes, so the stale row is the
      only thing left lying. On a daily cron the lie can last a day. Poll only
      while something on screen is pending, and stop when nothing is.
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

## Slice 9 — fetch on save

**Agent:** Claude Code. Needs the real database and a deploy.
**Files:** `app/api/save/route.ts`, `components/reader/actions.ts`,
`components/reader/reader-state.tsx`, `lib/queue.ts`, `lib/extract-now.ts`
(new), `app/api/cron/extract/route.ts` (shares the failure reporter),
`supabase/migrations/0008_claim_item_job.sql`

Numbered 9 because it was written after 8, not because it waits for it. Slices
9–16 are the feature list agreed on 2026-09-24 (see Where things stand).

### Done when

- [x] A link saved from `/inbox` or the extension becomes readable within
      seconds, without waiting for the daily cron. `/api/save` answers first
      and fetches in `after()`.
      Verified on 2026-09-24 from job timestamps on the deployment. Al Jazeera
      was ready 2 s after the save and UN News 7 s after. The three failures
      that evening settled in 1–3 s instead of waiting for the next day.
- [x] Only the job that save queued is claimed, through
      `claim_fetch_job_for_item(item, owner)`: service-role only,
      `for update skip locked`, and attempts counted exactly as in
      `claim_fetch_jobs`. Zero rows (a job already running, or a ready re-save
      that queued nothing) means nothing happens.
      Verified live in a rolled-back block: wrong owner claims 0, owner claims 1 with attempts 1, a second claim gets 0, and only service_role can execute it.
- [x] A ready re-save schedules no work.
      Route test.
- [x] Try again in the reader fetches immediately as well, after `retry_item`
      has spent the limit.
      Action test: scheduled after `queued`, not after `limited`.
- [x] A fetch cut off by the platform is no worse than today: the row stays
      `running` and the daily run's stale-lock reclaim picks it up.
      `maxDuration` is set on the save route.
      By construction: the claim sets `running`/`locked_at` exactly as the cron does, and the reclaim path was verified live in Slice 7.
- [x] Failures go through the same reporter as the cron. Server-side Sentry is
      still dead, so the check is the `items`/`fetch_jobs` rows.
      `lib/extract-now.test.ts`; the cron route now imports the same `recordJobReport`.
- [x] The pending copy is honest: usually ready in seconds, and a site that
      does not answer is retried by the daily run.
- [x] Tests cover: the route schedules only for a non-ready item, the job is
      claimed for the right item and owner, and nothing runs when the claim is
      empty. `after()` is mocked; it throws outside a request scope.
- [x] ARCHITECTURE section 10 and the decision log say this, replacing "the
      remedy is a plan or an external scheduler, not a code change".
- [x] Hand check by Ishank: save from `/inbox` and from the extension, open
      each about 15 s later, and the article is there.
      /inbox is confirmed by Ishank ("manually diya to instant aa gaya"). The
      extension has not been reported yet.

### Gotcha

Claim before you fetch, and claim *this item's* job. `claim_fetch_jobs(n)`
takes the oldest jobs of any user, so reusing it inside one user's request
would fetch strangers' links on their time. Fetching without claiming at all
lets the cron, a double tap or the extension's offline replay fetch the same
URL twice, and skips the attempt count that ends retries.

Second: the `after()` callback must build a service-role client. The session
client in the route is RLS-scoped, and `item_content` and `fetch_jobs` accept
writes from the service role only. It fails silently, because Sentry is dead
and the response has already gone.

## Slice 10 — save the page you are reading

**Agent:** Claude Code. Extension and API together; needs a deploy and a
reload of the unpacked extension.
**Files:**
- `extension/background.ts`, `extension/browser.ts`, `extension/core.ts`,
  `extension/manifest.json`, `extension/README.md`, `extension/test/`
- `app/api/save/route.ts`, `lib/save-body.ts` (new), `lib/extract-now.ts`,
  `lib/queue.ts`

Agreed with Ishank on 2026-09-25 after fetch-on-save showed how often
publishers refuse a server. On 2026-09-24:
- NDTV (Akamai) answered 403 to any non-browser client.
- openai.com (Cloudflare) answered 403 to our honest User-Agent.
- analyticsindiamag (Cloudflare) served a script shell with no article.

The page the reader is looking at has already loaded in their own browser.
The extension sends that page with the save, and the server extracts it
exactly as it would a fetched one. Nothing pretends to be a browser; the
alternative, a Chrome User-Agent on the server, was considered and rejected
(ARCHITECTURE section 5, guard 12).

### Done when

- [x] Toolbar click and the shortcut send the open tab's HTML with the URL.
      The context-menu link save stays URL-only, because that page was never
      opened.
      Background tests. The page also reports its own `location.href`, and the HTML is sent only if that matches the saved URL (review finding: an SPA route change between click and read).
- [x] The only new permission is `scripting`, used on the active tab at the
      moment of the click. It is explained in one sentence in the README's
      store text.
      Firefox's generated manifest also declares `websiteContent` data collection.
- [x] `/api/save` reads the body with a byte count as it arrives and refuses
      anything over `SAVE_BODY_MAX_BYTES` with 413. The extension checks the
      same constant first and drops the page, not the save, when it is too
      big.
      Route and `lib/save-body.test.ts`. The review found that `proxy.ts` makes Next buffer the body before the route runs, so the cap bounds parsing, not receipt; that is now a Slice 8 item. The extension upload timeout grows with the body, to 45 s at the cap.
- [x] A submitted page goes through the same extract and sanitise pipeline and
      the same job bookkeeping as a fetched one, claimed through
      `claim_fetch_job_for_item`. The server fetches nothing for it.
      `lib/queue.test.ts` hands `processJob` a hostile page with the fetcher mocked to throw: no fetch, stored and sanitised. 0009 (`p_page_sent`) lets a sent page skip the fetch backoff. Verified live in a rolled-back block: backoff without a page claims 0, with a page claims 1.
- [x] A ready item keeps its body; a submitted page never replaces a copy we
      already have.
      Route test.
- [x] An offline save is queued as a link only. Page HTML is never persisted in
      extension storage, and a replay falls back to the server fetch.
      Core test: the stored state never contains the page, and the replay body is `{url}`.
- [x] A page the browser will not let the extension read (Web Store,
      `chrome://`, PDF viewer) is still saved as a link.
      Background test.
- [x] ARCHITECTURE section 1 says a submitted page is not client-side
      extraction. Sections 5 and 9 say the submitted HTML is untrusted input
      with the same sanitiser and its own byte cap.
- [x] Tests for the route (html accepted, too big, wrong type), the queue (a
      supplied page skips the fetcher), the extension (capture on click and
      command, none for a link, no HTML on replay, oversize dropped) and the
      manifest permissions.
      Root 649 tests and extension 37 tests pass. So do typecheck, lint, the Next build and both extension builds; `node --check` parses the built files.
- [x] Hand check by Ishank, after reloading the extension and accepting the new
      permission: save the NDTV and openai.com articles from the open tab,
      and both are readable.
      Done in Chrome on 2026-09-25: two NDTV articles saved with the
      shortcut were ready about 2 s later, at 743 and 418 words. An earlier
      attempt that day reached nothing, most likely because the extension had
      not been reloaded yet. Firefox has not been checked.

### Gotcha

The HTML comes from the party we are defending against: anyone holding a
token can send any markup for any URL. That is acceptable only because it
lands in their own library, goes through the same sanitiser as every
fetched page, and never becomes a fetch. The body cap has to be counted as
bytes arrive, not trusted from Content-Length. And a submitted page must
never replace a ready item's body, or re-saving a page becomes a way to
rewrite an article.

Second: HTML must not go into the offline queue. `chrome.storage.local`
holds about 10 MB in total; a hundred queued pages would fill it and fail
every save after it, including the token write.

## Slice 11 — highlights + notes

**Agent:** Claude Code. Needs the real database for the migration; the UI
checks are Ishank's, because an agent cannot sign in.
**Files:**
- `supabase/migrations/0010_highlight_limits.sql` (new), `docs/SCHEMA.sql`
- `lib/extract.ts` (export `toPlainText`), `lib/plain-text.ts` (new: the
  block list both sides share), `lib/highlights.ts` (new: caps, validation,
  re-anchoring), `lib/highlight-dom.ts` (new: rendered DOM to plain-text
  offsets and back)
- `components/reader/highlight-actions.ts` (new), `components/reader/highlights.tsx`
  (new), `components/reader/reader.tsx`, `components/reader/reader-surface.tsx`,
  `app/(app)/read/[id]/page.tsx`, `app/globals.css`
- `test/highlight-actions.test.ts` (new), `lib/highlights.test.ts` (new),
  `lib/highlight-dom.test.ts` (new), `test/schema.test.ts`,
  `lib/reading.test.ts`

Design notes from the 2026-09-23 review, agreed 2026-09-25. The table,
its RLS and the owner-checked foreign key (0007) already exist; nothing has
written to it yet.

### Done when

- [x] Selecting text in a ready article offers **Highlight**. Saving it
      stores `quote`, `start_offset`, `end_offset` and paints it at once.
      Left for Ishank's hand check: no agent can open a signed-in page. The
      pieces are tested (mapper, action, render), and a review found that a
      triple-click on the last paragraph ended outside the article and was
      refused; it is now clamped (`ae67dcd`).
      Confirmed by Ishank on 2026-09-26 against the click-list in Where
      things stand ("sab thik hai").
- [x] Painting uses the CSS Custom Highlight API (`CSS.highlights` and
      `::highlight()`). The rendered article HTML is never mutated: no
      `<mark>`, no wrapped spans, no `innerHTML`.
      Render test: the signed-in reader's HTML has no `<mark>`. The
      `::highlight()` rules survive the production CSS build and painted
      ranges on the longform preview in the pane's Chromium.
- [x] Offsets are UTF-16 code units into
      `toPlainText(sanitiseArticleHtml(item_content.html))`, computed at
      read time. The server action recomputes that text and refuses a
      highlight whose `text.slice(start, end)` is not exactly `quote`.
      `test/highlight-actions.test.ts`, including a script the sanitiser drops.
- [x] The DOM mapper reproduces `toPlainText` on the rendered article: it
      skips the whole `.reader-image` span and any `noscript`, treats the same
      block elements as word boundaries and collapses whitespace the same
      way. A test renders the reader fixtures and asserts the mapper's text
      equals `toPlainText` of the same HTML.
      Also matched after hydration in a real Chromium on the longform,
      news-article and bare-title previews (same length and hash). The
      review ran about 5,000 native `Selection.modify` selections through it
      in Chromium and every one mapped and round-tripped.
- [ ] On load, each highlight is re-anchored: offsets first if they still
      match the quote, otherwise the occurrence of `quote` nearest to
      `start_offset`. One that anchors nowhere is still listed in the panel,
      marked as not found in this copy, and is never painted somewhere
      wrong.
      `anchorQuote` is unit-tested. The "not found" entry has not been seen
      in a browser, and nothing can produce a lost highlight until the
      sanitiser or `toPlainText` changes.
- [x] A note can be added, edited and removed on any highlight, and a
      highlight can be deleted.
      Actions tested.
      Confirmed by Ishank on 2026-09-26 against the click-list in Where
      things stand ("sab thik hai").
- [x] 0010 caps lengths in SQL (quote at most 2,000 characters, note at most
      10,000) and narrows the column grants: sessions may insert only the
      content columns and may update only `note`. Verified live in a
      rolled-back block: an over-long quote fails, an update of `quote` or
      offsets is refused, an update of `note` succeeds.
      2026-09-25, as the owner of the newest item: over-long quote and note
      23514; update of quote, of start_offset, and an insert naming `id` all
      42501; note update and delete succeed. Zero rows existed beforehand.
- [x] A **Highlights** panel in the reader toolbar lists every highlight in
      reading order with its note. Tapping a painted highlight opens it in
      the panel.
      Changed from "where `highlightsFromPoint` exists": taps are hit-tested
      against the ranges' boxes, which works on iPhone Safari too. Even the
      pane's Chromium has no `highlightsFromPoint`.
      Confirmed by Ishank on 2026-09-26 against the click-list in Where
      things stand ("sab thik hai").
- [x] `/read/[id]?h=<highlight id>` scrolls to that highlight and suppresses
      the saved-position restore. The panel's **Copy link** produces it.
      The page suppresses the restore only when it finds the quote in
      today's text, and ReaderSurface decides once, at open (both review
      findings).
      Confirmed by Ishank on 2026-09-26 against the click-list in Where
      things stand ("sab thik hai").
- [x] The public `/reader-preview` fixtures do not offer highlighting; they
      have no database.
      Render test: no Highlights control with `preview`, for a pending item,
      or when the highlights query failed.
- [x] Tests: validation (match, mismatch, surrogate pairs, caps), re-anchoring
      (moved, duplicated, missing quote), the DOM mapper against the
      fixtures, the server actions (refuses a mismatch, a foreign item and an
      oversize note; updates only `note`), and the migration text.
      691 tests pass, with typecheck, lint and `next build`.
- [x] ARCHITECTURE section 7 describes highlights; SCHEMA.sql matches 0010.
- [x] Hand check by Ishank (click-list in Where things stand), in Chrome and on
      a phone.
      Confirmed by Ishank on 2026-09-26 against the click-list in Where
      things stand ("sab thik hai").

### Gotcha

The offsets are only meaningful against one exact string, and there are
three candidates that look alike: the stored `item_content.text` (made by
the sanitiser of the day the item was fetched), `toPlainText` of today's
sanitised HTML, and the text the browser actually shows. The reader renders
today's sanitised HTML, so offsets must be counted against
`toPlainText(sanitiseArticleHtml(html))` at read time, and the DOM mapper
must reproduce that function exactly. The image placeholder is the trap: it
renders "Load image ↗" and the alt text, which `toPlainText` never saw, so a
mapper that counts it shifts every highlight after the first image.

Second: the stored quote is the truth, the offsets are a hint. A
re-extraction or a sanitiser change moves offsets silently. Re-anchor by
quote, and when the quote is not there, say so in the panel rather than
painting the right length of the wrong sentence.

---

## Slice 12 — Trash

**Agent:** Claude Code. Needs the real database for 0011; the UI checks are
Ishank's, because an agent cannot sign in.
**Files:**
- `supabase/migrations/0011_trash_index.sql` (new), `docs/SCHEMA.sql`
- `lib/constants.ts` (`PURGE_AFTER_DAYS`), `lib/queue.ts` (derives
  `PURGE_AFTER` from it), `lib/trash.ts` (new: the countdown, id and cutoff
  validation)
- `app/(app)/trash/page.tsx` (new), `app/(app)/trash/actions.ts` (new),
  `components/trash-list.tsx` (new)
- `components/filter-bar.tsx` (a Trash link and the delete copy, nothing else)
- `lib/trash.test.ts` (new), `test/trash-actions.test.ts` (new),
  `test/trash-ui.test.ts` (new), `test/organise-ui.test.ts`,
  `test/schema.test.ts`

Design notes from a read-only investigation on 2026-09-26. Soft delete, the
library's in-page Undo and the 30-day purge already exist (Slices 1, 4 and
7). What is missing is a place to see what was deleted, get it back once the
page holding its Undo is closed, and remove it for good.

- A separate `/trash` page, not a fourth state in the library. The library
  refuses every action except restore on a trashed row, `matchesFilters`
  hides deleted rows, and `filter-bar.tsx` is already the file Slice 8 has to
  split.
- No optimistic queue. Delete forever cannot be undone, so the page shows
  only what the server confirmed: buttons disable while an action runs, then
  the page reloads from the server.
- The session client and RLS only. `items_delete_own` already lets a session
  hard-delete its own rows; no SQL function and no service role is needed.

### Done when

Fixed first, in their own commits. Ishank agreed on 2026-09-26; both are
earlier-slice bugs found while designing this one.

- [ ] The library's Undo restored its batch all-or-nothing. Once Trash can
      delete one of its items forever, Undo would fail for the rest on
      every click. Restore now brings back what still exists and says what
      is gone (`app/(app)/actions.ts`, `test/organise-actions.test.ts`,
      `test/organise-ui.test.ts`).
- [ ] The save form said a re-save "brought it back to the top". The inbox
      sorts by `created_at`, which a re-save does not change
      (`components/save-form.tsx`).

The slice itself:

- [ ] `/trash` lists the signed-in user's deleted items, newest deletion
      first (`deleted_at desc, id desc`), 50 to a page with a lookahead row
      and `?page=` links. The library's heading row links to it.
- [ ] Each row shows the title as plain text (the reader refuses a trashed
      item, so nothing links to `/read`), the site, an **Open original ↗**
      link, how long ago it was deleted and when it goes.
- [ ] The countdown is one pure function, `purgeCountdown(deletedAt, now)`,
      with `now` taken once on the server. It rounds down, says "less than a
      day" under 24 hours, and past the deadline says the item goes at the
      next daily clean-up — never "0 days" and never a negative number.
      Table-tested at 30 days, 29 days 23 hours, 1.5 days, 23 hours, zero,
      minus 3 days and a `deleted_at` in the future.
- [ ] The number 30 lives once, as `PURGE_AFTER_DAYS` in `lib/constants.ts`.
      `lib/queue.ts` derives `PURGE_AFTER` from it, and a test fails if they
      drift. No client component imports `lib/queue.ts`, which pulls in
      `node:` modules.
- [ ] **Restore** clears `deleted_at` only where it is still set. The item
      goes back where it was (to Archive if it was archived). A row already
      restored or re-saved elsewhere is reported as that, not as an error.
- [ ] **Delete forever** asks twice, in place, and says what goes with the
      item: the saved copy, highlights and notes, reading position and tag
      links (the tags themselves stay). It deletes only rows whose
      `deleted_at` is still set, so an item re-saved or restored in another
      tab after the page loaded survives.
- [ ] **Empty trash** opens a dialog that states the count, then deletes in
      one statement bounded by the newest `deleted_at` in the trash when the
      page loaded, passed back as the raw database string. An item trashed
      in another tab after that survives. The button is disabled when the
      trash is empty.
- [ ] The library's delete copy says where things went. The undo panel reads
      "Moved N item(s) to Trash". Its footnote says Trash keeps items for 30
      days and links there. The `#` help line says "Move to Trash". The
      Delete button keeps its label.
- [ ] 0011 adds `items_trash_idx on items (user_id, deleted_at desc, id desc)
      where deleted_at is not null`. It is applied live, and `explain` with
      sequential scans off shows the Trash query using it.
- [ ] Verified live in a rolled-back block, as an item's owner under
      `authenticated`: the Delete-forever statement removes a trashed item
      and cascades to its `item_content`, `item_tags` and `highlights`,
      although none of those has a session delete policy. The same statement
      leaves a live item alone.
- [ ] Tests: the countdown table; id and cutoff validation; each action's
      predicates (`deleted_at is not null` on restore and delete, the cutoff
      on Empty trash, count mismatches reported); nothing under
      `app/(app)/trash` imports `lib/db/service`; the list render (rows,
      empty state, the two-step delete, the dialog's count); the library's
      new copy; and the migration text.
- [ ] ARCHITECTURE sections 4 (Soft delete) and 7 describe Trash;
      SCHEMA.sql matches 0011.
- [ ] Hand check by Ishank (click-list in Where things stand), in Chrome and
      on a phone.

Not in this slice: bulk selection or keyboard shortcuts in Trash; a Restore
button on the reader's "not available" page; fetching a restored item that
was still pending (it waits for the daily run, exactly as it does after the
library's Undo today).

### Gotcha

Trash has two clocks, and neither is the reader's. An item becomes
purgeable 30 days after `deleted_at`, but it only goes when a daily cron
succeeds: within an hour of 04:17 UTC, and later still if Supabase is
paused. So the countdown rounds down and, past the deadline, says "at the
next daily clean-up", never "0 days". Take `now` once on the server and
pass it down. A `Date.now()` in a client render disagrees with the server's
and trusts a device clock that may be wrong.

Second: Delete forever and Empty trash act on a list that went stale the
moment it rendered. A re-save from anywhere (the web, the extension, the
extension's offline replay) resurrects a trashed item, and so does a restore
in another tab. Delete only rows that are still deleted, and bound Empty
trash by the newest `deleted_at` the page read, so it never takes something
the reader has not seen. Use the session client: `purge_deleted_items` looks
like the right tool and would empty every user's trash.

---

## Notes from the field

Append surprises here as they happen: parser quirks, provider limits, deploy
traps. Be specific and date each entry. Future-you has no memory of this
session, and the whole value of this section is that it records the things that
are true but not written down anywhere else.

### 2026-09-10 — Slice 5

- **The two `search_tsv` columns cannot be ORed together.** `where
i.search_tsv @@ q or c.search_tsv @@ q` across a join to `item_content`
  reads best and uses neither GIN index — an OR spanning two relations is not
  answerable from either table's index. Each table is asked separately instead
  and the two answers folded by item id, which keeps one ordinary index lookup
  per index. Denormalising the body into `items.search_tsv` was the other way
  out and undoes the reason `item_content` exists.
- **An exclusion folded into the positive query means the wrong thing.**
  `websearch_to_tsquery('radeon -nvidia')` against `items.search_tsv` asks that
  the _metadata_ not say nvidia; the body stays free to. Exclusions are parsed
  out in `lib/search.ts` and applied to both tables. Proof against the real
  articles: `quantum` returns three, and `quantum -storage` returns one — the
  other two are dropped on the strength of their bodies alone.
- **`tag:foo` must be removed before the string reaches Postgres.** Left in,
  `websearch_to_tsquery('tag:foo')` is `'tag' & 'foo'`, so the search quietly
  looks for the word "tag" and finds nothing.
- **Ranking normalisation, measured rather than chosen.** Body rank is
  `ts_rank_cd(..., 1|32)`. Dividing by raw length (flag `2`) put the 425-word
  TechSpot review, which says "version" once, above the 9,442-word PostgreSQL
  article, which says it 39 times. Plain `ts_rank` with the same normalisation
  scored every article in the corpus between 0.005 and 0.010 for every term
  tried, which is no ordering at all. The chosen pair puts PostgreSQL top for
  "version" and "support", the storage comparison top for "storage" and
  "price", and PostgreSQL _last_ for "price" — which it mentions in passing —
  despite being twenty-two times longer than the article above it.
- **The 0.4 body weight is load-bearing.** A title-only match scores 1.0 before
  normalisation and 0.5 after, and a body rank cannot reach 1.0, so at 0.4 the
  best possible body match still loses to any title match. It still beats a
  match found only in an author (0.17) or a site name (0.09).
- **The English stemmer does not depluralise an acronym.** `to_tsvector
('english','GPUs')` is `'gpus'` and `'GPU'` is `'gpu'` — different lexemes.
  So searching `gpu` does _not_ match the title "AMD GPUs are climbing the
  sales charts"; it matches that article on its body, where the singular
  appears. Nothing here is broken, but it is the first thing that will look
  broken to someone testing search, and no configuration in this slice fixes
  it. Prefix matching or a second `simple` vector would, and both are schema
  changes.
- **`ts_headline` must run after the LIMIT.** It re-parses the whole document.
  On the 9,442-word article that is the difference between one re-parse and
  nine, and it is why the headline is computed in the final select over the
  paged rows rather than anywhere earlier.
- **`FragmentDelimiter` needs its quotes.** Written bare, the option parser
  eats the surrounding spaces and snippets come back reading "making some
  operations more...times faster". Quoting the value keeps them.
- **Snippet markers are `chr(2)`/`chr(3)`, not `<mark>`.** A snippet is text
  from someone else's web page and must never reach a renderer as HTML. The
  page splits on the two control characters and emits `<mark>` elements.
  Writing them as `chr()` in SQL and `String.fromCharCode` in TypeScript is
  deliberate: literal control characters do not survive being copied between
  a migration, a source file and a test, and they cost an hour proving it.
- **`service_role` had EXECUTE on `search_items` by default and now does not.**
  The function is SECURITY INVOKER and has no `user_id` check of its own by
  design — RLS is the authorisation model — which means the service role,
  whose whole purpose is bypassing RLS, would have returned every user's items
  to whoever asked. Revoked. Confirmed over HTTP: `anon` gets 401 and
  `service_role` 403, both `42501 permission denied for function`.
- **Two accounts, at the database level.** As the `authenticated` role carrying
  each profile's JWT claim, the account owning the nine articles gets three
  hits for `quantum` and the second, empty profile gets none. That exercises
  the real policies rather than reading them.
- **0004 was applied, then amended, then the function alone re-applied.** The
  fragment delimiter and the title-snippet branch were both wrong on the first
  push. `supabase db push` will not re-run a recorded migration, so the amended
  `create or replace function` was run on its own with `db query`. The file and
  the database agree, and a fresh database applying 0004 gets the final
  version — but the live one arrived in two steps, within this slice.
- **`/search` had to be added to `PROTECTED_PREFIXES` in `proxy.ts`.** Without
  it the layout still refused the page, but the redirect lost its `next`, so
  signing in dumped you on the inbox instead of the search you were running.

#### `explain analyze`, at 12 items and 9 extracted bodies

Not the 1,000-item plan the checklist asks for; that box stays open. The
function is a `Function Scan` to `explain`, so both plans below are of its
body with `'quantum'` substituted. At this size both are dominated by fixed
costs and say nothing about how it scales.

Default planner — sequential scans, which is correct for a 12-row table:

    Nested Loop Left Join  (cost=24.17..32.34 rows=4) (actual time=5.970..9.362 rows=3 loops=1)
      ->  Limit  (actual time=2.953..2.959 rows=3 loops=1)
            ->  Sort  Sort Key: score DESC, i.created_at DESC, i.id DESC
                  ->  Hash Join  Hash Cond: (i.id = r.item_id)
                        ->  Seq Scan on items i  (rows=12) Filter: deleted_at IS NULL AND archived_at IS NULL
                        ->  GroupAggregate  Group Key: i_1.id
                              ->  Append  (actual time=2.523..2.801 rows=5 loops=1)
                                    ->  Seq Scan on items i_1  Filter: (search_tsv @@ 'quantum'::tsquery)
                                    ->  Seq Scan on item_content c_1  Filter: (search_tsv @@ 'quantum'::tsquery)
      ->  Index Scan using item_content_pkey on item_content c  (loops=3)
    Planning Time: 20.773 ms
    Execution Time: 10.172 ms

`enable_seqscan = off` — the question the Gotcha actually asks, which is
whether the _shape_ lets the GIN indexes be used. It does, both of them:

    ->  Append  (actual time=... rows=5 loops=1)
          ->  Bitmap Heap Scan on items i_1  Recheck Cond: (search_tsv @@ 'quantum'::tsquery)
                Heap Blocks: exact=2
                ->  Bitmap Index Scan on items_search_idx  (actual time=1.364..1.364 rows=3)
                      Index Cond: (search_tsv @@ 'quantum'::tsquery)
          ->  Bitmap Heap Scan on item_content c_1  Recheck Cond: (search_tsv @@ 'quantum'::tsquery)
                Heap Blocks: exact=1
                ->  Bitmap Index Scan on item_content_search_idx  (actual time=0.088..0.088 rows=3)
                      Index Cond: (search_tsv @@ 'quantum'::tsquery)
    Planning Time: 0.650 ms
    Execution Time: 11.602 ms

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

### 2026-09-10 — Slice 7

- **`npx` echoes the command line, secrets and all.** `npx supabase migration
list --db-url "$DBURL"` printed the full connection string, password
  included, through npm's own `npm notice run …` line. Calling the cached
  binary directly avoids it. Anything secret goes in over stdin — `printf '%s'
"$SECRET" | vercel env add …` — never as an argument.
- **Vercel Hobby refuses a cron more frequent than daily**, and it refuses it
  at deploy time, not at schedule time: the whole deployment fails with
  "Hobby accounts are limited to daily cron jobs". Worth knowing before writing
  a per-minute design into `vercel.json`.
- **A daily cron makes the batch size a throughput ceiling.** Five per run
  times one run a day is five items a day. The route now keeps claiming rounds
  until the queue is empty or a 40-second budget is spent.
- **Vercel will not give a Secret env var back.** `vercel env pull` writes
  `[SENSITIVE]` for them. If nobody wrote the value down, the only way to know
  it again is to replace it.
- **`vercel crons run <path>` triggers a cron through Vercel's own machinery**,
  which means Vercel supplies the real bearer token. It is the only sane way to
  test a daily cron. In Git Bash the leading slash gets mangled into a Windows
  path — run it from PowerShell.
- **A named composite type beats `returns table` for a claim function.** The
  output names of `returns table` are in scope inside the body, and `item_id`,
  `user_id` and `url` are all column names in the tables being queried.
  `public.claimed_fetch_job` has no such scope.
- **The retry ladder, observed on the deployment**, saving a host that does not
  resolve: `attempts=1` requeued at +58s, `attempts=2` requeued at +298s,
  `attempts=3` failed with `item=failed/unreachable`. A job whose `run_after`
  is still in the future is not claimed — a run fired between the two was a
  no-op. A 404 went straight to `failed` on attempt 1 and was never retried.
- **Saving `127.0.0.1` is the cheapest live test of the section 5 guards**, and
  the first one ever run against the deployment: `failed` / `blocked_url` on
  attempt 1, no retry. Note that an agent's safety classifier will refuse to
  type a cloud metadata address into a form, which is the correct instinct;
  loopback tests the same guard.
- **Re-saving an item that is already `ready` writes a `save_events` row and no
  fetch job.** That makes it the right way to exercise the rate limit without
  sending a single request to anyone else's server.
- **`/api/debug-sentry` earned its keep.** Three deployed extraction failures
  produced no Sentry events, and the obvious explanation — a serverless
  function frozen before the SDK flushes — was wrong. Hitting the Slice 0 debug
  route settled it in one request: server-side Sentry is not working on the
  deployment at all. A route that exists only to answer "does capture work
  here" is worth the line in the launch checklist.
- **A crashed worker has to be manufactured.** There is no way to make a
  serverless function die mid-fetch on demand, so the stale-lock reclaim is
  tested by backdating `locked_at`. Same for the purge: nothing in a two-day-old
  database is thirty days old, so `deleted_at` gets backdated. Both are honest
  tests of the real code path against the real database — just note in the
  handoff that the clock was the thing that was faked, not the behaviour.
- **Re-queueing a `fetch_jobs` row for a settled item is the Retry button that
  does not exist yet.** It is also the cheapest way to produce a specific
  failure on the deployment without saving new URLs or spending anyone else's
  bandwidth. `fetch_jobs_one_open_per_item` keeps it safe: the insert only
  succeeds when nothing is already open for that item.

### 2026-09-11 — Slice 6 pause and reviewed boundaries

The initial interpretation of "no-op" was corrected by the user: it means
Slice 1's existing re-save behavior, not literal absence of writes. The shared
SQL body was compared against the real schema before approval and was identical
except its identity initializer. Tests now compare the implementation against
0002's statements and assert the wrapper/grants, avoiding a second save algorithm.

The user rejected an optional service-role user-id filter. The approved limiter
requires a discriminated session/user scope with no default, with two users'
events in the offline test. The route takes identity only from an active token
hash lookup and uses that same scope for rate counting and saving.

At the user-requested pause: 620 tests and typecheck pass; lint has one new
anonymous-default-export warning to fix. No remote migration, deployment,
commit or push has occurred. The working tree is the continuation point;
review scratch has been deleted. Finish the remaining verification and the
Part 4 handoff/commit/push before claiming Slice 6 complete.

### 2026-09-11 — Slice 6 implementation and database verification

Resumed after the requested pause. The anonymous-default-export warning was
fixed; root typecheck, lint, 620 tests and Next build pass. The extension's own
typecheck/lint, 33 tests and Chrome/Firefox builds pass. No dependency was added.
Browser/signed-in manual verification remains, and the post-deployment token
probe below found an open production failure. `extension/README.md` gives each
click and expected result.

Only 0005 was pending in the remote dry run, and only 0005 was applied. Live
read-only metadata verification returned:

- RLS true on extension_tokens, fetch_jobs, highlights, item_content, item_tags,
  items, profiles, save_events and tags; extension_tokens has three policies.
- save_item_impl EXECUTE: anon=false, authenticated=false, service_role=true.
- save_item wrapper: authenticated EXECUTE=true, SECURITY DEFINER=true.
- authenticated token privileges: read_hash=false, revoke=true,
  change_owner=false, delete_token=false.

Operational surprises: the Supabase CLI requires a local telemetry write even
for --help; sandbox escalation resolved it. A multiline positional SQL argument
through its Windows .cmd shim lost the remote flag and attempted localhost;
`db query --db-url ... --file extension/server/verify-schema.sql` worked. No
user data was read or written by the verification. The old npm shim can select
an inaccessible Roaming install, so scripts ran through the installed npm CLI
by absolute path. Vercel's cached CLI is 59.15.1 but its stored login is invalid;
no secret values were printed and no credentials were requested.

### 2026-09-11 — Slice 6 deployment probe and final handoff

Code commits `fa6ff5b` and `03f2093` were pushed to main. The Vercel browser
dashboard confirms the latter deployment is Ready. The first public probe
crossed a deployment transition; a second probe against the new code returned
204 for extension preflight, 401 for malformed bearer, 403 for foreign origin,
and **500 for a well-formed unknown token**, which should have returned 401.
No probe supplied a URL or an actual token, so no save was possible.

The new table is accessible through the existing local service client: a
nonexistent hash returns no row without error. Vercel lists the token secret
for Production and Preview, but the request log contains no exception detail.
Only presence/minimum-length checks were performed locally: the current
`.env.local` token-secret entry is empty. This contradicts the opening prompt;
no value was substituted, changed or printed. Check the deployed secret's
presence/length and service-client configuration before browser acceptance.
Do not assume the 500 proves which setting failed, and do not repair Sentry
inside this slice. The API acceptance box stays unticked.

### 2026-09-24 — earlier-slice bug pass

- **The limit had a side door.** `/api/save` counted `save_events` before
  calling `save_item`, but `save_item` is itself granted to `authenticated`,
  and PostgREST exposes every granted function. The route was a check in
  front of one door of a two-door room. The fix puts the count inside the
  function, under `pg_advisory_xact_lock` so two concurrent saves cannot both
  see 59. The route check stays because only it can say "try again in 12
  minutes". `raise sqlstate 'PT429'` is PostgREST's convention for choosing
  the HTTP status, so a direct caller gets a real 429.
- **An FK is not an ownership check.** Foreign-key checks run without RLS, so
  `item_tags (item_id) references items (id)` accepted any user's item id.
  Referencing `(id, user_id)` needs a redundant `unique (id, user_id)` on the
  parent, which is cheap and is the whole fix.
- **`db query --file` runs one prepared statement.** A second statement fails
  with "cannot insert multiple commands into a prepared statement". A DO block
  that ends in `raise exception 'VERIFY …'` runs any number of checks, reports
  them in the error text, and rolls everything back; a follow-up count
  confirmed nothing was left.
- **`next typegen` keeps deleted routes alive.** After `app/api/extract` was
  removed, `tsc` still failed on `.next/dev/types/validator.ts` importing it.
  That directory is generated by `next dev`; deleting it fixed the check.
- **`String.prototype.replace` eats `$$`.** Mirroring 0008 into SCHEMA.sql
  with `s.replace(anchor, anchor + block)` turned the function's `$$` quotes
  into `$`. In a replacement string `$$` means a literal `$`. The migration
  was fine, but the paste-the-whole-file setup in SETUP.md would have failed
  on the first statement. The review agent caught it, and
  `test/schema.test.ts` now checks the quotes. Use a replacer function.
- **Fetch-on-save made blocking visible (2026-09-25).** Of five saves on
  2026-09-24, two were ready. The other three failed, and none of them was a
  Marrow fault:
  - NDTV (Akamai) returns 403 to any non-browser client, including curl with
    a Chrome User-Agent.
  - openai.com (Cloudflare) returns 403 to our honest User-Agent and 200 to a
    Chrome one, at least from a residential IP.
  - analyticsindiamag answers 200 with a Cloudflare script shell titled
    "AIM — AI & Data Science News", which Readability correctly calls
    no_content.

  The "short" UN News item is a LIVE page. Its static HTML holds three
  paragraphs, and the updates arrive later.
- **The internet dropped mid-slice, and the order of operations mattered.**
  The Slice 10 fix sends a new RPC argument (`p_page_sent`). Deploying it
  before 0009 would have made every fetch-on-save claim fail, and with dead
  Sentry nobody would have noticed. The commits waited locally until 0009 was
  applied and verified. Rule: migration first, push second, whenever code
  calls a changed function signature.
- **The extension build does not typecheck.** `build.mjs` uses
  `transpileModule`, which happily emitted a file declaring `body` twice. Run
  `npm run typecheck` in `extension/` before loading a build, and `node
  --check` on `dist` if in doubt.

### 2026-09-26 — Slice 11, highlights + notes

- **The mapper was checked in a real browser without signing in.** The
  public `/reader-preview` pages render the same `ArticleBody`. A copy of
  the walker, run in the pane's Chromium after hydration, produced exactly
  the server's `toPlainText` (same length and hash) on three fixtures, the
  image placeholder included. Use the previews this way for anything that
  only needs the article DOM.
- **linkedom's `compareDocumentPosition` is wrong for text inside a
  preceding element.** It reports FOLLOWING where a browser says PRECEDING.
  `edgePosition` compares the text node's parent element instead, which is
  correct in both. Remember this before trusting linkedom for DOM ordering.
- **`highlightsFromPoint` is missing even from the desktop app's Chromium**,
  not only from iPhone Safari. Hit-testing range boxes needs no feature
  detection.
- **Six review findings, all in UI edge paths and all fixed** (`ae67dcd`,
  `fa42c57`, `7cae04f`): a triple-click on the last paragraph ends at the
  footer; a deleted deep-linked highlight replayed the old restore after a
  revalidation; a deep link to a lost highlight opened at the top and
  overwrote the position; Escape on the Highlight bar left the article;
  typing during a note save was lost; the two toolbar panels could stack.
  The first review run hit the session limit before any reviewer reported,
  so it produced nothing; budget for the review.
- **A stale `.next/dev/types/validator.ts` broke typecheck.** It still named
  the Slice 10 `zz-body-probe` route. Deleting `.next/dev/types` fixed it;
  `next dev` regenerates it.
- **Python on Windows writes CRLF in text mode.** `.gitattributes` normalises
  on commit, but pass `newline="
"` when scripting edits so the working
  tree stays LF.
- **A short quote that occurs twice can re-anchor to the wrong occurrence**
  after a re-extraction. The schema keeps no surrounding text to tell them
  apart. Nothing re-extracts a ready item today, so it is recorded, not
  fixed.
