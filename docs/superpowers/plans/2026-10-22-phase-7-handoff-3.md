# Phase 7 — third handoff: 7a, 7b and 7c are on `main`

**Date:** 2026-10-22 · **Read the earlier two first**, in order — they are not superseded:
[`2026-10-22-phase-7-handoff.md`](2026-10-22-phase-7-handoff.md) (what 7a shipped, and the traps that
predate it) and [`2026-10-22-phase-7-handoff-2.md`](2026-10-22-phase-7-handoff-2.md) (what 7b and 7c
found). This file covers the merges, the state of **7d in flight**, the microphone cut, and
everything **7e** needs to start.

**Written for:** the agent that finishes **7d (the eye)** and executes **7e (the consequences)**.

---

## 1. Where the phase stands

| plan | state |
| --- | --- |
| **7a — the contract** | **Merged**, [#205](https://github.com/SriSatyaLokesh/pariksha/pull/205). |
| **7b — the editor** | **Merged**, [#207](https://github.com/SriSatyaLokesh/pariksha/pull/207), squashed to `a5e2a9a`. |
| **7c — the gates** | **Merged**, [#208](https://github.com/SriSatyaLokesh/pariksha/pull/208), squashed to `8db4894`. |
| **7d — the eye** | **In flight.** Branch `phase-7d/the-eye` in `pariksha-wt2`, rebased onto `main`. Tasks 1–4 written and reviewed; fix pass 1 running; Task 5 **cut down** (see §3). |
| 7e — the consequences | **Not started**, but fully pre-flighted — §6 carries every ruling. |

`main` is valid and CI-green: proctoring enforces end to end, the organiser can configure it, and the
publish checklist no longer contradicts itself.

### Why 7c merged before 7b

They were built in parallel from the same base and neither depends on the other — 7c consumes **7a**'s
`ResolvedProctoring` and event vocabulary, not 7b's UI. 7b merged second only because **it was failing
CI**, on the `@pariksha/core` coverage gate rather than on any test:

```
ERROR: Coverage for functions (99.3%) does not meet global threshold (100%)
ERROR: Coverage for statements (97.39%) does not meet global threshold (98%)
```

Cause worth remembering: 7b's own branch review correctly moved `snapshotCost` **into
`packages/core`** to kill a duplicated, independently-wrong cost calculation — and left its **tests**
behind in `apps/web` and `apps/api`. The function was well tested and invisible to the package whose
gate guards it. Fixed by adding the core tests (438 → 450), **not** by moving a threshold (`AG5`).

---

## 2. Resume state, per clone

**The SDD ledgers are git-ignored and do not travel to origin.** `.superpowers/sdd/<plan>/progress.md`
exists on disk in each clone; a fresh clone elsewhere will not have them. **This file therefore
carries every ruling they hold that a later plan depends on** — §4 and §6. Read the ledger anyway if
you are on this machine: it has the probes, the verbatim failure lines, and the reasoning behind each
call.

| clone | branch | next action |
| --- | --- | --- |
| `pariksha` | `phase-7b/the-editor` (merged) | Free. Park it on `main`. |
| `pariksha-wt1` | `phase-7c/the-gates` (merged) | Free. **7e runs here**, cut from 7d's final head. |
| `pariksha-wt2` | `phase-7d/the-eye` | Finish 7d — §3. |

**Three fixed clones only**: `pariksha`, `pariksha-wt1`, `pariksha-wt2`. **Never create a git
worktree** — pnpm junctions have twice deleted `packages/core/**` and `packages/db/**` out of a
*different* checkout. To read a frozen commit use `git show <sha>:<path>`.

---

## 3. Finishing 7d

Tasks 1–4 are written, reviewed and their findings ruled. **Fix pass 1** is in flight, covering six
findings from the Task 3 and Task 4 reviews; its first commit (`1634971`, the blocking one) has
landed. Then:

### Task 5 is CUT DOWN — the microphone is deferred

The owner cut `Q12b`'s noise monitoring. This was the plan's own pre-authorised first cut. Filed in
full as **[#209](https://github.com/SriSatyaLokesh/pariksha/issues/209)** against Phase 8, with the
`monitorNoise` signature, every acceptance criterion and the traps.

**What must still ship in 7d, and why none of it is optional:**

1. **`resolveProctoring` hardcodes `requireMicrophone: false`**, ignoring the override — mirroring
   `faceCheck` in the same function, line for line, with a comment naming #209.
2. **The organiser's microphone control ships disabled**, naming #209, exactly as `face_check` names
   Phase 8.
3. **The `AG2` and `AG3` source scans ship**, each with its `Q10a` probe: no `MediaRecorder` anywhere
   in `apps/web/src`; no retained audio (`AudioBuffer`, `getChannelData`); no biometric template in
   either app.
4. **Tests pinning the cut**: `require_microphone: true` resolves `false`, and
   `proctoringRequirements` emits no microphone sentence for it.

**Why 1, 2 and 4 are required rather than tidy:** `require_microphone` already exists as a control and
`proctoringRequirements` already emits *"A working microphone is required for the whole test."*
Shipping a control the runtime ignores, with a sentence promising enforcement that does not exist, is
precisely the `Q1b` defect 7c's branch review had to correct **three times in one wave**.

**Why 3 is required:** the scans are mechanical and permanent, and cheapest to install **before** the
feature exists. The plan's own argument for the biometric scan — *"ships now, against a field nothing
can fill yet, so it is already in place when Phase 8 turns face counting on"* — applies identically to
the audio ones. `D-R2` still governs: the biometric pattern matches `landmark` in `Runner.tsx` and
`descriptor` in `OrganiserShell.tsx` on the day it is written, both innocent and both inside comments,
so **the scan strips comments first**.

**No PRD reword and no ADR, and that is a consequence rather than an omission.** The planned reword of
`P-06` from *"no audio is ever recorded"* to *"…recorded **or stored**"* existed only because
**capture-without-retention is a different claim from no-capture**. With nothing capturing audio, the
existing wording is true as it stands. #209 carries the instruction that the reword and the ADR land
in the same change that first opens an audio stream, so the public claim never ships a release behind
the code.

### Then

Whole-branch review → fix wave → scoped re-review → PR. **Every branch review in this phase has
returned *fix first***; budget the wave rather than hoping against it.

---

## 4. Decisions taken in 7d that 7e inherits

### One capture on return, never the backlog — and the plan's own test was wrong

Task 4's schedule advanced `due += intervalMs` per tick, so a hidden tab's whole backlog fired on
return: **60 captures for a clean hour and 60 for an hour containing a 20-minute blackout**, i.e.
~19–20 webcam reads and uploads a second apart. The brief's prose said *"a tab hidden for twenty
minutes takes one snapshot on return, not twenty"*; the plan's own test asserted
`toBeGreaterThanOrEqual(55)` for that scenario. **Both cannot hold** — a true single-capture catch-up
lands near 41.

**Ruled: one capture. ~41 is the correct answer.** The catch-up frames are images of **now**, not of
the twenty unobserved minutes, so firing twenty manufactures the appearance of coverage for a period
that has none. **7e's `observed: false` is the designed mechanism for saying proctoring was not
watching, and a backlog burst defeats it** by filling the gap with photographs of the wrong moment.
The absence is already recorded once, as a counted `visibility_hidden` violation. `AC-20`'s 55–65
describes an attempt that **was** watched for sixty minutes; it is not a quota for one that was not.

**7e must not "repair" the count.** A short snapshot count on an attempt with a long hidden-tab gap is
exactly the signal `integrityFor` is supposed to see.

### `camera_lost` takes a snapshot only when a frame exists

Skipping the violation snapshot for all three reasons rested on "the camera is already unavailable".
True for an ended or muted track; **false for `"covered"`**, where the track stays live with a
drawable frame — `isCameraLensCovered` depends on exactly that to detect the condition at all. Ruled:
**snapshot on `"covered"`, skip ended and muted, pin all three.**

### `snapshotCost` is the one cost function (carried from 7b, still binding)

If 7e needs a cost figure anywhere, call `snapshotCost` from `packages/core`. Do not re-derive one —
re-deriving it is what produced a live bug on two surfaces.

---

## 5. Traps found this session, on top of the earlier two handoffs' lists

### `no-hex-colors.test.ts` forbids CSS named-colour **words**, not only hex

`black`, `green`, `blue` and friends are refused anywhere outside a **block** comment. 7d Task 3 had
built the covered-lens detection around a "black frame" vocabulary and had to rename **the whole
concept** — identifiers, comments, test names — to go green. The guard's name badly understates what
it enforces. **Pick colour-free vocabulary up front.**

### A Strict attempt cannot start in jsdom without a desktop stub

7c's branch-review fix made the device gate decide **at mount** rather than after the candidate clicks
"Check my device", and Strict resolves `desktopOnly: true`. jsdom's `matchMedia` answers
`matches: false` to every query, `pointer: fine` included, so the gate correctly refuses and Start
stays disabled.

Use `stubDesktop()` from `apps/web/test/exam/camera-gate.test.tsx`, which stubs **only** `innerWidth`
and `matchMedia` — **`device-gate.test.tsx` replaces `navigator` wholesale**, which would take
`navigator.mediaDevices` down with it.

### A clean rebase is not a correct rebase

Rebasing 7d onto 7c's fixed head reported **zero conflicts** and the suite went red anyway: a
typecheck error in a file whose author had run `tsc` before writing it, and two tests the device-gate
fix correctly broke. **Run the suites after every rebase**, not only the ones that conflict.

### vitest flakes on this machine under load, and the discriminator is the isolated re-run

The `apps/web` suite is now **2270 tests across 80 files**. Three 7b-owned files failed after a rebase
with a **different subset each run** and passed in isolation, with a dozen stray node processes on the
box — the documented #161 signature. **Always `--no-file-parallelism`**, and never call a failure a
regression without the isolated re-run. Equally: never wave a red suite through as "probably flakes"
**without** running that check.

### A test that fires events without `act()` is a flake waiting to happen

`fullscreen.test.tsx`'s `sendBeacon` test failed once in three full runs and passed in isolation. It
alone in its file did not wrap `fireEvent` in `act()`. **It was fixed at the cause, not with
`waitFor`** — a `waitFor` would have hidden a real double-send had the diagnosis gone the other way.

### Coverage gates live in CI, not in the suite

`pnpm test` is green while `@pariksha/core`'s coverage thresholds fail. The gate runs as a separate CI
step with explicit `--coverage.thresholds.*` flags. **Moving code into `packages/core` without moving
its tests drops the gate below 100% functions**, and nothing local tells you.

---

## 6. 7e — everything decided before a single task is dispatched

The full pre-flight is in `pariksha-wt1`'s git-ignored ledger at
`.superpowers/sdd/2026-10-21-phase-7e-the-consequences/progress.md`. **These five rulings are
reproduced here because that file does not travel.**

### What the tree confirms the plan can rely on

| assumption | found |
| --- | --- |
| `SubmitReason` reserves `"limit"` | `apps/api/src/run/submit.ts:58` |
| `FAILURE_EVENTS` and `VIOLATION_EVENTS` exist | `packages/core/src/proctoring.ts` |
| `setIntegrity` never touches `flag` | `packages/db/src/repo/attempts.ts`; 0008's own comment explains the separation |
| `attempts.monitor` / `attempts.read_evidence` sit unused in the matrix | `packages/core/src/permissions.ts`; `proctor` holds both |
| the `event` table can answer "has this attempt been actioned" | indexed on `attempt_id` |

### `E-R1` — there is no `status` column on `attempt`, so the plan's "Migrations: none" is wrong

`attempt` has no status column: status is **derived** from `submittedAt`. The plan asserts `status`
eleven times across Tasks 1–4 (`toBe("locked")`, `toBe("submitted")`, `status: "in_progress"`).

Considered and rejected: deriving the lock from the event log (`attempt_locked` later than any
`attempt_unlocked`), which needs no migration — it costs **one extra query on every candidate write**,
because `assertWritable` runs per answer save, and that is a `ROUTE_BUDGETS` bump on the hottest route
in the product.

**Ruled: add `0009_attempt_lock.sql` — `ALTER TABLE attempt ADD locked_at integer;`** Nullable, so no
`DEFAULT` and no backfill question; one `ADD COLUMN` per `ALTER TABLE` as 0004–0008 each record for
D1; no PRAGMA of any kind. `readAttemptByTokenHash` already loads the row `attemptContext` puts on the
request, so the lock check costs **zero extra queries and zero budget**, and `lockedAt` is symmetrical
with `submittedAt`. Unlock sets it back to `NULL`; the audit row records that it happened.

**Both dialects**, plus `schema/columns.ts`'s `TABLE_MANIFEST`, as 0008 did. And **a new migration
must bump `apps/api/test/worker.test.ts`**, which hard-codes the migration filename list and the
`migrations: N` count — it runs only under the package's *second* vitest config, so focused runs stay
green while the branch is red.

### `E-R2` — the lock guard cannot go in `attemptContext`, where the plan puts it

The plan says *"`attemptContext` refuses writes on a locked attempt with 409 — one guard in the
middleware every write route already passes through."* That middleware does not know the method, and
**its own doc comment forbids exactly this**:

> *"A **submitted** attempt resolves. The receipt (`C-08`) and the result are read through this same
> cookie after `submitted_at` is stamped; refusing here would log a candidate out of their own result
> page. Whether a *write* is still allowed is the answer route's question."*

A 409 there breaks `GET /api/v1/run/attempt` for a locked candidate — the **one** request a locked
candidate's page must still be able to make, since it is how the overlay learns it is locked and how it
learns it has been unlocked.

**Ruled: the guard goes in `assertWritable(attempt, now)`** (`apps/api/src/run/attempt.ts`), the shared
write gate the answer route already calls immediately after its `submittedAt` check. One guard, every
write route, reads and the receipt untouched. The plan's instinct — one guard, not one per route — was
right about the shape and wrong about the place.

### `E-R3` — 7e declares three `detail` shapes

`violation_limit_reached`, `attempt_locked` and `attempt_unlocked` are already in `PROCTORING_EVENTS`,
so this is the shapes only, declared in `packages/core/src/proctoring.ts` beside the four 7c Task 4
declared and the ones 7d adds. Task 1 **depends** on `violation_limit_reached` existing as a row —
that is where `alreadyActioned` comes from — so it must actually be written, not merely decided.

### `E-R4` — `expectedSnapshots` belongs in `integrity.ts`, not in two call sites

The plan says it comes "from the resolved interval and the elapsed time". That arithmetic has two
callers (submit, and every violation recompute) and belongs beside the shortfall constant, not copied
into both. `snapshotCost` is this phase's precedent for exactly that: 7b's branch review found the
same arithmetic duplicated and **independently wrong** on two surfaces.

### `E-R5` — the standing negative-assertion rule

`expect(screen.queryByRole("button", { name: /Unlock/ })).toBeNull()` is the shape that shipped
vacuous three times in 7c. So are the 404/403 workspace-scoping assertions on the unlock route:
**prove the route answers 200 for the right actor in the same file**, or a typo in the URL makes all
three pass.

### 7e's own Review Focus, unchanged and worth re-reading

The limit reached twice in one flush; a late flush after the candidate submitted; a stack failure
arriving at limit-minus-one (`snapshot_failed` must never auto-submit an honest candidate whose
storage was down); an unlock by a member of another workspace (404) or by a role without the
permission (403), on the product's **first organiser-side attempt routes**; and an integrity recompute
clobbering a `scoring_blocked` flag.

---

## 7. The owner's step — still outstanding, and 7e is where it bites

`deploy.yml` applies no migrations by design. `node deploy/cloudflare/setup.mjs` does.

**It is not a 7d blocker.** 7d writes `snapshot` rows and that table comes from `0000`, so it is live.
**7e is different**: it reads and writes `attempt.integrity_flag` and `observed` (7a's `0008`, never
applied) and adds `0009`'s `locked_at`. Until the script runs, any deployed route touching those
columns fails with `D1_ERROR: no such column`.

Nothing on `main` reads them today — `getAttempt` is their only reader and it has **no callers outside
`packages/db`'s own tests** — which is why 7a, 7b and 7c could all merge and deploy safely. **7e must
not be the plan that discovers this.**

`database_id` is already committed in `wrangler.toml`; only the migrations are outstanding. The
sandbox classifier refuses the command for the agent — the owner runs:

```
! node deploy/cloudflare/setup.mjs
```

---

## 8. What the owner validates by hand

Each result goes in the **roadmap's Phase 7 row**, not only in a task report.

- **`AC-17`** — an Android phone, an iPhone and a desktop-mode iPad, each refused with `desktop_only`
  on and admitted with it off. **Tap Start without touching "Check my device"**: that path was
  bypassable until 7c's branch review caught it, and every test in the suite clicked the button first,
  which is exactly why nothing caught it.
- **Escape actually exiting fullscreen.** The e2e suite drives the exit with
  `document.exitFullscreen()` because exiting on Escape is Chromium's **browser-UI** behaviour and the
  suite runs headless. Measured: `document.fullscreenElement` stays non-null a full second after the
  keypress.
- **`AC-19`** — a camera physically unplugged mid-attempt, **and replugged**. The replug path is what
  7d's Task 3 review found broken.
- **`AC-20`'s real-encoder figure.** Measured in Chromium with a **fake** camera: **2966 bytes** at
  quality 0.8, 320×240, `image/jpeg`. `SNAPSHOT_KB` pins 25 KB and `Tail.tsx` states it publicly.
  Chromium's synthetic device is very low-entropy — it peaks near 4.2 KB even at quality 0.9 — so that
  measurement **bounds the figure from below and can neither confirm nor refute it against a real
  face.** The public promise is unverified. A figure measured against synthetic noise is not evidence
  about photographs, and `AG5` forbids retuning the constant to match.

---

## 9. Cut order

Already cut: **`Q3`'s on-device face check** (pre-planning) and **`Q12b`'s microphone**
([#209](https://github.com/SriSatyaLokesh/pariksha/issues/209), this session). Both ship as disabled
controls naming their future phase — that pattern is now the precedent for any further cut.

**A third cut stops and asks.**

## 10. When to stop and ask

Four classes, and only these: an irreversible operation; a security-sensitive action; a side effect
outside the worktree (**a merge to `main` is the owner's — though in this session they authorised
merging directly, so confirm which applies**); or a plan so broken that every path forward is a guess.

Everything else is a ruling you take and record as `Ruling: <what> — <why> — <cost if wrong>`.
