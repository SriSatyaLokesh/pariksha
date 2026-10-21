# Phase 7 — proctoring: design

| | |
| --- | --- |
| **Status** | Draft — awaiting the owner's approval. Every ruling is settled, `Q4` included. |
| **Date** | 2026-10-21 |
| **Implements** | [PRD.md](../../PRD.md) `P-01`–`P-10`, `AC-17`–`AC-21` |
| **Builds on** | [Phase 6.5 design pass](2026-10-20-phase-6-5-design-pass-design.md) — its rulings bind every surface this phase adds |
| **Roadmap** | [ROADMAP.md](../../ROADMAP.md#phase-7--proctoring) |

## Contents

1. [Intent](#1-intent)
2. [Goals, non-goals, anti-goals](#2-goals-non-goals-anti-goals)
3. [What already exists](#3-what-already-exists)
4. [`Q1` — the profile is a preset, the overrides are the truth](#4-q1--the-profile-is-a-preset-the-overrides-are-the-truth)
5. [`Q2` — a stack failure never blocks; a camera requirement does](#5-q2--a-stack-failure-never-blocks-a-camera-requirement-does)
6. [`Q3` — the face check is pre-cut](#6-q3--the-face-check-is-pre-cut)
7. [`Q4` — the snapshot upload path](#7-q4--the-snapshot-upload-path)
8. [`Q5` — lock ships with a minimal unlock](#8-q5--lock-ships-with-a-minimal-unlock)
9. [`Q6` — the integrity rule is three numbers, in their own columns](#9-q6--the-integrity-rule-is-three-numbers-in-their-own-columns)
10. [`Q7` — events use the writer that already exists](#10-q7--events-use-the-writer-that-already-exists)
11. [`Q8` — the proctoring editor is the sixth setting row](#11-q8--the-proctoring-editor-is-the-sixth-setting-row)
12. [`Q9` — the watermark is paint, and the device gate is one function](#12-q9--the-watermark-is-paint-and-the-device-gate-is-one-function)
13. [`Q10` — how this phase is proved](#13-q10--how-this-phase-is-proved)
14. [`Q11` — every observation is off-switchable, and the cost is on the screen](#14-q11--every-observation-is-off-switchable-and-the-cost-is-on-the-screen)
15. [`Q12` — the microphone monitors level and records nothing](#15-q12--the-microphone-monitors-level-and-records-nothing)
16. [What Phase 7 inherits from 6.5](#16-what-phase-7-inherits-from-65)
17. [Constraints the builder must respect](#17-constraints-the-builder-must-respect)
18. [Left to the builder](#18-left-to-the-builder)
19. [The plan split](#19-the-plan-split)
20. [Cut order, and what this phase does not fix](#20-cut-order-and-what-this-phase-does-not-fix)

## 1. Intent

Pariksha can run a test today. It cannot tell an organiser anything about *how* the test was
taken. Phase 7 is the first phase that observes an attempt rather than serving it.

Almost all of `schemas/test-1.json`'s `proctoring` block already imports, clones and exports
while enforcing nothing. The `event` and `snapshot` tables have sat in `packages/db` since
Phase 2; `event` has a repository writer that no route calls, and `snapshot` has no
repository function at all. Phase 7 is the phase that makes the written settings true.

**Why now.** Proctoring is what separates a quiz tool from an assessment tool, and it is the
last thing in the product that touches the candidate runtime's critical path. Phase 8's
monitor *watches* the events this phase emits; building the monitor over an empty table
would be building a window onto nothing. Phase 6.5 has also just finished, so every surface
this phase adds is drawn once, on the finished design system, rather than drawn and redrawn.

**The sentence the whole phase answers to.** A candidate whose model will not load, whose
upload fails, or whose event ingest is down must still be able to answer every question and
submit. Proctoring is evidence for the organiser. Its **one** deliberate exception is
`Q2`'s camera requirement, which an organiser opts into knowingly and a candidate is warned
about before the timer starts.

## 2. Goals, non-goals, anti-goals

### Goals

- `G1` — every control under `proctoring.overrides` has a reader that honours it, and the
  three profiles resolve to override sets through one pure function.
- `G2` — the candidate-side enforcement: device and browser gating, fullscreen, window-leave
  detection, copy/paste/right-click blocking, the watermark, camera and identity photo,
  interval and violation snapshots, microphone level monitoring, extra-monitor detection.
- `G3` — the server side: event ingest, snapshot objects in private storage, violation
  counting, the configured violation action, and the integrity flag on every attempt.
- `G4` — the organiser can set all of it from the builder before publishing, can switch every
  observation off independently, and can see what each setting costs them.
- `G5` — `AC-17` through `AC-21` pass, each by the means §13 names for it.

### Non-goals

- The live monitor, proctor actions and the per-attempt review page — Phase 8.
- `C-10`'s proctor broadcast to candidates — Phase 8 owns the sender.
- The snapshot ZIP export and the events CSV — Phase 8 (`R-09`, `R-10`).
- Retention and deletion of snapshots and events — Phase 8's retention job. Phase 7 writes
  rows and objects and leaves their expiry to the phase that owns expiry.
- On-device face counting — **pre-cut**, see `Q3`.
- Any grading consequence. An integrity flag never changes a score.

### Anti-goals

- `AG1` — **a proctoring stack failure must never block answering.** A model that will not
  load, an upload that 500s, an ingest that is down: each records what it can, raises one
  organiser-facing flag, and gets out of the way. `Q2`'s camera requirement is the single
  stated exception and is written as one.
- `AG2` — **no video and no audio is ever recorded or stored.** `P-06` is a promise made in
  the consent copy *and already made publicly* on the landing page. A code path that could
  persist either is a defect regardless of whether it is reachable.
- `AG3` — **no biometric template is stored.** No face embedding, landmark set, descriptor or
  voiceprint anywhere — not in a table, not in storage, not in `localStorage`, not in an
  event's detail JSON.
- `AG4` — proctoring code must not be able to crash the runner. A thrown error inside a
  signal path that takes down `ExamApp` is `AG1` wearing a different coat.
- `AG5` — never make a gate green by moving a bar (inherited, 6.5 `AG2`).

## 3. What already exists

Read this before planning. It is the difference between extending the runtime and rebuilding
it, and every row here was verified against the tree on 2026-10-21.

| exists | where | state |
| --- | --- | --- |
| `proctoring.profile` + 12 overrides | `schemas/test-1.json` §`proctoring` | Imports, clones, exports. `allow_calculator` is read by `run/attempt.ts`. **`profile` already has three more readers** — `routes/run.ts:141-161` ships it in the landing payload, `web/src/lib/run.ts:34` types it, and `web/src/routes/exam.tsx:111,193` renders it through `PROCTORING_LABEL`, **branching on `profile`**, which is exactly what `Q1` forbids. `Q1b` is therefore a *replacement* of a live payload field, not an addition, and needs a `scrub-scan` replay. |
| `appendEvents()` — server-minted `evt_` ids, **capped at 10 events per request** | `packages/db/src/repo/attempts.ts:356`, exercised by `packages/db/test/repo/identifiers.test.ts:78` | A real writer. No *route* calls it. `Q7` uses it as-is. |
| `event` table — attempt, type, detail JSON, client ts, server ts | `packages/db/src/schema/{sqlite,pg}.ts` | `clientTs` and `serverTs` both exist because a client clock cannot be trusted and a server clock cannot say when the candidate left the window. No client-id column, and `id` is the primary key with no attempt-scoped unique index. |
| `snapshot` table — attempt, storage key, taken at, reason, face count | same | **No repository function at all.** `faceCount` is nullable, which is `Q3`'s shape already in the schema. |
| `attempt.flag`, `NOT NULL`, **already carrying a grading value** | `packages/db/src/schema/sqlite.ts:250`; written as `"scoring_blocked"` by `run/submit.ts:357` on a `bounded.ts` refusal | `Q6` must not clobber it. |
| `SubmitReason = "manual" \| "timeout" \| "limit"` | `apps/api/src/run/submit.ts:58` | `"limit"` is **already reserved for this phase**. `Q5`'s `auto_submit` collects it rather than adding a reason. |
| `deviceReport()` over `innerWidth >= 1024`, `matchMedia("(pointer: fine)")` and a UA family | `apps/web/src/routes/exam.tsx:73` | Reports and never blocks; its own comment says Phase 7 refuses. `Q9b` extends this function; it does not write a second one. |
| `ROUTE_BUDGETS` | `apps/api/src/app.ts:77` | Every mounted route needs a **measured** subrequest budget or `budget.test.ts` fails. Four new routes is four measurements, and the plan budgets for taking them. |
| `attempt` route authority, with its own middleware | `apps/api/src/app.ts` `ROUTE_AUTH` | Every new candidate-side route here is `attempt`. `routeAuthorities()` reads the live route table, so a route added without a declaration fails CI. |
| Candidate response scrubbing, derived mechanically from `ROUTE_AUTH`; `INTERNAL = ["wsp_","bnk_","ver_","usr_"]` | `apps/api/test/run/scrub-scan.test.ts` | **Phase 7's first task re-runs this before adding a route.** No candidate-reachable response may carry a workspace id — which constrains `Q4`'s storage key. |
| `StorageAdapter.signedUrl` — signed **reads**, 600 s | `packages/storage/src/adapter.ts` | **No signed PUT.** And `verifyDiskSignature` has **no caller outside its own test**: no `/files` route is mounted, so `node.ts:27`'s `baseUrl` 404s today. The disk read path was never wired. |
| The production adapter | `apps/api/src/index.ts:42` — `r2BindingAdapter(env.FILES)` | Built with **no signer**, and `r2.ts` throws without one. `signedUrl` has zero production callers. The deployed Worker cannot presign anything today. |
| The shipped CSP — `connect-src 'self'`, no absolute URL permitted | `apps/api/src/middleware/security.ts`, `apps/web/public/_headers`, asserted by `apps/web/test/hosting.test.ts` | Its comment reads: Phase 7 adds `blob:` to `img-src` for camera frames **and nothing else**. `routes/media.ts` already decided the mirror question for reads — it proxies bytes rather than 302, because the policy would kill the follow-up. |
| `OrganiserShell`, `SettingRow`, `PANEL_KEYS` (exactly five) | `apps/web/src/`, from 6.5c and 6.5d | `Q8` adds the sixth. |
| The publish checklist — one function behind `GET …/checklist` and `POST …/publish`, with `blocking`/`advisory` severity | Phase 5 Task 12 (#64) | `Q1c`, `Q5` and `Q11` add advisory rows. This phase adds **no** blocking row. |
| A **public, shipped promise** of the snapshot spec | `apps/web/src/sections/signal/Tail.tsx:125` | "320×240 JPEG snapshots, about 25 KB each, every sixty seconds and on each violation, stored in a private bucket behind signed URLs that expire in ten minutes." This pins the encode target and describes a signed **read** path. The implementation must match the sentence already sold, or the sentence changes with an ADR. |
| `bounded.ts` — the execution bound on grading | `apps/api/src/run/bounded.ts` | The precedent for a refusal that costs a flag, not a candidate's marks. |

## 4. `Q1` — the profile is a preset, the overrides are the truth

> **Ruling.** `profile` supplies **defaults** for the overrides and has no independent effect.
> Resolution is one pure function in `packages/core`, `resolveProctoring(profile, overrides) →
> ResolvedProctoring`, with every field present and no optionals. Every reader — candidate
> runtime, API, publish checklist, the editor's summary row — calls it. **No reader branches on
> `profile`**, and the three readers that do today (§3) are converted, not left beside it.
>
> **`desktop_only` is a plain organiser toggle.** `P-01` reads as though Standard and Strict
> *are* a phone block; they are not. Standard and Strict default it on, and an organiser who
> turns it off has a test phones may take. That is a supported configuration, not a
> misconfiguration.
>
> **Why.** Fourteen booleans and numbers with three presets is a resolution problem, and a
> resolution problem solved once in a pure function cannot drift between the screen that sets
> it and the browser that enforces it. The three existing `profile` readers are that drift
> beginning.
>
> **Cost if wrong.** A test authored under one default set and edited after the defaults change
> resolves differently. Mitigated by the frozen published version: a published attempt resolves
> against the version it pinned, exactly as its paper does.

**`Q1a` — when `desktop_only` is off, the rest of the stack must behave on a phone.** It need
not behave *well*. Fullscreen on iOS Safari has no `requestFullscreen` on most elements;
`visibilitychange` fires when a call arrives; an extra-monitor check is meaningless. The rule:
every control degrades to *not firing* rather than to a false violation. A phone candidate who
never leaves the app accumulates zero violations.

**`Q1b` — the resolved set is visible to the candidate before they start.** The start page
already renders `PROCTORING_LABEL` from a `profile` the landing payload ships. That field is
**replaced** by the resolved requirements, in plain sentences, from the same object the runtime
enforces. A candidate who will be denied for having no camera learns it before the timer. The
landing payload changing shape means a `scrub-scan` replay and a `routes/run.ts` change, both
in 7a.

**`Q1c` — the checklist rows this phase adds are advisory.** "Strict without a camera
requirement"; "snapshot interval 15 s on a 180-minute test — 720 images per candidate"; "`lock`
chosen, and an attempt locked in Phase 7 clears only by an organiser opening it". Phase 7 adds
no blocking row (see `Q5`).

## 5. `Q2` — a stack failure never blocks; a camera requirement does

> **Ruling.** Two words that read alike and must never be confused in this codebase.
>
> A **stack failure** is proctoring not working — a model that will not load, an upload that
> returns 500, an ingest that is down, a device with no API at all. It **never** blocks
> anything. It records what it can, raises one organiser-facing flag on the attempt, and gets
> out of the way. Every signal path is written as: try, and on anything at all, degrade. No
> `throw` escapes a signal path into the runner.
>
> A **violation** is the candidate doing a disallowed thing — leaving fullscreen, switching
> windows. Violations may hide the questions behind an overlay per `P-03`, and the timer keeps
> running.
>
> **The camera requirement is neither, and it blocks.** In Strict, `P-05` and `AC-19` are
> explicit: the attempt cannot start without camera permission and a live frame, and a camera
> that stops, is unplugged or goes black mid-test raises an overlay that blocks the questions
> within 5 s until it is back. **Indefinitely.** A candidate whose webcam dies at minute 40 is
> blocked with the timer running, and their only recourse inside the product is `Q5`'s unlock.
>
> **Why.** This is `AG1`'s one deliberate exception, taken knowingly. A hard camera requirement
> is what Strict means in the PRD, and an organiser who chooses Strict is choosing it. A bounded
> escape — continue after 120 s with the attempt marked unobserved — was offered and refused:
> it would make Strict mean "a camera, unless you would rather not", which is not a requirement.
>
> **Cost if wrong.** It is the phase's sharpest edge and it is written down rather than
> discovered: a hardware fault ends an honest candidate's attempt. Three mitigations, all
> required: `Q1b` warns before the timer; `Q6` counts the outage so the organiser can see
> exactly what happened; and `Q5`'s unlock exists partly for this, which is why `Q5` does not
> get to be deferred.

**`Q2a` — overlays hide questions and nothing else.** An overlay never unmounts the runner,
never discards a typed answer, and never pauses the save queue. A candidate who is typing when
fullscreen drops has their keystroke saved; they simply cannot see the next question until
fullscreen is back. Phase 6's offline queue keeps working underneath.

**`Q2b` — the overlay's accessibility, ruled rather than left open.** `role="alertdialog"`,
`aria-modal="true"`, focus moved to it and trapped, an accessible name stating the condition and
the remedy, and **no Escape handler** — an overlay a keystroke dismisses is not a proctoring
control. `axe` does not test Escape, so the focus trap gets a behavioural test of its own rather
than riding the `axe` assertion.

**`Q2c` — the error boundary is the backstop, not the plan.** `AG4` says a signal path must not
crash the runner. The signal paths are written not to throw; a React error boundary around the
proctoring layer catches the one that does anyway, records a failure event, and leaves the paper
intact.

## 6. `Q3` — the face check is pre-cut

> **Ruling.** `P-07`'s on-device face counting does **not** ship in Phase 7. `face_check` is an
> override that validates, imports, clones and exports, with the control shipped **disabled** and
> copy naming the phase that turns it on. `snapshot.faceCount` stays `null` for every Phase 7
> attempt.
>
> **Why.** Chrome will not instantiate WebAssembly without `'wasm-unsafe-eval'` in `script-src`,
> and MediaPipe commonly wants a blob worker besides. The candidate runtime's policy is the
> tightest in the product, and `hosting.test.ts`'s own comment reads: *"A design that needed a CSP
> change would be the wrong design."* Widening it for the phase's most expensive control — the one
> control with no acceptance criterion naming it directly — buys the least and risks the most.
> `§20` already named it the first cut; it is cut now, before a plan is written around it, rather
> than mid-phase.
>
> **Cost if wrong.** Strict ships without the control that most distinguishes Strict, and an
> organiser reading the override list sees a toggle they cannot use. The precedent is exact and
> recent: `T-19`'s `check_reachable` shipped disabled with copy naming its phase in Phase 6, and
> the roadmap row recorded it so it was not rediscovered as a bug. This does the same.

**`Q3a` — `null` and `0` are never conflated.** Whatever Phase 8 does with face counting
inherits a column where `null` means "not counted" and `0` means "counted, nobody there". Phase 7
writes only `null`, and `Q6`'s multi-face threshold reads *"snapshots whose count is a number
greater than one"* — a `null` is not evidence of anything. Writing that rule correctly now costs
nothing and is the difference between Phase 8 being easy and Phase 8 being a migration.

**`Q3b` — `AG3` still gets its guard.** The no-biometrics test ships in Phase 7 even though
nothing can violate it yet, in the shape of `controls.test.ts`: a source-level scan asserting that
no module persists a landmark, embedding or descriptor. A guard written against an empty field is
a guard that is already in place when the field fills.

## 7. `Q4` — the snapshot upload path

> **Ruling.** The browser POSTs the JPEG to one `attempt`-authority route, which calls the
> `StorageAdapter.put()` that already exists. No presigned PUT, no storage-seam change, no new
> credential, no bucket CORS, and the only CSP change in the whole phase is the `blob:` on
> `img-src` that `security.ts` already promises. The storage key never leaves the server.
>
> **Why.** A presigned PUT exists to keep bytes out of the Worker — and it does not save the
> resource that actually binds. On the Workers free plan the ceiling is **100,000 requests a day**;
> a presigned design mints one URL per snapshot and then takes a report-back leg, so it spends the
> same request count or twice it. Everything else it touches this codebase has already decided
> against: `connect-src 'self'` and `hosting.test.ts`'s no-absolute-URL assertion forbid the origin
> it needs, `routes/media.ts` already proxies *reads* for exactly this reason, and ADR 0009
> rejected a `connect-src` widening for a smaller feature than this. The deployed Worker has no
> signer and no secret to build one from. And `Q4a`'s key would carry a `wsp_` into a presigned URL
> handed to a candidate, which `scrub-scan` fails on by design.
>
> Two further facts settle it. **Body size is enforceable only on this path** —
> `readBodyWithLimit` caps the POST at the trust boundary, where a signed PUT cannot bound what
> arrives (R2 does not document content-length signing), so one hostile candidate could PUT a
> multi-gigabyte object under a signed `image/jpeg` and exhaust the free tier. And **private
> storage stays private on every deployment**: a presigned design forces MinIO onto the public
> internet with TLS and CORS, where today it sits on the Docker network and `s3Adapter.put()`
> already works.
>
> Build cost: roughly four files against twelve or more. One failure state instead of three.
>
> **Cost if wrong.** It pins the floor at one metered Worker request per snapshot. The phase's own
> worst case — a 180-minute test at the 15 s floor, 720 images a candidate — is 216,000 requests
> across 300 candidates, which no free-plan deployment survives. A presigned design does not escape
> that either; the escape is batching, and it is the same escape on both paths. So the route carries
> a `ponytail:` note naming *k* JPEGs per POST as the upgrade path, and `Q11`'s advisory row is
> where an organiser meets the arithmetic before they meet the limit.

**`Q4e` — the measured budget is 3.** An R2 binding operation **is** a subrequest against the
50-per-request limit (`instrument.ts:38-40` already counts `put` and deliberately does not count
`signedUrl`). The route's `ROUTE_BUDGETS` entry is the attempt join, the put and the snapshot row
— measured, not assumed, like every other entry.

**`Q4f` — the row exists if and only if the object does.** Write the `snapshot` row after the put
succeeds. A row naming an object that was never written is a gap Phase 8's review timeline cannot
explain; a successful put with no row is one orphan object the retention job can still sweep by
prefix.

Settled either way, and true of both paths:

**`Q4a` — the storage key is minted server-side, always, and carries no workspace id.** The
client sends a reason and a timestamp; it never sends a path. `assertKey` refuses traversal. The
workspace scoping that Phase 8's retention job will need comes from the `snapshot` row, which has
a `workspaceId` column, not from the object's prefix.

**`Q4b` — the content type is `image/jpeg` and is enforced, not hoped for.** `AG2` is not kept by
good intentions: an upload path that would accept `video/webm` is a video recorder with extra
steps.

**`Q4c` — `AG2` gets a mechanical guard.** A test in the shape of `scrub-scan.test.ts`: every
storage write reachable from the runtime is enumerated from the source, and each must declare an
image content type. A new writer that does not is a CI failure, not a review finding.

**`Q4d` — an upload failure is a stack failure.** `Q2`. No snapshot, one failure event, paper
unaffected, and the organiser can see that the attempt has fewer images than its interval implies.

## 8. `Q5` — lock ships with a minimal unlock

> **Ruling.** All four `violation_action` values ship: `warn_only`, `warn_then_flag`,
> `auto_submit` (which collects `SubmitReason`'s already-reserved `"limit"`) and `lock`. `lock`
> freezes the attempt behind an overlay explaining what happened and what to do; one
> organiser-side unlock endpoint and one button on the attempt release it. No monitor, no queue,
> no reviewer workflow — Phase 8 replaces the *surface* and keeps the *endpoint*.
>
> **Why.** `lock` without an unlock would put a candidate in a state the product cannot leave,
> with the timer running. And `Q2`'s camera ruling makes the unlock load-bearing for a second
> reason: a dead webcam in Strict blocks indefinitely, and the unlock is the only recourse the
> product has. Deferring `lock` would also leave a published-and-exportable enum value that
> silently does nothing — the exact shape of defect #186 (`branding.finish_message`, a writer with
> no reader) that 6.5a had to come back and fix.
>
> **Cost if wrong.** In Phase 7 nothing *tells* an organiser a lock happened except opening the
> attempt. This was going to be mitigated by a blocking checklist row requiring a contact route —
> but no support-email, reply-to or from-address field exists anywhere in the schema, and
> inventing one is a branding-panel change, an import/export path and a `validateTest` rule that
> belong to whoever owns organiser contact details. **So the row is advisory, not blocking**, and
> the locked overlay tells the candidate to contact the organiser named on the test rather than
> giving them an address this product does not hold.

**`Q5a` — the unlock is audited and permissioned.** An organiser action on a candidate's attempt:
Phase 3's append-only audit log, behind the permission matrix like every other one. It is **not**
a `review` row — `review` is Phase 8's verdict model and borrowing it would pre-empt a design that
phase has not made.

**`Q5b` — unlocking does not refund time.** The timer is server-authoritative (Phase 6 Task 9) and
it ran through the lock. Whether an organiser may *extend* an attempt is Phase 8's question, and
this phase must not answer it by accident.

## 9. `Q6` — the integrity rule is three numbers, in their own columns

> **Ruling.** `P-10` says the rule is one the organiser can edit. What ships is **the three
> thresholds in the PRD's own defaults, as three editable numbers** — the violation count
> (`violation_limit`, which exists), the camera-outage seconds and the count of multi-face
> snapshots (**two new overrides**, bringing the block to fourteen) — plus the fixed sentence that
> combines them. `high_risk` when any threshold is met, `review` on any violation at all, `clean`
> otherwise.
>
> **The flag gets its own columns.** `attempt.flag` is `NOT NULL` and already carries
> `"scoring_blocked"` from `submit.ts:357`. Integrity is a different axis from grading, and
> overloading one column with both would mean every recompute risks erasing a grading state. 7a
> carries a migration adding `integrity_flag` and `observed` across **all three dialects**, with
> `parity.test.ts` and `no-d1-hostile-sql.test.ts` green.
>
> **Why.** "A rule the organiser can edit" could mean an expression editor. Nothing in the PRD or
> in `AC-17`–`AC-21` asks for one, no acceptance criterion tests one, and the three defaults
> `P-10` states are a complete description of the only rule anyone has asked for. A rule language
> is the most expensive possible reading of one sentence.
>
> **Cost if wrong.** Two new override fields means a schema change under `additionalProperties:
> false` and, by this repo's convention (6.5 `D19`), an ADR. An organiser who wants "`high_risk`
> only on multi-face, never on tab switches" cannot have it; they can set the tab-switch threshold
> beyond reach, which covers the realistic version of that want. Three numbers behind one pure
> function is cheap to replace; a saved expression tree is not.

**`Q6a` — the flag is computed, never stored as the last word.** Derived from events and snapshots
by a pure function, recomputed on submit and whenever a violation lands. A stored flag that no
longer matches the evidence is worse than no flag.

**`Q6b` — a stack failure is not a violation, and `observed` is where that lives.** An attempt whose
uploads all failed is not `high_risk`; it is `observed: false`, which is a different column, a
different word on the screen, and no reflection on the candidate. `Q2`'s camera block means a
Strict attempt is rarely unobserved for camera reasons — but it can still be unobserved because
every upload failed, which is precisely the case the organiser must be able to see.

## 10. `Q7` — events use the writer that already exists

> **Ruling.** One route, `POST /api/v1/run/attempt/events`, `attempt` authority, taking an array
> and calling `appendEvents()` unchanged. **Ten events per request**, the cap that function already
> documents and the daily write budget it already protects. Ids are minted server-side as `evt_`,
> as they are today. **No client-generated id and no idempotency key.**
>
> **Why.** The earlier draft invented client ids for idempotency. `appendEvents()` already exists,
> already batches, and the `event` table has no column for a client id and no attempt-scoped unique
> index — so honouring a client-chosen id would mean a migration *and* a cross-attempt write
> surface, bought for a guarantee an event does not need. An event is evidence, not an answer.
> At-least-once delivery of evidence is fine; a duplicated "left the window" row is a cosmetic
> defect, and a lost one is the same as the thousand things a browser kill loses anyway.
>
> **Cost if wrong.** Duplicate rows after a retry will show in Phase 8's events CSV. If that turns
> out to matter, a unique index on (attempt, type, `clientTs`) is a later migration — which is the
> cheap direction to be wrong in.

**`Q7a` — the server counts, the client does not.** The violation count shown to the candidate
("Warning 2 of 5") comes back from the ingest response. A client-side counter resets on reload, and
the whole point of a limit is that it cannot.

**`Q7b` — event types are a closed string union in `packages/core`.** Not free text, so Phase 8's
monitor and CSV have something to switch on and each type has a declared detail shape.

**`Q7c` — the ingest is rate-limited and budgeted.** Phase 6 Task 4 built the rate limiter; an
endpoint a candidate's browser can call in a loop uses it. The route also needs a **measured**
`ROUTE_BUDGETS` entry like every other. `rate_limit` row expiry remains Phase 8's retention job.

## 11. `Q8` — the proctoring editor is the sixth setting row

> **Ruling.** `D7`'s panel of setting rows gains a sixth: "Proctoring — Strict · camera required ·
> images every 60 s · locks at 5 violations · ≈ 1.5 MB per candidate". It opens in place like the
> other five, addressable as `?panel=proctoring`, and its summary states the resolved setting the
> way the other five state theirs.
>
> **Why.** 6.5d shipped `PANEL_KEYS` with five because five was all that existed. Proctoring is a
> test-level setting in `schemas/test-1.json` beside timing, access and branding; putting it
> anywhere else would give the builder's information architecture an exception in its first month.
>
> **Cost if wrong.** Fourteen overrides plus the profile is more controls than any other panel
> carries, and a panel that opens in place must still fit. `D16`'s three-track field-row grid is
> the shape, grouped — gating, camera and microphone, consequences — with `D16`'s "explanation of
> the whole group is one note under the row" doing the work per-field help would otherwise do
> fourteen times.

**`Q8a` — the profile is the panel's first control and it rewrites the rest.** Choosing Standard
sets the overrides to Standard's defaults, visibly. An override differing from its profile default
is marked as such, so "what did I change" is answerable without a diff.

**`Q8b` — this is the last panel 6.5d's pattern absorbs without being revisited.** Consent and
retention are still unbuilt and own by other phases. If either becomes a seventh and eighth row,
the panel's density is a real question. Phase 7 notes this and does not solve it.

## 12. `Q9` — the watermark is paint, and the device gate is one function

> **Ruling, watermark.** A CSS overlay carrying the candidate's identity and the current time over
> the paper, `pointer-events: none`, excluded from the accessibility tree, never part of the copy
> buffer. It exists so a photograph of a screen identifies who took it. It deters the photograph;
> it does not survive a DOM inspector, and nothing here pretends otherwise. Copy, paste and
> right-click blocking is the same honesty: `preventDefault()` on three events and a recorded
> event, not a protection boundary, and the consent copy says so.
>
> **Cost if wrong.** A watermark over a paper is a contrast and legibility hazard on the one
> surface where legibility matters most. It takes a `contrast-usage.test.ts` entry on both grounds,
> and `D8`'s frozen geometry means it must not move a single thing a candidate's hand is on.

**`Q9b` — the device gate extends `deviceReport()`; it does not join it.** `exam.tsx:73` already
ships a checker over `innerWidth >= 1024`, `matchMedia("(pointer: fine)")` and a UA family, whose
comment says Phase 7 refuses. Phase 7 extends **that** function to return a refusal, rather than
writing a second one over a different input set — which is the drift `Q1` exists to prevent. Where
`P-01` names `Sec-CH-UA-Mobile`, a request header, the server contributes its reading to the same
resolved decision rather than deciding separately.

**`Q9c` — when `desktop_only` is off, the copy that says otherwise must change.** The landing page
hand-writes `<dt>Devices</dt><dd>A laptop or desktop, with a mouse or trackpad.</dd>` and
`deviceReport` says "Touch-only devices are not supported." Under `Q1`'s supported configuration
both are false. They read from the resolved object or they are removed.

## 13. `Q10` — how this phase is proved

> **Ruling.** The owner validates the real-device matrix by hand, once, and the result is recorded
> in the roadmap row. CI proves everything that can be proved without hardware, and every guard is
> broken on purpose to show it can fail.
>
> **Why.** `AC-17` needs an Android phone, an iPhone and a desktop-mode iPad; `AC-19` needs a
> camera physically unplugged. A real-device cloud buys the first and cannot buy the second, for
> money and an account. The owner has the devices.
>
> **Cost if wrong.** A hand-run matrix does not re-run on a regression. The mitigation is that the
> *decision* is a pure function and the *devices* are only its inputs.

| criterion | how |
| --- | --- |
| `AC-17` device rule | The decision is pure over the header, user agent, touch points and viewport. A table test covers the Android, iPhone and desktop-mode-iPad signatures and the desktop ones, **both ways** — refused when `desktop_only` is on, admitted when it is off (`Q1`). Real devices by hand, once, by the owner. |
| `AC-18` fullscreen and window-leave | Playwright: drive `fullscreenchange`, `visibilitychange` and `blur`; assert the warning text, the count and one event row with a duration. Counting is server-side (`Q7a`), so the count is assertable without trusting the page. |
| `AC-19` camera in Strict | A fake media stream starts the attempt; stopping its tracks stands in for the unplug and must raise the blocking overlay inside 5 s and keep it up. Permission denial at start is separately and fully automatable. The physical unplug: by hand, once. |
| `AC-20` snapshot count | A clock-driven test over a simulated 60 minutes counting upload calls (55–65), plus `Q4c`'s content-type scan for "no audio or video file exists anywhere in storage" — the half of `AC-20` that is load-bearing and fully mechanical. |
| `AC-21` violation limit | Fully automatable, all four actions, no hardware. Includes `Q5`'s unlock and the `SubmitReason "limit"` path. |

**`Q10a` — probe verification, as standard.** Each new guard — `Q3b`'s no-biometrics scan, `Q4c`'s
content-type scan, the `ROUTE_AUTH` coverage of the new routes, `Q2b`'s focus trap — is
deliberately broken once to prove it fails, and the probe is recorded in the ledger.

**`Q10b` — `D14` reachability.** Every web assertion starts at `OrganiserApp` or `ExamApp` and
clicks its way there. No component is mounted in isolation to make a test shorter.

## 14. `Q11` — every observation is off-switchable, and the cost is on the screen

> **Ruling.** Every control that spends the organiser's money can be switched off independently of
> every other, and the panel states what the current settings cost **per candidate**.
>
> `snapshot_interval_seconds` changes from `minimum: 15` to `minimum: 0`, where **0 means off**.
> That makes "require the camera, take one identity photo, then stop taking pictures" expressible,
> which it is not today — the cheapest meaningful Strict configuration, and currently unreachable.
> No new field, no format bump, and no existing document can hold a 0.
>
> The panel shows a figure derived from the settings as entered — "≈ 60 images · ≈ 1.5 MB · ≈ 60
> uploads per candidate" — and **not** a total, because the product does not know the headcount. An
> advisory checklist row fires on the expensive configurations (`Q1c`).
>
> **The upload count is on that line because requests, not bytes, are the ceiling.** `Q4`'s worst
> case — 720 images a candidate — is 216,000 Worker requests across 300 candidates against a
> free-plan limit of 100,000 a day. Storage is the cost an organiser pays; requests are the cost
> that stops the test. Both belong on the row.
>
> **Why.** Snapshots are the one part of this phase that costs an organiser real money, at a rate
> they set with a number they may not connect to storage. A 180-minute test at the 15 s floor is 720
> images a candidate — about 18 MB each, and 5.4 GB across 300. An organiser should meet that figure
> in the editor, not on an invoice.
>
> **Cost if wrong.** A per-candidate figure invites the reader to do the multiplication, and some
> will do it wrong. The alternative — asking for an expected headcount to multiply by — adds a field
> that exists only to feed an estimate and is wrong the moment registration opens.

**`Q11a` — the figure comes from the shipped promise, not from a guess.** `Tail.tsx:125` already
publicly states ~25 KB at 320×240. The estimate uses that constant, and the encode path is measured
against it in 7d rather than assumed.

**`Q11b` — off means off, all the way down.** `snapshot_interval_seconds: 0` means no capture
timer, no upload route traffic, and no `snapshot` rows — not a capture whose upload is skipped.
`require_camera` false means `getUserMedia` is never called for video at all, so no permission
prompt and no browser indicator.

## 15. `Q12` — the microphone monitors level and records nothing

> **Ruling.** A new `require_microphone` override. When on, the attempt requests microphone
> permission — which lights the browser's own recording indicator for the whole attempt — and
> computes an **audio level** in the browser. The only thing kept is an event: "noise above
> threshold for 14 s at 11:42". No audio buffer is retained, no stream is recorded, nothing is
> uploaded, and no `MediaRecorder` is constructed anywhere in the codebase.
>
> The candidate is told the truth, plainly: *"Your microphone is on. Noise level is monitored; no
> audio is recorded or stored."*
>
> **Why.** The deterrent an organiser wants from a microphone comes from the browser's recording
> indicator, and that turns on from the permission alone. A level threshold then makes the claim
> true — something genuinely is being monitored — at the cost of one event type and an audio
> worklet. **A toggle that tells the candidate audio is being recorded when it is not was asked for
> and refused**: a false statement in a privacy notice, to people who are not party to the decision,
> in the one area where this product's honesty is the thing being sold. `P-06` is already promised
> publicly on the landing page; a contradicting on-screen claim would end the proctoring stack's
> credibility the first time a candidate found both.
>
> **Cost if wrong.** `P-06` must be reworded from "no audio is ever recorded" to "no audio is ever
> recorded or stored", with an ADR, because capture-without-retention is a genuinely different
> claim from no-capture and the consent copy must not overstate either way. And a microphone
> permission prompt is one more thing that can be denied before an attempt starts — so unlike the
> camera, **a denied microphone is a stack failure, not a block** (`Q2`): the attempt proceeds,
> flagged.

**`Q12a` — `AG2` and `AG3` bind this control hardest.** No `MediaRecorder`, no `AudioBuffer`
persisted, no voiceprint, no transcription, and no raw samples in an event's detail JSON. The
threshold crossing and its duration are the entire output. `Q4c`'s content-type guard extends to
assert that no audio media type can be written by any storage writer in the tree.

**`Q12b` — level monitoring is cheap or it is off.** An `AudioWorklet` computing RMS over a window,
not an analyser polled on a frame loop. If it cannot be made to cost nothing noticeable on a weak
machine, it is cut — the indicator, which is the deterrent, survives the cut.

## 16. What Phase 7 inherits from 6.5

Not suggestions. These are gates that will fail.

- **`D1`'s accent rule.** The organiser's new panel paints on the Signal ground in both modes; the
  candidate's overlays, warnings and watermark take **voltage**, the runtime's accent. An accent may
  not cross grounds. Every colour-setting selector this phase adds needs a `SURFACE` entry in
  `contrast-usage.test.ts` — **two of them**, one per ground, under `D20`.
- **`DESIGN.md` is the only place a colour is declared.** `no-hex-colors.test.ts` fails a raw hex
  anywhere else, and it strips only `/* */` comments, so an issue reference in a CSS comment goes in
  a block comment.
- **`D16`'s field-row grid and `D17`'s controls** for the proctoring panel. Fourteen controls, one
  grid per group, ids from `useId()`.
- **`D8`'s frozen geometry.** The candidate runtime's layout does not move. The watermark and the
  overlays sit over it; they do not reflow it.
- **`axe` assertions** on every new surface, with `Q2b` ruling the overlay case explicitly.
- **`component-dimensions.test.ts`** pins sizing for anything new.

## 17. Constraints the builder must respect

Carried from the 6.5 spec because each has cost a previous session real time.

- `pnpm build` needs `SITE_URL`: `SITE_URL='https://pariksha.example' pnpm build`.
- `pnpm test --force` does not work. Use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside a checkout** — pnpm junctions have twice deleted
  `packages/core/**` and `packages/db/**`. There are three fixed clones; read a frozen commit with
  `git show <sha>:<path>`.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`. Not a knob.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`, independent of the 10 s
  `testTimeout`. Not a knob either.
- Every mounted route needs a **measured** `ROUTE_BUDGETS` entry and a `ROUTE_AUTH` declaration.
- Migrations are written for D1, SQLite **and** Postgres, with `parity.test.ts` and
  `no-d1-hostile-sql.test.ts` green.
- Every merge to `main` needs `node deploy/cloudflare/setup.mjs` afterwards.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A` where untracked phase
  notes live.
- Stop for the four classes: an irreversible operation, a security-sensitive action, a side effect
  outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a
  guess.
- Every ruling recorded as `Ruling: … — why — cost if wrong` in
  `.superpowers/sdd/<plan-name>/progress.md`.

## 18. Left to the builder

- The snapshot JPEG's encode path, measured against `Tail.tsx`'s already-public ~25 KB at 320×240.
- Event type names and each type's detail JSON shape, within `Q7b`'s closed set.
- Which event types flush immediately beyond a violation that triggers an action, within the
  ten-per-request cap.
- Grouping and summary wording for the proctoring panel's fourteen controls, within `Q8`.
- The noise threshold and window for `Q12`, and whether it is organiser-settable or a constant.
- Whether the extra-monitor check prompts for the Window Management permission or reads only what is
  available without one. `P-08` says "where the browser exposes it"; a permission prompt mid-exam is
  a `Q2` hazard and the quieter reading is probably right.
- The browser support check's copy and its exact version floor, from `P-02`.
- Where `observed: false` appears on the attempt, given Phase 8 owns the review page.
- Test naming and placement, following `apps/api/test/` and `apps/web/test/`'s existing shapes.

## 19. The plan split

Five plans, each shipping working, testable software on its own.

| plan | ships | goals | depends on |
| --- | --- | --- | --- |
| **7a — the contract** | `resolveProctoring()` and `ResolvedProctoring` in core; the two new overrides and `snapshot_interval_seconds: 0` with their ADR; `Q7b`'s event union; the `integrity_flag` + `observed` migration on three dialects; the `ROUTE_AUTH` re-check and `scrub-scan` replay; converting the three existing `profile` readers; `Q1b`'s start-page requirements; the checklist's advisory rows | `G1` | — |
| **7b — the editor** | the sixth setting row, all fourteen controls, `Q8a`'s profile behaviour, `Q11`'s cost figure, both grounds | `G4` | 7a |
| **7c — the gates** | `Q9b`'s extended device gate, browser support, fullscreen, window-leave, copy/paste/right-click, the watermark, extra monitors, and `Q7`'s event ingest | `G2`, `G3` (part) | 7a |
| **7d — the eye** | camera, identity photo, `Q4`'s POST route and its measured budget, snapshots, `Q12`'s microphone level | `G2`, `G3` (part) | 7a, 7c |
| **7e — the consequences** | violation counting, the limit, all four actions, `Q5`'s lock and unlock, `Q6`'s integrity flag and `observed` | `G3`, `G5` | 7a, 7c, 7d |

**Order.** 7a first and alone — everything consumes its types and its migration. 7b and 7c are then
independent of each other. 7d needs 7c's event ingest.
7e needs all of them, because it is the phase's consequences and there is nothing to have
consequences about until the signals exist.

## 20. Cut order, and what this phase does not fix

**Already cut before planning: `Q3`'s face check.** Not a contingency — a decision, taken because
the CSP widening it needs buys the least of anything in the phase.

**Cut first: `Q12`'s level monitoring**, if it cannot be made free on a weak machine (`Q12b`). The
microphone permission and its indicator survive the cut; only the event goes.

**Cut second: `Q9`'s watermark.** Paint, by its own ruling, and the only control whose absence
changes nothing a candidate can do.

**Nothing else has a cut order. A third cut stops and asks.**

**Not fixed here.** The live monitor, proctor actions and the attempt review page (Phase 8);
`C-10`'s broadcast; the snapshot ZIP and events CSV; retention and deletion of what this phase
writes; on-device face counting; a contact route for a locked candidate; the phone field's country
picker; pointer drag for reordering; and the consent-editor half of Phase 5's deferral, which
belongs to the phase that owns consent copy rather than to proctoring.
