<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# House rules

Read by Claude Code (via `CLAUDE.md`) and by Codex automatically. You do not
need to paste these into a session — they are already loaded. If you find
yourself pasting them, something is misconfigured.

1. **Read `docs/ARCHITECTURE.md`, `docs/SCHEMA.sql` and `docs/ROADMAP.md`
   before writing anything.** They are the source of truth. Read the whole
   ROADMAP entry for your slice, including the **Gotcha** at the bottom — that
   is the part that gets built wrong the first time.

2. **Work only on the slice you are given.** Do not implement future slices. Do
   not refactor earlier ones. If you see a real bug in earlier work, say so and
   stop — do not silently fix it, because a fix that arrives inside an unrelated
   diff is a fix nobody reviews.

3. **Do not read the whole repository to orient yourself.** Every slice in
   `ROADMAP.md` names its files. Start there and follow imports outward.

4. **Ask before adding any dependency not already in `package.json`.** Each
   slice lists its pre-approved additions; anything beyond that list needs a
   yes.

5. **No placeholder data, no mock values, no stubs, unless explicitly asked.**
   If something needs a key or a decision you do not have, stop and ask. A
   stubbed value that looks like it works is the single most expensive thing an
   agent can produce here, because it is discovered four slices later.

6. **Run `npm run typecheck`, `npm run lint` and `npm test` before saying you
   are done.** Fix what they report. "It should work" is not a result.

7. **No `any`. No `@ts-ignore`. No commented-out code. No `TODO` left
   behind.** If something needs doing later, it goes in `ROADMAP.md` where it
   is tracked, not in a comment where it is not.

8. **Never write a secret into a committed file.** Not in tests, not in
   fixtures, not in a comment, not in `.env.example`. Add the variable name to
   `.env.example` with an empty value and document it in ARCHITECTURE §8.

9. **Small commits with real messages**, one per logical unit of work. A
   message says what changed and why, not "update files".

10. **Finish the slice properly.** Tick the boxes in `docs/ROADMAP.md` that are
    genuinely done, leave the rest unticked with a one-line note on what is
    left, append anything surprising to **Notes from the field**, update
    `ARCHITECTURE.md` if the code deviated from it, commit, and then tell the
    human exactly what to verify by hand.

## Writing style for code comments

Comment the _why_, never the _what_. `// increment i` is noise. `// Count bytes
as they arrive; Content-Length is supplied by the party we are defending
against` is the reason someone will not "simplify" the guard away in six months.
