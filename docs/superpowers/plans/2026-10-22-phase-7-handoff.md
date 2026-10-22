# Phase 7 — handoff after 7a

**Date:** 2026-10-22 · **Written for:** the agent that executes 7b, 7c, 7d and 7e.

Read this before the plan you are about to run. It says what 7a actually shipped — which is
not in every respect what 7a's plan said it would — what is still open, and the traps that
cost this phase real time already.

**Sources, in authority order.** The spec binds; the plan argues from it; this handoff
records what execution found.

1. [`../specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md) — the approved design. Twelve rulings. §3 is the pre-planning read.
2. [`2026-10-21-phase-7-README.md`](2026-10-21-phase-7-README.md) — the plan index, the order, and the shared-interface table.
3. Your plan: [7b](2026-10-21-phase-7b-the-editor.md) · [7c](2026-10-21-phase-7c-the-gates.md) · [7d](2026-10-21-phase-7d-the-eye.md) · [7e](2026-10-21-phase-7e-the-consequences.md)
4. This file.

---

## 1. Where the phase stands

| plan | state |
| --- | --- |
| **7a — the contract** | **Merged 2026-10-22** as [#205](https://github.com/SriSatyaLokesh/pariksha/pull/205), squashed to `16fc4f5`. Closed #77. |
| 7b — the editor | Not started. Depends on 7a only. **Unblocked.** |
| 7c — the gates | Not started. Depends on 7a only. **Unblocked.** Independent of 7b — either order, or in parallel in two clones. |
| 7d — the eye | Not started. Needs 7c's queue, layer and `ProctoringOverlay`. |
| 7e — the consequences | Not started. Needs a, c and d. |

**One deployment step is outstanding.** `deploy.yml` applies no migrations by design;
`node deploy/cloudflare/setup.mjs` does, and 7a added `0008_attempt_integrity.sql`. Until that
runs against the live D1 database, any deployed route touching `attempt.integrity_flag` or
`attempt.observed` fails with `D1_ERROR: no such column`. Nothing in 7a's own code reads those
columns, so `main` is not broken today — but **7e writes them**, and it must not be the plan
that discovers this. Confirm the step has run before 7e starts.

---

## 2. What 7a shipped, as built

The README's "What is shared across plans" table is still right about *names*. These are the
details it cannot carry, and several differ from what the plans were written against.

### `@pariksha/core` — `packages/core/src/proctoring.ts`

```ts
resolveProctoring(input?: { profile?; overrides? }): ResolvedProctoring  // every field present
proctoringRequirements(resolved): string[]
PROCTORING_DEFAULTS: Readonly<Record<ProctoringProfile, ResolvedProctoring>>
PROCTORING_EVENTS, ProctoringEventType, VIOLATION_EVENTS, FAILURE_EVENTS, isViolation()
```

- **Resolution never uses `||`, and never a bare `??` on an overridable key.** `overrideOr`
  reads `key in overrides && overrides[key] !== undefined`. `snapshot_interval_seconds: 0`
  means off and must survive; an explicit `undefined` behaves as an absent key. There is a
  test for each, and the `||` form was probed and proven to fail one.
- **No reader branches on `profile` to decide what to enforce.** One read survives, in the
  publish checklist, and it carries a comment saying why it is allowed and that it is not a
  licence for an enforcement reader. Do not copy it into one.
- **`PROCTORING_DEFAULTS[profile] ?? PROCTORING_DEFAULTS.off`** — the lookup is total, because
  this function is called from the browser against payload-shaped input.
- **`faceCheck` resolves `false` under every profile**, by a deliberate commented refusal, even
  when the document says `true`. The field still validates, imports, clones and exports.
- **The defaults table is pinned by three literal assertions**, one per profile. If you change
  a default, you change those too — that is the point of them. `violationLimit: 5`,
  `cameraOutageSeconds: 120` and `multiFaceSnapshots: 2` are `Q6`'s three integrity thresholds
  and had no assertion anywhere before.

**`proctoringRequirements` differs from the plan in two ways you will meet:**

- It emits a **browser** sentence — "Use a fully updated Chrome, Edge, Firefox or Safari." —
  whenever at least one other requirement is enabled, and **it names no device class**. The
  `desktopOnly` line is the only line that claims a device, and only when that is true.
  A test with `desktop_only` off is a supported configuration a phone may take (`Q1a`), and a
  sentence telling that candidate to use a laptop is false. 7c owns the browser check itself;
  if you give the floor a version number, this is the sentence that states it.
- **The identity-photo line and the images line are gated on `requireCamera`.** `Q11b` says
  `require_camera` false means `getUserMedia` is never called for video at all, so a photo that
  cannot be taken is not promised to the candidate. The organiser is told instead, by a
  checklist row (below).

### `schemas/test-1.json`

Fifteen override keys. The three 7a added are `camera_outage_seconds` (integer, min 1),
`multi_face_snapshots` (integer, min 1) and `require_microphone` (boolean); `snapshot_interval_seconds`
relaxed to `minimum: 0`. [ADR 0011](../../adr/0011-proctoring-overrides-grow-by-three.md) records
why that needed no format bump, and what *would*: a required key, or a narrowed constraint.

The two thresholds' descriptions say they mark the attempt **`high_risk`** — they are integrity
thresholds, not violation counters. `camera_lost` is separately a violation event. Keep the two
axes apart in your copy too; that separation is the whole reason the flag got its own columns.

### `packages/db`

`attempt.integrity_flag` (`text NOT NULL DEFAULT 'clean'`) and `attempt.observed`
(`bool NOT NULL DEFAULT true`), in SQLite/D1 and Postgres, in `TABLE_MANIFEST`, and in the
committed migration bundle.

```ts
export type IntegrityFlag = "clean" | "review" | "high_risk";
setIntegrity(db, workspaceId, { attemptId, integrityFlag: IntegrityFlag, observed })
  : Promise<{ updated: boolean }>
```

- The **writer's input** is the union; `getAttempt`'s **return** is `string`, deliberately — the
  database can hold anything and a reader that narrows that would be lying. There is no `CHECK`
  constraint and no migration for one.
- `{ updated }` tells you whether a row was actually written. 7e's recompute needs it: a
  no-op on a deleted attempt is not a written verdict.
- **`attempt.flag` is a different axis.** It already carries `"scoring_blocked"` from
  `apps/api/src/run/submit.ts`. An integrity write must never touch it; there is a test.

### `LandingPayload.proctoring`

```ts
proctoring: { profile: ProctoringProfile; requirements: string[] }
```

A **replacement**, not an addition. The old bare profile string and `exam.tsx`'s
`PROCTORING_LABEL` are gone, and so is the hand-written `<dt>Devices</dt><dd>A laptop or
desktop, with a mouse or trackpad.</dd>` row — false under a supported configuration (`Q9c`).

- **The resolved object is not on this payload.** Only the profile name and the sentences. The
  landing payload is reachable by anyone holding the link; the enforcement object rides
  `GET /api/v1/run/attempt`, which is `attempt`-authority. `scrub-scan` has an assertion that
  no override object appears in a candidate-reachable body — it was probed, and it fails when
  the raw overrides are shipped. **If you put the resolved object on a public payload, that
  test is what will stop you, and it is right.**
- `profile` is carried for display and currently has **no reader**. It is in the README's shared
  contract, so it stays — but if you find yourself writing `payload.proctoring.profile === …`
  to decide behaviour, that is the branch `Q1` forbids.
- `apps/web/test/exam/landing.test.tsx`'s `landingFixture` carries the real Standard sentences,
  copied verbatim from `apps/api/test/run/landing.test.ts` so the two cannot drift. Keep them
  in step.

### The publish checklist — **four** advisory rows, not three

`apps/api/src/publish/checklist.ts`, all `advisory`; Phase 7 adds no blocking row.

| id | fires when |
| --- | --- |
| `proctoring_strict_no_camera` | profile is Strict and `require_camera` is off |
| `proctoring_snapshot_cost` | images per candidate exceed 200; states images, megabytes **and uploads** |
| `proctoring_lock_without_recourse` | `violation_action` is `lock` |
| `proctoring_capture_without_camera` | `!requireCamera && (identityPhoto \|\| snapshotIntervalSeconds > 0)` — **added during 7a**, not in the plan |

The cost figure counts **interval snapshots only** — the identity photo is one image inside the
"≈", matching the spec's own worked example. 25 KB per image, from the figure
`apps/web/src/sections/signal/Tail.tsx` already states publicly; that is a pinned promise, not a
constant to retune. Megabytes are decimal (1000), as the comment there explains.

### `packages/core/src/types.ts`

`Test.proctoring?: { profile?: ProctoringProfile; overrides?: ProctoringOverrides }` is now
modelled, so `TestSettings` (an `Omit` of `Test`) carries it and `settings.proctoring` needs no
cast. Three casts were retired by this. Do not add a fourth.

---

## 3. Open questions you will hit, and who owns them

**Decide the first before 7b or 7c is planned in detail.** The rest are flagged so they are not
rediscovered as bugs.

1. **`PROCTORING_DEFAULTS` is global and unversioned.** `Q1`'s mitigation — "a published attempt
   resolves against the version it pinned, exactly as its paper does" — holds only for
   *explicitly set* override keys, which the frozen version does pin. A published Strict test
   that set no overrides resolves against *today's* table, so changing a default silently changes
   how an already-published test behaves. Either accept that in writing, or have publish
   materialise the resolved set into the frozen version. **Not 7a's to fix; it is cheap now and
   expensive after 7e.**
2. **`Q7b`'s per-type detail shapes do not exist.** The spec says event types are a closed union
   *"and each type has a declared detail shape"*. 7a shipped the union only, correctly — the plan
   did not ask for the shapes. The plan that **emits** each event should declare its detail
   shape: 7c for the gate events, 7d for camera, snapshot and noise, 7e for the lifecycle ones.
   Do not leave `detail` as free-form JSON for Phase 8 to reverse-engineer.
3. **`block_copy_paste` and `watermark` produce no requirement sentence.** The plan's fixed order
   of eight excluded them, so this matches the plan — but `Q1b`'s reason ("a candidate learns it
   before the timer") applies to a blocked paste and to their own email across the page as much
   as to a camera. If 7c adds them, add them to `proctoringRequirements`, not to a second list.
4. **No event has a "returned" counterpart for `window_blur` / `visibility_hidden`.**
   `fullscreen_exit`/`fullscreen_restore` and `camera_lost`/`camera_restored` pair up; these two
   do not. `Q6`'s thresholds do not need one, so it is not a gap today — but Phase 8's monitor
   will want "away for 40 s", and adding a member to a closed union after four plans switch on it
   is the expensive direction. Decide in 7c, when you write the emitter.
5. **The microphone's noise threshold** is a constant in 7d, not a sixteenth control. A control
   waits for someone to ask.
6. **Where `observed: false` appears** beyond the attempt row — Phase 8 owns the review page.
7. **A contact route for a locked candidate** — no support-email field exists anywhere in the
   schema. The row stays advisory and the overlay says "contact the organiser". Inventing a
   field is a branding change belonging to whoever owns organiser contact details.

### Deferred minors from 7a's reviews — judged to stand, not forgotten

- `exam.tsx` keys the requirements list on the sentence string (unique by construction).
- The cost row's `field` names only `snapshot_interval_seconds`; duration is the other knob.
- `docs/test-format.md`'s interval row says "no uploads" where the schema qualifies that
  `identity_photo` still yields one capture — the schema is the normative text and is correct.
- The Sections list and the device-report list in `exam.tsx` have `list-style: none` without
  `role="list"`, losing list semantics in WebKit. The **requirements** list was fixed; those two
  were deliberately left alone. If 7c touches that area, fixing all three is a one-attribute job.
- `apps/api/test/run/start.test.ts` has a **real flake** — a random-id substring collision. It
  predates this phase and is unrelated to it. If it goes red once, re-run before investigating.

---

## 4. Traps that have already cost this project sessions

### Build and test

- `pnpm build` needs `SITE_URL`: `SITE_URL='https://pariksha.example' pnpm build`.
- **`pnpm test --force` does not work.** Use `npx turbo run test --force --concurrency=1`.
- **`apps/api`'s test script is `vitest run && vitest run -c vitest.workers.config.ts`.**
  `test/worker.test.ts` is excluded from the default config and runs only under the second,
  against a Miniflare D1 binding. A focused run or a `--filter=@pariksha/db` can be entirely
  green while the branch is red — this happened in 7a and cost a fix round.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`. Not a knob.
- **A stale `dist/` in `@pariksha/core` or `@pariksha/db` makes a 7a export import as `undefined`.** A
  clone whose packages were built before 7a landed resolves `PROCTORING_EVENTS`, `resolveProctoring`
  and friends to `undefined` **through the package boundary**, and the failure surfaces far from its
  cause — in 7c it was an opaque `TypeError` thrown inside zod by `z.enum(undefined)`, with a stack
  trace pointing at the route file. Every remaining plan imports 7a exports the same way. Before
  debugging anything of that shape:
  `SITE_URL='https://pariksha.example' npx turbo run build --filter=@pariksha/core --filter=@pariksha/db`.
- **`findBy*`/`waitFor` carry their own 1 s `asyncUtilTimeout`**, independent of the 10 s
  `testTimeout`, and it is the bar an async query actually fails against. Also not a knob — fix
  the test's approach.

### Migrations

A new migration touches **five** things, not two:

1. `packages/db/migrations/sqlite/NNNN_*.sql` — **D1 takes one `ADD COLUMN` per `ALTER`**,
   statements separated by `--> statement-breakpoint`; SQLite refuses `ADD … NOT NULL` without a
   literal `DEFAULT`; **no `PRAGMA` of any kind**.
2. `packages/db/migrations/pg/NNNN_*.sql` — the sibling, same defaults so the dialects agree.
3. Both dialect modules in `packages/db/src/schema/`.
4. `packages/db/src/schema/columns.ts`'s `TABLE_MANIFEST` — `parity.test.ts` compares **three**
   sources and a column in two of three fails it. Use the declared `ColumnClass` vocabulary
   (`bool` is SQLite `integer` / Postgres `boolean`).
5. `packages/db/src/migrations.generated.ts` — regenerate with
   `node packages/db/scripts/bundle-migrations.mjs`, never by hand;
   `migrations-bundle.test.ts` asserts it is byte-identical to the generator's output.

Plus `apps/api/test/worker.test.ts`, which hard-codes the migration **filename list** and the
`migrations: N` count the health endpoint returns. Both are deliberately literal ("Named, not
counted"). Extend them; never make them dynamic.

`no-d1-hostile-sql.test.ts` greps only for `PRAGMA`. It does **not** catch a merged
`ALTER TABLE … ADD COLUMN a, ADD COLUMN b`. `migrate.test.ts` does, by executing the SQL against
real SQLite, which rejects exactly what D1 rejects. This was probed in 7a; a second regex would
restate what running the SQL already proves.

### Routes

Every mounted route needs a **measured** `ROUTE_BUDGETS` entry and a `ROUTE_AUTH` declaration —
`budget.test.ts` and `routeAuthorities()` both read the live route table, and `scrub-scan` derives
its endpoint list from `ROUTE_AUTH` at run time, so a route added without a declaration fails CI.
**An R2 binding operation is a subrequest** against the 50-per-request limit (`instrument.ts`
counts `put` and deliberately does not count `signedUrl`). 7a added no route; 7c, 7d and 7e each do.

### Design gates (7b, 7c and 7d all paint)

- **`DESIGN.md` is the only place a colour is declared.** `no-hex-colors.test.ts` fails a raw hex
  anywhere else and **strips only `/* */` comments**, so an issue reference in a CSS comment must
  be in a block comment.
- The organiser's surfaces paint on the **Signal** ground; the candidate's overlays, warnings and
  watermark take **voltage**, the runtime's accent. **An accent may not cross grounds.** Every
  colour-setting selector needs a `SURFACE` entry in `contrast-usage.test.ts` — **two**, one per
  ground.
- `css-chain.ts` is the one `@import` resolver and strips comments, so a rule named only in prose
  cannot satisfy a scan. `CHAINS` decides which stylesheet a component's rules live in.
  `THEME_SELECTOR` fixes the two grounds as `:root` and `:root[data-theme="light"]` as the only
  selectors that may assign a semantic name. `SEMANTIC_NAMES` is a contract list to consume, not
  extend.
- `D8`'s frozen geometry: the candidate runtime's layout does not move. Overlays and the
  watermark sit **over** it; they do not reflow it.
- `axe` on every new surface, and `component-dimensions.test.ts` pins sizing for anything new.
- `Q2b` rules the overlay case explicitly: `role="alertdialog"`, `aria-modal="true"`, focus moved
  and trapped, an accessible name stating the condition and the remedy, and **no Escape handler**.
  `axe` does not test Escape, so the focus trap needs a behavioural test of its own.

### Repository

- **Never create a git worktree.** pnpm junctions have twice deleted `packages/core/**` and
  `packages/db/**`. There are three fixed clones — `pariksha`, `pariksha-wt1`, `pariksha-wt2` —
  and no others. To read a frozen commit: `git show <sha>:<path>`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`, never the Claude account email.
- **Never `git add -A`** — untracked phase notes live in these trees.
- Every merge to `main` needs `node deploy/cloudflare/setup.mjs` afterwards, and the
  `database_id` it writes into the local `wrangler.toml` must be committed.

---

## 5. How 7a was executed, and what worked

Use `superpowers:subagent-driven-development`: one fresh implementer per task, a fresh reviewer
after each, then a whole-branch review on the most capable model, one fix wave, one scoped
re-review. Every subagent invokes the **ponytail** skill before anything else. 7b, 7c and 7d
paint — use **ui-ux-pro-max** for the styling work in those.

What earned its keep in 7a, in rough order of value:

- **A pre-flight scan against the tree, before Task 1.** Seven of 7a's plan's own file paths,
  helper names and test assertions did not match the tree — the plan named five helpers that do
  not exist, two file paths that are not there, and one piece of arithmetic that contradicted its
  own test. Every one was found by reading the files before dispatching, and each became a ruling
  in the ledger rather than a surprise mid-task. **Do this first. It is the cheapest hour in the
  plan.**
- **Probe verification, as standard.** Each new guard broken on purpose once to prove it can
  fail, then restored, with the failure line recorded. Seven probes in 7a; one of them
  (`no-d1-hostile-sql` not catching a merged `ALTER`) found a real blind spot that reading alone
  would have missed. No probe may appear in a commit.
- **Telling every reviewer two things explicitly:** that `git show <sha>:<path>` is the only
  alternative source for a file, and that they **must not run the test suite** — the implementer's
  report is the test evidence. Two reviewers on this project each lost an hour to re-running it.
- **Rulings, not stalls.** Fourteen decisions were taken and recorded as
  `Ruling: <what> — <why> — <cost if wrong>` rather than queued for the owner. The owner reads the
  list at the end and reworks what they disagree with. A session parked on a question costs a day
  and buys nothing.
- **Commit after every task, before the review.** An uncommitted subagent tree is unrecoverable.

7a's full ledger — every ruling, every probe, every deferred minor — is at
`.superpowers/sdd/phase-7a/progress.md` in the clone it ran in (git-ignored; it does not travel
between clones). This handoff carries forward everything from it that outlives the plan.

---

## 6. What the owner validates by hand

`Q10` settled this: CI proves everything provable without hardware, and three things are not.
Each result goes in the **roadmap's Phase 7 row**, not only in a task report.

- **`AC-17`** — an Android phone, an iPhone and a desktop-mode iPad, each refused with
  `desktop_only` on and admitted with it off. The pure decision is table-tested in 7c Task 3.
- **`AC-19`** — a camera physically unplugged mid-attempt. The track-ended and black-frame paths
  are automated in 7d Task 3.
- **`AC-20`**'s real-encoder figure — 7d Task 2 measures the JPEG quality landing nearest the
  25 KB already promised publicly, and records it.

## 7. Cut order

Already cut before planning: **`Q3`'s on-device face check.** Not a contingency — MediaPipe needs
`'wasm-unsafe-eval'`, and `hosting.test.ts`'s own comment reads *"A design that needed a CSP change
would be the wrong design."* `face_check` ships as a disabled control naming Phase 8.

**Cut first:** `Q12b`'s noise monitoring (7d Task 5), if the worklet cannot be made free on a weak
machine. The microphone permission and its browser indicator survive the cut; only the event goes.

**Cut second:** `Q9`'s watermark (7c Task 5). Paint, by its own ruling, and the only control whose
absence changes nothing a candidate can do.

**Nothing else has a cut order. A third cut stops and asks.**

## 8. When to stop and ask

Four classes, and only these: an irreversible operation; a security-sensitive action; a side
effect outside the worktree (**a merge to `main` is the owner's**); or a plan so broken that every
path forward is a guess. Everything else is a ruling you take and record.
