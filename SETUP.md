# SETUP.md — the parts only you can do

An agent can write every line of code and run every command in this repo. It
cannot click through a signup flow, pass a phone verification, or enter your
card details. This is that list, in the order that unblocks the most work
soonest.

Total: about 40 minutes, once.

**One rule above all: never paste a key into a chat message, a commit, or a
file other than `.env.local`.** Keys go in `.env.local` and in the Vercel
dashboard. Nowhere else. If a key is ever pasted somewhere public, rotate it
immediately — in Supabase that is Project Settings, API, and there is a rotate
button.

---

## Step 1 — Two CLIs (5 min)

`git` and Node are already here. `gh` is not.

```bash
winget install --id GitHub.cli -e
```

Close and reopen your terminal, then:

```bash
gh auth login
```

Choose GitHub.com, HTTPS, and authenticate in the browser.

The Supabase CLI does not need installing — `npx supabase@latest` works on
demand, and is only needed from Slice 5 onward when there are more migrations.

**Unblocks:** pushing to GitHub, which is the last unticked item in Slice 0
that does not need an account.

---

## Step 2 — GitHub repository (3 min)

From inside this folder, once there is a commit to push:

```bash
gh repo create marrow --private --source=. --remote=origin --push
```

Private for now. Make it public when Slice 8 adds a licence.

If you would rather click: github.com/new, name it `marrow`, **do not** add a
README, .gitignore or licence (this folder already has them), then follow the
"push an existing repository" lines it shows you.

---

## Step 3 — Supabase project (10 min) — the important one

1. supabase.com, sign in with GitHub.
2. **New project.** Name `marrow`. Region: pick the one nearest you —
   `ap-south-1` (Mumbai) if you are in India. Region cannot be changed later
   without recreating the project.
3. It generates a database password. **Save it in your password manager now.**
   It is shown once, and Step 5 needs it.
4. Wait for provisioning, roughly two minutes.

### Copy the keys

**Project Settings → API.** Three values:

| On the page             | Into `.env.local` as            |
| ----------------------- | ------------------------------- |
| Project URL             | `NEXT_PUBLIC_SUPABASE_URL`      |
| `anon` `public`         | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY`     |

The `service_role` key bypasses every security policy in the database and can
read every user's data. It is a password, not an identifier. It never goes near
anything with `NEXT_PUBLIC_` in the name.

**Project Settings → Database → Connection string → URI.** Replace
`[YOUR-PASSWORD]` with the password from step 3, and put the result in
`SUPABASE_DB_URL`.

### Create `.env.local`

```bash
cp .env.example .env.local
```

Then fill in the four values above. Leave everything else empty for now — the
app is built so that absent optional keys disable a feature rather than
crashing.

Confirm it is ignored. This must print nothing at all:

```bash
git status --porcelain .env.local
```

### Apply the schema

Easiest path, no install: **SQL Editor → New query**, paste the entire contents
of `docs/SCHEMA.sql`, and Run.

Then verify, in a new query. This is the check that matters:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Eight rows, and **every one must say `true`**. A table without row-level
security is one where any signed-in user can read everyone else's data. If any
row says false, stop and say so before going further.

Paste that output into `docs/ROADMAP.md` under "Notes from the field" — the
Slice 0 checklist asks for it.

### Auth settings, for Slice 1

**Authentication → URL Configuration:**

- Site URL: `http://localhost:3000` for now; change it to your domain after
  Step 6.
- Redirect URLs: add `http://localhost:3000/**` and, once deployed, your
  production URL with `/**`.

Magic links will fail with an unhelpful error if this is wrong, and it is the
first thing to check when Slice 1 sign-in does not work.

**Unblocks:** Slices 0, 1 and everything after.

---

## Step 4 — Vercel (8 min)

1. vercel.com, sign in with GitHub.
2. **Add New → Project**, import the `marrow` repository.
3. Framework preset is detected as Next.js. Do not change the build settings.
4. **Environment Variables** — paste in, for Production, Preview and
   Development:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` — your Vercel URL for now, no trailing slash
5. Deploy.

The first deploy will succeed even with none of those set — the build needs no
credentials by design. Set them anyway; Slice 1 needs them.

**Unblocks:** the last two boxes in Slice 0.

---

## Step 5 — Sentry (5 min)

1. sentry.io, sign in with GitHub. Create a project, platform **Next.js**.
2. It shows you a DSN. Put the same value in **both**
   `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN`. A DSN is not a secret — it
   identifies a project and only permits writing events to it.
3. Note the org and project slugs from the URL
   (`sentry.io/organizations/<org>/projects/<project>/`) into `SENTRY_ORG` and
   `SENTRY_PROJECT`.
4. **Settings → Auth Tokens → Create**, scope `project:releases`. Put it in
   Vercel as `SENTRY_AUTH_TOKEN`. Do **not** put it in `.env.local` — it is
   only used at build time, and a token sitting in a local file is a token
   waiting to be committed.

Then confirm capture works: deploy, visit `/api/debug-sentry`, and check the
error appears in Sentry within a few seconds. That route exists only for this
check and is deleted in Slice 8.

**Unblocks:** the Sentry box in Slice 0. Skipping this is survivable — errors
just go unreported.

---

## Step 6 — Domain (10 min, and the only one that costs money)

Optional until launch. Do it last.

1. Cloudflare, **Registrar → Register domain**. Cloudflare sells at wholesale
   with no first-year discount and no renewal markup — expect roughly ₹1,000 a
   year for a `.com`.
2. In Vercel: **Project → Settings → Domains → Add**, enter the domain.
3. Vercel gives you a DNS record. Add it in Cloudflare exactly as shown. Set
   the record to **DNS only** (grey cloud), not proxied — Vercel terminates TLS
   itself and proxying it causes a redirect loop that is genuinely unpleasant
   to debug.
4. Wait for the certificate. Usually minutes.
5. Update `NEXT_PUBLIC_SITE_URL` in Vercel, and the Site URL and redirect URLs
   in Supabase Auth, to the new domain. **Magic links break if you forget
   this**, and they break only in production.

---

## What is blocked by what

| Do this first     | Or else                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Step 1 (`gh`)     | Nothing can be pushed.                                             |
| Step 3 (Supabase) | Slice 1 cannot start at all. This is the critical path.            |
| Step 4 (Vercel)   | Slice 0 stays unfinished; you can still build every slice locally. |
| Step 5 (Sentry)   | Errors go unreported. Everything else works.                       |
| Step 6 (domain)   | Nothing. Purely cosmetic until launch.                             |

If you only have twenty minutes: **Steps 1 and 3.** Those two unblock the next
three slices of real work.
