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

**Last updated: 2026-09-28 — Slice 15 (reading stats) built, reviewed and pushed; waiting on Ishank's hand check. Slice 14 still waits for his Android re-check.**

- **Slice 15 is deployed; only the hand check is open.** Migrations 0014
  and 0015 are applied and verified live in a rolled-back block. 0015 is a
  fix the live check found: `read_progress` is real, and against the
  numeric literal 0.9 an article at exactly 90% was not finished. Seven of
  eight boxes are ticked. Three reviewers on the diff (about 3.1 lakh
  tokens) found two real problems in the page, both fixed: Backlog counted
  an article finished and then scrolled back up, and a week that finished
  nothing showed "not known" minutes. Typecheck, lint, 915 tests and
  `next build` pass.
- **What Ishank checks by hand (about 3 minutes, signed in):**
  1. `/inbox`: a **Stats** button beside Trash opens `/stats`.
  2. The tiles and table match the live data on 2026-09-28: "Week of
     7 Sep" shows 13 saved and 2 finished (the two backfilled articles),
     "Last week" 7 saved and 1 highlight, "This week" zeros. The rules are
     stated under the table.
  3. Open an unfinished article and scroll to its end. Reload `/stats`:
     "This week" shows 1 finished and its minutes, and Finished goes up by
     one.
  4. `/inbox`, filter **Read**: that article is there, labelled Read.
  5. Scroll the same article back to the top, reload `/stats`: it is still
     finished, and Backlog did not go up.
  6. On the phone, `/stats` fits; the table may scroll sideways, and the
     bars are hidden there.
- **The backlog strip now asks `read_at` (0016, 2026-09-29, Ishank's
  yes).** It used `read_progress < 0.9`, so an article at exactly 90%, or
  one finished and scrolled back up, was Read in the library and still
  picked for the strip. Shown live before and after in a rolled-back
  block. No UI change; the strip's click-list from Slice 13 still holds.

- **Slice 14 is deployed but not done.** On Ishank's Android phone
  (Chrome), a speed or voice change took effect only at the next sentence,
  and speech stops when the screen locks or Chrome goes to the home
  screen. Everything else on the click-list held.
- **The first fix did not work on Android.** It made a change restart the
  current sentence at once (and a chosen voice set the utterance's
  language). In the pane's Chromium the restart worked. On the phone the
  change still arrived only at the next sentence, and nothing was
  repeated. The likely cause: Chrome on Android stops the system voice
  asynchronously, so a `speak()` sent straight behind `cancel()` is lost in
  that stop and reported as ended, and the queue moves on a sentence.
- **The second fix, pushed 2026-09-28.** After a `cancel()` that
  interrupted speech, the next `speak()` waits 350 ms (`SETTLE_MS`). The
  first speak of a session is never delayed, because iPhone Safari needs it
  inside the tap. And, at Ishank's suggestion, Resume and a changed setting
  now start from the word being spoken, where the browser reports words;
  where it reports none, from the sentence's start. Seen in the pane:
  a speed change restarted the sentence 350 ms later, › moved exactly one,
  Resume carried on from mid-sentence. Typecheck, lint, 886 tests and
  `next build` pass. Not put through reviewer agents, to save budget.
- **The background stop is not fixed and cannot be with device voices.**
  Chrome on Android and Safari on iPhone both stop page speech when the
  page leaves the screen. The panel says so; it does not solve it. The
  options are Ishank's decision: Chrome's own "Listen to this page" on
  Android, or server-made audio (ARCHITECTURE §13), which would be a slice
  of its own and a change to §1.
- **What Ishank re-checks (two minutes, Android, no sign-in):**
  1. <https://marrow-bice.vercel.app/reader-preview/longform>, speaker
     button, **Listen from here**. While it reads, tap **1.5×**: within
     about half a second the *same* sentence carries on, faster.
  2. Pick another **Voice**: the same sentence carries on in it.
  3. In the panel, › skips exactly one sentence, not two.
  4. Go to the home screen and back: the button reads Resume.

  If 1 still waits for the next sentence, 350 ms is too short for that
  phone, or the cause is something else; the next step would be an event
  log on the preview page rather than another guess.
- **Next after Slice 15:** Pocket/Instapaper import, then AI summary.
  Write each into this file and show it to Ishank before building.
  Migrations continue from **0017**.
- **Still open from earlier:** Firefox with the rebuilt extension, and the
  Slice 6 browser checks further down. Two new Slice 8 boxes came out of
  Slice 12: a fetch running when its item is deleted forever reports a
  false `server_error`, and the library's tag dialog closes on a click in
  its padding.
  New from Slice 14: the dev console warns about whitespace text nodes
  inside a `table` on the longform preview (see Notes from the field,
  2026-09-28). Not fixed there: it is `ArticleBody`, an earlier slice.
- **Working notes for the next agent:**
  - Supabase CLI: `npm-cache/_npx/aa8e5c70f9d8d161/node_modules/.bin/supabase`,
    called by full path with the DB URL read from `.env.local` and never
    printed. It needs sandbox escalation. `db query --file` takes a single
    statement, so verify with a DO block that ends in `raise` (rolls back).
    `drop index` inside such a block is a safe way to test an index choice.
  - Push a migration **before** any code that calls a changed function.
  - Ishank pauses Supabase when idle.
  - Signed-in pages cannot be opened by an agent; hand the click-list over.
    The public `/reader-preview` pages can stand in for anything that only
    needs the article DOM.
  - A reviewer workflow costs a lot of Ishank's budget: Slice 12's five
    reviewers and ten verifiers spent about 1.16M tokens and ran out his
    session limit; Slice 13's three reviewers and seven verifiers spent
    about 660k. Slice 14's three reviewers, with the findings verified
    inline instead of by verifier agents, spent about 430k. Keep reviewers
    on the diff and say the cost up front.

_Earlier on 2026-09-28 — Slice 13 (backlog strip) done and hand-checked:_
migrations 0012 and 0013 applied and verified live; Ishank ran the
click-list (the strip on `/inbox`, Not now, archive from the list, the
phone) and reported it all fine; all ten boxes ticked; four review
findings fixed; 843 tests.

_Earlier on 2026-09-26 — Slice 12 (Trash) done and hand-checked:_

- **Slice 12 is deployed and done.** Ishank ran the click-list below on
  2026-09-26 and reported it all fine ("sab thik hai"); all fourteen boxes
  are ticked. Migration 0011 (`items_trash_idx`) is applied and verified
  live, and so are the Delete-forever cascade under `authenticated` and the
  Empty-trash cutoff (rolled-back blocks). Two earlier-slice bugs were
  fixed first (the library's all-or-nothing Undo, the "back to the top"
  re-save copy). A reviewer workflow found four real bugs, all fixed.
  Typecheck, lint, 780 tests and `next build` pass.
- **The click-list Ishank ran (Chrome, then a phone).** Use a throwaway
  article; Delete forever cannot be undone.
  1. `/inbox`: a **Trash** button sits beside "Shortcuts ?".
  2. Delete one item. The panel says "Moved 1 item to Trash", and its
     footnote mentions 30 days and links to Trash.
  3. Open Trash. The item is at the top: "Deleted just now · Kept for 29
     more days" (30 if within the second). The title is not a link, and
     **Open original ↗** opens the site in a new tab.
  4. **Restore**. A message says it is back; the item is in the library at
     its original date (in Archive if it was archived).
  5. Delete it again, then in Trash press **Delete forever** once. A warning
     appears and the button reads "Yes, delete forever". **Cancel** undoes
     that. A quick double-click on "Delete forever" must *not* delete.
  6. Press it, then "Yes, delete forever". The row goes and the status says
     "Deleted forever."
  7. With two or more items in Trash, press **Empty trash**. The dialog
     states the count. A click inside the box keeps it open, a click
     outside closes it. Reopen and confirm: Trash is empty and the button
     is greyed out.
  8. Phone: `/trash` fits, the buttons wrap, the dialog fits the screen.

_Earlier on 2026-09-26 — Slice 11 done and hand-checked:_ migration 0010
applied and verified live; Ishank ran the click-list and reported it all
fine ("sab thik hai"); twelve of thirteen boxes ticked (the open one is the
"not found" panel entry, which nothing can produce yet); six review findings
fixed; 691 tests.

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
- [x] **`items.read_at` is never written by anything.** Moved to Slice 15
      and done there on 2026-09-28: a trigger stamps the first finish at
      90% (0014, 0015). Found while verifying
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
- [ ] A fetch still running when its item is deleted forever (Slice 12) ends
      quietly. Today its `item_content` write fails the foreign key and
      `processJob` reports it as a retriable `server_error`, which
      `recordJobReport` sends to Sentry as an error. Nothing is left behind;
      only the report is wrong. Check for zero rows from the items update
      (or 23503 from the content upsert) and settle as "item gone".
- [ ] The library's tag and rename dialog (`filter-bar.tsx`) closes on a
      click in its own padding, because a click there targets the dialog as
      a backdrop click does. Slice 12 fixed the same thing in the Trash
      dialog by moving the padding to an inner wrapper.

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

- [x] The library's Undo restored its batch all-or-nothing. Once Trash can
      delete one of its items forever, Undo would fail for the rest on
      every click. Restore now brings back what still exists and says what
      is gone (`app/(app)/actions.ts`, `test/organise-actions.test.ts`,
      `test/organise-ui.test.ts`).
      `70c1c5f`. Action tests: a partial batch restores the rest, a wholly
      missing batch settles without writing, other changes still refuse a
      partial batch. UI test: the notice clears the Undo record.
- [x] The save form said a re-save "brought it back to the top". The inbox
      sorts by `created_at`, which a re-save does not change
      (`components/save-form.tsx`).
      `3a078c7`: "it's in your inbox, under the date you first saved it."

The slice itself:

- [x] `/trash` lists the signed-in user's deleted items, newest deletion
      first (`deleted_at desc, id desc`), 50 to a page with a lookahead row
      and `?page=` links. The library's heading row links to it.
      Loader and render tested (`test/trash-page.test.ts`,
      `test/trash-ui.test.ts`). Confirmed by Ishank on 2026-09-26 against
      the click-list in Where things stand ("sab thik hai").
- [x] Each row shows the title as plain text (the reader refuses a trashed
      item, so nothing links to `/read`), the site, an **Open original ↗**
      link, how long ago it was deleted and when it goes.
      Render test: no `/read` link; the original opens in a new tab with
      `noopener noreferrer nofollow`.
- [x] The countdown is one pure function, `purgeCountdown(deletedAt, now)`,
      with `now` taken once on the server. It rounds down, says "less than a
      day" under 24 hours, and past the deadline says the item goes at the
      next daily clean-up — never "0 days" and never a negative number.
      Table-tested at 30 days, 29 days 23 hours, 1.5 days, 23 hours, zero,
      minus 3 days and a `deleted_at` in the future.
      `lib/trash.test.ts`, plus a sweep over 31 days asserting no row ever
      promises more time than is left.
- [x] The number 30 lives once, as `PURGE_AFTER_DAYS` in `lib/constants.ts`.
      `lib/queue.ts` derives `PURGE_AFTER` from it, and a test fails if they
      drift. No client component imports `lib/queue.ts`, which pulls in
      `node:` modules.
      Source test on `components/trash-list.tsx`.
- [x] **Restore** clears `deleted_at` only where it is still set. The item
      goes back where it was (to Archive if it was archived). A row already
      restored or re-saved elsewhere is reported as that, not as an error.
      Action tests assert the exact statement: only `deleted_at` changes.
- [x] **Delete forever** asks twice, in place, and says what goes with the
      item: the saved copy, highlights and notes, reading position and tag
      links (the tags themselves stay). It deletes only rows whose
      `deleted_at` is still set, so an item re-saved or restored in another
      tab after the page loaded survives.
      The review found that a double-click or a held Enter landed both
      presses on the same button; both are now refused (`4d4fc9e`), and the
      warning is tied to the button for screen readers.
- [x] **Empty trash** opens a dialog that states the count, then deletes in
      one statement bounded by the newest `deleted_at` in the trash when the
      page loaded, passed back as the raw database string. An item trashed
      in another tab after that survives. The button is disabled when the
      trash is empty.
      Action, loader and render tests; the cutoff shape was also run live
      (below). The dialog opens on Cancel, not the destructive button.
- [x] The library's delete copy says where things went. The undo panel reads
      "Moved N item(s) to Trash". Its footnote says Trash keeps items for 30
      days and links there. The `#` help line says "Move to Trash". The
      Delete button keeps its label.
      `test/organise-ui.test.ts`.
- [x] 0011 adds `items_trash_idx on items (user_id, deleted_at desc, id desc)
      where deleted_at is not null`. It is applied live, and `explain` with
      sequential scans off shows the Trash query using it.
      Applied 2026-09-26. Changed from the wording above: with 3 trashed
      rows across 1 user the planner still prefers a backward scan of
      `items_purge_idx`. With that index dropped inside a rolled-back
      block, the Trash query under RLS is an Index Only Scan on
      `items_trash_idx` with `user_id` as the index condition and no sort.
- [x] Verified live in a rolled-back block, as an item's owner under
      `authenticated`: the Delete-forever statement removes a trashed item
      and cascades to its `item_content`, `item_tags` and `highlights`,
      although none of those has a session delete policy. The same statement
      leaves a live item alone.
      2026-09-26: content, highlight and job rows went 1/1/1 to 0/0/0; the
      statement removed 1 of the 2 ids and the live one stayed. Empty trash
      with a cutoff an hour back removed exactly the 3 older rows and kept
      the one trashed just then.
- [x] Tests: the countdown table; id and cutoff validation; each action's
      predicates (`deleted_at is not null` on restore and delete, the cutoff
      on Empty trash, count mismatches reported); nothing under
      `app/(app)/trash` imports `lib/db/service`; the list render (rows,
      empty state, the two-step delete, the dialog's count); the library's
      new copy; and the migration text.
      780 tests pass, with typecheck, lint and `next build`.
- [x] ARCHITECTURE sections 4 (Soft delete) and 7 describe Trash;
      SCHEMA.sql matches 0011.
- [x] Hand check by Ishank (click-list in Where things stand), in Chrome and
      on a phone.
      Confirmed by Ishank on 2026-09-26 ("sab thik hai").

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

## Slice 13 — "From your backlog" strip

**Agent:** Claude Code. Needs the real database for 0012; the UI checks are
Ishank's, because an agent cannot sign in.
**Files:**
- `supabase/migrations/0012_backlog_strip.sql` (new),
  `supabase/migrations/0013_backlog_week_start.sql` (new, a review fix),
  `docs/SCHEMA.sql`
- `lib/backlog.ts` (new: the rule's numbers, the week key, the "why" line)
- `components/backlog-strip.tsx` (new), `components/backlog-actions.ts`
  (new: Not now)
- `app/(app)/inbox/page.tsx` (loads the strip in the default view only),
  `components/filter-bar.tsx` (a slot under the save form, nothing else)
- `lib/backlog.test.ts` (new), `test/backlog-actions.test.ts` (new),
  `test/backlog-ui.test.ts` (new), `test/inbox-page.test.ts` (new),
  `test/schema.test.ts`, `test/organise-ui.test.ts`

Design notes from the 2026-09-24 research and its critic, re-checked against
the code and the live database on 2026-09-26. A read-it-later list becomes a
graveyard: what was saved two weeks ago sinks below everything saved since.
The strip brings three of those back to the top of the library.

- **The rule is fixed and shown on the strip:** up to three ready articles,
  saved at least 14 days ago, not archived, not in Trash, less than 90% read,
  and not put off with **Not now**. `read_at` is never written until Slice
  8, so `read_progress` is the only reading signal there is.
- **Which three** is decided by ranking each candidate on a hash of the ISO
  week and its own id. The pick is the same all week, on every reload and
  device, and changes each Monday at 00:00 UTC (05:30 IST).
- **ARCHITECTURE §1 rules out "recommendations or an algorithmic feed".**
  This is not one: a fixed, disclosed rule over the reader's own saves, with
  no behaviour tracking and no engagement ranking. §1 and §13 will say so,
  so nobody later "improves" it into a feed.
- **The pick runs in SQL.** PostgREST cannot order by a hash, and hashing in
  JavaScript would fetch the whole backlog on every `/inbox` load, which the
  Pocket import (a later slice) would make thousands of rows.
- **Live on 2026-09-26:** 7 of the 12 ready items qualify at 14 days, so the
  hand check will see a full strip.
- **Agreed with Ishank on 2026-09-26:** Not now is in, and the review runs
  three reviewers (roughly 5–6 lakh tokens) rather than five.

### Done when

- [x] 0012 adds `items.resurface_after timestamptz` (null means never put
      off) and `public.backlog_strip(p_week text)`, which returns up to
      three rows (`id, url, title, site_name, created_at, reading_minutes,
      read_progress`) ordered by `md5(p_week || id)`. It is SECURITY INVOKER
      and filters by the rule only, so RLS confines it to the caller.
      EXECUTE is revoked from public, anon and service_role (which bypasses
      RLS) and granted to authenticated, as `search_items` is.
      Applied 2026-09-26. The review found that measuring against `now()`
      let items join mid-week; 0013 (`b00f811`) replaced it with
      `backlog_strip(p_week, p_min_age_days)`, measured from the week's start.
- [x] The 14 days and the 90% live once in `lib/backlog.ts`, and a test
      fails if the migration's numbers drift from them.
      Changed by 0013: the 14 is now passed to the function, so it lives
      only in `lib/backlog.ts`. The 0.9 and the 3 are pinned by
      `test/schema.test.ts`, with every other condition of the rule.
- [x] Verified live in a rolled-back block, as the owner under
      `authenticated`:
      - it returns three of the qualifying items;
      - the same week twice gives the same three, and another week gives a
        different order;
      - archiving an item outside the pick leaves the pick unchanged;
      - Not now on a picked item replaces it with the next one;
      - anon and service_role cannot execute it.
      0012, 2026-09-26: 7 candidates; all five held, and a stranger got 0
      rows. 0013: the 1-argument function is gone and the grants hold; W40
      gives the same three twice; an item that turns 14 days old mid-W40
      stays out of W40; Not now hides at once. W39 gives none, because the
      oldest save (9 Sep) is newer than 21 Sep minus 14 days.
- [x] `/inbox` shows the strip only in the default view (Inbox, All, no tag,
      page 1), between the save form and "Your library", and renders nothing
      when no item qualifies.
      Loader and slot tested (`test/inbox-page.test.ts`,
      `test/organise-ui.test.ts`). Left for Ishank's hand check. The strip
      has items from 28 Sep (checked read-only that day).
      Confirmed by Ishank on 2026-09-28 against the click-list in Where
      things stand ("baaki sab check list me thik hai").
- [x] Each entry links to `/read/<id>` and says why it is there, for
      example "Saved 3 weeks ago · 12 min · 40% read", or "not started" at
      zero. Never "unread" or "not opened": an article opened and left at
      the top also reads 0, and nothing records opening. The strip states
      its rule in one line.
      `lib/backlog.test.ts` and the render test.
- [x] **Not now** sets `resurface_after` 30 days ahead, only on the
      reader's own item that is not in Trash, and the strip refills on the
      revalidated render.
      Action test and the live checks. The review found that Not now on the
      last item dropped focus to `<body>`; the library heading now takes it
      (`0be061d`).
- [x] Triage in the list below keeps the strip honest. Archiving, deleting
      or finishing a picked item removes it from the strip on the next
      render, without a reload.
      Rests on `mutateLibrary`'s `revalidatePath('/inbox')`, which re-renders
      the page and so the strip. Left for Ishank's hand check.
      Confirmed by Ishank on 2026-09-28 against the click-list in Where
      things stand ("baaki sab check list me thik hai").
- [x] Tests:
      - the ISO week key across a year boundary (2026-12-31 is 2026-W53;
        2027-01-04 is 2027-W01);
      - the "why" line (days and weeks, missing minutes, zero progress);
      - the numbers matching the migration;
      - the strip render (titles escaped, nothing when empty, default view
        only);
      - the Not now action (refuses a malformed id, writes only
        `resurface_after`);
      - the migration text.
      843 tests pass, with typecheck, lint and `next build`.
- [x] ARCHITECTURE §1 (why this is not a feed), §7 (the strip) and §13;
      SCHEMA.sql matches 0012.
      And 0013.
- [x] Hand check by Ishank (click-list in Where things stand), in Chrome and
      on a phone.
      Confirmed by Ishank on 2026-09-28 against the click-list in Where
      things stand ("baaki sab check list me thik hai").

Changed after the slice, 2026-09-29: "less than 90% read" became "never
finished" (`read_at is null`, 0016), once Slice 15 made `read_at` a
stamp that does not fall when an article is scrolled back up.

Not in this slice: the weekly email digest (the research ranked it weak: it
needs Resend, a sending domain and working server-side Sentry); writing
`read_at` (Slice 8); a setting to turn the strip off.

### Gotcha

Stable means stable per item, not per list. Seeding one shuffle with the
week and picking by index reshuffles all three whenever anything in the
backlog changes: archive one unrelated article and the whole strip swaps.
Rank every candidate by its own hash of the week and its id, and take the
top three. Then the strip changes only when one of its own items leaves.

Second: "unfinished" is a guess. `read_at` is never written, and a short
article reports progress 1 the moment it is opened, so `read_progress` below
0.9 is the only signal. It measures scrolling, not opening: an article
opened and left at the top reads 0 too. The copy must not claim more than
that: say "40% read" or "not started", never "unread" or "not opened". And
keep the rule fixed and
disclosed. It is the only thing that keeps this from being the feed §1 rules
out.

---

## Slice 14 — Listen mode

**Agent:** Claude Code. No migration and no Supabase work. The checks that
matter are on Ishank's phone, and because Listen also works on the public
`/reader-preview` pages, most of them need no sign-in.
**Files:**
- `lib/listen.ts` (new: the sentence plan, the length cap, where to start,
  the rate choices, the stored preference)
- `components/reader/narrator.ts` (new: the speech queue, over an injected
  `speechSynthesis` so it can be tested without a browser)
- `components/reader/listen.tsx` (new: the toolbar control and its panel)
- `components/reader/reader-surface.tsx` (mounts Listen for a readable
  article and keeps the toolbar shown while it plays, nothing else),
  `components/reader/reader.tsx` (passes the article's `lang`),
  `app/globals.css`
- `lib/listen.test.ts` (new), `test/narrator.test.ts` (new),
  `test/listen-ui.test.ts` (new)

Design notes from the 2026-09-24 research and its critic, re-checked
against the code on 2026-09-28.

- **Device voices only.** `speechSynthesis`: no dependency, no key, no
  server route, no migration. Server-made audio from a paid TTS API would
  survive a locked screen, but it adds a key, cost and storage, and edges
  toward §1's "no podcasts". It stays out.
- **Say the limit on the control.** On an iPhone, speech stops when the
  screen locks or Safari leaves the foreground. The panel says so in one
  line. This is not a pocket podcast. Ishank's Android Chrome stops the
  same way (2026-09-28), so the line says "on a phone".
- **Voice and rate stay on the device, in localStorage.** Changed from the
  research, which put the rate in `profiles.settings`. Voices differ per
  device and a rate is relative to the voice speaking it, so a synced rate
  would be wrong on the other device anyway. It also keeps the slice free of
  a new Server Action, and the preview behaves exactly like `/read`.
- **Listen works on `/reader-preview` too.** It needs only the article DOM
  and the device, and writes nothing anywhere. So the phone spike the
  research asked for is Listen itself, on the public longform sample.
- **Built for the worst case, so the quirks need not be true.** The research
  lists three unverified ones: Chrome cuts an utterance after about 15 s,
  Android turns pause into cancel and sends no word boundaries, iOS stops on
  lock. The design assumes all three: one sentence per utterance with a
  length cap; Pause is `cancel()` and Resume speaks the same sentence again
  (from the last word the browser reported, else from its start); the tint
  moves per sentence when it is queued, never per
  word on `boundary` (changed from "on `start`" while building: queueing is
  one event fewer to depend on). The phone check then records which quirks are real, and
  nothing depends on the answer.

### Done when

- [x] A **Listen** control sits in the reader toolbar, before ✎ and Aa, on
      `/read/[id]` and on the preview fixtures. It appears only for a
      readable article and only where `speechSynthesis` exists; the server
      render has none, so a browser without speech shows nothing broken.
      `test/listen-ui.test.ts` (none without speech or on the server; on a
      readable surface, preview or not; none on a pending one). Seen in
      the pane's Chromium on the longform preview.
- [x] Speech comes from the rendered page, not `item_content.text`: the
      title, then the article through `textIndex` in `lib/highlight-dom.ts`,
      which already skips the image placeholder and `noscript`. Every block
      element ends a sentence, so a heading never runs into the paragraph
      after it. Code blocks (`pre`) are skipped. Sentences come from
      `Intl.Segmenter` in the article's `lang` (a punctuation split where it
      is missing), and one longer than 200 characters is split at a comma,
      else at a space.
      `lib/listen.test.ts` runs the three article fixtures through
      `ArticleBody`: every sentence is capped and maps back to exactly its
      own text. In the pane, "Learning the same mile" was spoken on its own.
- [x] **Play** starts at the first sentence below the toolbar, where the
      reader is scrolled. At the top of the page it starts with the title.
      In the pane's Chromium on the longform preview: from the top the first utterance was the title;
      scrolled to mid-article, the first sentence under the toolbar.
- [x] **Pause**, **Resume**, and skip back and forward one sentence. Pause
      cancels and remembers the sentence; Resume speaks it again from its
      start (since 2026-09-28, from the last word the browser reported,
      where it reports words). The last sentence ending leaves the control
      at "Listen again", not stuck on Pause.
      Narrator and UI tests. In the pane: Pause spoke nothing more, Resume
      repeated the sentence, › moved exactly one.
- [x] The sentence being spoken is tinted with a `marrow-listen` Custom
      Highlight, readable in all four page colours, and scrolled into view
      when it leaves the screen. The toolbar does not auto-hide while Listen
      plays, so Pause stays reachable. Without `CSS.highlights`, speech and
      follow-along still work, untinted.
      In the pane: the tint painted in the dark theme, and scrolling down
      left `data-hidden="false"` while playing and hid the toolbar once
      paused. The UI tests run without `CSS.highlights`. The other themes'
      tint is for the hand check.
- [ ] **Rate** 0.75, 1, 1.25, 1.5, 1.75 or 2 (default 1), applied at
      once: the current sentence starts again with it. **Voice**: the
      device's voices, those matching the
      article's `lang` first. With `lang` null or no match, the device
      default. An empty list while voices are still loading
      (`voiceschanged`) never reads as "no voices". Both are kept per
      device; damaged storage falls back to the defaults.
      `lib/listen.test.ts` and the UI test (stored JSON, the restarted
      sentence's rate, voice and language).
      Reopened 2026-09-28: on Ishank's Android a change was heard only at
      the next sentence. Changed from "applied from the next sentence";
      a chosen voice sets the utterance's language; and after an
      interrupting cancel the next speak waits `SETTLE_MS` (the first
      restart was lost on Android). Checked in the pane's Chromium;
      waiting for his re-check on Android.
- [x] Speech stops on unmount (Esc, Back to library, client navigation), on
      `pagehide`, and when the article changes. Back on a visible page after
      the system stopped speech (an iPhone lock), the control reads Resume,
      not Pause.
      UI test (unmount cancels, a late end is ignored) and narrator test
      (`reconcile`). In the pane a client navigation stopped speech and
      cleared the tint, and the first Esc closed the panel instead. No
      iPhone to try the lock on; Android's behaviour goes in the notes.
- [x] A cancelled utterance's late `end` or `error` never advances, speaks
      twice or flips the state (see Gotcha). Tested with a fake synth that
      fires them after the next sentence has started.
      Also seen live: the pane's Chromium answers each cancel with an
      `interrupted` error, and both were dropped.
- [x] Tests: the sentence plan (block ends, headings, `pre` skipped, the
      cap, the `lang` fallback), where to start, the stored preference, the
      narrator (advance and finish, pause and resume on the same sentence,
      skip at both ends, late events after cancel, an error mid-sentence,
      a rate change), and the render (no control on the server or without
      speech, a control on the preview, unmount cancels).
      883 tests pass, with typecheck, lint and `next build`.
- [x] ARCHITECTURE §1 (why this is not a podcast), §7 (Listen) and §13.
- [ ] Hand check by Ishank (click-list in Where things stand): the phone on
      `/reader-preview/longform`, then one signed-in article in Chrome. Which
      of the three quirks are real goes into Notes from the field.
      Reopened 2026-09-28. The first "sab thik hai" was followed by three
      failures on Android (speed, voice, background). The rest held. The
      re-check list is in Where things stand.

Not in this slice: server-made audio and playback with the screen locked;
a per-word tint; tapping a sentence to start there; a keyboard shortcut;
holding follow-along back while the reader scrolls elsewhere; reading
tables as tables (each cell is read as its own sentence).

### Gotcha

Every `cancel()` answers late. Pause, skip and stop all cancel the current
utterance, and the browser then fires that utterance's `end` (Chrome) or an
`error` of `interrupted` or `canceled` (Safari, Firefox), asynchronously,
after the next sentence has already been queued. A handler that does "on
end, speak the next one" turns Pause into "skip one and keep talking" and
Skip into "skip two". Give every utterance a generation number and drop any
event from one that is not current. Also hold a reference to the current
utterance: Chrome has been known to drop the events of an utterance nothing
references.

Second: iPhone Safari speaks only from a user gesture. The first `speak()`
has to run synchronously inside the tap handler, with no `await` for voices
and no animation frame first. `getVoices()` is empty until `voiceschanged`
on Chrome, so start with the default voice rather than waiting for the list.

Found on Ishank's phone: Chrome on Android stops the system voice after
`cancel()` returns. A `speak()` sent straight behind it is lost in that
stop and reported as ended, so a restart or a skip lands one sentence
further on. Wait briefly after a cancel that interrupted speech, but never
before the first speak of a session (the iPhone gesture above).

Third: `speechSynthesis` belongs to the window, not the component. Esc and
Back to library are client navigations, so an article that is not cancelled
on unmount keeps talking over the library.

---

## Slice 15 — Reading stats

**Agent:** Claude Code. Needs the real database for 0014; the page is
signed-in only, so the UI check is Ishank's.
**Files:**
- `supabase/migrations/0014_reading_stats.sql` (new),
  `supabase/migrations/0015_read_at_real_compare.sql` (new, a fix found by
  the live check), `docs/SCHEMA.sql`
- `lib/stats.ts` (new: row validation, week labels, the bar scale, the
  copy)
- `app/(app)/stats/page.tsx` (new), `components/stats-view.tsx` (new)
- `components/filter-bar.tsx` (a Stats link beside Trash, nothing else)
- `lib/stats.test.ts` (new), `test/stats-page.test.ts` (new),
  `test/schema.test.ts`, `test/organise-ui.test.ts`

Changed from the plan while building: `read_at` is stamped by a trigger,
not by `saveReadingProgress`, so `components/reader/actions.ts` is
untouched. A trigger stamps in the same statement as any progress write,
whichever path makes it.

Design notes, 2026-09-28, from the schema and the reader code.

- **Stats need `read_at`, and nothing wrote it.** That was an open Slice 8
  box (found in Slice 5). Without it this page could count saves and
  highlights, but never "finished". Ishank agreed on 2026-09-28 that this
  slice takes the box over and backfills: `read_at` is stamped the first
  time an article's progress reaches 90%, the same line the backlog strip
  uses for "unfinished". The library's Read/Unread filter and labels start
  working with no change of their own.
- **What the page shows, and what it does not.** The last 12 weeks, one
  row each: saved, finished, about how many minutes those finished articles
  take to read, and highlights made. Above it: in the library now, finished
  in all, and the backlog (ready, never finished, saved over 14 days ago;
  changed from "under 90%" by the review, see below). No
  streaks, goals, badges or comparisons. §1 rules out engagement ranking,
  and a streak is that aimed at the reader.
- **One SQL function, SECURITY INVOKER.** `reading_stats(p_week, p_weeks)`
  builds the weeks with `generate_series` and counts into them, so an empty
  week is a zero and not a missing row. `p_week` comes from the server's
  clock, as the strip's does. RLS confines it to the caller. Bars are plain
  CSS widths in a real `<table>`; no chart library.
- **Weeks run Monday to Sunday in UTC**, the same as the backlog strip
  (they turn at 05:30 IST on Monday), and the page says so. A per-reader
  time zone is out of scope.

### Done when

- [x] `read_at` is set to `now()` the first time an item's `read_progress`
      is written at 0.9 or more, and only while it is null. Scrolling back
      never clears it and reading again never moves it. The preview writes
      nothing, as before.
      Changed: a `before update of read_progress` trigger (0014), not the
      server action. 0015 compares against `0.9::real` (see Gotcha).
- [x] 0014 backfills `read_at` from `updated_at` for items already at 90%
      or more; the page says those dates are approximate. It adds
      `public.reading_stats(p_week text, p_weeks int)` returning
      `(week_start date, saved int, finished int, finished_minutes int,
      highlights int)` for up to 52 weeks. Items in Trash are left out, and
      so are their highlights. EXECUTE is revoked from public, anon and
      service_role and granted to authenticated.
      Applied 2026-09-28. The backfills dated 2 of the 20 live items.
- [x] Verified live in a rolled-back block, as the owner under
      `authenticated`: an empty week is a zero row; an item saved in one
      week and finished in another counts once in each; a trashed item
      counts nowhere; a stranger gets zeros; anon and service_role cannot
      execute it.
      2026-09-28, after 0015: 0.89 left `read_at` null, 0.9 stamped it,
      0.2 afterwards kept it, a reread at 1.0 did not move a stamp from 40
      days back; 12 rows with no null counts, 52 for `p_weeks` 99. The
      trigger fires under `authenticated` although that role cannot
      execute the trigger function. Before 0015 the same block showed 0.9
      not stamping.
- [x] `/stats` shows the 12 weeks newest first, with the totals and the
      backlog line above, and the rule for "finished" stated on the page
      ("scrolled to 90%"). Minutes say "about", and a week whose finished
      articles have no reading time shows "—", not zero. The library's
      heading row links to it.
      Loader and render tests. Left for Ishank's hand check: an agent
      cannot sign in. The review found two things here, both fixed
      (`66622b3`): Backlog counted `read_progress < 0.9`, which falls again
      when a finished article is scrolled back up, so one article could be
      under Finished and Backlog at once; it is now "`read_at` is null". And
      a week that finished nothing showed its minutes as "not known"; it
      shows 0.
- [x] With nothing saved yet, the page says so instead of drawing twelve
      empty rows.
      Render test.
- [x] Tests: the `read_at` stamp (at 0.9, not at 0.89, never moved, never
      cleared); week labels; the bar scale (a zero week, a single week, one
      huge week); the page (the empty state, a failed load, the backlog's
      filters, the Stats link); the migration text.
      Changed: the stamp is SQL, so it was tested live (above) and its text
      in `test/schema.test.ts`, not in an action test. "Not for someone
      else's item" is RLS on the update, as before. 915 tests pass,
      with typecheck, lint and `next build`.
- [x] ARCHITECTURE §7 (what `read_at` means now, under Reader state, and
      the stats page) and §13; the Slice 8 `read_at` box points here.
      SCHEMA.sql matches 0014 and 0015. Changed from "§4": `read_progress`
      is described in §7, so `read_at` went beside it.
- [ ] Hand check by Ishank: finish one article, see it in this week's row
      and under Read in the library; the page on the phone.

Not in this slice: a per-reader time zone; a manual "Mark as read" or
"Mark unread"; stats by tag or site; export of the stats.

### Gotcha

`read_at` is a first-finish stamp, and it must stay one. If every write at
90% or more sets it, reopening an article from March moves it into this
week, and "finished this week" counts rereads. Stamp it only where it is
null, in the same statement as the progress write, so a race between two
tabs cannot stamp twice.

Second: "finished" is a scroll, not a reading. An article short enough to
fit on the screen reports progress 1 as soon as it opens, so opening one
finishes it. The page states the rule rather than claiming "you read 9
articles".

Third: count into a series, not from the rows. `group by` over items
returns only the weeks that had something, and a chart built from it
silently skips the empty weeks, which are the ones that matter.

Fourth, found live: `read_progress` is `real`, and real 0.9 is 0.89999998.
Compared with the literal `0.9`, which is numeric, Postgres works in double
precision and an article at exactly 90% is not finished. The client rounds
progress to four places, so 0.9 is a value it really writes. Compare with
`0.9::real`.

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

### 2026-09-26 — Slice 12, Trash

- **At today's size the planner ignores `items_trash_idx`.** With 3 trashed
  rows, all one user's, it scans `items_purge_idx` backward and filters on
  `user_id`. Dropping `items_purge_idx` inside a rolled-back block showed the
  Trash query as an Index Only Scan on `items_trash_idx` with no sort.
  `drop index` is transactional, so this is a safe way to ask "can this
  index serve the query" on the live database.
- **A session's delete cascades through tables it cannot delete from.**
  `item_content` and `fetch_jobs` have no delete policy for `authenticated`,
  yet Delete forever as the owner took their rows with it. Postgres runs
  foreign-key actions as the table owner, outside RLS.
- **A click in a `<dialog>`'s own padding targets the dialog**, exactly as a
  backdrop click does. The Trash dialog keeps its padding on an inner
  wrapper; the library's tag dialog still has the old shape (Slice 8 box).
- **linkedom has no `showModal`.** `test/trash-ui.test.ts` stubs it per test
  (`modalDialog()`), including `open`.
- **A two-press confirm on one button is also a double-click target.**
  Keeping focus on the button is right for keyboards and screen readers,
  but it puts the second press exactly where a double-click or a held Enter
  lands. Refuse `event.detail > 1` and repeated Enter keydowns.
- **Review cost.** Five reviewers and ten verifiers spent about 1.16M
  subagent tokens, and Ishank's session limit ran out with three verifiers
  unfinished. Verified real and fixed: double-click or held Enter past the
  confirm, a false "was kept" message (found twice), and `/trash` missing
  from the proxy. Of the three unverified, checked by hand: one duplicated
  the "was kept" finding, and two were real and fixed (the warning did not
  reach screen readers; a click in the dialog's padding dismissed it). A
  refuted "no test for the page's queries" was a real gap and got a test.
- **Two earlier-slice bugs were fixed first, with Ishank's agreement:** the
  library's all-or-nothing Undo and the "back to the top" re-save copy.

### 2026-09-26 — Slice 13, the backlog strip

- **A per-item rank keeps the order stable, not the set.** Ranking each
  candidate on its own hash stopped unrelated changes from reshuffling the
  strip, but with `now()` in the age and Not-now conditions, items still
  crossed the line mid-week and pushed one of the three off. The live check
  had passed because it used a fixed candidate set; the review caught it.
  0013 measures both conditions from the start of the ISO week.
- **`to_date(p_week, 'IYYY-"W"IW')` gives that week's Monday** in Postgres.
  Checked live for 2026-W39, 2026-W53, 2027-W01 and 2020-W53.
- **Measuring from the week's start delays a young library's first strip.**
  In the week of 21 Sep the cut-off is 7 Sep and the oldest save is 9 Sep,
  so the strip is empty until 28 Sep. The age is a parameter now, so this
  is a code change if it ever needs to be.
- **linkedom's `compareDocumentPosition` bit again**, in a test of where the
  strip sits. Compare indexes in `querySelectorAll("*")` instead.
- **Review.** Three reviewers and seven verifiers, about 660k tokens against
  an estimate of 500–600k. Five confirmed findings, four of them distinct,
  all fixed: the mid-week change (`b00f811`); focus falling to `<body>`
  after Not now on the last item (found twice); and the keydown guard
  swallowing `?`, `/` and Escape (`0be061d`). A refuted "no test pins the
  rule's other conditions" was covered anyway when 0013's tests were
  written.

### 2026-09-28 — Slice 14, listen mode

- **Chromium answers `cancel()` with an `interrupted` error, not `end`.**
  Seen in the desktop app's pane: every Pause and skip produced one late
  `error: interrupted` from the cancelled utterance. The generation counter
  dropped both kinds; a handler that treated errors as "stop" would have
  shown a false problem message on every Pause.
- **The pane's Chromium has five local Microsoft voices** (en-US, en-IN)
  and fired `end` reliably for sentences of up to 200 characters. None of
  the three reported quirks showed on desktop; the phone check is what
  settles them.
- **linkedom's window is a proxy over `globalThis`.** Anything assigned to
  it (`Object.assign(window, {...})`) lands on the real global and survives
  `vi.unstubAllGlobals()`. The Listen UI test passed only because its
  "no speech" case ran first. Use `vi.stubGlobal`. linkedom's `Range` also
  has no `setStart`, `setEnd` or `getBoundingClientRect`.
- **A saved preview position changes where Listen starts.** The preview
  restores the last scroll from localStorage, so a second visit started
  mid-article, as designed. Scroll to the top to hear the title.
- **Found, not fixed (earlier slice): whitespace inside tables.** On
  `/reader-preview/longform` the dev console reports "whitespace text nodes
  cannot be a child of `<table>`" (and `thead`, `tr`, `tbody`). It comes
  from `ArticleBody` turning the sanitised HTML's whitespace between table
  tags into text nodes. React warns that this can cause a hydration error;
  none was reported and the table renders. Worth a look in Slice 8, since
  publisher tables are full of such whitespace.
- **Hand check, 2026-09-28, corrected.** Ishank first reported the list
  fine, then that on his Android phone (Chrome) a speed change and a voice
  change did nothing, and speech stopped on a screen lock and on going to
  the home screen. So of the reported quirks: stopping in the background
  is real on Android as well as iOS; a cut after 15 s was not seen. Two
  lessons. A setting that applies "from the next sentence" is heard five
  to ten seconds late, which on a phone is indistinguishable from not at
  all; it now restarts the sentence. And Chrome on Android chooses a voice
  by language, so the utterance's `lang` has to be the chosen voice's.
  Also: a ticked hand check deserves a question about each step that
  settles something (here 4 and 5), not only a "fine" for the list.
- **Android, second round, 2026-09-28.** With changes restarting the
  sentence at once, Ishank's phone still applied a new speed or voice only
  at the next sentence, and repeated nothing. A lost restart fits that:
  the stop after `cancel()` is asynchronous there. Answered with a 350 ms
  wait after an interrupting cancel (`SETTLE_MS`), not yet confirmed on the
  phone. Ishank also asked for a restart from the current word rather than
  the sentence start; that works wherever the browser sends word
  `boundary` events (the pane's Chromium does), and falls back to the
  sentence start where it does not.

### 2026-09-28 — Slice 15, reading stats

- **`real` against a numeric literal is a double-precision comparison.**
  `read_progress` is real; real 0.9 is 0.89999998; `read_progress >= 0.9`
  promotes both sides to double and says no. The client writes exactly 0.9
  (it rounds to four places), so an article at 90% was not finished until
  0015 compared with `0.9::real`. The live check caught it; the migration
  text looked right. PostgREST filters are not affected: `lt.0.9` arrives
  untyped and takes the column's type.
- **The same trap was in the backlog strip** (`read_progress < 0.9`,
  0013). Fixed by 0016 with Ishank's yes on 2026-09-29: the strip asks
  `read_at is null`. Live, with every other candidate archived in a
  rolled-back block, the strip picked articles at 0.9, at 0.1 after being
  finished, and at 0.4 before 0016; after it, only the one at 0.4.
- **`read_progress` is where the reader is, not how far they got.** It
  falls when a finished article is scrolled back up. Anything that means
  "finished" should read `read_at`, which never falls. The review caught
  the stats page's Backlog count using progress.
- **Backfill: 2 of 20 live items** had progress at 0.9 or more and no
  `read_at`; both are dated in the week of 7 Sep from `updated_at`. 0015's
  backfill found none at exactly 0.9. The touch trigger moved their
  `updated_at` to the migration time.
- **A trigger fires without EXECUTE on its function.** `stamp_read_at` is
  revoked from `authenticated`, and an `authenticated` update of
  `read_progress` still stamped. Only creating the trigger needs EXECUTE.
- **The agent's Bash tool halves backslashes in heredocs.** A Python
  heredoc meant to write a backslash and an n into a TypeScript string
  wrote a real newline instead. Use the Edit tool for anything with
  backslashes.
