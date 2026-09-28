# ARCHITECTURE.md

Source of truth for **Marrow**. If the code and this document disagree, one of
them is a bug. Fix the code, or update this document in the same commit — never
leave them out of step.

---

## 1. What this is

Marrow is a read-it-later app. You give it a URL; it fetches the page on the
server, extracts the article, and stores a clean, readable copy you own. The
list of saved things is the product. Everything else serves it.

**In scope, v1:**

- Save a URL from the web app or a browser extension.
- Server-side extraction: title, author, site, publish date, lead image,
  reading time, and the article body as sanitised HTML.
- A reading view that is genuinely nice to read on a phone.
- Tags, archive, favourites.
- Full-text search across title, excerpt, author, site name and body.
- Export everything you have as JSON. No lock-in.

**Explicitly not in scope, v1:**

- Teams, sharing, public profiles, social anything.
- Recommendations or an algorithmic feed. The "From your backlog" strip
  (Slice 13) is not one: it applies a fixed rule, shown on the strip, to the
  reader's own saves, and ranks nothing by behaviour or engagement. Changing
  the rule means changing what the strip says it does.
- PDFs, video, podcasts. URLs that resolve to HTML articles only. Listen
  (Slice 14) is not a podcast: the device's own voices read the article
  that is open, while the page is open. Nothing is recorded, stored or sent,
  and it stops when a phone locks or the browser leaves the screen (iPhone
  and Android alike). Making audio on the server would change
  that, and is a decision for this list, not a setting.
- Mobile apps. The web app is a PWA and that is the whole mobile story.
- Client-side extraction. Extraction is a server concern; see §5. Since
  Slice 10 the extension may send the page the reader already has open. That
  is capture, not extraction: nothing on the client parses the markup, and the
  server extracts and sanitises it exactly as it would a fetched page. Nothing
  pretends to be a browser to get it.
- Bypassing paywalls. A hard paywall is a first-class _failure state_, not a
  problem to solve. See §6.

**The one-line pitch:** save anything, read it clean, later, and own the copy.

### Naming

The product name lives in exactly one place: `lib/constants.ts`, exported as
`APP_NAME`. Nothing else hardcodes it. Renaming the product is a one-line
change plus a domain purchase.

---

## 2. Stack

| Layer     | Choice                           | Why                                                                                              |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Framework | Next.js 16, App Router, React 19 | Server Components keep extracted HTML off the client bundle; one deploy target for app + API.    |
| Language  | TypeScript, `strict: true`       | No `any`, no `@ts-ignore`. Enforced by `npm run typecheck` in CI.                                |
| Styling   | Tailwind CSS v4                  | No component library. The reading view needs bespoke typography; a design system would fight it. |
| Database  | Supabase Postgres                | Row Level Security is the authorisation model, not an add-on.                                    |
| Auth      | Supabase Auth, magic link only   | No passwords to leak, no OAuth consent screens to maintain.                                      |
| Hosting   | Vercel                           | Native Next.js target. Cron via `vercel.json`.                                                   |
| Errors    | Sentry                           | Client + server + edge.                                                                          |
| Tests     | Vitest                           | Fast, no build step, native ESM/TS.                                                              |

### Deviations from the original plan, and why

- **Next 16, not 15.** `create-next-app@latest` ships 16.x with React 19.
  Pinning back a major to match a doc written earlier buys nothing and costs
  security patches. Everything else in the plan is unaffected.
- **Tailwind v4**, which is PostCSS-plugin based (`@tailwindcss/postcss`) and
  has no `tailwind.config.js` by default. Theme tokens live in `app/globals.css`
  under `@theme`. If you go looking for a config file, that is why it is absent.

Any further deviation gets a row in §13 and a line in this section. A deviation
that is not written down is a trap for whoever opens this repo next.

- **Slice 3 image loading is opt-in until the image proxy ships.** Publisher
  images reserve their layout space but make no request until the reader
  chooses to connect to the source. See §7 and the Slice 8 launch checklist.

---

## 3. Repository layout

```
app/
  (marketing)/            Public pages. No auth, statically rendered.
    page.tsx              Landing.
  (app)/                  Authenticated shell. Layout enforces a session.
    inbox/                The list. The main screen.
    read/[id]/            Reading view.
    trash/                Deleted items: restore, delete forever, empty.
    settings/
  api/
    save/route.ts         POST a URL. Creates the item, enqueues extraction.
    cron/                 Scheduled work. Guarded by CRON_SECRET.
  auth/                   Magic-link callback and sign-out.
  globals.css
  layout.tsx
proxy.ts                  Refreshes the session on every request. Next 16's
                          name for what used to be middleware.ts.
lib/
  constants.ts            APP_NAME and the product copy. No logic.
  env.ts                  Environment access and validation. See §8.
  db/
    browser.ts            Anon client for Client Components.
    server.ts             Anon client + session cookies, for the server.
    service.ts            Service-role client. Imports server-only. See §9.
    proxy.ts              Anon client for proxy.ts, plus the response it
                          writes refreshed cookies onto.
  canonical.ts            URL normalisation and the dedupe hash. Pure.
  safe-next.ts            Post-sign-in redirect guard. Pure. See §9.
  fetcher.ts              The SSRF boundary. Security-critical. See §5.
  extract.ts              HTML to article. Pure given a fetch result.
  sanitize.ts             The allowlist that untrusted HTML must survive.
  types.ts                Shared types. Database types should be generated;
                          they are hand-written until SUPABASE_DB_URL works.
components/
supabase/
  migrations/             Numbered, forward-only. Never edit an applied one.
extension/                MV3 browser extension. Its own package.json.
docs/
  ARCHITECTURE.md         This file.
  SCHEMA.sql              The schema, as applied.
  ROADMAP.md              Slices, checklists, and notes from the field.
```

**Rule:** anything under `lib/` that is pure stays pure. `canonical.ts`,
`extract.ts` and `sanitize.ts` take data and return data — no network, no
database, no environment access. That is what makes them testable without
credentials, and it is why Slices 3, 4 and 6 can be built by an agent that has
no access to your Supabase project.

---

## 4. Data model and the authorisation boundary

The schema is `docs/SCHEMA.sql`, applied as `supabase/migrations/0001_init.sql`.
Read it; it is commented. What follows is the reasoning, not a restatement.

### Row Level Security is the authorisation model

Every table has RLS enabled and a policy keyed on `auth.uid()`. There is no
application-level `where user_id = ...` that, if forgotten, leaks data. Forget it
and you get zero rows, not someone else's rows. This is the single most
important property of the schema and it is why every table — including join
tables and the job queue — carries RLS with no exceptions.

**Verify, do not assume.** After any migration:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

Every row must read `t`. A table shipped with `rowsecurity = f` is an incident.

### Why content is a separate table

`items` is queried constantly — it is the list. `item_content` holds the
extracted body, which is measured in tens of kilobytes and is read only when
someone opens one article. Splitting them keeps the list query small and lets
`select *` on `items` stay honest.

### Dedupe

Saving the same article twice must not create two rows. `canonical.ts` produces
a normalised URL (see §6) and `url_hash`, a SHA-256 of it. `items` has a unique
index on `(user_id, url_hash)`. Re-saving is an upsert that resurrects an
archived or soft-deleted item rather than erroring — see the Slice 1 gotcha in
ROADMAP.md, which is the specific case people get wrong.

### Soft delete

`deleted_at` rather than `DELETE`. Undo is expected behaviour in a list you
triage quickly, and losing an article to a mis-tap is the kind of thing that
makes someone stop trusting the app. A cron job hard-deletes after 30 days.

Since Slice 12, `/trash` lists the soft-deleted items and offers Restore and
Delete forever. Delete forever is a session `DELETE` under RLS
(`items_delete_own`); `item_content`, `item_tags`, `highlights` and
`fetch_jobs` cascade, and the cascade runs for a session even though none of
those tables has a delete policy for one (verified live, 2026-09-26). The 30
lives once, as `PURGE_AFTER_DAYS` in `lib/constants.ts`, and the purge's
interval is derived from it.

### Extension tokens and the shared save implementation

`extension_tokens` (0005) stores an owner, browser name, creation/revocation
times and an HMAC-SHA256 hash of a random 32-byte bearer credential. Only the
one-time generation response contains the raw token. Owner RLS policies and
column grants allow issuing tokens, reading metadata and revoking active
tokens; sessions cannot read hashes, change ownership or reactivate a token.
Deleting a profile cascades to its tokens.

`save_item_impl(uuid,text,text,text)` contains the existing save body unchanged
apart from taking its user id as an argument. EXECUTE is revoked from PUBLIC,
anon and authenticated, and granted only to service_role. The existing
SECURITY DEFINER `save_item(text,text,text)` wrapper supplies `auth.uid()`.
The extension API supplies the owner resolved from an active token hash.
There is one upsert implementation: both doors resurrect archived/deleted
items, preserve reading state and requeue extraction only for non-ready items.

---

## 5. The fetcher — SSRF and the untrusted-URL boundary

**This is the most dangerous file in the repository.** A user hands us a string
and we make a server-side HTTP request to it, from inside our hosting provider's
network, with whatever ambient credentials that network confers. That is the
textbook shape of Server-Side Request Forgery. Cloud metadata endpoints, private
network services, and internal admin panels are all one careless `fetch()` away.

`lib/fetcher.ts` is the only place in the codebase permitted to fetch a
user-supplied URL. Nothing else calls `fetch` on user input, ever. If you find
a second one, that is the bug.

### Required guards — all of them, not a subset

1. **Scheme allowlist.** `http:` and `https:` only. Reject `file:`, `gopher:`,
   `data:`, `blob:`, `ftp:`, and anything else, before parsing goes further.
2. **No embedded credentials.** Reject any URL with `username` or `password`.
3. **Port allowlist.** 80 and 443 only. Everything else is refused.
4. **Hostname denylist.** `localhost`, anything ending `.local`, `.internal`,
   `.localhost`, `.home.arpa`, and `metadata.google.internal`.
5. **Resolve, then judge every address.** `dns.promises.lookup(host, { all: true })`
   and reject if **any** returned address is private or reserved — not just the
   first. A hostname with one public and one private A record is an attack, not
   a coincidence.
6. **Blocked ranges.**
   - IPv4: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`,
     `169.254.0.0/16` (this is where `169.254.169.254`, the cloud metadata
     endpoint, lives), `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`,
     `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`,
     `255.255.255.255/32`.
   - IPv6: `::`, `::1` (loopback), `fc00::/7` (unique local), `fe80::/10`
     (link-local), `ff00::/8` (multicast).
   - IPv4-mapped IPv6 (`::ffff:127.0.0.1`) must be **unmapped and re-checked**
     against the IPv4 ranges. Same for `2002::/16` (6to4) and `64:ff9b::/96`
     (NAT64) — extract the embedded IPv4 and check it.
7. **Pin the connection to the address you validated.** Validating a hostname
   and then handing the hostname to `fetch` leaves a DNS-rebinding window: the
   name can resolve to a public IP for your check and `127.0.0.1` for the actual
   connection. Pass a custom `lookup` to the agent that returns only the address
   you already approved. This is why the fetcher is built on `node:http` and
   `node:https` rather than `fetch`: `fetch` exposes no socket-level `lookup`
   hook, so on `fetch` this guard cannot be written at all. Node calls that
   hook with `{ all: true }` and expects an array back whenever
   `autoSelectFamily` is on, which it has been by default since Node 20 —
   answering the older bare-string shape fails every request at connect time.
8. **Redirects are re-validated, every hop.** `redirect: 'manual'`. Maximum 3
   hops. Each `Location` is resolved against the current URL and run through
   the entire check from step 1. A public host that 302s to `127.0.0.1` is the
   single most common bypass and must be covered by a test.
9. **Size cap, enforced on the stream.** 5 MB. `Content-Length` is a hint from a
   hostile party; read the body in chunks, count bytes, and abort the moment the
   running total exceeds the cap. Do not trust the header and do not buffer
   first.
10. **Timeouts.** 10 s total, 5 s to connect. `AbortSignal.timeout`. A host that
    accepts the connection and then sends one byte per minute must not hold a
    serverless function open until the platform kills it.
11. **Content-Type allowlist.** `text/html`, `application/xhtml+xml`,
    `text/plain`. Anything else is refused after headers, before the body.
12. **No ambient authority.** No cookies, no `Authorization`, no client
    certificates, no proxy environment variables. `node:http` reads no proxy
    variables at all, which is a third reason it is the transport. A
    descriptive `User-Agent` naming the product and a contact URL, so site
    operators can identify us — accepting that some CDNs blackhole any agent
    that is not a browser, and that those sites therefore resolve to
    `unreachable` after the timeout. Being identifiable is the point; a
    `User-Agent` that imitates Chrome to get past bot management is not a
    change to make quietly.
13. **Errors are opaque to the caller.** Map every failure to the fixed
    taxonomy in §6. Never return the raw error, the resolved IP, the timing, or
    the redirect chain to the user. Differentiated errors turn the fetcher into
    a blind-SSRF oracle for mapping an internal network.

### Pages the reader sends (Slice 10)

A toolbar or shortcut save from the extension carries the open tab's HTML.
No request is made on its behalf, so none of the guards above run, and none
need to: nothing is fetched. What replaces them is:

- a byte cap, `SAVE_BODY_MAX_BYTES` in `lib/save-body.ts`, counted as the route
  reads the body and never trusted from Content-Length, answered with 413.
  It bounds what we decode, not what is received. `proxy.ts` matches the
  route, so Next buffers the body first (up to 10 MB by default), and Vercel
  refuses anything over 4.5 MB before that. Narrowing the proxy is in Slice 8;
- the same extractor and sanitiser as a fetched page, through the same
  `processJob` and the same item-scoped claim;
- the rule that a ready item keeps its body. A sent page can fill an empty
  item but can never rewrite a stored one.

Anyone with a token can send any markup for any URL. That is tolerable only
because it lands in their own library and is sanitised on the way in.

### Runtime

`lib/fetcher.ts` and every route that calls it run on the **Node.js runtime**,
never Edge. Guards 5 and 7 need `node:dns` and a real socket-level `lookup`
hook, and neither exists on Edge. Any route importing the fetcher declares
`export const runtime = 'nodejs'`.

### Testing

The tests are written **before** the implementation, and they cover at minimum:
private IPv4 ranges; IPv6 loopback and ULA; an IPv4-mapped IPv6 address; a
redirect from a public host to `127.0.0.1`; a redirect chain longer than 3; a
response that exceeds 5 MB; a host that times out; a non-HTML content type; and
a URL carrying embedded credentials. No network access in the test suite — DNS
and the agent are injected.

---

## 6. Extraction pipeline

Input: a validated fetch result. Output: either an article or a typed failure.
Everything here after the fetch is pure and testable offline.

### Steps

1. **Canonicalise** (`lib/canonical.ts`, pure). Lowercase scheme and host, strip
   the default port, strip the fragment, drop tracking parameters (`utm_*`,
   `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`, `ref_src`,
   `_hsenc`, `_hsmi`, `yclid`, `msclkid`), sort the remaining query parameters,
   strip a trailing slash on a non-empty path, and honour `rel=canonical` from
   the fetched document when it points at the same registrable domain — and only
   then, because an off-domain canonical is how a scraper site steals identity.
   Registrable domain needs the Public Suffix List and therefore a dependency we
   do not carry, so the implemented test is narrower: the same host, or one host
   a subdomain of the other. It never accepts a canonical the fuller test would
   reject; it declines `m.example.com` pointing at `www.example.com`, which
   loses a dedupe rather than opening a hole.
   Hash the result with SHA-256 into `url_hash`.
2. **Parse** the HTML with `linkedom` — not `jsdom`. Serverless cold starts
   matter and `jsdom` is an order of magnitude heavier.
3. **Extract** with `@mozilla/readability`. It is the same engine as Firefox
   Reader Mode, which means its failure modes are well understood and its
   output is predictable.
4. **Metadata**, in priority order: JSON-LD `Article`, then OpenGraph, then
   Twitter cards, then `<meta name>`, then Readability's own guesses, then
   `<title>`. First non-empty wins, per field, independently.
5. **Sanitise** (`lib/sanitize.ts`) with a strict allowlist via `sanitize-html`.
   This is a security boundary, not a formatting step: we store HTML that we
   later render into our own origin, so a surviving `<script>` or an
   `onerror=` attribute is stored XSS against every reader of that item. Allow
   structural and semantic tags, `href` on `<a>` restricted to http/https,
   `src`/`alt` on `<img>`; strip every event handler, every `style`, every
   `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, and every
   `javascript:` or `data:` URL. Force `rel="noopener noreferrer nofollow"` and
   `target="_blank"` on outbound links.
6. **Derive** word count and reading time (200 wpm, floor 1 minute).

### Failure taxonomy

Extraction fails constantly and that is normal. Every failure resolves to one of
these, stored in `items.fail_reason`, each with its own user-facing copy and its
own suggested next action. A failed save is still a saved item — the URL and
title are kept, the body is not.

| Code               | Means                                                                                                                | What the user sees                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `blocked_url`      | Failed a §5 guard.                                                                                                   | "That link can't be saved." No detail, deliberately.   |
| `unreachable`      | DNS failure, connection refused, timeout.                                                                            | "Couldn't reach that site." Offer retry.               |
| `not_found`        | 404 or 410.                                                                                                          | "That page is gone."                                   |
| `forbidden`        | 401, 403, or a bot wall.                                                                                             | "That site blocked us."                                |
| `paywalled`        | Extracted, but the body is a stub and paywall markers are present, or the extracted body is itself a paywall notice. | "Looks like a paywall — saved the link only."          |
| `too_large`        | Exceeded 5 MB.                                                                                                       | "That page is too big."                                |
| `unsupported_type` | Not HTML.                                                                                                            | "Only web pages for now."                              |
| `js_required`      | Under 250 words and the document is mostly `<script>`.                                                               | "This page needs a browser to render. Saved the link." |
| `no_content`       | Readability returned nothing usable.                                                                                 | "Couldn't find an article here. Saved the link."       |
| `server_error`     | Anything else. Logged to Sentry with the URL.                                                                        | "Something went wrong on our end." Retry.              |

**Design rule: every one of these must be reachable and survivable.** A save
that fails is never a spinner that never resolves and never a row that silently
disappears.

---

## 7. Rendering, routes and caching

- **Server Components by default.** `'use client'` is opt-in, at the leaf, and
  needs a reason: interactivity or browser API access. The extracted article
  body is rendered on the server; it never enters the client bundle.
- **The list is the product.** `/inbox` is the default route after sign-in.
  Mobile-first: the phone layout is the design, the desktop layout is the
  adaptation, not the other way round.
- **Mutations are Server Actions**, except `POST /api/save`, which is a real
  route because the browser extension calls it cross-origin and needs CORS and
  a token.
- **No caching of user data.** Every authenticated route is dynamic. `items` is
  per-user and mutable; a stale list is worse than a slow one. Marketing pages
  are static.
- **Optimistic UI on the list.** Archive, favourite and delete apply instantly
  and reconcile on the server response. Saving shows the item immediately in a
  `pending` state; extraction fills it in.
- **Images will be proxied** through `/api/img`, re-using the §5 guards. This
  endpoint is not present in Slices 0–2. Until it ships, the Slice 3 reader
  reserves a bounded image frame and offers **Load image**, explicitly saying
  it connects to the source site. Only that choice sets a publisher `src`;
  requests use `loading="lazy"` and `referrerPolicy="no-referrer"`. This still
  exposes the reader's IP to that source and HTTP images can fail under HTTPS,
  so automatic publisher loading remains deferred to the proxy in Slice 8.
  Missing dimensions use a fixed 3:2 frame; valid dimensions keep their ratio.
  `object-fit: contain` and an equally sized unavailable state prevent shifts.

### Library triage state

- `/inbox` accepts `state=inbox|archive|favourites`, `read=all|read|unread`,
  `tag=<tag UUID>` and a one-based `page`. Tag IDs keep shared filter URLs valid
  after a rename. Pages contain 50 rows plus one server-side lookahead row.
  Archive sorts by `archived_at`; the other states sort by `created_at`. All
  have `id` as a deterministic secondary sort and retain the partial-index
  predicates from SCHEMA.sql. Live plans are handed off in
  `docs/SLICE-4-EXPLAIN.sql` and have not been verified without credentials.
- Optimistic intent is queued in the client and written by session-scoped
  Server Actions in order. Each response reloads the list and tags, then the
  client replays only the remaining intent. A rejected operation therefore
  rolls back without cancelling later independent operations. Snapshot read
  timestamps prevent older route refreshes from undoing confirmed responses.
- A transport failure can follow a committed write. If reconciliation fails,
  the UI returns to its last confirmed list, cancels unsent intent, explains the
  uncertainty and requires a reload before more triage. Delete Undo retains
  the original rows and stays available without a timer while the client page
  remains mounted; reload/navigation away can discard that local Undo history.
- Tag names are normalized purely in `lib/tags.ts`, within the schema's ASCII
  slug constraints. Creation ignores unique conflicts and then resolves the
  existing ID. Bulk association is one insert; if it fails, an unused tag may
  remain and is reported. Rename conflicts reject instead of merging tags.
  Autocomplete uses the cached complete catalogue with no keystroke requests.

### Search

- `/search` takes `q` alongside the same `state`, `read`, `tag` and `page`
  parameters the library takes, read by the same `parseFilters`. `searchUrl` is
  built on `filterUrl` so the two cannot drift, and moving between the library
  and the results keeps whatever was narrowed down. Both the `tag` parameter
  and any `tag:` in the query are required tags, so they compose rather than
  override.
- `lib/search.ts` is pure and holds the whole query language: quoted phrases,
  `-exclusion`, `tag:` and `-tag:`, `or`, and caps on length and token count.
  Only structure leaves it. The strings it produces go to
  `websearch_to_tsquery`, which never throws; `to_tsquery`, which does, is used
  nowhere.
- Exclusions are carried as a **separate** query, not as `!term` inside the
  positive one. Search reads two tables, and a negation inside one index scan
  says nothing about the other, so an exclusion is asked of the whole item.
- `public.search_items` (0004) is the query. Title and body are indexed in
  different tables, so each is asked separately — one lookup per GIN index —
  and the answers are folded by item id. Metadata rank is `ts_rank_cd(…, 32)`,
  body rank `ts_rank_cd(…, 1|32)`, combined as `meta + 0.4 * body` so that a
  title match always outranks a body match. `ts_headline` runs after the LIMIT,
  never before.
- The function is SECURITY INVOKER and filters by nothing: RLS is the
  authorisation model, as everywhere else. It must never become SECURITY
  DEFINER, and EXECUTE is revoked from `service_role`, which bypasses RLS.
- Snippets come back with matches wrapped in `chr(2)`/`chr(3)` and are split
  into `<mark>` elements. Snippet text is article text from a page we did not
  write and is never handed to a renderer as HTML.
- **There are deliberately two search affordances, and they are not the same
  thing.** `/` in the library is Slice 4's find-on-this-page: a substring match
  over the titles and URLs already on screen, which jumps to a row and touches
  no server. `/search` is this: full text, every item, ranked. The library
  keeps `/` because jumping to a row you can already see should not cost a
  round trip. Nothing links `/` to `/search` today; when Slice 8 splits
  `components/filter-bar.tsx`, offering "search everything for this instead"
  when the on-page find comes up empty is the obvious join between them.

### Reader state and fixture boundary

- `profiles.settings.reader` is `{ theme, family, size }`. Theme is `system`,
  `light`, `dark` or `sepia`; family is `serif` or `sans`; size is 18, 20, 22 or
  24 CSS pixels. An absent theme means `system`. CSS follows device changes
  without JavaScript; an explicit profile choice is rendered by the server.
  Updates merge the reader object into the existing profile settings.
- `items.read_progress` is a fraction of the article's scrollable height,
  excluding the heading and footer. A trailing five-second throttle serializes
  writes. `visibilitychange` (hidden), `pagehide` and unmount flush the latest
  value. A per-user, per-item local recovery value survives interrupted network
  writes; a successful write clears it if it has not changed in the meantime.
  Closing a browser can interrupt a request, so the recovery value is restored
  on the next visit and synchronized as reading resumes.
- `/read/[id]` reads the item, content and profile through the verified session
  client and RLS. The body is re-sanitized and converted to React elements only
  on the server. Only controls, progress and individual image loading are
  client components; article HTML is never imported into their JavaScript.
- `/reader-preview/[id]` is a public, noindex catalogue of fixed fixtures. Its
  explicit proxy exception never applies to `/read`, and no fixture path reads
  Supabase. The catalogue selects from an allowlist before reading any file.
  It shares the production renderer but stores preferences and positions only
  in a separate browser namespace. Retry explains that no job was requested.
  The original SVG is served locally; example-domain source links are fixtures,
  not working publisher URLs.

### Highlights and notes (Slice 11)

- A highlight stores `quote`, `start_offset`, `end_offset` and an optional
  `note`. Offsets are UTF-16 code units into
  `toPlainText(sanitiseArticleHtml(item_content.html))`, recomputed at read
  time. They are not offsets into `item_content.text`, which the sanitiser
  of the day the item was fetched produced, and which may differ from what
  the reader renders today.
- `lib/highlight-dom.ts` reads the rendered article back as that same
  string. It skips the image placeholder (`.reader-image`, whose "Load image"
  and alt text the stored HTML never had) and `noscript`, and shares the
  block list in `lib/plain-text.ts` with `toPlainText`. A test renders the
  fixtures through `ArticleBody` and compares; on 2026-09-25 the same
  comparison also matched in a real Chromium, after hydration, on the three
  preview fixtures.
- `addHighlight` recomputes the text on the server and refuses a quote that
  is not exactly the text at its offsets. On load, each highlight re-anchors:
  its own offsets if they still hold the quote, otherwise the occurrence of
  the quote nearest to `start_offset`. One whose quote is gone is listed in
  the panel as not found and never painted. A short quote that occurs twice
  can re-anchor to the wrong occurrence after a re-extraction; the schema
  keeps no surrounding context to tell them apart.
- Painting uses the CSS Custom Highlight API (`CSS.highlights`,
  `::highlight()`). Nothing writes into the rendered article. A tap on a
  painted highlight is hit-tested against the ranges' boxes, because
  `highlightsFromPoint` is missing from iPhone Safari (and from the Chromium
  in the desktop app's browser pane). The toolbar panel lists every
  highlight either way.
- Sessions insert only the content columns and update only `note` (0010).
  Moving a highlight means deleting it and making another. Quote and note
  length caps live in SQL as well as in `lib/highlights.ts`, because
  PostgREST is reachable directly with a session.
- `/read/[id]?h=<id>` scrolls to that highlight and suppresses the
  saved-position restore, but only when the id is one of the item's
  highlights and the page finds its quote in today's text. Otherwise the
  article opens where the reader left off, because opening at the top lets
  the first scroll overwrite the saved position. The decision is made once,
  when the article opens.
- A selection that runs past the article is clamped to it: Chromium ends a
  triple-click on the last paragraph at the start of the footer.
- The public previews have no database and offer no highlighting.

### Trash (Slice 12)

- `/trash` is its own page, not a fourth library state. The library refuses
  every change except restore on a trashed row, and `filter-bar.tsx` is the
  file Slice 8 has to split. The library links to it, and its undo panel says
  where a deleted item went and for how long.
- It lists the reader's deleted items, newest deletion first
  (`deleted_at desc, id desc`), 50 to a page with a lookahead row, served by
  `items_trash_idx` (0011). A second, single-row query returns the whole
  trash's count and its newest `deleted_at`, so Empty trash can say what it
  will delete from any page.
- Nothing is optimistic. Nothing on the page can be undone, so a row changes
  only when the server says it did: each Server Action revalidates `/trash`
  and `/inbox`, and the rows that come back are the truth.
- The actions run on the session client only. `purge_deleted_items` takes
  no user and would empty every user's trash. Restore and Delete forever
  repeat `deleted_at is not null`, because a re-save from any door, or a
  restore in another tab, may have made the row live since the page loaded;
  a row that no longer matches is kept and reported. Empty trash deletes by
  predicate, bounded by the newest `deleted_at` the page read, passed back
  as the database wrote it (microseconds included), so an item trashed after
  the page loaded is never taken unseen.
- Each row's time is put into words on the server by `purgeCountdown`, with
  one `now` for the page. The purge runs once a day, so the deadline is the
  earliest an item can go, not when it goes: figures round down, and past the
  deadline the row says it goes at the next daily clean-up.
- Titles are plain text, because the reader refuses a trashed item; the row
  links to the original URL instead.
- Delete forever is two presses on one button, so focus stays put between
  them. That same button is where a double-click's second click and a held
  Enter's repeats land, so both are refused. Empty trash's dialog opens on
  Cancel for the same reason.
- `proxy.ts` lists `/trash` as protected, so a signed-out visit is sent to
  sign in with `next` and comes back to Trash. Without it the `(app)`
  layout's redirect wins, and that one carries no `next`.

### The backlog strip (Slice 13)

- In the plain library view only (Inbox, All, no tag, page 1), a strip
  between the save form and the list shows up to three ready articles saved
  at least 14 days ago that are not archived, not in Trash, under 90% read,
  and not put off with Not now. The rule is stated on the strip.
- `public.backlog_strip(p_week, p_min_age_days)` (0012, then 0013) picks
  them. Each candidate is ranked on `md5(week || id)`, and both time
  conditions (the minimum age and Not now's expiry) are measured from the
  start of the ISO week, Monday 00:00 UTC, not from `now()`. So the pick
  holds all week and on every device: it changes when the week turns, when
  one of its own items leaves, or when the reader brings an old item back
  (unarchive, restore). It is SECURITY INVOKER with no user filter, like
  `search_items`; EXECUTE is kept from anon and the service role. The
  minimum age is passed from `lib/backlog.ts`, so changing it is a code
  change.
- `read_at` is never written until Slice 8, so "unfinished" means
  `read_progress < 0.9`. That measures scrolling, not opening, so the copy
  says "40% read" or "not started", never "unread".
- Not now sets `items.resurface_after` 30 days ahead through the session
  client; nothing else about the item changes. The item comes back at the
  first week start after that, so the strip says "about a month".
- When Not now empties the strip, the strip unmounts with the focused
  button, and the library heading takes focus so the shortcuts keep
  working. The strip's keydown guard lets `?`, `/` and Escape through.
- The page asks for the strip once, with one `now` for the week and the
  wording. If that request fails the strip is left out: it is a way back
  into the library, and the library must still render.
- The strip renders inside the library's keyboard surface, so its keydowns
  stop at its wrapper; the triage shortcuts act only on the list.

### Listen (Slice 14)

- A speaker button in the reader toolbar reads the article aloud with the
  browser's `speechSynthesis`: no server route, key, dependency or
  migration. It appears after hydration, only for a readable article and
  only where the browser has speech. It works on `/reader-preview` too.
- What is spoken comes from the rendered page: the `h1`, then the article
  through `textIndex` (`lib/highlight-dom.ts`), so the image placeholder and
  `noscript` are never read. Every block element ends a sentence and `pre`
  is skipped (`spokenSentences` in `lib/listen.ts`). Sentences come from
  `Intl.Segmenter` in the article's `lang`, with a punctuation split where it
  is missing. One over 200 UTF-16 units is split at a comma or a space.
- One sentence per utterance (`components/reader/narrator.ts`). Pause
  cancels, and Resume speaks the sentence again from the last word the
  browser reported (word `boundary` events), or from its start where none
  arrive; skips move one sentence. After a cancel that interrupted speech,
  the next `speak()` waits 350 ms, because Chrome on Android stops
  asynchronously and loses a speak sent straight behind the cancel. The
  first speak of a session never waits (iPhone's gesture rule). Every utterance carries a generation number, and events
  from any but the newest are dropped, because a cancelled utterance
  answers late: Chrome with an `interrupted` error, others with `end`. The
  current utterance is held by reference.
- Play starts at the first sentence whose box ends below the toolbar, or
  from the top once the reader has finished. Everything up to `speak()`
  runs inside the tap, which iPhone Safari requires.
- The spoken sentence is painted with the `marrow-listen` Custom Highlight
  and scrolled into view when it leaves the screen. The toolbar does not
  auto-hide while Listen plays. Follow-along scrolling writes
  `read_progress` through the usual throttled path.
- Rate and voice live in localStorage under `reader:<scope>:listen`, per
  device, not in `profiles.settings`: voices differ per device, and a rate
  is relative to its voice. The voice is stored per primary language
  subtag. With none stored, the utterance gets the article's `lang` and the
  device picks its default voice. With one stored, the utterance takes that
  voice's language rather than the article's, because Chrome on Android
  picks the voice by language. A change of either restarts speech at once,
  from the word being spoken where the browser reports words; one that waited for the next sentence was heard too
  late to seem to work.
- Speech stops on unmount (Esc and Back to library are client navigations,
  and `speechSynthesis` belongs to the window) and on `pagehide`. When the
  page is visible again and the engine has gone quiet or paused on its own,
  the control reads Resume.

---

## 8. Environment variables

Every variable the app reads, in one place. `.env.example` mirrors this list
with empty values and is committed. `.env.local` holds the real values and is
**never** committed — `.gitignore` covers `.env*`, with `.env.example`
explicitly un-ignored.

`NEXT_PUBLIC_` is a prefix that means _this value is compiled into JavaScript
that is shipped to every visitor's browser_. It is not a namespace and it is not
a convention. Putting a secret behind it publishes the secret.

| Variable                        | Public | Needed from | Where it comes from                                                                                                                           |
| ------------------------------- | ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes    | Slice 0     | Supabase, Project Settings, API, Project URL                                                                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes    | Slice 0     | Supabase, Project Settings, API, `anon` `public`                                                                                              |
| `SUPABASE_SERVICE_ROLE_KEY`     | **NO** | Slice 0     | Supabase, Project Settings, API, `service_role`. Bypasses RLS entirely. Server-only, always.                                                  |
| `NEXT_PUBLIC_SITE_URL`          | yes    | Slice 1     | Your deployed origin, no trailing slash. Magic-link redirects are built from it, so a wrong value silently breaks sign-in in production only. |
| `SUPABASE_DB_URL`               | **NO** | Slice 0     | Supabase, Project Settings, Database, connection string. Used by the CLI for migrations.                                                      |
| `SENTRY_DSN`                    | no     | Slice 0     | Sentry, Project, Client Keys                                                                                                                  |
| `NEXT_PUBLIC_SENTRY_DSN`        | yes    | Slice 0     | Same DSN. A DSN is not a secret; it identifies a project and only permits writes.                                                             |
| `SENTRY_ORG` / `SENTRY_PROJECT` | no     | Slice 0     | Sentry URL slugs. Source-map upload only.                                                                                                     |
| `SENTRY_AUTH_TOKEN`             | **NO** | Slice 0     | Sentry, Settings, Auth Tokens. Build-time only; set it in Vercel, not in the repo.                                                            |
| `CRON_SECRET`                   | **NO** | Slice 7     | Generate: `openssl rand -hex 32`. Every `/api/cron/*` route rejects a request whose bearer token does not match.                              |
| `EXTENSION_TOKEN_SECRET`        | **NO** | Slice 6     | `openssl rand -hex 32`. Keys HMAC-SHA256 of extension save tokens; rotating it invalidates all existing tokens.                               |
| `RESEND_API_KEY`                | **NO** | Slice 7     | resend.com. Only needed if the digest email ships; the slice degrades gracefully without it.                                                  |

**Absent-key behaviour.** A missing required variable throws, with the
variable's name in the message. Failing loudly beats failing mysteriously at
3 a.m.

The throw happens on **first use**, not at import. `lib/env.ts` exposes getters
for exactly this reason: `next build` walks every module, so validating at
import time would make a build without credentials fail — and that build is
what CI runs on every pull request, and what an agent with no access to this
Supabase project uses to check its own work. Deferring the throw keeps it just
as loud while keeping `npm run build` credential-free, which is an invariant
worth protecting.

Missing Sentry or Resend keys disable that feature quietly; they are genuinely
optional. There is **no** fallback to a placeholder value anywhere.

---

## 9. Security posture beyond the fetcher

- **Auth.** Magic link only. No password to phish, no reset flow to abuse, no
  OAuth app to misconfigure. Sessions live in httpOnly cookies via
  `@supabase/ssr`.
- **`getUser()`, never `getSession()`, on the server.** `getSession()` reads the
  cookie and trusts it. `getUser()` verifies the JWT with Supabase. On the
  server, always the latter.
- **The service-role client bypasses RLS.** It is the one key that can read
  every user's data. `lib/db/service.ts` imports `server-only` so that a client
  component importing it fails the build rather than shipping it to a browser.
  It is used for migrations, cross-user cron jobs, and the narrowly scoped
  extension save entry point. The latter verifies the stored token hash before
  deriving identity; it never accepts a caller-supplied user id.
- **Extension credentials only authorize saving.** They are opaque tokens,
  not Supabase session JWTs, and only `POST /api/save` accepts them. Generating
  and revoking tokens requires a verified web session. Revocation is checked
  on each save; an already authenticated in-flight request may finish.
  Extension requests omit cookies; an invalid bearer never falls back to a
  cookie session. CORS permits the own-site origin and syntactically valid
  Chrome/Firefox extension origins, with POST/OPTIONS and only Authorization
  and Content-Type request headers. It never enables credentialed CORS and
  exposes Retry-After. A token is still required even for an allowed extension
  origin; host permissions can also allow requests without an Origin header.
- **Stored XSS is the realistic threat.** We render attacker-controlled HTML
  into our own origin. §6 step 5 is the defence. A CSP without `unsafe-inline`
  for scripts is the second layer; sanitisation is not allowed to be the only
  one.
- **Rate limits** on `POST /api/save`, counted in Postgres against the user id.
  Without one, a single account can point our servers at an arbitrary number of
  hosts — we become someone's scanner, and our IP range takes the blame.
  **Sixty accepted saves per rolling hour.** The counter is `save_events`, one
  row per accepted save written inside `save_item()`; a rejected save writes
  nothing, so the window drains instead of the lockout extending itself.
  Rejection is a 429 with `Retry-After` and copy that says what happened —
  never a 500, which tells someone to retry the thing that just failed.
  `checkSaveRateLimit` requires an explicit session or user scope. The session
  form relies on RLS and has no user-id filter; the service-role form requires
  the verified token owner's user id and always filters by it. The same scope
  supplies identity to the save implementation. Both forms use the same
  `decideRateLimit` arithmetic and accepted-save events; neither has a separate
  allowance. The existing count-then-save concurrency behavior is unchanged.
- **Zero secrets in committed files.** Not in tests, not in fixtures, not in
  comments, not in a `.env.example` that "just has the dev one".
- **Sent pages are untrusted input (Slice 10).** The extension's `scripting`
  permission is used on the active tab only, at the click, to read
  `document.documentElement.outerHTML`. The page is sent once and never
  stored in the extension, so the offline queue still holds links only. See
  §5, "Pages the reader sends".

---

## 10. Background work

Extraction happens out of band. `POST /api/save` writes a `pending` item and
returns immediately; the user sees the row appear at once. Nobody waits ten
seconds for a page fetch to finish. The fetch then runs in the same
invocation, after the response has gone (`after()`, Slice 9), so the article
is usually readable within seconds. The queue below is the backstop, not the
first attempt.

- `fetch_jobs` is the queue. A row per attempt-cycle, with `state`, `attempts`,
  `run_after` and `last_error`.
- Retries: only for transient reasons — `unreachable` and `server_error`.
  Retrying a 404 is someone else's server paying for our optimism.
- Backoff between attempts walks 1 min, 5 min, 25 min, and how far down that a
  job goes is capped by its own `max_attempts` column. The default is 3; the
  25-minute step is reached only by a row whose cap has been raised
  deliberately. The minutes are a floor: a job is claimed only when the cron
  runs, so on the daily schedule below each retry waits for the next day's run
  and an unreachable site gets its final answer about two days after saving.
- Vercel Cron drives `/api/cron/extract`; each run claims a small batch with
  `for update skip locked` so overlapping invocations cannot process the same
  job twice. `attempts` increments at claim time, not at settle time: a worker
  that dies mid-fetch has still spent an attempt.
- The batch is five, fetched concurrently, so a round costs one fetch budget
  rather than five. A run keeps claiming rounds until the queue is empty or a
  40-second budget is spent — throughput is the batch size times how often the
  cron runs, and the schedule below makes "how often" small.
- **The schedule is once a day, and that is a plan limit, not a design.**
  Vercel's Hobby plan rejects any cron expression that would run more than
  daily; a deployment carrying `* * * * *` fails outright. So `vercel.json`
  says `9 2 * * *` for extract and `17 4 * * *` for purge, both UTC, and Hobby
  additionally fires them within a one-hour window of that time rather than on
  the minute. Since Slice 9 this no longer delays a save: `lib/extract-now.ts`
  claims that one item's job with `claim_fetch_job_for_item` (0008) and runs
  it in `after()`, both from `/api/save` and from the reader's Try again.
  What still waits for the daily run is everything after a first attempt that
  failed transiently, and any fetch the platform cut off. Those remain a
  launch decision in Slice 8.
- A `running` row whose `locked_at` has not moved for five minutes is a crashed
  worker. It goes back to the queue, or — if it stalled on its last attempt —
  the job is closed **and its item is resolved with it**, because a tidy job
  table behind an item that still shows a spinner is the failure section 6
  forbids.
- `/api/cron/purge` runs daily and hard-deletes items soft-deleted over 30 days
  ago (`PURGE_AFTER_DAYS`). `item_content`, `item_tags`, `highlights` and
  `fetch_jobs` cascade.
- Every cron route requires `Authorization: Bearer ${CRON_SECRET}`, compared in
  constant time. A route that finds the variable unset fails closed with a 500
  and a Sentry event; it never treats "unconfigured" as "open".

---

## 11. Observability

Sentry for client, server and edge. Every extraction failure is logged with the
URL and the failure code; `blocked_url` in particular is logged, because a spike
in it means someone is probing us. PII is scrubbed: no email addresses, no
tokens, no cookies in event payloads. `/api/debug-sentry` exists only to prove
capture works during Slice 0 and is **deleted in Slice 8**.

---

## 12. Testing

- **Vitest.** Unit tests live beside the code as `*.test.ts`.
- **Non-negotiable coverage:** `lib/fetcher.ts` (see §5), `lib/canonical.ts`
  (dedupe correctness is data integrity), and `lib/sanitize.ts` (an XSS corpus
  that must not survive).
- **No network in tests.** Ever. DNS and the HTTP agent are injected into the
  fetcher for exactly this reason. A test suite that needs the internet is a
  test suite that fails in CI on a Sunday for reasons unrelated to the code.
- CI runs `typecheck`, `lint`, `test`, `build` on every pull request.

---

## 13. Decisions log

Append here when a decision is made that a future reader would otherwise
re-litigate. Date, decision, reason.

- **2026-09-11 — One save implementation, two authenticated doors.** The user
  reviewed and approved the SQL split before it was added to 0005. Extension
  re-save means the Slice 1 resurrection/preservation behavior, not a literal
  absence of writes. The privileged identity parameter is safe only behind
  the service-role-only grant; the web wrapper remains SECURITY DEFINER.
- **2026-09-11 — Required rate-limit scope.** The user rejected an optional
  user-id filter because omission or a wrong filter could miscount another
  account. The approved discriminated scope makes the session/user choice
  explicit and userId required for the service-role form. Offline tests put
  two accounts' events in one backing collection and exercise both scopes.
- **2026-09-11 — Separate browser build, no additional dependencies.** Chrome
  uses an MV3 module service worker and Firefox an MV3 module event page from
  the same sources. The extension package uses the root's existing compiler
  and test tools. Its build ships only browser modules and options assets;
  `extension/server` and `extension/web` belong to the Next app. activeTab and
  the single API host are supplemented only by storage, contextMenus and
  alarms for the checklist's durable storage, link menu and suspended-worker
  retry requirements. No content scripts or page-wide host permission exist.
- **2026-09-11 — Durable saves belong to their configured token.** Local
  writes are serialized, saves persist before requests, and alarms retry after
  worker restarts. Replacing/removing a token or receiving 401/403 discards
  pending saves, so one account's browsing activity cannot be replayed into
  another. The options UI states this behavior before the user changes tokens.

- **2026-09-09 — Credential-free reader catalogue, separate from auth.** A
  dedicated `/reader-preview/[id]` route makes Slice 3 reviewable without
  weakening the authenticated layout. Only this fixed fixture namespace skips
  session refresh. Production persistence is covered with offline session and
  database fixtures, not a live project.
- **2026-09-09 — Opt-in publisher images pending the proxy.** The image proxy
  described in §7 was not implemented by an earlier slice. Building a second
  fetcher inside the reader would cross the Slice 3 boundary. Reserve space,
  disclose the source connection, and require a tap until the guarded proxy
  ships; the remaining work is tracked in Slice 8.

- **2026-09-06 — Next.js 16 instead of 15.** `create-next-app@latest` ships 16.
  Pinning back a major for doc-consistency is not a reason.
- **2026-09-06 — `lib/db/` as three files, not one `lib/db.ts`.** The original
  plan called for one module exporting all three clients. That cannot work: the
  service-role module must import `server-only` to poison it for client
  bundles, and the server module imports `next/headers`, which is unavailable
  in Client Components. A single file would therefore be unimportable from the
  browser client's own consumers. Splitting is the only way to get the
  build-time guard, which is the point of the exercise.
- **2026-09-06 — `linkedom` over `jsdom`.** Serverless cold-start cost.
- **2026-09-06 — `sanitize-html` over DOMPurify.** DOMPurify wants a DOM;
  `sanitize-html` is a pure-Node parser and this runs on the server only.
- **2026-09-06 — Soft delete over hard delete.** Undo is expected in a list
  people triage quickly.
- **2026-09-06 — No paywall circumvention.** It is a failure state with copy,
  not a feature. This is a product decision and a legal one.
- **2026-09-09 — `proxy.ts`, not `middleware.ts`.** Next 16 renamed the file
  convention and warns on the old name.
  `npx @next/codemod@canary middleware-to-proxy .` performs the rename.
- **2026-09-09 — Environment validation is lazy.** §8 explains it. The
  invariant being protected is that `npm run build` needs no credentials, which
  is what makes CI meaningful and what keeps the Codex-owned slices unblocked.
- **2026-09-09 — Database types are hand-written for now.** `supabase gen types`
  needs either a Supabase access token or a working connection string, and
  neither is configured. `lib/types.ts` must be replaced with generated output
  once `SUPABASE_DB_URL` works; until then it is kept in step with SCHEMA.sql by
  hand, which is exactly the kind of thing that rots.
- **2026-09-09 — The fetcher is built on `node:http`, not `fetch`.** Three of
  the section 5 guards need it: `fetch` has no socket-level `lookup` hook, so
  guard 7 cannot be expressed on it; redirects have to be ours to follow so
  guard 8 can re-validate each hop; and `node:http` consults no proxy
  environment variables, which guard 12 requires. The cost is writing the
  streaming, timeout and redirect handling by hand, which guard 9 wanted
  anyway.
- **2026-09-09 — Same-site canonical instead of registrable domain.** Section 6
  step 1 explains the narrower test and what it costs. Revisit if a public
  suffix list ever earns its place in `package.json`.
- **2026-09-09 — A paywall is detected from the extracted body, not only from
  its length.** A teaser padded with advertising furniture extracts as several
  hundred words and clears any threshold for "stub"; the New York Times does
  exactly this, and judging by length alone stores "we are checking your
  access" as a two-minute read. The body is asked what it is before it is asked
  how big.
- **2026-09-09 — `docs/SCHEMA.sql` is the current schema, not a copy of the
  first migration.** It carries every correction later migrations made, so a
  fresh project needs one paste rather than a replay. Migrations stay
  forward-only and frozen; `0001` still contains the bug `0002` fixed.
- **2026-09-10 — `max_attempts` caps the backoff schedule; the schedule does
  not set the attempt count.** "3 attempts, backoff 1 / 5 / 25" reads two ways,
  and the column won. A job runs, waits a minute, runs, waits five, runs, and
  is then finished — a final answer roughly six minutes after saving, with the
  retry button the taxonomy allows. The alternative reading spends half an hour
  before admitting a site is down, which is a worse product for the same code.
  The 25-minute step stays in the table because `max_attempts` is per row.
- **2026-09-10 — The cron worker does not call `POST /api/extract`.** That
  route runs as the signed-in user and is scoped by RLS, which is right for a
  reader pressing Retry and impossible for a worker acting across every user's
  rows. The two share the pipeline — `lib/fetcher`, `lib/extract`,
  `lib/sanitize` — and duplicate the item and `item_content` writes, which
  differ anyway in client and in job bookkeeping. Folding them together is
  tracked for Slice 8 rather than done inside this one.
- **2026-09-10 — `lib/queue.ts` takes its Supabase client as a parameter.**
  Importing `lib/db/service.ts` would pull `server-only` into the module graph,
  and that package throws outside a React Server Component, so the retry policy
  and the cron authorisation would only be testable through a route. It also
  puts the privilege at the call site, where a reader can see it.
- **2026-09-10 — The extract cron drains, rather than taking one batch.** With
  a per-minute schedule, throughput is the batch size times sixty an hour and a
  fixed batch is fine. Vercel's Hobby plan allows only a daily cron, and five
  items a day is not a queue. A run now keeps claiming until the queue is empty
  or a 40-second budget is spent, which is correct under both schedules — the
  budget stops it _starting_ another round, well short of `maxDuration`,
  because a run the platform kills leaves its rows locked for the stale-lock
  window.
- **2026-09-24 — The save limit lives in Postgres too.** `save_item` is
  granted to `authenticated`, so `/rest/v1/rpc/save_item` never passed through
  `/api/save` and its 60-an-hour check; with open sign-up that was an unmetered
  queue of server-side fetches. `enforce_save_limit` (0006) counts the same
  `save_events` window under a per-user advisory lock and raises `PT429`, which
  PostgREST turns into HTTP 429. Both save doors and `retry_item` spend it. The
  route keeps its own check because only it can put the wait into words; a
  test in `test/schema.test.ts` fails if the two numbers drift.
- **2026-09-24 — Try again is `retry_item`, not a re-save.** Re-saving
  un-archives by design; retrying a failed fetch should change fetch state and
  nothing else.
- **2026-09-24 — Child rows reference `(id, user_id)`.** `item_tags` and
  `highlights` policies pin `user_id` to `auth.uid()`, but a plain foreign key
  only proves the parent exists, and FK checks ignore RLS. Composite keys to
  `items (id, user_id)` and `tags (id, user_id)` (0007) make the row's owner
  own the parent as well.
- **2026-09-24 — `POST /api/extract` is removed.** Nothing called it after the
  queue shipped, it re-fetched without the save limit, and a failed re-fetch
  turned a ready item into a failed one while its stored copy still existed.
  The queue (`lib/queue.ts`) is now the only writer of extraction results. The
  2026-09-10 entry above describes the state before this.
- **2026-09-24 — Fetch on save, in `after()` (Slice 9).** This reverses the
  "not a code change" line in section 10, with Ishank's agreement. A save
  claims only its own job, through a service-role function keyed on item and
  owner, because `claim_fetch_jobs` would take strangers' oldest jobs. Both
  claims use SKIP LOCKED, so the cron, a second tap and the extension's
  offline replay cannot fetch the same URL twice. The callback builds a
  service-role client, because the route's session client cannot write
  `item_content`. The save route and the reader page set `maxDuration = 60`.
  A fetch cut off by the platform stays `running` until the daily run's
  stale-lock reclaim takes it.
- **2026-09-25 — The extension sends the page the reader has open (Slice 10).**
  Fetch-on-save showed how many publishers refuse a server outright. NDTV
  refused even a Chrome User-Agent, and Cloudflare served an empty shell. A
  Chrome User-Agent on the server was rejected: it is dishonest (§5, guard
  12) and would not have worked for Akamai. The reader's browser already has
  the page, so the extension sends it, and extraction stays on the server.
  Offline replays send the link only, because `storage.local` cannot hold
  pages.
- **2026-09-25 — Highlights are painted, not marked up (Slice 11).** The
  article is sanitised HTML rendered on the server. Wrapping highlights in
  `<mark>` would mutate the DOM React owns and move the text nodes the
  offsets are counted over, so the CSS Custom Highlight API paints ranges
  instead. The panel is the universal way in; tapping a painted highlight is
  a shortcut. It is hit-tested against range boxes rather than using
  `highlightsFromPoint`, which neither iPhone Safari nor this Chromium has.
- **2026-09-26 — Trash is a page of its own, and it is not optimistic
  (Slice 12).** Adding a `trash` state to the library would have meant hiding
  every action but restore, a second sort and undo semantics for something
  that cannot be undone, all inside the file Slice 8 must split. Delete
  forever and Empty trash act only on rows that are still deleted, and Empty
  trash stops at the newest deletion the page showed. The alternative, a
  SECURITY DEFINER "empty my trash" function, would add nothing: a session
  may already hard-delete its own rows.
- **2026-09-26 — The library's Undo restores what is left of its batch.**
  It used to refuse the whole batch if any item was gone. Once Delete
  forever existed, that Undo would fail on every click and strand the rest.
- **2026-09-26 — The backlog strip picks in SQL, by a per-item hash
  (Slice 13).** PostgREST cannot order by an expression, and hashing in
  JavaScript would fetch the whole backlog on every `/inbox` load. Ranking
  each candidate on its own hash of the week, rather than shuffling the list
  with one seed and taking the first three, keeps the strip still when
  something else in the backlog changes. The review then found that a
  per-item rank is not enough: with `now()` in the conditions, items joined
  mid-week. 0013 measures from the week's start.
- **2026-09-28 — Listen uses the device's voices and assumes the worst of
  them (Slice 14).** Server-made audio would keep playing on a locked
  iPhone, but it needs a paid TTS key, storage per article, and is a step
  toward the podcasts §1 rules out. So speech stays on the device, and the
  limit is said on the control. Three platform quirks were reported but not
  verified: Chrome cutting long utterances, Android turning pause into
  cancel with no word boundaries, iOS stopping on lock (Android Chrome
  stops in the background too, it turned out). Rather than settle
  them first, the queue is built so none of them matters: short
  utterances, Pause as cancel, a per-sentence tint.
