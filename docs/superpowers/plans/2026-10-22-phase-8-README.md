# Phase 8 — results, monitoring, grading and data lifecycle: plan index

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md)
— 42 rulings, 10 guards, written 2026-10-22 and pre-flighted against `main` at `243ba07`. Twelve
rulings are the owner's. A builder's review of the first draft added `K35`–`K42` and corrected one
error in it.

The spec covers seven independently shippable slices, so it is seven plans. Each produces working,
testable software on its own.

> **Read the spec's §5 (the pre-flight) and §6 (the four constraints) before running any plan.**
> §5 lists a dozen things the tree already has — a plan that rebuilds any of them costs a task —
> and three things it deliberately does not. §6 is the 50-subrequest ceiling, the 10 ms CPU limit,
> the single nightly cron, and the fact that a candidate's browser never polls. Six of the seven
> slices hit at least one.

> **Phase 7 is not finished.** `main` carries 7a, 7b and 7c. **7d is in flight** on an unmerged
> branch and **7e is not started**. Two of these plans are gated on that; see Order below. Read
> [handoff](2026-10-22-phase-7-handoff.md), [handoff-2](2026-10-22-phase-7-handoff-2.md) and
> [handoff-3](2026-10-22-phase-7-handoff-3.md) first — they carry every trap this project has
> already paid for, and 8a's Global Constraints section is distilled from them.

| plan | ships | goals | depends on |
| --- | --- | --- | --- |
| [8a — the ledger](2026-10-22-phase-8a-the-ledger.md) | `rescoreAttempt`, `countedScore`, `toCsv`, `estimateCost`, `TestRetention`, the organiser attempt reads, migration `0010`, the `scheduled` registry, `#186`, `#179`, the PRD correction | the floor | — |
| [8b — the verdict](2026-10-22-phase-8b-the-verdict.md) | grading queue (blind and by question), reviewer verdicts, regrade | `G2` | a |
| [8c — the numbers](2026-10-22-phase-8c-the-numbers.md) | test analytics, item analysis, the four exports, the snapshot manifest, `D7c`'s readiness aggregate | `G3`, `G4` | a, b |
| [8d — the perimeter](2026-10-22-phase-8d-the-perimeter.md) | webhook CRUD **and** delivery, HMAC, the retry drain, scoped API keys | `G3` (machine half), `S-05` | a |
| [8e — the sweep](2026-10-22-phase-8e-the-sweep.md) | retention job, candidate export and erasure, `rate_limit` expiry, the free-tier meter | `G5`, `G6` | a |
| [8f — the ear](2026-10-22-phase-8f-the-ear.md) | `#209`'s microphone, `#84`'s re-cut, the `P-06` reword and its ADR | Phase 7's `G2`/`G3`, mic half | a, **7d merged** |
| [8g — the watchtower](2026-10-22-phase-8g-the-watchtower.md) | live monitor, the five proctor actions, per-attempt review page, `C-10`'s broadcast | `G1` | a, b, d, **7e merged** |

## Order

**8a first and alone.** Every other plan consumes it, and it owns the phase's only migration.

**Then 8b, 8d and 8e in parallel** — none touches proctoring, and their tables (`review`,
`webhook`, `api_key`) have existed since migration `0000`. This is the independent slice, and it is
**three** plans wide.

**8c after 8b**, because the results CSV carries the verdict and the note.

**8f once 7d merges.** `#209` re-enables a control and deletes a hardcoded `false` that *7d ships* —
against a tree without 7d there is nothing to re-enable, and the `AG2`/`AG3` source scans it must
keep green do not exist yet.

**8g last.** It needs 7e for `attempt.integrity_flag`, `observed` and `0009`'s `locked_at`, and it
replaces the **surface** of 7e's two minimal organiser attempt routes while keeping their
**endpoint**.

```
8a ──┬── 8b ──┬── 8c
     │        │
     ├── 8d ──┤
     │        │
     ├── 8e   └── 8g   (also waits on 7e)
     │
     └── 8f           (waits on 7d)
```

8g is drawn after 8b and 8d because it shows their output: `latestVerdicts` on the review page and
`fireWebhooks` for `attempt.flagged`. Both are long merged by the time 7e releases it, so the edge
costs nothing — it is recorded so nobody starts 8g against a tree missing them.

## Before 8a merges — the owner's blocking step

**`K41`, which `CLAUDE.md` now carries as a repository-wide rule.** `deploy.yml` redeploys `main`
on every push and applies **no** migrations; `node deploy/cloudflare/setup.mjs` applies them and a
human runs it. So a branch adding a migration must have it applied to the live D1 **before** it
merges, or the auto-deploy ships code whose schema is not there yet.

This repository has the scar: **`0008` merged with Phase 7a and went four days unapplied**, and
every live `attempt` select failed with `no such column` until setup was run on **2026-10-22**.

**`0008` is applied. It is no longer outstanding** — `attempt.integrity_flag` and `observed` exist
in production and every plan here may assume them. **`0010` is the only migration this phase gates
on**, and applying it is a blocking item in 8a's definition of done.

The agent's pre-merge evidence, both free and neither touching the account:

```
node deploy/cloudflare/setup.mjs --dry-run     # the whole flow twice, in memory; second run a no-op
pnpm --filter @pariksha/api test               # includes worker.test.ts, against Miniflare
```

The owner's step, which the sandbox classifier refuses for the agent:

```
! node deploy/cloudflare/setup.mjs
```

**After the merge, check the count.** `GET /api/v1/health` answers `{"migrations":N}`, and **N must
equal the number of files in `packages/db/migrations/sqlite/`**. A mismatch means the deploy shipped
ahead of the schema.

## Migration numbering

`0010` is 8a's, and **`0009` belongs to 7e** (handoff-3, `E-R1`). Whichever of the two lands second
yields and renumbers.

**The guard here is weaker than it looks.** `migrations-bundle.test.ts` does **not** catch two
branches each adding a differently-named `0010_*.sql` — it only asserts the committed bundle equals
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
| a | `listAttemptsForTest()` — set-based, with derived `lastContactAt` | b, c, g |
| a | `0010` — `webhook_delivery`, `attempt.proctor_message`, `.proctor_message_at`, the `response(workspace_id, question_id)` index | b, c, d, g |
| a | `SCHEDULED_JOBS`, `runScheduled()` | b (regrade drain), d (webhook drain), e (retention, rate limits) |
| b | `latestVerdicts()` | c, g |
| d | `fireWebhooks()` | g (`attempt.flagged`) |

**`SCHEDULED_JOBS` ships empty with a deliberately brittle `expect(SCHEDULED_JOBS).toEqual([])`
test.** A plan registering a job must edit that line, which is how the registry's contents stay
visible instead of accumulating unseen. Three plans edit it: 8b, 8d, 8e.

## The six permissions this phase wires for the first time

`attempts.monitor`, `attempts.read_evidence`, `attempts.grade`, `results.export`,
`candidates.delete` and `keys.manage` have **zero production callers** on `main` — only
`permissions.test.ts`. Phase 8 wires six of thirteen.

`KG2`: every 403 test needs a **200 beside it in the same file**. A typo in the URL makes a bare
403 pass for free, and that shape shipped vacuous three times in 7c.

The boundaries that actually bite, each tested as a pair:

| route | admits | refuses |
| --- | --- | --- |
| grading | Reviewer (`attempts.grade`) | Author (`tests.edit` only) |
| events / snapshot exports | Reviewer (`attempts.read_evidence`) | **Viewer** (`results.export` only) |
| monitor and actions | Proctor (`attempts.monitor`) | Author |
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
| `KG7` | the candidate runtime adds **no** periodic `fetch` | g |
| `KG8` | no cost figure reaches a `node` deployment | e |
| `KG9` | `audit_log.detail_json` carries ids, never personal data — this is what pays for `KG4`'s exemption | e |
| `KG10` | the monitor joins the density registry's fixed `SURFACES` list | g |

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

## Execution

`superpowers:subagent-driven-development`: one fresh implementer per task, a fresh reviewer after
each, then a whole-branch review on the most capable model, one fix wave, one scoped re-review.
Every subagent invokes the **ponytail** skill before anything else. 8b, 8c, 8e and 8g paint — use
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
