# Phase 7 — second handoff, after 7b and 7c

**Date:** 2026-10-22 · **Supersedes nothing.** Read
[`2026-10-22-phase-7-handoff.md`](2026-10-22-phase-7-handoff.md) **first** — it covers what 7a
shipped and the traps that predate this session. This file covers what 7b and 7c found, the
decisions taken during them, and the exact state to resume from.

**Written for:** the agent that executes **7d (the eye)** and **7e (the consequences)**, and for
whoever picks this up in a new session.

---

## 1. Where the phase stands

| plan | state |
| --- | --- |
| **7a — the contract** | **Merged** as [#205](https://github.com/SriSatyaLokesh/pariksha/pull/205), squashed to `16fc4f5`. |
| **7b — the editor** | **Done.** [PR #207](https://github.com/SriSatyaLokesh/pariksha/pull/207), branch `phase-7b/the-editor` at `2f372c1`. Five tasks, all task-reviewed and fixed; whole-branch review returned *fix first* with 12 findings; all 12 addressed in one fix wave and the scoped re-review of that wave came back clean. **Awaiting the owner's merge** — a merge to `main` is theirs. |
| **7c — the gates** | **Tasks 1–3 complete and reviewed.** Task 4 is **committed as WIP and unverified** (`1c0c9a2`). Task 5 not started, but fully pre-flighted with rulings recorded. Branch `phase-7c/the-gates`, pushed. |
| 7d — the eye | Not started. Needs 7c's queue, layer and `ProctoringOverlay` — all three exist on the 7c branch. |
| 7e — the consequences | Not started. Needs 7a, 7c and 7d. |

### Resume state, per clone

**The ledgers are the recovery map and they are git-ignored.** `.superpowers/sdd/<plan>/progress.md`
lives on disk in each clone and does **not** travel to origin. A new session **on this machine, in
these clones** will find them intact; a fresh clone elsewhere will not. Read the ledger for a plan
before touching it — each carries every ruling with its reasoning and its cost-if-wrong, every
review verdict, and every probe with its verbatim failure line.

| clone | branch | at | next action |
| --- | --- | --- | --- |
| `pariksha-wt2` | `phase-7b/the-editor` | `2f372c1` | Nothing. PR #207 is open and reviewed; the clone is free for 7d. |
| `pariksha-wt1` | `phase-7c/the-gates` | `1c0c9a2` | **Verify Task 4 first** — it was committed mid-task to survive the session boundary and has never been run. Then review it, then Task 5. |

**`1c0c9a2` is unverified.** It was committed because an uncommitted implementer tree is
unrecoverable, not because it was finished. Run the suite before anything else:
`cd apps/web && npx vitest run --no-file-parallelism`. If it is red, that is expected and is where
to start; the Task 4 dispatch's requirements and my rulings are in the 7c ledger under
"Task 4 — pre-flight".

---

## 2. Decisions this session took that 7d and 7e inherit

The first handoff listed seven open questions. Three were due in 7c and are now ruled. **These are
binding on 7d and 7e** — they are not re-litigable preferences.

### `Q7b`'s per-type `detail` shapes — the emitter declares them

The task that **emits** an event declares its `detail` shape. 7c Task 4 declared the four gate
events (`fullscreen_exit`, `fullscreen_restore`, `window_blur`, `visibility_hidden`) in
`packages/core/src/proctoring.ts`.

- **7d declares** `camera_lost`, `camera_restored`, `identity_photo_captured`,
  `noise_above_threshold`, `snapshot_failed`.
- **7e declares** `violation_limit_reached`, `attempt_locked`, `attempt_unlocked`.

Do not leave `detail` free-form for Phase 8 to reverse-engineer.

### The "returned" counterpart — there isn't one, and that was deliberate

`window_blur` and `visibility_hidden` have no paired return event, while `P-04` wants *when* the
candidate left **and for how long**. Ruled: **do not add a member to the closed union.** Defer the
send until return and carry the duration on the leave event — on blur, start timing and emit
nothing; on focus, `pushImmediate("window_blur", { awayMs })`. If the page unloads while away, the
queue's existing buffer sends it with `awayMs: null` rather than losing it.

One event per departure, a count that cannot double, and the warning appears **on return**, which
is what `P-04` describes. **7d's `camera_lost`/`camera_restored` already pair**, so it does not face
this — but if 7d or 7e is ever tempted to add a union member, this is the precedent for not doing it.

### `block_copy_paste` and `watermark` get requirement sentences

The first handoff's open question 3, ruled for 7c Task 5: both get sentences in
**`proctoringRequirements`**, not a second list. `Q1b`'s reason — a candidate learns what is
enforced before the timer starts — applies to a blocked paste and to their own name across the page
exactly as it applies to a camera.

**This changes Standard's resolved requirement list** (`standard.blockCopyPaste` is `true`), which
breaks the pinned fixtures in `apps/api/test/run/landing.test.ts` and
`apps/web/test/exam/landing.test.tsx`. Those are **meant** to break; extend both deliberately and
keep the two copies identical, because they exist so the two cannot drift.

### `snapshotCost` is the one cost function, and it lives in core

7b moved `SNAPSHOT_KB`, `KB_PER_MB` **and the function itself** into `packages/core/src/proctoring.ts`.
Both the publish checklist and the builder panel call it.

This was not tidiness. The whole-branch review found a **live bug on two surfaces**: the panel's
cost clause did not gate on `requireCamera`, so Strict with `require_camera: false` claimed
`≈ 60 images · ≈ 60 uploads` for a configuration `Q11b` says captures nothing — and
`apps/api/src/publish/checklist.ts` had an **independent, unguarded copy of the same bug**. If 7e
needs a cost figure anywhere, call `snapshotCost`. Do not re-derive one.

---

## 3. Still open, and now owned by 7d / 7e / Phase 8

Carried from the first handoff, plus what this session added.

1. **`PROCTORING_DEFAULTS` is global and unversioned.** A published Strict test that set no
   overrides resolves against *today's* table, so changing a default silently changes how an
   already-published test behaves. **Cheap now, expensive after 7e.** Still unfixed.
2. **The `desktop_only` gate parses a human sentence.** `exam.tsx` extracts it with a regex from
   `proctoringRequirements`'s output. 7c Task 3 made the test consume the **real** sentence so a
   reword breaks a test rather than the gate — but the coupling stands. The implementer's opinion on
   reading `resolved.desktopOnly` directly is in the 7c ledger. **Worth settling before 7e adds more
   readers.**
3. **The `min={1}` integer boxes commit schema-rejecting values with no `issueFor` surface.** 7b left
   this deliberately: it is faithful to `TimingPanel`'s existing hole, and fixing one panel of six
   makes the inconsistency worse. Fix all six or none.
4. **A profile change silently discards an imported `face_check: true`**, partly undoing `Q3`'s
   round-trip intent. This is the interaction of two accepted rulings — Task 3's
   clear-with-confirmation and `Q3`'s round-trip — not a defect in either. **A design question, not
   a bug.**
5. **The microphone's noise threshold** is a constant in 7d, not a sixteenth control.
6. **Where `observed: false` appears** beyond the attempt row — Phase 8 owns the review page.
7. **A contact route for a locked candidate** — no support-email field exists in the schema. The
   advisory row stays advisory and the overlay says "contact the organiser".

---

## 4. Traps this session found, on top of the first handoff's list

### A stale `dist/` makes a core export import as `undefined`

`@pariksha/core` and `@pariksha/db` are consumed **through the built package**. A clone whose
packages were built before an export existed resolves it to `undefined`, and the failure surfaces
far from its cause — in 7c it was an opaque `TypeError` thrown inside zod by `z.enum(undefined)`,
with a stack trace pointing at the route file.

```
SITE_URL='https://pariksha.example' npx turbo run build --filter=@pariksha/core --filter=@pariksha/db
```

**This also governs probes.** A probe that edits a core constant or a core string and does **not**
rebuild is testing the old build — it proves nothing and reports success. Rebuild on the break *and*
on the restore. 7b's constant probes and 7c's sentence probe both needed this.

### Two clones cannot run full suites at once

`apps/web`'s vitest caps at `maxWorkers: min(availableParallelism(), 4)` **per run**, sized for one
run on this machine. Two clones verifying at once oversubscribes the box: a full suite went red with
**37 failures across 5 unrelated files**, tests that normally take milliseconds taking 10–170 s, and
18–24 lingering node processes. Three attempts each failed a *different* set of files.

**Use `--no-file-parallelism`** for any full-suite run. It is correctness-neutral, verifies the whole
suite rather than a sample, and is reliable under load. Parallel clones remain safe for **editing**;
they are unsafe for **verification**. Never wave a red suite through as "probably flakes" without
that check — the per-file isolated re-run is the cheap discriminator.

### jsdom cannot see three things this phase kept assuming it could

Each of these produced a test that asserted nothing, in three separate tasks:

- **No external stylesheet is applied.** `getComputedStyle(el).appearance` / `.pointerEvents` /
  `.userSelect` resolve to `""`. Use `paintsIn(element, prop, RESOLVED[page])` from
  `apps/web/test/css-chain.ts` — `admin.html` for the organiser chain, `exam.html` for the candidate
  runtime.
- **`getBoundingClientRect` returns all zeros**, so any `D8` no-reflow assertion is `0 === 0` and
  passes whatever the layout does. Geometry claims belong in `apps/web/e2e/measurement/`, which holds
  five specs for exactly this.
- **No Fullscreen API.** `document.fullscreenElement` must be installed with `Object.defineProperty`;
  `vi.spyOn(document, "fullscreenElement", "get")` cannot work.

### A `queryBy*` expecting `null` passes for free when the query is wrong

**Three tasks shipped this defect before it was caught each time.** The worst case queried
`role="group"` for a panel that computes to `region`, so the assertion could never fail no matter how
broken the behaviour.

**Every negative assertion needs a positive control beside it**: prove the query matches when the
thing *is* present, then assert `null` when it is not. The branch review audited all fourteen on 7b
and each now has one. Hold 7d and 7e to the same bar.

### An `axe` test can pass against broken markup

Breaking a label and watching your own `getByLabelText` throw proves that RTL works, not that `axe`
caught anything. 7b Task 5's probe did it properly: break the association, then use a **role-based**
query to bypass RTL's throw, and confirm `axe` itself reports
`"Form elements must have labels (label)"`. Do that, or the gate is decoration.

Related: **"both grounds" is one pass run twice** unless something actually differs. Toggling
`data-theme` in jsdom injects no stylesheet and `colour-contrast` cannot run, so two iterations
produce an identical DOM and rule set. 7b now ships one honest pass with a comment pointing at
`contrast-usage.test.ts`, where real per-ground ratios are computed from the resolved stylesheet.
**One honest pass beats two implying coverage nobody has.**

### Commit before you verify

Three implementers were interrupted mid-task by spend limits this session and two more stopped while
waiting on a background suite. Every tree was recovered **because it was committed or committable**.
The verification is recoverable; the tree is not. Put "commit as soon as you have something coherent,
then refine" in every dispatch, and never hold a finished tree hostage to a test run.

---

## 5. Before 7e ships — the owner's step, and it is still outstanding

`deploy.yml` applies no migrations by design. `node deploy/cloudflare/setup.mjs` does, and 7a added
`0008_attempt_integrity.sql`. Until it runs against the live D1, any deployed route touching
`attempt.integrity_flag` or `attempt.observed` fails with `D1_ERROR: no such column`.

**7e writes those columns.** Nothing on `main` reads them today, so `main` is not broken — but 7e
must not be the plan that discovers this.

The sandbox classifier refuses this command for the agent. The owner runs it:

```
! node deploy/cloudflare/setup.mjs
```

then commits the `database_id` it writes into `wrangler.toml`.

---

## 6. What the owner validates by hand

`Q10` settled that CI proves everything provable without hardware, and three things are not. Each
result goes in the **roadmap's Phase 7 row**, not only in a task report.

- **`AC-17`** — an Android phone, an iPhone and a desktop-mode iPad, each refused with `desktop_only`
  on and admitted with it off. **The pure decision is now table-tested** in 7c Task 3, with an
  explicit `refused:` literal per row.
- **`AC-19`** — a camera physically unplugged mid-attempt. 7d Task 3 automates the track-ended and
  black-frame paths.
- **`AC-20`**'s real-encoder figure — 7d Task 2 measures the JPEG quality landing nearest the 25 KB
  now pinned as `SNAPSHOT_KB` in `packages/core`. That constant is a **public promise**
  (`sections/signal/Tail.tsx` states it), imported by two readers; if the measurement disagrees with
  it, that is a finding about the promise, not a constant to retune quietly.

---

## 7. Cut order, unchanged

Already cut before planning: **`Q3`'s on-device face check.** MediaPipe needs `'wasm-unsafe-eval'`
and `hosting.test.ts`'s own comment reads *"A design that needed a CSP change would be the wrong
design."* `face_check` ships as a disabled control naming Phase 8. 7c Task 3 corrected the landing
copy that still claimed face counting ran.

- **Cut first:** `Q12b`'s noise monitoring (7d Task 5), if the worklet cannot be made free on a weak
  machine. The microphone permission and its browser indicator survive; only the event goes.
- **Cut second:** `Q9`'s watermark (7c Task 5). Paint, and the only control whose absence changes
  nothing a candidate can do.

**Nothing else has a cut order. A third cut stops and asks.**

## 8. When to stop and ask

Four classes, and only these: an irreversible operation; a security-sensitive action; a side effect
outside the worktree (**a merge to `main` is the owner's**); or a plan so broken that every path
forward is a guess. Everything else is a ruling you take and record as
`Ruling: <what> — <why> — <cost if wrong>`.
