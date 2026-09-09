# SETUP.md — the parts only you can do

An agent can write every line of code and run every command in this repo. It
cannot click through a signup flow, pass a phone verification, or enter your
card details. This is that list, in the order that unblocks the most work
soonest.

Total: about 40 minutes, once. **It has already been done for this project.**
What follows is still the procedure — for a second machine, a fresh Supabase
project, or a rebuild — and every trap that actually bit us is written down.

**One rule above all: never paste a key or a connection string into a chat
message, a commit, or any file other than `.env.local`.** A connection string
contains the database password. If one ends up somewhere it should not be,
rotate it: Supabase → Settings → Database → **Reset database password**.

---

## Step 1 — Two CLIs (5 min)

`git` and Node are already here. `gh` is not.

```bash
winget install --id GitHub.cli -e
```

Close and reopen your terminal — a newly installed program is invisible to a
shell that was already running. Then:

```bash
gh auth login
```

GitHub.com → HTTPS → Yes → Login with a web browser.

The Supabase CLI does not need installing; `npx supabase@latest` works on
demand. It is optional — everything below can be done in the dashboard.

---

## Step 2 — GitHub repository (3 min)

From inside this folder, once there is a commit to push:

```bash
gh repo create marrow --private --source=. --remote=origin --push
```

Private for now. Make it public when Slice 8 adds a licence.

---

## Step 3 — Supabase project (10 min) — the important one

1. supabase.com, sign in with GitHub.
2. **New project.** Name `marrow`. Region: nearest you — South Asia (Mumbai)
   from India. **Region cannot be changed later** without recreating.
3. It generates a database password. **Save it now**, in a password manager. It
   is shown once and never again.
4. Wait roughly two minutes for provisioning.

> **If you end up with two projects** — made one, deleted it, made another —
> check every value comes from the _same_ one. Nothing catches a mismatch for
> you: the app keys work fine on their own, and only the database connection
> fails, naming a project ref you will not recognise. Compare against the ref
> inside `NEXT_PUBLIC_SUPABASE_URL`.

### Copy the keys

**Project Settings → API:**

| On the page             | Into `.env.local` as            | Secret?                                 |
| ----------------------- | ------------------------------- | --------------------------------------- |
| Project URL             | `NEXT_PUBLIC_SUPABASE_URL`      | No — it ships to every browser          |
| `anon` `public`         | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No — same                               |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY`     | **Yes.** Bypasses every security policy |

Then:

```bash
cp .env.example .env.local
```

Fill it in, and confirm it is ignored. This must print nothing at all:

```bash
git status --porcelain .env.local
```

### Apply the schema

**SQL Editor → New query**, paste the entire contents of `docs/SCHEMA.sql`,
Run. `Success. No rows returned` means it worked.

`docs/SCHEMA.sql` is the **current, complete schema**, including every fix that
a later migration made. On a fresh project that one paste is all you need — you
do not replay `supabase/migrations/` file by file.

The migrations directory is for changing a database that already exists. Each
file applies once, in order, and is **never edited afterwards**. That is why
`0001_init.sql` still contains a bug that `0002` fixes: history stays honest.

> **Known consequence of the SQL Editor route:** the Supabase CLI keeps its own
> record of which migrations ran, in `supabase_migrations.schema_migrations`,
> and pasting into the editor does not update it. The first `supabase db push`
> will therefore try to re-apply `0001` and fail with
> `type "item_status" already exists`. Fix it then with
> `supabase migration repair --status applied 0001` (and `0002`). Do not delete
> the migration files.

### Verify — this is the check that matters

New query:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

**Eight rows, every one `true`.** A table without row-level security is one
where any signed-in user can read everyone else's saved articles. If any row
says false, stop and say so.

### Auth settings — do this before testing sign-in

**Authentication → URL Configuration:**

- **Site URL:** your deployed origin, e.g. `https://marrow-bice.vercel.app`
- **Redirect URLs:** add both
  - `http://localhost:3000/**`
  - `https://<your-vercel-url>/**`

`/**` means "any page on that site". Magic links only redirect to URLs on this
list, and a missing entry fails with a message that points nowhere useful. This
is the first thing to check when sign-in does not work.

### The database connection string — optional, and easy to get wrong

Not needed by the app. Only `supabase db push` uses it, from Slice 5 on.

Click **Connect** at the top of the project. It is _not_ under "Connection
pooling" — that section only holds pool sizes. Choose **Session pooler**.

- **Not** "Direct connection": `db.<ref>.supabase.co` resolves to IPv6 only,
  and most home connections in India are IPv4-only. It will never connect.
- Pooler hostnames carry an index — `aws-0-ap-south-1…`, `aws-1-ap-south-1…` —
  not `aws-ap-south-1…`. A `getaddrinfo ENOTFOUND` here means the hostname is
  wrong, not your network.
- Session mode is port `5432`. If only the transaction pooler is offered, take
  that string and change `6543` to `5432`.
- Passwords containing `@ # ? / :` break the URL. Use letters and digits.

Paste the result into `.env.local` as `SUPABASE_DB_URL`, nowhere else.

**Unblocks:** Slices 0, 1 and everything after.

---

## Step 4 — Vercel (8 min)

1. vercel.com, sign in with GitHub.
2. **Add New → Project**, import the `marrow` repository.
3. Framework preset is detected as Next.js. Change nothing.
4. **Environment Variables**, for Production, Preview and Development:

| Variable                        | Value                                  | Type       |
| ------------------------------- | -------------------------------------- | ---------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project URL                            | **Config** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` key                             | **Config** |
| `SUPABASE_SERVICE_ROLE_KEY`     | `service_role` key                     | **Secret** |
| `NEXT_PUBLIC_SITE_URL`          | your Vercel URL, **no trailing slash** | **Config** |
| `NEXT_PUBLIC_SENTRY_DSN`        | Sentry DSN                             | **Config** |

5. Deploy.

> **Do not mark `NEXT_PUBLIC_` variables as Secret.** They are compiled into the
> JavaScript every visitor downloads, so marking them secret hides nothing from
> anyone — it only stops _you_ reading them back, and then the only way to learn
> what is set is to delete and re-enter it. Only `SUPABASE_SERVICE_ROLE_KEY` and
> `SENTRY_AUTH_TOKEN` are genuinely secret.
>
> **A trailing slash on `NEXT_PUBLIC_SITE_URL` breaks magic links**, and only in
> production.
>
> **`SUPABASE_DB_URL` does not belong here at all.** Nothing in the app reads
> it; it is a local tool's variable. A stale database password sitting in Vercel
> is risk with no benefit.
>
> **Changing a variable does nothing until you redeploy.** Deployments → the top
> one → `…` → **Redeploy**. Pushing a commit also rebuilds with current values.

The first deploy succeeds even with none of these set: the build needs no
credentials by design. Set them anyway — Slice 1 needs them.

---

## Step 5 — Sentry (5 min)

1. sentry.io, sign in with GitHub. New project, platform **Next.js**.
2. Copy the DSN into **both** `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN`. A DSN
   is not a secret — it names a project and only permits writing events to it.
3. Optional, and only for readable stack traces: `SENTRY_ORG` and
   `SENTRY_PROJECT` are the slugs in the dashboard URL;
   `SENTRY_AUTH_TOKEN` comes from Settings → Auth Tokens (scope
   `project:releases`). Put the token in **Vercel only**, never in
   `.env.local` — it is used at build time, and a token in a local file is a
   token waiting to be committed.

Without those three you still get errors; you get them with minified line
numbers.

### Confirm it actually captures

Deploy, then open `/api/debug-sentry` on the live site. It returns 500 by
design, and the error should reach Sentry within seconds.

> If the route 500s but Sentry stays empty, the SDK is not wired and the DSN is
> not the problem. `next.config.ts` must apply `withSentryConfig`
> **unconditionally** — that is what puts the SDK in the bundle. Gating it on
> `SENTRY_ORG`/`SENTRY_PROJECT`, which only control source-map upload, disables
> error reporting entirely while every other signal looks healthy. The quick
> test after `npm run build`:
>
> ```bash
> grep -rl sentry .next/static/chunks/*.js
> ```
>
> On the deployed site those files live under
> `/_next/static/immutable/chunks/`, not `/_next/static/chunks/` — grepping the
> local path against production finds nothing and looks exactly like failure.

That route exists only for this check and is deleted in Slice 8.

---

## Step 6 — Domain (10 min, and the only one that costs money)

Optional until launch. Do it last.

1. Cloudflare → **Registrar → Register domain**. Sold at wholesale, roughly
   ₹1,000 a year for a `.com`.
2. Vercel → **Project → Settings → Domains → Add**.
3. Add the DNS record Vercel gives you, in Cloudflare, set to **DNS only**
   (grey cloud) — not proxied. Vercel terminates TLS itself, and proxying
   causes a redirect loop that is unpleasant to debug.
4. Wait for the certificate. Usually minutes.
5. Update `NEXT_PUBLIC_SITE_URL` in Vercel **and** the Site URL and redirect
   URLs in Supabase Auth. **Magic links break if you forget this**, in
   production only.

---

## What is blocked by what

| Do this first      | Or else                                                 |
| ------------------ | ------------------------------------------------------- |
| Step 1 (`gh`)      | Nothing can be pushed.                                  |
| Step 3 (Supabase)  | Slice 1 cannot start at all. This is the critical path. |
| Step 3 (Auth URLs) | Sign-in fails with an unhelpful error.                  |
| Step 4 (Vercel)    | You can still build and run every slice locally.        |
| Step 5 (Sentry)    | Errors go unreported. Everything else works.            |
| Step 6 (domain)    | Nothing. Cosmetic until launch.                         |

If you only have twenty minutes: **Steps 1 and 3.** Those two unblock the next
three slices of real work.

---

## A note on reading these files

Open `.md` files in **Notepad or VS Code, not Word**. Word takes an exclusive
lock — which blocks any agent trying to edit the file — and leaves `~$`-prefixed
junk beside it. Saving from Word can mangle the formatting outright.
