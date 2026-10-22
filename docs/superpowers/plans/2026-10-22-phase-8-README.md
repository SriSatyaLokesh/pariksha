# Phase 8 — results, monitoring, grading and data lifecycle: plan index

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md)
— 43 rulings, 10 guards, written 2026-10-22 and pre-flighted against `main` at `243ba07`. A
builder's review of the first draft added `K35`–`K42` and corrected one error in it.

> ## Scope, 2026-10-23 — `K43`
>
> **Six plans execute: 8a, 8b, 8c, 8d, 8e, 8f.** Execution is **subagent-driven** and **nothing
> starts until 7d merges**.
>
> **8g is deferred whole**, with 7e — see its own banner. Its four deliverables each read a column
> only 7e writes, and `setIntegrity` has no production caller today.
>
> Three knock-ons applied throughout: the migration is **`0009`** and drops the two broadcast
> columns; **`attempt.flagged` is cut** from the webhook events; `lastContactAt` leaves
> `listAttemptsForTest`.

The spec covers seven independently shippable slices, so it is seven plans. Each produces working,
testable software on its own. **Six of the seven execute** — see the scope box above.

> **Read the spec's §5 (the pre-flight) and §6 (the four constraints) before running any plan.**
> §5 lists a dozen things the tree already has — a plan that rebuilds any of them costs a task —
> and three things it deliberately does not. §6 is the 50-subrequest ceiling, the 10 ms CPU limit,
> the single nightly cron, and the fact that a candidate's browser never polls. Six of the seven
> slices hit at least one.

> **Phase 7 is not finished.** `main` carries 7a, 7b and 7c. **7d is in flight** on an unmerged
> branch and **7e is out of scope** (`K43`). Read
> [handoff](2026-10-22-phase-7-handoff.md), [handoff-2](2026-10-22-phase-7-handoff-2.md) and
> [handoff-3](2026-10-22-phase-7-handoff-3.md) first — they carry every trap this project has
> already paid for, and 8a's Global Constraints section is distilled from them.

| plan | ships | goals | depends on |
| --- | --- | --- | --- |
| [8a — the ledger](2026-10-22-phase-8a-the-ledger.md) | `rescoreAttempt`, `countedScore`, `toCsv`, `estimateCost`, `TestRetention`, the organiser attempt reads, migration `0009`, the `scheduled` registry, `#186`, `#179`, the PRD correction | the floor | — |
| [8b — the verdict](2026-10-22-phase-8b-the-verdict.md) | grading queue (blind and by question), reviewer verdicts, regrade | `G2` | a |
| [8c — the numbers](2026-10-22-phase-8c-the-numbers.md) | test analytics, item analysis, the four exports, the snapshot manifest, `D7c`'s readiness aggregate | `G3`, `G4` | a, b |
| [8d — the perimeter](2026-10-22-phase-8d-the-perimeter.md) | webhook CRUD **and** delivery, HMAC, the retry drain, scoped API keys | `G3` (machine half), `S-05` | a |
| [8e — the sweep](2026-10-22-phase-8e-the-sweep.md) | retention job, candidate export and erasure, `rate_limit` expiry, the free-tier meter | `G5`, `G6` | a |
| [8f — the ear](2026-10-22-phase-8f-the-ear.md) | `#209`'s microphone, `#84`'s re-cut, the `P-06` reword and its ADR | Phase 7's `G2`/`G3`, mic half | a |
| ~~[8g — the watchtower](2026-10-22-phase-8g-the-watchtower.md)~~ | **DEFERRED (`K43`)** — monitor, proctor actions, review page, broadcast. Written, not deleted. | ~~`G1`~~ | a, b, d, **7e** |

## Order

**Nothing starts until 7d merges.** 8f needs it directly; the rest wait with it so the phase has
one start gun, and so 8a is cut from a tree that already has 7d in it.

**8a first and alone.** Every other plan consumes it, and it owns the phase's only migration.

**Then 8b, 8d, 8e and 8f in parallel** — four plans wide. None touches proctoring beyond 8f's own
microphone, and `review`, `webhook` and `api_key` have existed since migration `0000`.

**8c after 8b**, because the results CSV carries the verdict and the note.

**8g does not execute** (`K43`). When 7e lands, it replaces the **surface** of 7e's two minimal
organiser attempt routes while keeping their **endpoint**, and brings its own migration for the two
broadcast columns `0009` no longer carries.

```
7d merges
    │
    └── 8a ──┬── 8b ── 8c
             ├── 8d
             ├── 8e
             └── 8f

        8g ── DEFERRED with 7e (depends on a, b, d)
```

## Before 8a merges — the blocking migration step

**`K41`, which `CLAUDE.md` now carries as a repository-wide rule.** `deploy.yml` redeploys `main`
on every push and applies **no** migrations; `node deploy/cloudflare/setup.mjs` applies them and a
human runs it. So a branch adding a migration must have it applied to the live D1 **before** it
merges, or the auto-deploy ships code whose schema is not there yet.

This repository has the scar: **`0008` merged with Phase 7a and went four days unapplied**, and
every live `attempt` select failed with `no such column` until setup was run on **2026-10-22**.

**`0008` is applied. It is no longer outstanding** — `attempt.integrity_flag` and `observed` exist
in production and every plan here may assume them. **`0009` is the only migration this phase gates
on**, and applying it is a blocking item in 8a's definition of done.

The agent's pre-merge evidence, both free and neither touching the account:

```
node deploy/cloudflare/setup.mjs --dry-run     # the whole flow twice, in memory; second run a no-op
pnpm --filter @pariksha/api test               # includes worker.test.ts, against Miniflare
```

Applying it — **the executing agent's step, confirmed by the owner on 2026-10-23**, no longer a
handoff:

```
node deploy/cloudflare/setup.mjs
```

**Narrow authorisation.** `CLAUDE.md` lists this among the commands that touch the live account,
and that stands. Authorised for **this migration as part of 8a's definition of done** — once, after
a clean dry run. Not for anything else, and not extended to the other `wrangler` commands that
table names.

**After the merge, check the count.** `GET /api/v1/health` answers `{"migrations":N}`, and **N must
equal the number of files in `packages/db/migrations/sqlite/`**. A mismatch means the deploy shipped
ahead of the schema.

## Migration numbering

**`0009` is 8a's**, verified free on `main`: 7e is out of scope and never created it. A future 7e
takes `0010` or later, and 8g brings its own after that.

**The guard here is weaker than it looks.** `migrations-bundle.test.ts` does **not** catch two
branches each adding a differently-named `0009_*.sql` — it only asserts the committed bundle equals
the generator's output. The real guard is `apps/api/test/worker.test.ts`'s hard-coded filename list
and `migrations: N` count, and **that file runs only under `apps/api`'s second vitest config**
(`vitest.workers.config.ts`), so a focused run stays green while the branch is red.

## What is shared across plans

| produced by | name | consumed by |
| --- | --- | --- |
| a | `rescoreAttempt()` | b (grading, regrade) |
| a | `countedScore()`, `CountedResult` | c (CSV, analytics); the candidate result page |
| a | `toCsv()`, `csvFilename()`, `CsvPage` | c, e |
| a | `estimateCost()` — composes `snapshotCost`, `workers`-only | d (the webhook line), e (the dashboard), the publish checklist |
| a | `TestRetention`, `resolveRetention()`, `RETENTION_DEFAULTS` | e |
| a | `listAttemptsForTest()` — set-based (no `lastContactAt`; `K43` removed it with 8g) | b, c |
| a | `0009` — `webhook_delivery` and the `response(workspace_id, question_id)` index | b, c, d |
| a | `SCHEDULED_JOBS`, `runScheduled()` | b (regrade drain), d (webhook drain), e (retention, rate limits) |
| b | `latestVerdicts()` | c |


**`SCHEDULED_JOBS` ships empty with a deliberately brittle `expect(SCHEDULED_JOBS).toEqual([])`
test.** A plan registering a job must edit that line, which is how the registry's contents stay
visible instead of accumulating unseen. Three plans edit it: 8b, 8d, 8e.

## The five permissions this phase wires for the first time

`attempts.read_evidence`, `attempts.grade`, `results.export`, `candidates.delete` and
`keys.manage` have **zero production callers** on `main` — only `permissions.test.ts`. Phase 8
wires five of thirteen.

**`attempts.monitor` stays unwired**: it was 8g's alone, and 8g is deferred (`K43`). It keeps the
distinction it has had since the matrix was written — a Proctor holds it and nothing reads it yet.

`KG2`: every 403 test needs a **200 beside it in the same file**. A typo in the URL makes a bare
403 pass for free, and that shape shipped vacuous three times in 7c.

The boundaries that actually bite, each tested as a pair:

| route | admits | refuses |
| --- | --- | --- |
| grading | Reviewer (`attempts.grade`) | Author (`tests.edit` only) |
| events / snapshot exports | Reviewer (`attempts.read_evidence`) | **Viewer** (`results.export` only) |
| candidate erasure | **Owner only** (`candidates.delete`) | Admin |

## Guards this phase adds

Each is broken on purpose once to prove it can fail, with the verbatim failure line recorded in the
plan's ledger. **No probe appears in a commit.** A probe that edits a `@pariksha/core` constant and
does not rebuild is testing the old build — rebuild on the break *and* on the restore.

| guard | what it holds | plan |
| --- | --- | --- |
| `KG1` | no key, explanation, rubric, model answer or accepted pattern in any export | c |
| `KG2` | every new route has `ROUTE_AUTH` + `ROUTE_ACTIONS`; every 403 has its 200 | b, c, d, e, g |
| `KG3` | no route issues a query per item — measured against **300 candidates** | a, c, g |
| `KG4` | `S-14` deletion empties every candidate-data table in `TABLE_MANIFEST`, `audit_log` exempt by name | e |
| `KG5` | no `secret_hash`, `signing_secret` or key plaintext in any response | d |
| `KG6` | the CSV is Excel-safe — BOM, RFC 4180, round-trips through `readDelimited` | a |
| ~~`KG7`~~ | the candidate runtime adds no periodic `fetch` — **deferred with 8g** | ~~g~~ |
| `KG8` | no cost figure reaches a `node` deployment | e |
| `KG9` | `audit_log.detail_json` carries ids, never personal data — this is what pays for `KG4`'s exemption | e |
| ~~`KG10`~~ | the monitor joins the density registry — **deferred with 8g** | ~~g~~ |

## Cut order

**Already cut, in the spec:** `K1` face counting (the CSP blocker has not moved), `K2` per-question
time (no data source exists anywhere), `K3` the real ZIP (one Strict attempt exceeds 50
subrequests).

- **Cut first: `P8.14`'s free-tier *dashboard*** (8e Task 3). A PRD risk-table mitigation, not an
  `AC`. **Cutting it does not cut the cost surface** — `K35`'s per-control estimates live beside
  the controls they describe, in 8a and 8d, so an organiser still meets the cost at the moment of
  the decision, which is what `G6` actually requires.
- **Cut second: `D7c`'s readiness aggregate** (8c Task 5). A Phase 6.5 carry-forward; the builder
  already shows readiness and `tests.tsx:74`'s own comment documents the absence. If it goes, it
  goes whole — the comment stays and the guard stays.

**A third cut stops and asks.**

## Starting from here

Written for whoever picks this up — including a session in another clone, which **will not have
the planning ledger** (`.superpowers/` is git-ignored and does not travel). Everything needed is
committed; this section is the entry point.

1. **Confirm 7d is merged.** `git log --oneline main | grep -i "7d\|the eye"`. Nothing in Phase 8
   starts before it (`K43`). If it is not merged, finish that first.
2. **Pull `main` and park on it.** The plans and the spec are on `main` as of this PR.
3. **Re-verify the spec's §5 pre-flight against the head you cut from.** It was true at `243ba07`;
   7d moves things. This is the cheapest hour in the phase and 7a proved it — seven of its plan's
   own file paths and helper names did not match the tree. **Record what moved** before dispatching
   Task 1.
4. **Re-check 8f against what 7d actually shipped**, not against 7d's plan. 8f was written from
   7d's plan plus handoff-3's description of the cut, because 7d was unmerged and in another clone
   when these plans were written. Specifically: that `resolveProctoring` hardcodes
   `requireMicrophone: false` where 8f assumes, that the organiser control ships disabled, and that
   the `AG2`/`AG3` source scans exist in the shape 8f must keep green. Twenty minutes, not a
   re-plan.
5. **Run 8a alone, to completion and merge**, including `K41`'s blocking migration step. Every
   other plan consumes its interfaces.
6. **Then 8b, 8d, 8e and 8f.** They are independent of each other. Parallel clones are safe for
   **editing** and unsafe for **verification** — use `--no-file-parallelism` for any full-suite
   run, and never two full suites at once (a documented 37-failure cascade across 5 unrelated
   files, three times, each a different subset).
7. **Then 8c**, which needs 8b's `latestVerdicts`.

**Size 8d honestly before starting it.** Its own header says this and it bears repeating: the
`webhook` and `api_key` *tables* exist and **nothing else does** — no repo function, no route, no
screen for either. It is two plans' worth of work in one. Split it rather than quietly dropping the
CRUD.

**8g is deferred — do not execute it.** Its banner says why and what changed underneath it.

## Execution

`superpowers:subagent-driven-development`: one fresh implementer per task, a fresh reviewer after
each, then a whole-branch review on the most capable model, one fix wave, one scoped re-review.
Every subagent invokes the **ponytail** skill before anything else. 8b, 8c and 8e paint — use
**ui-ux-pro-max** for the styling work in those.

What earned its keep in Phase 7 and is not optional here:

- **A pre-flight scan against the tree before Task 1.** Seven of 7a's own file paths, helper names
  and test assertions did not match the tree. The spec's §5 is this phase's version, done in
  advance — **verify it still holds** against the head you cut from, and record what moved.
- **Probe verification as standard.** Every new guard broken once, the failure line recorded.
- **Tell every reviewer two things explicitly:** that `git show <sha>:<path>` is the only
  alternative source for a file, and that they **must not run the test suite** — the implementer's
  report is the test evidence. Two reviewers on this project each lost an hour to re-running it.
- **Rulings, not stalls.** Record each as `Ruling: <what> — <why> — <cost if wrong>`. A session
  parked on a question costs a day and buys nothing.
- **Commit after every task, before the review.** An uncommitted subagent tree is unrecoverable.
- **Every branch review in Phase 7 returned *fix first*.** Budget the wave rather than hoping
  against it.

Ledgers live at `.superpowers/sdd/phase-8<x>/progress.md`. **They are git-ignored and do not travel
between clones** — anything a later plan depends on goes in a handoff, not only in a ledger.

## What the owner validates by hand

CI proves everything provable without a real cohort and real hardware. These are the exceptions,
and each result goes in the roadmap's Phase 8 row, not only in a task report.

| what | why CI cannot | plan |
| --- | --- | --- |
| `AC-27` — ten attempts hand-scored against the CSV | an automated check would use the same scoring engine the CSV did | c |
| The CSV opened in **real Excel**, with a non-Latin name in it | `KG6` proves the bytes, not the application | c |
| `AC-28` — a webhook to a real endpoint, verifying, then retried after a deliberate 500 | the HMAC is unit-tested against an independent verifier; only a real receiver proves the header survives the wire | d |
| A real microphone: granted, denied, and unplugged mid-attempt | `AG1` means denied **starts the attempt anyway** — the opposite of the camera on the same page | f |
| The worklet's cost on a weak machine | `#209`'s own cut criterion: if it is not free, cut the event and keep the permission | f |
| The monitor against 300 real candidates | `KG3` proves the query shape; only a real test proves the screen is readable | g |
| A broadcast to a candidate who is reading, not typing | `K12`'s known cost, and the one case the design accepts | g |
| A reset, end to end | `K39` destroys nothing — confirm the earlier attempt survives and `countedScore` picks the expected one | g |
