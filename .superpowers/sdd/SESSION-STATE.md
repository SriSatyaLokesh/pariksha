# SESSION STATE — 2026-10-23. The old scratchpad path is GONE; this file replaces it.

The session scratchpad that earlier ledger entries point to no longer exists. **This file, plus the
four per-plan ledgers, is the recovery map.** Trust them over recall.

## STANDING ORDER (owner, verbatim)

*"keep going, dont stop until 7e and phase 8 are done ask advisor if you get questions, at every
interval wrte to legder so that autocompact will not leave you context less"*

*"a phase means the whole phase."* Advisor = a **Fable subagent**, never the owner. Four things stop
a run: an irreversible/destructive op beyond a squash-merge, a security-sensitive action, a side
effect outside the repo, a plan so broken every path is a guess.

## MERGED THIS SESSION

**Phase 8d — `290e9ed`, PR #230.** Outbound webhooks. Deployed, health verified
`{"migrations":10}` (unchanged, correct — it carried no migration).

## LANES

| clone | branch | HEAD | state |
| --- | --- | --- | --- |
| `pariksha` | `phase-8e/the-sweep` | `71c6590` | all 4 tasks + fix wave done; **fix-wave re-review running** (`a77f08acb3888a48a`) |
| `pariksha-wt1` | `phase-8b/the-verdict` | `e2219c7` | all 4 tasks done; **branch-review fix wave running** (`adefb20aa46d72488`) |
| `pariksha-wt2` | `phase-8d-2/scoped-keys` | `4b7286b` | one task done; **security branch review running** (`aca6ed04d5a1f0341`) |
| `pariksha-wt3` | `phase-7e/the-consequences` | `6c40110` | all 5 tasks + `main` merged in; **branch review running** (`a95a578e73b190b57`) |

**8c** — not started. 5 tasks. Needs 8b's `latestVerdicts()`, so it waits for 8b to merge, then takes
whichever clone frees.

## THE MIGRATION GATE — only 7e

7e alone adds `0010_violation_limit_claim.sql` and `0011_attempt_locked_at.sql`, **both dialects**.
`main` is at 10; 7e takes live D1 to **12**. **`node deploy/cloudflare/setup.mjs` must be run before
7e merges** — `deploy.yml` ships `main` on every push and applies no schema. Health must then read
`{"migrations":12}`. `worker.test.ts` pins the filename list and count, and runs **only** under
`vitest run -c vitest.workers.config.ts`.

8b, 8e and 8d-2 add **none**.

## MERGE MECHANICS — learned the hard way today

- **CI is a required check and auto-merge is OFF** (`enablePullRequestAutoMerge` disabled). Every
  merge: push, open PR, wait for four green checks, `gh pr merge --squash --delete-branch`.
  **Never `--admin`.** CI caught a real lint error four local reviews had read past.
- **`P8D-R8`: "pre-existing" means present on `main`, verified with `git show origin/main:<path>`** —
  not "present before this wave". An error in a file the branch *created* cannot be pre-existing.
- **Rebasing a long branch onto `main` fails on the first commit; `git merge origin/main` is one
  resolution pass instead of eight**, and the PR squashes anyway.
- **`P7E-R18`: after any merge touching a shared function, re-measure every route whose budget
  includes it.** Git flags a conflict where two branches edit a line, never where one branch changes
  the *cost* of a function the other's route already calls. `/attempt/events` went 13 → 14 with no
  conflict at that line.

## CRON DISPATCH — verified on `main`

`runScheduled` does `if (job.cron !== cron) continue;` — jobs share an invocation **only when their
cron strings are identical**. 8e's nightly `17 3 * * *` never collides with 8d's `*/5 * * * *`.
**8b's `regradeJob` declares exactly `*/5 * * * *` and does collide** — 37 + 22 = 59 against a
50-subrequest ceiling. Fix sent: stagger to a different expression, do not shrink the batch.

## OWNER RULINGS — binding

1. **`P7E-R9`: unwatched escalates to review, never renders clean.** `observed` stays a **separate
   field** — `review` now has two causes an organiser must tell apart. Scoped: `observed:false`
   means proctoring was **configured to watch** and the evidence did not arrive; under Off/Standard
   nothing was promised so `observed` stays true. **Hard boundary: a `review` from `observed:false`
   triggers no consequence.** Shipped structurally — the only `"clean"` line hardcodes
   `observed: true` as a literal.
2. **Scoring gets built; only the microphone (8f) is deferred.**

## DEFERRED — do not build. Epic #223, milestone "Phase 8.5"

**8f the ear** (#209, #84) — `K44`. Parked branch `phase-8f/the-ear` at `cf6274f`; **do not merge.**
**8g the watchtower** (#89, #90, #91, #87) — `K43`. Its blocker clears when 7e merges, but it stays
deferred unless the owner asks.

## PARKED FINDINGS THAT MUST NOT BE LOST

**7e Task 4's two MAJORs** (`P7E-R14`) — named verbatim in 7e's ledger and in its branch-review
dispatch: a failed unlock produces **no UI feedback at all** (409/403/network all look like
success); and Unlock fires on a **single click with no confirmation** with **no re-lock surface
anywhere in the product**.

## OPEN ISSUES

#226 retention rows-read and batch fairness · #227 security, closed by 7e · #228 every `apps/web`
test hand-rolls `fakeClient` · #229 Postgres has no test infrastructure · #231 paused webhook
backlog stays in the drain's index range.

## MY OWN REPEATED ERROR, NAMED

**Six implementers overruled me today with evidence; all six were right.** The pattern:
**my cost rulings are directionally right and mechanically wrong** — I name the metered dimension
correctly, then prescribe a fix without checking what the engine actually does (`P8E-R20`:
windowing a count does not reduce rows *examined* without a composite index). **State the
constraint; let the implementer choose the mechanism.**

Also: **never run a fix round and the next task in the same clone at once** (`P7E-R10`, broken twice
as `P8E-R16`). A *review* is read-only and may overlap an implementer; a second *implementer* may
not.

## HOUSEKEEPING

`pariksha-landing/` deleted. **`pariksha-p6/` still `Device or resource busy`** — held by a live
process. Use `rmdir`, never `rm -rf`: it removes only empty dirs and does not follow links, which
matters because `rm -rf` over a junction is what twice deleted `packages/core/**`.
`.claude/worktrees/`'s 12 junction-laden `agent-*` dirs stay untouched until the primary clone is
idle, and then only with something that does not follow links.

---

## COLLISION — a second session drove these same four clones for ~40 minutes

Session `pariksha-ac` was told by its user that this session had died in a 10:22 UTC crash (every
transcript cut at the same second) and was asked to recover all four lanes. This session had been
resumed instead, so **both dispatched into `pariksha`, `pariksha-wt1`, `pariksha-wt2` and
`pariksha-wt3` at once.** It has stopped, killed its agents, and handed over. **All four of my
agents were alive throughout and were never interrupted** — verified with `ListAgents`.

**Four things it changed. None are to be undone:**

1. **`pariksha-wt1` HEAD is now `17d4afc`** — 13 files, ~529 insertions of my 8b fix wave that were
   sitting uncommitted, committed verbatim as *"wip … recovered unverified (C1, C2)"*. Nothing was
   built, linted or tested first and the message says so. **Right call** — it existed only so a
   second crash could not take it. Squash-merge erases the label anyway.
2. **All four branches are now pushed to origin.** None were before, which was a real exposure.
   **Consequence: nobody may force-push.** Both live implementers are told to run
   `git log --oneline HEAD..origin/<branch>` before pushing and to stop if it prints anything.
3. **PR #233 is open** for `phase-8e/the-sweep` → `main`, assigned. Currently **DIRTY** (conflicts
   with `main`) and **no checks reported** — both expected, because my agent is merging `main` into
   that branch locally right now. **Push onto #233; do not open a second PR.**
4. A comment on **#229** recording 8e's `m5`: the first destructive path carrying
   dialect-conditional SQL, where `payload_json ->> 'candidateId'` **fails silent on Postgres** and
   leaves a plaintext `external_id` after an erasure the candidate was told had completed.

**Two trees hold work of mixed provenance — treat as untrusted input, not as my agents' output:**

- **`pariksha-wt1`**, on top of `17d4afc`: `apps/api/test/grade/regrade.test.ts` (+6/-2) and
  `apps/web/test/authoring/question-screen.test.tsx` (+125). Written by the other session's
  implementer while mine was also editing. My implementer is diffing both and judging **hunk by
  hunk on merit** — keeping what is correct, dropping what is not, reporting which it judged
  foreign. The +125 web test file may legitimately answer the branch review's "zero web tests for
  the Task 4 surface" finding. **Nothing is kept merely because it is already there.**
- **`pariksha-wt2/.superpowers/sdd/phase-8d-2-scoped-keys/`**: a second `task-5-report.md` and a
  regenerated review package from the other session's own reading. My implementer's
  `task-1-report.md` is untouched. My reviewer is told to work from the package I generated and to
  treat the other report as a second opinion.

**Three deviations the other session flagged on 8d-2, forwarded to my reviewer as leads to verify,
not findings to copy.** The one that matters: **`authorize.ts` may check `apiKeyScopes.includes(action)`
on a path parallel to `can()` rather than routing keys through it.** A second authorization path is
how a key quietly stops obeying the matrix — every later change to `can()` would silently not apply
to keys. Also: `apps/api/test/authorization.test.ts` is in the brief's file list and may never have
been touched; and `resolveApiKey` carries an extra `apiKeyId` field and a third `now` param.

**Nothing the other session did touched Cloudflare, ran `setup.mjs`, or merged anything.**

### Permission boundary, held

The other session has permission to read production where this one does not. **I asked it not to
run the `0010` pre-flight on my behalf.** If one session is denied an action, having a peer perform
it is not a workaround — it is the denial being bypassed, and that decision belongs to a human.
The pre-flight stays with the owner.

---

## SESSION UPDATE — 2026-10-29: Results Hub & Candidate Review (`feat/results-hub-and-candidate-review`)

### Current Status
- **Branch**: `feat/results-hub-and-candidate-review`
- **Plan**: `docs/superpowers/plans/2026-10-28-results-hub-and-candidate-review.md`
- **Spec**: `docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md`
- **SDD Directory**: `.superpowers/sdd/2026-10-28-results-hub-and-candidate-review/`
- **Status**: ALL 5 TASKS COMPLETE & VERIFIED. Monorepo typecheck & lint 100% clean.

### Commit History on Branch
- `f199341` docs: add design spec and implementation plan for results hub (#271)
- `9ee7290` feat(api): add results overview and test results endpoints (Task 1)
- `02e6187` feat(web): add results client API and navigation shell wiring (Task 2)
- `27e1542` test(web): scope rowFor to Settings region to disambiguate Results nav (Task 2 polish)
- `c548408` feat(web): implement Results Hub workspace test picker (Task 3)
- `ac39d86` feat(web): add candidate results table and test results view (Task 4)
- `bf05efb` fix(results): address exactOptionalPropertyTypes and lint warnings in results routes and components (Task 4/5 polish)

### Verification Summary
- `pnpm typecheck`: Clean across all packages (`@pariksha/core`, `@pariksha/db`, `@pariksha/api`, `@pariksha/web`, `@pariksha/storage`).
- `pnpm lint`: Clean across all packages.
- Unit Tests:
  - `@pariksha/api` results route: 17/17 passed.
  - `@pariksha/web` results route, table, hub, nav: 23/23 passed.
  - Core, db, and storage unit tests: 100% passed.
- Invariants verified:
  - Ruling 1: Author `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.
  - Ruling 2: Edge subrequest ceiling respected via batched queries.
  - Ruling 3: Zero rubric/key leakage (`KG1`) strictly enforced.
  - Ruling 4: Ponytail minimal standard-library/native-first patterns + Senior Fullstack accessible components.

