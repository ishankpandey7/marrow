# Marrow

Save anything. Read it clean, later.

A read-it-later app: you give it a URL, it fetches the page on the server,
strips it back to the article, and keeps a clean copy you own.

Status: **Slice 0.** Skeleton and schema are in place; the landing page is all
there is to look at. `docs/ROADMAP.md` says what happens next.

## Documentation

| File                                           | What it is                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Source of truth. Read it before writing code. §5 is the security-critical part. |
| [`docs/SCHEMA.sql`](docs/SCHEMA.sql)           | The database, commented. Applied as `supabase/migrations/0001_init.sql`.        |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)           | Nine slices, each with a checklist and the gotcha that slice gets wrong.        |
| [`SETUP.md`](SETUP.md)                         | The accounts and keys you have to create by hand, in order.                     |
| [`AGENT-PROMPTS.md`](AGENT-PROMPTS.md)         | Ready-to-paste prompt for every slice, and which agent runs it.                 |
| [`AGENTS.md`](AGENTS.md)                       | House rules. Loaded automatically by both agents.                               |

## Running it locally

Requires Node 24 and npm 11.

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values — see SETUP.md
npm run dev
```

`npm run build` and the whole test suite work with **no credentials at all**.
That is deliberate: CI builds without secrets, and so can a contributor or an
agent in a sandbox. Only `npm run dev` against real data needs `.env.local`.

## Scripts

| Command             | What it does                                                 |
| ------------------- | ------------------------------------------------------------ |
| `npm run dev`       | Development server on http://localhost:3000                  |
| `npm run build`     | Production build. Type-checks as part of the build.          |
| `npm run typecheck` | `tsc --noEmit`                                               |
| `npm run lint`      | ESLint. Next 16 removed `next lint`; this is plain `eslint`. |
| `npm test`          | Vitest, once. `npm run test:watch` to watch.                 |
| `npm run format`    | Prettier over the tree. `format:check` in CI.                |

## What the tests check right now

There is no application logic to test yet, so the suite guards the two things
that are already easy to get wrong and expensive to discover late:

- **`test/schema.test.ts`** — every table in `docs/SCHEMA.sql` has Row Level
  Security enabled and at least one policy, every `security definer` function
  pins its `search_path`, and the schema has not drifted from the applied
  migration. This enforces the central security property of the database
  without needing a database.
- **`test/env-example.test.ts`** — every environment variable the code reads is
  documented in `.env.example`, and `.env.example` never contains a value.

## Licence

Not yet chosen. Decide before the repository goes public.
