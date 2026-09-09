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
- Full-text search across title, excerpt and body.
- Export everything you have as JSON. No lock-in.

**Explicitly not in scope, v1:**

- Teams, sharing, public profiles, social anything.
- Recommendations or an algorithmic feed.
- PDFs, video, podcasts. URLs that resolve to HTML articles only.
- Mobile apps. The web app is a PWA and that is the whole mobile story.
- Client-side extraction. Extraction is a server concern; see §5.
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

---

## 3. Repository layout

```
app/
  (marketing)/            Public pages. No auth, statically rendered.
    page.tsx              Landing.
  (app)/                  Authenticated shell. Layout enforces a session.
    inbox/                The list. The main screen.
    read/[id]/            Reading view.
    settings/
  api/
    save/route.ts         POST a URL. Creates the item, enqueues extraction.
    extract/route.ts      Runs the pipeline for one item. Node runtime.
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
- **Images are proxied** through `/api/img`, which re-uses the §5 guards. Direct
  hotlinking leaks our readers' IP addresses to every publisher they read and
  breaks under HTTPS when the source is HTTP.

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
| `EXTENSION_TOKEN_SECRET`        | **NO** | Slice 6     | `openssl rand -hex 32`. Signs the extension's save token.                                                                                     |
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
  It is used for exactly two things: applying migrations, and cron jobs that
  legitimately act across users.
- **Stored XSS is the realistic threat.** We render attacker-controlled HTML
  into our own origin. §6 step 5 is the defence. A CSP without `unsafe-inline`
  for scripts is the second layer; sanitisation is not allowed to be the only
  one.
- **Rate limits** on `POST /api/save`, counted in Postgres against the user id.
  Without one, a single account can point our servers at an arbitrary number of
  hosts — we become someone's scanner, and our IP range takes the blame.
- **Zero secrets in committed files.** Not in tests, not in fixtures, not in
  comments, not in a `.env.example` that "just has the dev one".

---

## 10. Background work

Extraction happens out of band. `POST /api/save` writes a `pending` item and
returns immediately; the user sees the row appear at once. Nobody waits ten
seconds for a page fetch to finish.

- `fetch_jobs` is the queue. A row per attempt-cycle, with `state`, `attempts`,
  `run_after` and `last_error`.
- Retries: 3 attempts, exponential backoff (1 min, 5 min, 25 min), and only for
  transient reasons — `unreachable` and `server_error`. Retrying a 404 is
  someone else's server paying for our optimism.
- Vercel Cron drives `/api/cron/extract` every minute; each run claims a small
  batch with `for update skip locked` so overlapping invocations cannot process
  the same job twice.
- `/api/cron/purge` runs daily and hard-deletes items soft-deleted over 30 days
  ago.
- Every cron route requires `Authorization: Bearer ${CRON_SECRET}`.

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
