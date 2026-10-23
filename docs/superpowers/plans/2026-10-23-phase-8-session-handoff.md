# Phase 8 session handoff — 2026-10-23

Written for whoever picks this up, including a session with none of the
conversation that produced it. Everything needed to continue is here or in a
file named here.

> **Read first:** `2026-10-22-phase-8-README.md` for the plan index and the
> scope rulings (`K43`, `K44`), and the three Phase 7 handoffs for the traps
> this project has already paid for. This document records only what the
> 2026-10-23 session did, found, and left.

## What is merged

| PR | Slice | Note |
| --- | --- | --- |
| #221 | 8a — the ledger | the floor; carried `0009` |
| #230 | 8d-1 — the perimeter, webhooks | |
| #233 | **8e — the sweep** | retention, candidate export/erasure, rate-limit expiry, free-tier meter. No migration. |
| #236 | docs: the test-cascade correction | see "The cascade" below |
| #237 | **8d-2 — scoped API keys** | no migration; `api_key` has existed since `0000` |
| #235 | **8b — the verdict** | grading queue, reviewer verdicts, regrade. No migration. Produces `latestVerdicts()`. |

`main` is at `f23c62f`. Live health answers `{"status":"ok","dialect":"d1","migrations":10}`, matching the 10 `.sql` files on disk.

## What is NOT done

**8c — the numbers has not been started.** Five tasks: test analytics, item
analysis, the four exports, the snapshot manifest, `D7c`'s readiness
aggregate. It is the whole remaining body of Phase 8 and it depends on 8b's
`latestVerdicts()`, which is now on `main`, so it is unblocked. Plan:
`2026-10-22-phase-8c-the-numbers.md`.

**Phase 8 is therefore not complete.** Merging everything currently open does
not finish it; 8c has to be built.

**8f and 8g stay deferred** (`K43`, `K44`, milestone 14, issue #223).

## 7e — the consequences (Phase 7, not 8, but in the same queue)

Branch `phase-7e/the-consequences`, pushed, **not merged**. It is the only
branch carrying migrations: **`0010` and `0011`, pin 12**.

Branch review returned `C1` + `M1`–`M7` + `m1`–`m8`; one fix wave, a scoped
re-review returning **SHIP**, then one regression found by the coordinator's
full-suite run and fixed. State at handoff: all findings closed or
declined-with-reason, `apps/api` 1118/1118, `packages/db` 241, `packages/core`
520/520, build and lint clean, pin 12.

### The `0010` hazard, and why no production read is needed

`0010` creates a partial unique index over `violation_limit_reached` markers.
#227 left that event type **candidate-submittable on `main` from Phase 7a**
until this branch narrowed the ingest schema, so live D1 may already hold
duplicates. A unique index over duplicates **aborts**: the ledger stops at 10,
`0011` never runs, and the auto-deploy then ships code declaring `locked_at`
against a table without it — the `0008` scar, which cost this project four
days.

The fix prepends a dedupe to both dialect files, so the migration is correct
whether or not duplicates exist and **no pre-flight count against production
is required**:

```sql
DELETE FROM event
WHERE type = 'violation_limit_reached'
  AND EXISTS (
    SELECT 1 FROM event AS keep
    WHERE keep.type = 'violation_limit_reached'
      AND keep.attempt_id = event.attempt_id
      AND (keep.server_ts < event.server_ts
           OR (keep.server_ts = event.server_ts AND keep.id < event.id))
  );
```

The survivor is the **earliest `server_ts`**, tie-broken by `id`. An earlier
draft used `MIN(id)`, which is wrong: `newId` is 12 Crockford characters of
`crypto.getRandomValues`, 60 bits with **no time component**, so an id-ordered
survivor is arbitrary.

**The hazard was proved real, not assumed.** With the `DELETE` stripped, the
migration aborts against Miniflare with
`UNIQUE constraint failed: event.attempt_id: SQLITE_CONSTRAINT_UNIQUE`.

A standing regression now covers it in `apps/api/test/worker.test.ts` — it
takes `0010`'s statements **from the committed bundle** rather than retyping
them (which is why `migrations.generated.js` is now exported from
`@pariksha/db`), drops the index to recreate the pre-`0010` shape, and asserts
four things: duplicates collapse to the earliest, a single-marker attempt is
untouched, a `window_blur` row on the same attempt survives, and the rebuilt
index still refuses a second marker. Probed both ways.

**Accepted trade, recorded:** deleting duplicates erases the forensic signal
that #227 was exercised in production. "Did a candidate actually forge
markers?" becomes permanently unanswerable.

### The remaining steps for 7e

1. Full suite, alone (see the incantation below).
2. `node deploy/cloudflare/setup.mjs --dry-run` — free, in-memory, runs the
   whole flow twice and asserts the second run is a no-op.
3. `node deploy/cloudflare/setup.mjs` — **applies `0010` and `0011` to live
   D1. The owner authorised this on 2026-10-23, for this migration.** It must
   happen **before** the merge: `deploy.yml` redeploys `main` on every push
   and applies no migrations.
4. Merge, then confirm `GET /api/v1/health` answers `{"migrations":12}`.

## The cascade — this project's verification was wrong, and #236 fixes it

`CLAUDE.md` told agents to pass `--no-file-parallelism` to avoid the
documented 37-failure cascade. **That flag does not prevent it.** It
serialises files *within* one vitest process; `turbo run test` still runs each
package's task **concurrently**. Measured on one commit, one machine:

| command | result |
| --- | --- |
| `turbo run test -- --no-file-parallelism` | **15 files / 43 tests failed** |
| `turbo run test --concurrency=1 -- --no-file-parallelism` | 1 file failed |
| `apps/api` alone, `apps/web` alone | **0 failed** |

The correct full-suite incantation:

```
npx turbo run test --concurrency=1 -- --no-file-parallelism
```

Two traps recorded with it:

- **Without the bare `--`, turbo rejects the flag and the wrapper still exits
  0.** A run that executed no tests reads as green. A branch was reported
  verified on exactly that before it was caught.
- **A lone failure under load is not a failure until reproduced alone.** The
  `SignIn` magic-link wait misses its deadline on a loaded machine.

## `SITE_URL` must be an `https://` origin

`scripts/prerender.mjs` refuses anything else:
`SITE_URL "http://localhost:5173" must be an https:// origin.` Several
"`@pariksha/web#build` fails" reports this session were this and nothing else.
Use `SITE_URL=https://pariksha.example` for a local build.

## #228 is costing real time — fix it before 8c

Every `apps/web` test file hand-rolls its own `fakeClient` implementing
`ApiClient`. One interface change therefore breaks twenty-odd copies, and it
did so **four times in one session, in four distinct failure modes**:

1. a merge conflict in `webhook-panel.test.tsx`;
2. a CI type-check failure on `phase-8e` after `main` merged in;
3. a **clean merge that did not compile** — `api-key-panel.test.tsx` was
   created on `phase-8d-2`, so git had nothing to flag;
4. a cross-branch break on `phase-8b` after two merges.

Git shows a conflict where two branches edit the same line, never where one
branch adds a member another branch's hand-rolled fixture must also carry.
**One shared fixture helper would delete about twenty copies of this.** 8c adds
four export methods to the same interface, so doing it first is cheaper than
doing it after.

## Rulings made this session

- **`P8E-R20`** (inherited, confirmed) — `spentToday`/`countsToday`/
  `UsageCounts` deleted rather than windowed. With only single-column
  `workspace_id` indexes on `attempt`, `snapshot` and `event`, a windowed
  predicate still **examines** every workspace row. Verified against
  `packages/db/src/schema/columns.ts`.
- **8e's `C1` is a partial fix and says so** — the steady-state `snapshot`
  scan drops from ~3× to ~1× the table's row count, not to ~0: `snapshot` has
  no index on `taken_at`, so the base scan still reads every row. Residual is
  #226.
- **8d-2's `MAJOR-3` ships documented, not fixed** (`P8D2-R1`) — a `created_by`
  column would be `0012` landing **out of order** ahead of 7e's `0010`/`0011`.
  Filed as #234.
- **7e's `M1` was an over-correction, and the trade was avoidable.** Bounding
  `recomputeIntegrity` by gating it behind `atLimit && !alreadyActioned` left
  the live organiser flag reading `clean` while violations accumulated on
  `warn_then_flag`, the default action, where the limit may never be crossed
  before submit. `integrityFor` reads only three things off the event list — a
  violation count, a failure count, and the **maximum** `camera_lost`
  `outageMs` — all SQL aggregates. One aggregate query (`listIntegrityCounts`)
  makes the recompute cheap, so the gate was removed rather than the test
  changed. The `/attempt/events` (19) and `/attempt/submit` (15) budgets were
  **re-measured and are unchanged**: the swap is one-for-one, not two-into-one.

## Issues filed or extended

- **#229** — two comments: 8e is the first *destructive* path carrying
  dialect-conditional SQL, and there are now **four** unexercised Postgres
  branches in the erasure path. Two fail **silently**: `candidateIdExtract`
  and `webhookAttemptIdExtract`. A silent failure there leaves a plaintext
  `external_id` after an erasure the candidate was told had completed. Whatever
  closes #229 should cover those two first.
- **#226** — widened with the `EXPLAIN QUERY PLAN` result that
  `snapshot.taken_at` has no index.
- **#231**, **#232**, **#234** — filed by the session that ran earlier the
  same day.

## Recovering agents after a crash or interrupt

Both happened today. A host crash killed four background agents at once at
10:22 UTC, and a later Ctrl+C killed an implementer mid-task. In both cases
the committed work survived and the uncommitted work was recoverable **only
because it was committed in place before anything else was done**.

- `.superpowers/sdd/<phase>/progress.md` **in each clone** is the real ledger.
  It is gitignored and does not travel between clones.
- `~/.claude/projects/<slug>/<session>/subagents/agent-<id>.jsonl` shows where
  an agent died; the sibling `.meta.json` gives its model and description.
  Tail with a JSON filter, never `cat` — they are hundreds of KB.
- Simultaneous final timestamps across the parent and every agent, with no
  error entry anywhere, means the **host** died, not an agent.
- A stopped agent **cannot be resumed** by the harness. Commit its tree, then
  dispatch a fresh agent pointed at that commit, told to audit it hunk by hunk
  rather than trust it.
- **Push every lane branch at its first commit.** Committing survives an agent
  dying; only a push survives the host dying. Four branches existed only on one
  disk for most of a day.

## Running it locally

```bash
SITE_URL=https://pariksha.example pnpm build

# API — needs all four, none of which are in .env
SESSION_SECRET=<32 bytes hex> DATABASE_URL=./pariksha.sqlite \
STORAGE_DIR=./files PUBLIC_URL=http://localhost:5173 \
APP_URL=http://localhost:5173 EMAIL_CONSOLE=true \
EMAIL_FROM="Pariksha Local <noreply@localhost>" \
  node --env-file=.env apps/api/dist/node.js

pnpm --filter @pariksha/web dev     # http://localhost:5173/admin.html
```

- **`.env` holds no `OIDC_PROVIDERS`**, so Google sign-in is not available
  locally; those credentials are `wrangler secret` values on the deployed
  Worker. `EMAIL_CONSOLE=true` prints the magic link to the server log, and the
  local database already has `owner@college.test` with one workspace. A magic
  link only reaches an account that already exists.
- **`/` is empty under `vite dev` by design.** `apps/web/index.html`'s body is
  `<div id="root"></div>`; `scripts/prerender.mjs` fills it at build time and
  no client script ships on the landing page (SEO-2). Use `vite preview` to
  see the real thing — `preview.proxy` is already configured.
