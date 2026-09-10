# AGENT-PROMPTS.md

Every prompt you need, filled in, in the order you use them. Copy the block,
paste it, that is the whole session opener.

---

## How a session works

Three messages. That is the entire rhythm.

1. **Open** — paste the slice prompt from Part 3. **Nothing else**, and that
   is not shorthand: `AGENTS.md` loads the house rules by itself, and
   "Where things stand" at the top of `docs/ROADMAP.md` says where the last
   session left off. A fresh session in this folder starts oriented.
2. **Work** — answer the agent's questions. Push back when something looks
   wrong. This is most of the session.
3. **Close** — paste the wrap-up prompt from Part 4 before you run out of
   budget or attention. Not after.

### You do not paste house rules

`AGENTS.md` holds them, `CLAUDE.md` includes it, and both Claude Code and
Codex read those automatically on startup. If you catch yourself pasting rules
about `any` or commit messages, something is misconfigured — check that
`AGENTS.md` is present in the repo root.

### One slice, one session

Do not run two slices in one session and do not split one slice across two if
you can avoid it. The slices are drawn so that each one fits in a session and
ends with something that works. A session that ends mid-slice is the one where
things get lost, which is exactly what the wrap-up prompt exists to limit.

### Never start a slice by asking the agent to read the repo

Every ROADMAP entry names its files. "Read the codebase and get familiar" costs
you a large fraction of a context window and buys nothing that the docs do not
already say better.

---

## Part 1 — The schedule

Strictly in order. Each slice assumes the one before it is built and deployed.

| Slice | What                               | Agent           | Cannot start until                 |
| ----- | ---------------------------------- | --------------- | ---------------------------------- |
| 0     | Skeleton, deployed                 | **Claude Code** | — (mostly done; see below)         |
| 1     | Auth, save a URL, list view        | **Claude Code** | SETUP.md steps 1–3                 |
| 2     | Extraction pipeline                | **Claude Code** | Slice 1                            |
| 3     | Reading view                       | **Codex**       | Slice 2                            |
| 4     | Tags, archive, favourites, filters | **Codex**       | Slice 1 (3 is nicer first)         |
| 5     | Search                             | **Claude Code** | Slice 2, plus ~50 real saved items |
| 6     | Browser extension                  | **Codex**       | Slice 1                            |
| 7     | Background jobs, retries, limits   | **Claude Code** | Slice 2 + Vercel                   |
| 8     | Hardening and launch               | Either          | Everything                         |

### Why that split

**Claude Code** runs against your real checkout with your real `.env.local`. It
can apply a migration, hit your actual Supabase, run the dev server, and check
that a live URL extracts properly. Give it the slices where the verification
step is "run this and show me what happened" — 0, 1, 2, 5, 7.

**Codex** is better pointed at self-contained work with a crisp test command:
UI over fixtures, pure functions, the extension. Slices 3, 4 and 6 were drawn
so they need no credentials — that is not a coincidence, it is why
`lib/canonical.ts`, `lib/extract.ts` and `lib/sanitize.ts` are required to stay
pure.

The split is a default, not a rule. If Codex is the one with budget left, give
it slice 5 and tell it to write the query and hand you the `explain analyze` to
run yourself.

---

## Part 2 — Sharing one folder between two agents

You have one working tree, not two clones. So the constraint is simple and
absolute:

**Never run both agents at the same time.** They will overwrite each other's
edits with no conflict and no warning, because neither one is going through
git.

Before switching from one agent to the other, in the terminal:

```bash
git status --short
```

Empty output, or the only entry is the `AGENTS.md` block that `next dev`
re-adds. Anything else means the previous session did not finish its wrap-up —
either commit it or throw it away before starting the next agent. Handing a
dirty tree to a fresh agent is how you get a change nobody can explain three
slices later.

Then start the new session with the slice prompt. It reads the docs; it does
not need a summary of what the other agent did, because the wrap-up prompt
already wrote that down.

If you would rather they work in parallel, use `git worktree` to give each a
separate directory on its own branch — but one at a time is genuinely simpler
and this project is not big enough to need the parallelism.

---

## Part 3 — The prompts

### Slice 0 — finishing it

Most of Slice 0 is built: scaffold, docs, schema, the three Supabase clients,
Sentry wiring, CI, tests, landing page. What is left all needs credentials, so
do **SETUP.md steps 1–5 first**, then paste this.

**Agent: Claude Code**

```
SLICE 0 — finish the credentialed tail.

I have now done SETUP.md steps 1 through 5. .env.local has real Supabase
values, Vercel and Sentry projects exist, and gh is authenticated.

Work only on the unticked boxes under Slice 0 in docs/ROADMAP.md:

1. Apply supabase/migrations/0001_init.sql to my Supabase project. Then run the
   pg_tables RLS query from ARCHITECTURE §4 against the real database and show
   me the raw output. Every row must be true. If any is false, stop and tell me
   rather than fixing it silently.
2. Verify the server-only guard is real: temporarily add a client component
   that imports lib/db/service.ts, confirm the build fails, then remove it.
   Show me the error.
3. Confirm Sentry actually captures. Tell me the URL to hit and what I should
   see in the dashboard.
4. Commit and push to main.

Then stop and tell me exactly what to check in the Vercel and Supabase
dashboards, and what the first deploy should look like.
```

---

### Slice 1 — auth, save a URL, list view

**Agent: Claude Code**

```
SLICE 1 — auth, save a URL, list view.

Slice 0 is built and deployed. Read the Slice 1 entry in docs/ROADMAP.md,
including the gotcha at the bottom. The re-save conflict case is not optional —
handle it and test all four of its behaviours.

Work in: app/auth/, app/(app)/layout.tsx, app/(app)/inbox/page.tsx,
app/api/save/route.ts, lib/canonical.ts, proxy.ts, components/.

Build exactly the checklist items under Slice 1. Design notes the docs do not
capture:

- Magic link only. No password, no OAuth, no "sign in with Google".
- The list is the product's main screen. Design it at 375px first and let the
  desktop layout be the adaptation.
- The empty state should tell me what to do and give me the thing to do it
  with. Not the words "No items".
- A pending item should look like it is working, not like it is broken.

lib/canonical.ts stays pure — no network, no env, no database — and its tests
come before its implementation.

When done: the URL to test, and the three things most likely to be broken.
```

---

### Slice 2 — extraction pipeline

The riskiest slice in the project. The security framing goes first, on purpose.

**Agent: Claude Code**

```
SLICE 2 — extraction pipeline.

Build lib/fetcher.ts FIRST, before anything else, and write its tests before
its implementation.

Read ARCHITECTURE.md §5 in full. SSRF is the specific threat and every guard
listed there is required — all thirteen, not the ones that seem most likely. A
user-supplied URL goes into a server-side fetch from inside Vercel's network,
so this file is the security boundary for the whole product.

Tests must cover, at minimum: private IPv4 ranges; IPv6 loopback and ULA; an
IPv4-mapped IPv6 address; a redirect from a public host to 127.0.0.1; a
redirect chain longer than 3; a response exceeding 5 MB; a host that times out;
a non-HTML content type; a URL with embedded credentials. No test may touch the
network — inject DNS and the agent.

Only once those pass, build the rest of the Slice 2 checklist: lib/extract.ts,
lib/sanitize.ts, app/api/extract/route.ts.

Pre-approved dependencies: @mozilla/readability, linkedom, sanitize-html,
@types/sanitize-html. Ask before anything else.

Before you say you are done, run the pipeline against these four real URLs and
show me what happened for each — which fail_reason, what got stored, what the
user would see:

  - a normal news article
  - a hard paywall
  - a JavaScript-only SPA
  - a URL that 404s

All four must fail gracefully or succeed cleanly. No crash, no hang, and no
internal detail leaking into the user-facing message.
```

---

### Slice 3 — reading view

**Agent: Codex**

```
SLICE 3 — the reading view.

Slices 0–2 are built. Read the Slice 3 entry in docs/ROADMAP.md including the
gotcha.

Work in: app/(app)/read/[id]/page.tsx, components/reader/, lib/reading.ts,
app/globals.css.

Build exactly the Slice 3 checklist. This slice is judged on how it feels to
read, so the taste notes matter more than usual:

- Typography is the feature. Measure of 60–75 characters, generous line height,
  real vertical rhythm. If a 3,000-word article is not pleasant to read on a
  phone, the slice is not done.
- Chrome recedes. Controls are reachable but not present while reading.
- Three themes — light, dark, sepia. Follow prefers-color-scheme until the
  reader chooses; an explicit choice then wins and persists.
- Every fail_reason from ARCHITECTURE §6 gets its own designed state with that
  copy and a sensible action. These are not error pages, they are part of the
  product.

You do not have my Supabase credentials and do not need them. Build against
fixtures. npm run build, npm run typecheck, npm run lint and npm test must all
pass — that is your verification, not a screenshot of my database.

When done, tell me which fixtures you used and which route to open.
```

---

### Slice 4 — tags, archive, favourites, filters

**Agent: Codex**

```
SLICE 4 — organise: tags, archive, favourites, filters.

Read the Slice 4 entry in docs/ROADMAP.md including the gotcha about optimistic
UI that never reconciles.

Work in: app/(app)/inbox/page.tsx, app/(app)/actions.ts,
components/tag-input.tsx, components/filter-bar.tsx, lib/tags.ts.

Build exactly the Slice 4 checklist. Notes:

- This slice is about speed of triage. Someone with 200 unread items should be
  able to clear them in two minutes with the keyboard.
- Every mutation is optimistic AND reconciles. A rejected write must roll the
  UI back and say so.
- Filters live in the URL. A filtered view must survive a refresh and be
  shareable to yourself.
- lib/tags.ts slug normalisation is pure and tested. Two tags differing only in
  case or spacing are one tag.

Run explain analyze on the list queries and confirm they use the partial
indexes already defined in docs/SCHEMA.sql. A sequential scan on items is a
bug — tell me if you find one rather than adding an index yourself, because the
index belongs in a migration.

Verification is npm test plus typecheck, lint and build.
```

---

### Slice 5 — search

**Agent: either.** The pure half — the query parser and its tests — needs no
credentials. The ranking half needs the live database, and whoever cannot reach
it must say so rather than tune against fixtures.

```
SLICE 5 — search.

Read the Slice 5 entry in docs/ROADMAP.md including the gotcha about
to_tsquery, and read "Where things stand" at the top first.

Work in: app/(app)/search/page.tsx, lib/search.ts, lib/search.test.ts,
components/search-input.tsx, supabase/migrations/0004_search.sql.

Notes:

- The migration is 0004. The ROADMAP used to say 0002; that was written before
  0002 and 0003 existed. Two migrations sharing a number fails
  test/schema.test.ts. Check `ls supabase/migrations/` before you name a file.

- Do not create the search columns. They already ship in 0001_init.sql, and
  they are two, in two tables:
    items.search_tsv        weighted setweight A=title, B=excerpt, C=author,
                            D=site_name, with GIN index items_search_idx
    item_content.search_tsv the article body, unweighted, with GIN index
                            item_content_search_idx
  So "a title match outranks a body match" is partly given to you and partly
  the real design problem: the two live in different tables and have to be
  combined into one ordering without losing either index. Solve that
  deliberately and write down why you chose what you chose. Add 0004 only if
  something is genuinely missing — and if it is, say what and why.

- websearch_to_tsquery, never to_tsquery. Never interpolate user input into a
  tsquery string. A person will type an unbalanced quote and to_tsquery throws.

- The query parser is pure and tested offline: quoted phrases, -exclusion,
  tag:foo. That half needs no database, so there is no excuse for it being
  thin.

- Search composes with the Slice 4 filters in the URL rather than replacing
  them. Read components/filter-bar.tsx before you design the interaction; do
  not refactor it, it is already 872 lines and Slice 8 owns splitting it.

- Ranking must be shown against real saved articles, not fixtures. There are 9
  extracted articles in the database right now, 16,693 words, 425 to 9,442
  words each, and two of them are about quantum physics — which is exactly the
  pair that tells you whether your ordering is doing anything. Use them.

- The checklist asks for `explain analyze` over 1,000+ items. That cannot be
  honestly closed at 9 articles. Run the plan against what exists, paste it
  into Notes from the field with the row count written next to it, and leave
  the box unticked. Do NOT seed a thousand generated rows to tick it.

- If you cannot reach the database at all: build and test the pure half, leave
  every live box unticked, and tell me exactly which commands you need me to
  run. Do not invent a query plan, do not fabricate ranking results, and do not
  tick a box you did not see pass. House rule 5.

Two things about the current state, so you do not chase them:

- Extraction runs on a DAILY cron, because Vercel Hobby refuses anything more
  frequent. If you save links and they sit on "Fetching the article", that is
  expected — force a run with `npx vercel crons run /api/cron/extract` from the
  project folder, then reload the page. The list does not refresh itself; that
  is a known gap with a box under Slice 8.

- Server-side Sentry does not work on the deployed app. That is a Slice 0
  fault, already diagnosed and written up as the first box under Slice 8. It is
  not yours. Do not fix it inside this slice.

Before you say you are done: run npm run typecheck, npm run lint and npm test
and fix what they report. Then update "Where things stand" at the top of
docs/ROADMAP.md for the end of Slice 5, tick only the boxes you actually saw
pass, append anything surprising to Notes from the field, commit, and push.
Both the handoff and the push get forgotten.
```

### Slice 6 — browser extension

**Agent: Codex**

```
SLICE 6 — browser extension.

Read the Slice 6 entry in docs/ROADMAP.md including the gotcha about
permissions.

Work in: extension/ (its own package.json and build), app/api/save/route.ts
for CORS and token auth, and app/(app)/settings/extension/page.tsx for token
generation.

Build exactly the Slice 6 checklist. Notes:

- Manifest V3, one source tree, working in both Chrome and Firefox.
- Request the minimum permissions. activeTab plus my own API origin. Not
  <all_urls> — that gets an extension rejected from review and is not needed.
- The token is save-only. It must not be able to read my list, delete anything,
  or change settings. If the API cannot express that yet, tell me what needs
  adding rather than widening the token.
- One click saves the current tab and shows success or failure without me
  opening the popup.
- Saving an already-saved page reports "already saved" and changes nothing.
  This exercises the Slice 1 gotcha through a second entry point — test it.

You do not need my credentials. Unit-test the background logic, and tell me
exactly how to load the unpacked extension and what to click to verify.
```

---

### Slice 7 — background jobs, retries, limits

**Agent: Claude Code**

```
SLICE 7 — background jobs, retries, rate limits.

Read the Slice 7 entry in docs/ROADMAP.md including the gotcha about
for update skip locked.

Work in: app/api/cron/extract/route.ts, app/api/cron/purge/route.ts,
lib/queue.ts, lib/rate-limit.ts, vercel.json.

Build exactly the Slice 7 checklist. Notes:

- The claim query must be safe under overlapping invocations. On a one-minute
  schedule with a ten-second fetch, they will overlap.
- Retry only unreachable and server_error. A 404 is never retried.
- lib/rate-limit.ts is tested with an injected clock. No setTimeout in tests.

Verify against the real deployment, not just locally:

1. Save a URL and show me the job row moving queued to running to done.
2. Call a cron route from outside with curl and no Authorization header. Show
   me the 401.
3. Trip the rate limit deliberately and show me the response and the
   Retry-After header.
4. Confirm both jobs appear in the Vercel cron dashboard as having run.
```

---

### Slice 8 — hardening and launch

**Agent: either**

```
SLICE 8 — hardening and launch.

Read the Slice 8 entry in docs/ROADMAP.md including the gotcha about CSP.

This is the slice where things get deleted and tightened, not added. Do not
build new features. If you find something missing, write it in Notes from the
field and leave it.

Start with these two, in this order:

1. Delete app/api/debug-sentry/. It has been there since Slice 0 for exactly
   this moment.
2. Add the Content-Security-Policy with a nonce, no unsafe-inline for scripts.
   Budget real time for it — it will break something that has been quietly
   relying on an inline script, and next dev and next start do not behave the
   same way here. Verify on the deployed site with the console open.

Then the rest of the Slice 8 checklist.

Two things I want proof of rather than a claim:

- Delete a test account, then query every table for that user_id and show me
  the empty results.
- Lighthouse on mobile for the list and the reader. Show me the numbers.
```

---

## Part 4 — Ending a session

Paste this before your budget runs out, not after. It is the single
highest-value prompt in this file: it is what makes the next session start at
full speed instead of spending its first twenty minutes re-deriving where
things stand.

```
We are wrapping up. Do these five things and nothing else — no new code, no
refactors, no "one small fix while I am here".

1. Tick the boxes in docs/ROADMAP.md that we actually completed and verified.
   Leave partially-done items unticked with a one-line note on what is left.
   Do not tick anything you did not check.
2. Append anything surprising to "Notes from the field": parser quirks, a
   Supabase limit we hit, a deploy trap, a library that did not behave as
   documented. Be specific and date it. Future-me has no memory of this
   session.
3. If we deviated from docs/ARCHITECTURE.md, update the doc to match reality
   and add a line to the decisions log in §13.
4. Run typecheck, lint and test one last time. Commit everything and push.
5. Give me a five-line handoff: what is done, what is half-done, what to start
   with next time, anything I need to do by hand, and anything you are unsure
   about.
```

That handoff goes into **"Where things stand" at the top of `docs/ROADMAP.md`**,
not into a note you have to remember to carry. House rule 1 makes every agent
read that file before writing anything, so the next session picks it up on its
own.

Which means the next session needs **nothing from you but the slice prompt**.
No summary of what was built, no list of what works, no re-explaining the
architecture. If you find yourself typing any of that, the handoff was not
written properly — fix the file rather than the message.

---

## Part 5 — When it goes wrong

**The agent stubbed something with fake data.** It was missing a key or a
decision and guessed instead of asking. Say: "Remove the placeholder in `<file>`
and stop. Tell me exactly what you need from me." Then give it the real thing.
The cost of this compounds — a stub found now is minutes, a stub found in Slice
6 is hours.

**It refactored earlier slices.** Revert it: `git checkout -- <paths>`. House
rule 2 exists because a refactor buried in a feature diff is a refactor nobody
reviews. Ask for it as its own commit if it was actually a good idea.

**It says it is done but did not run the checks.** Say: "Run typecheck, lint
and test, paste the output." Do not take "should pass" for an answer, on any
slice, ever.

**Two agents touched the same file and something is gone.**
`git diff` and `git checkout -- <file>` if it is uncommitted. This is what Part
2 is for. Commit before switching agents, every time.

**A slice is turning out much bigger than one session.** Stop where you are,
run the wrap-up prompt, and start a fresh session. Do not push through on a
context window that is nearly full — that is where agents start forgetting the
constraints they were given at the top.
