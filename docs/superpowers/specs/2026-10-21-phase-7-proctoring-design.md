# Phase 7 — proctoring: design

| | |
| --- | --- |
| **Status** | Draft — not locked |
| **Date** | 2026-10-21 |
| **Implements** | [PRD.md](../../PRD.md) `P-01`–`P-10`, `AC-17`–`AC-21` |
| **Builds on** | [Phase 6.5 design pass](2026-10-20-phase-6-5-design-pass-design.md) — its rulings bind every surface this phase adds |
| **Roadmap** | [ROADMAP.md](../../ROADMAP.md#phase-7--proctoring) |

## Contents

1. [Intent](#1-intent)
2. [Goals, non-goals, anti-goals](#2-goals-non-goals-anti-goals)
3. [What already exists](#3-what-already-exists)
4. [`Q1` — the profile is a preset, the overrides are the truth](#4-q1--the-profile-is-a-preset-the-overrides-are-the-truth)
5. [`Q2` — a proctoring failure never blocks answering; a violation may](#5-q2--a-proctoring-failure-never-blocks-answering-a-violation-may)
6. [`Q3` — the face check ships, lazy and fail-open](#6-q3--the-face-check-ships-lazy-and-fail-open)
7. [`Q4` — snapshots go straight to storage on a presigned PUT](#7-q4--snapshots-go-straight-to-storage-on-a-presigned-put)
8. [`Q5` — lock ships with a minimal unlock](#8-q5--lock-ships-with-a-minimal-unlock)
9. [`Q6` — the integrity rule is three numbers, not a rule language](#9-q6--the-integrity-rule-is-three-numbers-not-a-rule-language)
10. [`Q7` — one event ingest, batched and idempotent](#10-q7--one-event-ingest-batched-and-idempotent)
11. [`Q8` — the proctoring editor is the sixth setting row](#11-q8--the-proctoring-editor-is-the-sixth-setting-row)
12. [`Q9` — the watermark is paint, not protection](#12-q9--the-watermark-is-paint-not-protection)
13. [`Q10` — how this phase is proved](#13-q10--how-this-phase-is-proved)
14. [What Phase 7 inherits from 6.5](#14-what-phase-7-inherits-from-65)
15. [Constraints the builder must respect](#15-constraints-the-builder-must-respect)
16. [Left to the builder](#16-left-to-the-builder)
17. [The plan split](#17-the-plan-split)
18. [Cut order, and what this phase does not fix](#18-cut-order-and-what-this-phase-does-not-fix)

## 1. Intent

Pariksha can run a test today. It cannot tell an organiser anything about *how* the test
was taken. Phase 7 is the first phase that observes an attempt rather than serving it.

Everything in `schemas/test-1.json`'s `proctoring` block already imports, clones and
exports. Exactly one field of it has a reader — `allow_calculator`, in
`apps/api/src/run/attempt.ts`. Every other control is a field nothing enforces. The `event`
and `snapshot` tables have sat in `packages/db` since Phase 2 with nothing writing to
either. Phase 7 is the phase that makes the written settings true.

**Why now.** Proctoring is what separates a quiz tool from an assessment tool, and it is the
last thing in the product that touches the candidate runtime's critical path. Phase 8's
monitor *watches* the events this phase emits; building the monitor over an empty table
would be building a window onto nothing. Phase 6.5 has also just finished, so every surface
this phase adds is drawn once, on the finished design system, rather than drawn and
redrawn.

**The sentence the whole phase answers to.** A candidate whose camera dies, whose browser
refuses to load a model, or whose upload fails must still be able to answer every question
and submit. Proctoring is evidence for the organiser; it is never a gate on the candidate's
marks.

## 2. Goals, non-goals, anti-goals

### Goals

- `G1` — every control under `proctoring.overrides` has a reader that honours it, and the
  three profiles resolve to override sets through one pure function.
- `G2` — the candidate-side enforcement: device and browser gating, fullscreen, window-leave
  detection, copy/paste/right-click blocking, the watermark, camera and identity photo,
  interval and violation snapshots, on-device face counting, extra-monitor detection.
- `G3` — the server side: event ingest, snapshot keys in private storage, violation counting,
  the configured violation action, and the integrity flag on every attempt.
- `G4` — the organiser can set all of it, from the builder, before publishing.
- `G5` — `AC-17` through `AC-21` pass, each by the means §13 names for it.

### Non-goals

- The live monitor, proctor actions and the per-attempt review page — Phase 8.
- `C-10`'s proctor broadcast to candidates — Phase 8 owns the sender.
- The snapshot ZIP export and the events CSV — Phase 8 (`R-09`, `R-10`).
- Retention and deletion of snapshots and events — Phase 8's retention job. Phase 7 writes
  rows and objects and leaves their expiry to the phase that owns expiry.
- Any grading consequence. An integrity flag never changes a score.

### Anti-goals

- `AG1` — **a candidate who cannot be observed must still be able to answer.** A phase that
  ships a proctoring stack which can strand an honest candidate has failed even if every
  control works.
- `AG2` — **no audio and no video, ever, anywhere.** `P-06` is a promise made to candidates
  in the consent copy. A code path that could record either is a defect regardless of
  whether it is reachable.
- `AG3` — **no biometric template is stored.** `P-07` counts faces and keeps the count. A
  face embedding, a landmark set or a descriptor persisted anywhere is a breach of the same
  promise.
- `AG4` — proctoring code must not be able to crash the runner. A thrown error inside a
  signal path that takes down `ExamApp` is `AG1` wearing a different coat.
- `AG5` — never make a gate green by moving a bar (inherited, 6.5 `AG2`).

## 3. What already exists

Read this before planning; it is the difference between extending the runtime and
rebuilding it.

| exists | where | state |
| --- | --- | --- |
| `proctoring.profile` + 12 overrides | `schemas/test-1.json` §`proctoring` | Imports, clones, exports. One reader (`allow_calculator`). |
| `event` table — attempt, type, detail JSON, client ts, server ts | `packages/db/src/schema/{sqlite,pg}.ts` | Created in Phase 2. **No writer.** |
| `snapshot` table — attempt, storage key, taken at, reason, face count | same | Created in Phase 2. **No writer.** `faceCount` is nullable, which is `Q3`'s fail-open shape already in the schema. |
| `review` table — attempt, reviewer, verdict, note | same | Created in Phase 2. Phase 8 owns it; `Q5`'s unlock does **not** use it. |
| `attempt` route authority, with its own middleware | `apps/api/src/app.ts` `ROUTE_AUTH` | Every new candidate-side route in this phase is `attempt`. `routeAuthorities()` reads the live route table, so a route added without a declaration fails CI. |
| Candidate response scrubbing, derived mechanically from `ROUTE_AUTH` | `apps/api/test/run/scrub-scan.test.ts` | **Phase 7's first task re-runs this against its new routes before adding one** (the Phase 6 roadmap row says so explicitly). |
| `StorageAdapter.signedUrl` — signed **reads**, 10 minutes | `packages/storage/src/adapter.ts` | There is **no signed PUT**. `Q4` adds one. |
| `OrganiserShell`, `SettingRow`, `PanelKey` (five settings) | `apps/web/src/`, from 6.5c and 6.5d | `Q8` adds the sixth. |
| The publish checklist — one function behind `GET …/checklist` and `POST …/publish` | Phase 5 Task 12 (#64) | `Q1` and `Q5` add rows to it. |
| `bounded.ts` — the execution bound on grading | `apps/api/src/run/bounded.ts` | Precedent for the shape `Q3` needs: a refusal that costs a flag, not a candidate's marks. |

## 4. `Q1` — the profile is a preset, the overrides are the truth

> **Ruling.** `profile` supplies **defaults** for the twelve overrides and has no independent
> effect. Resolution is one pure function in `packages/core`, `resolveProctoring(profile,
> overrides) → ResolvedProctoring`, with every field present and no optionals. Every reader —
> candidate runtime, API, publish checklist, the editor's summary row — calls it. No reader
> branches on `profile`.
>
> **`desktop_only` is a plain organiser toggle.** `P-01` reads as though Standard and Strict
> *are* a phone block; they are not. Standard and Strict default it on, and an organiser who
> turns it off has a test phones may take. That is a supported configuration, not a
> misconfiguration.
>
> **Why.** Twelve booleans with three presets is a resolution problem, and a resolution
> problem solved once in a pure function is a resolution problem that cannot drift between
> the screen that sets it and the browser that enforces it. The alternative — readers that
> each ask "is this Strict?" — is how the editor and the runtime come to disagree.
>
> **Cost if wrong.** A test authored under one default set and edited after the defaults
> change resolves differently. Mitigated by the frozen published version: a published
> attempt resolves against the version it pinned, exactly as its paper does.

**`Q1a` — when `desktop_only` is off, the rest of the stack must behave on a phone.** It need
not behave *well*. Fullscreen on iOS Safari has no `requestFullscreen` on most elements;
`visibilitychange` fires when a call arrives; a front camera at 320×240 is fine and an
extra-monitor check is meaningless. The rule: every control degrades to *not firing* rather
than to a false violation. A phone candidate who never leaves the app accumulates zero
violations.

**`Q1b` — the resolved set is visible to the candidate before they start.** The start page
already lists what the attempt requires. It gains the proctoring requirements, in plain
sentences, from the same resolved object — not a second list written by hand. A candidate
who will be denied for having no camera learns it before the timer, not after.

**`Q1c` — the publish checklist gains advisory rows, not blocking ones.** "Strict without a
camera requirement" and "snapshot interval 15 s on a 180-minute test (720 snapshots)" are
advisory. The one blocking row this phase adds belongs to `Q5`.

## 5. `Q2` — a proctoring failure never blocks answering; a violation may

> **Ruling.** Two words that read alike and must never be confused in this codebase.
>
> A **violation** is the candidate doing a thing the organiser disallowed — leaving
> fullscreen, switching windows, a second face. Violations may block the *view* of the
> questions behind an overlay, per `P-03` and `P-05`, and the timer keeps running.
>
> A **failure** is the proctoring stack not working — the model will not load, the camera
> permission prompt never resolves, the upload returns 500, storage is down, the device has
> no `getUserMedia` at all. A failure **never** blocks anything. It records what it can,
> raises one organiser-facing flag on the attempt, and gets out of the way.
>
> Every signal path is written as: try, and on anything at all, degrade. No `throw` escapes a
> signal path into the runner.
>
> **Why.** `AG1`. This is the one ruling in the phase that is worth more than the rest of the
> phase combined — a stranded honest candidate is the failure mode that ends a pilot.
>
> **Cost if wrong.** Fail-open is also fail-silent: an organiser can run a Strict test where
> a third of the attempts quietly had no camera. The defence is the flag — a failure is
> recorded as an event and surfaces on the attempt, so "this attempt was not actually
> observed" is a thing the organiser can see rather than assume.

**`Q2a` — the one deliberate pre-start block.** `P-05` is explicit: in Strict, the attempt
**cannot start** without camera permission and a live frame. That is a start gate, not an
answering gate — it fires before an attempt row exists, so no candidate is stranded
mid-paper by it. It is the only place in the phase where a proctoring condition prevents
progress outright, and `Q1b` is why the candidate is not surprised by it.

**`Q2b` — overlays hide questions and nothing else.** An overlay never unmounts the runner,
never discards a typed answer, and never pauses the save queue. A candidate who is typing
when fullscreen drops has their keystroke saved; they simply cannot see the next question
until fullscreen is back. Phase 6's offline queue keeps working underneath.

**`Q2c` — the error boundary is the backstop, not the plan.** `AG4` says a signal path must
not crash the runner. The signal paths are written not to throw; a React error boundary
around the proctoring layer catches the one that does anyway, records a failure event, and
leaves the paper intact.

## 6. `Q3` — the face check ships, lazy and fail-open

> **Ruling.** MediaPipe ships in Phase 7, loaded **after** the paper is answerable and never
> on the path to the first question. The candidate answers question one while the WASM and
> the model are still arriving. If they never arrive, or arrive and fail to initialise, the
> attempt runs with `face_check` off: snapshots still upload, `snapshot.faceCount` stays
> `null`, and one failure event names why.
>
> **Why.** `P-07` asks for on-device counting, and on-device is the whole reason it is
> allowed to exist — a frame counted in the browser is a frame no server has to be trusted
> with. Deferring it would make Phase 7 the phase that ships Strict proctoring without the
> control that makes Strict mean something. Paying for it with a slower first question would
> break `AG1` for every candidate to catch a few.
>
> **Cost if wrong.** A candidate on a slow connection or a weak machine may get no face
> counting at all, and the organiser sees `null` counts rather than zero. `null` and `0` must
> therefore never be conflated anywhere — `Q6` depends on it: "several faces in ≥ 2
> snapshots" counts snapshots whose count is a number greater than one, and a `null` is not
> evidence of anything.

**`Q3a` — counting runs on the snapshot, not on a live stream.** One count per captured
frame, which is the frame already being uploaded. No continuous inference loop, no second
video pipeline, and a CPU cost bounded by the snapshot interval rather than by the frame
rate.

**`Q3b` — nothing but the integer survives.** `AG3`. The detector's output is read for its
detection count and discarded in the same function. No landmark array, embedding or
descriptor is written to a table, to storage, to `localStorage`, or into an event's detail
JSON. The guard for this is a source-level test in the shape of `controls.test.ts`: the
module that holds the detector is the only module permitted to name the detector's result
type, and it exports nothing but a number.

**`Q3c` — the model is served from the deployment, not from a CDN.** PRD `S-11` has no
third-party-asset exception and the candidate runtime's CSP is the product's tightest. The
WASM and the model file are repo assets served from the same origin. Their weight is a
measured figure the plan records, not an estimate.

## 7. `Q4` — snapshots go straight to storage on a presigned PUT

> **Ruling.** The browser asks the API for an upload URL, PUTs the JPEG to storage directly,
> and reports the key back. The JPEG bytes never cross the Worker.
>
> This extends the storage seam: `StorageAdapter` gains `signedUploadUrl(key, opts)` beside
> its existing `signedUrl`, implemented on R2, S3, disk and memory, and the disk adapter
> gains a receiving route that verifies the same signature `sign.ts` already verifies for
> reads — with the method and the content type inside the signed payload, for the same reason
> the expiry is inside it today.
>
> **Why.** `AC-20` is 55–65 snapshots for one 60-minute attempt, and the pilot gate (`G1`) is
> 300 candidates. Eighteen thousand JPEGs through the Worker is bytes and subrequests spent
> on being a pipe. Presigning is SigV4 with `PUT` where `r2.ts` and `s3.ts` already sign
> SigV4 with `GET`.
>
> **Cost if wrong.** A presigned PUT is a capability loose in a browser. It is scoped to one
> key, which `assertKey` already refuses to let traverse; it is short-lived; and the key is
> derived server-side from the attempt, never accepted from the client. A candidate can
> overwrite their own snapshot and reach nothing else. Also: four adapters is four
> implementations where there was one, and the disk path needs a real receiving handler —
> this is the phase's largest unglamorous cost and the plan must budget it as such.

**`Q4a` — the key is minted by the server, always.** `snapshot/<workspace>/<attempt>/<taken
at>-<reason>.jpg`, built from the attempt the cookie names. The client sends a reason and a
timestamp; it never sends a path.

**`Q4b` — the content type is signed and enforced.** `image/jpeg`, in the signature. `AG2`
is not kept by hoping: an upload URL that would accept `video/webm` is a video recorder with
extra steps.

**`Q4c` — one URL per snapshot, requested at capture time.** No pre-minted batch sitting in
memory for an hour. The URL request rides the same best-effort path as everything else in
`Q2`: cannot get one, no snapshot, one failure event, paper unaffected.

**`Q4d` — `AG2` gets a mechanical guard.** A test in the shape of `scrub-scan.test.ts`:
every storage write reachable from the runtime is enumerated from the source, and each one
must declare an image content type. A new writer that does not is a CI failure rather than a
review finding.

## 8. `Q5` — lock ships with a minimal unlock

> **Ruling.** All four `violation_action` values ship: `warn_only`, `warn_then_flag`,
> `auto_submit` and `lock`. `lock` freezes the attempt behind an overlay that explains what
> happened and what to do; one organiser-side unlock endpoint and one button on the attempt
> release it. No monitor, no queue, no reviewer workflow — Phase 8 replaces the *surface*
> and keeps the *endpoint*.
>
> **Why.** Shipping `lock` without an unlock would put a candidate in a state the product
> has no way out of, which is `AG1` with the timer still running. Deferring `lock` would
> leave `AC-21` partly met and leave a published-and-exportable enum value that silently
> does nothing — the exact shape of defect #186 (`branding.finish_message`, a writer with no
> reader) that 6.5a had to come back and fix.
>
> **Cost if wrong.** An organiser must be watching for a lock to clear it, and in Phase 7
> nothing tells them one happened except opening the attempt. The publish checklist's one
> blocking row of this phase is the mitigation: choosing `lock` requires a contact route
> (the test's support email or reply-to) to be set, so a locked candidate has somewhere to
> write.

**`Q5a` — the unlock is audited and permissioned.** It is an organiser action on a
candidate's attempt, so it writes to Phase 3's append-only audit log and sits behind the
permission matrix like every other one. It is not a `review` row; `review` is Phase 8's
verdict model and borrowing it here would pre-empt a design that phase has not made.

**`Q5b` — unlocking returns remaining time honestly.** The timer is server-authoritative
(Phase 6 Task 9) and it ran through the lock. An unlock does not refund time. Whether an
organiser may *extend* an attempt is Phase 8's question, and this phase must not answer it
by accident.

## 9. `Q6` — the integrity rule is three numbers, not a rule language

> **Ruling.** `P-10` says the rule is one the organiser can edit. What ships is **the three
> thresholds in the PRD's own defaults, as three editable numbers** — the violation count,
> the camera-outage seconds, and the count of multi-face snapshots — plus the fixed sentence
> that combines them. `high_risk` when any threshold is met, `review` on any violation at
> all, `clean` otherwise.
>
> **Why.** "A rule the organiser can edit" could mean an expression editor. Nothing in the
> PRD or in `AC-17`–`AC-21` asks for one, no acceptance criterion tests one, and the three
> defaults `P-10` states are a complete description of the only rule anyone has asked for. A
> rule language is the most expensive possible reading of one sentence.
>
> **Cost if wrong.** An organiser who wants "high_risk only on multi-face, never on tab
> switches" cannot have it; they can set the tab-switch threshold high enough to be
> unreachable, which covers the realistic version of that want. If a second real request
> arrives, the thresholds grow into whatever it needs — three numbers behind one pure
> function is a cheap thing to replace, which a saved expression tree is not.

**`Q6a` — the flag is computed, never stored as the last word.** It is derived from events
and snapshots by a pure function, recomputed on submit and whenever a violation lands. A
stored flag that no longer matches the evidence is worse than no flag.

**`Q6b` — a failure is not a violation.** `Q2`'s distinction reaches the flag: an attempt
with no camera because the camera broke is not `high_risk`. It is flagged as unobserved,
which is a different word on the screen and a different field in the row.

## 10. `Q7` — one event ingest, batched and idempotent

> **Ruling.** One route, `POST /api/v1/run/attempt/events`, `attempt` authority, taking an
> array. The client buffers and flushes on a short interval and on the events that matter
> immediately (a violation that triggers an action). Each event carries a client-generated
> id; the server upserts on it, exactly as Phase 6 Task 8 made the answer save idempotent.
>
> **Why.** The runtime already has an offline save queue with idempotent server upsert; a
> second delivery mechanism for a second kind of write would be two things to get right. The
> `event` table's `clientTs` and `serverTs` columns were designed for precisely this —
> Phase 2 put both there because a client clock cannot be trusted and a server clock cannot
> say when the candidate actually left the window.
>
> **Cost if wrong.** Buffering means a browser killed mid-buffer loses a few seconds of
> events. Acceptable: an event is evidence, not an answer, and `Q2` already says evidence is
> best-effort. Violations that trigger an action flush immediately, so the one class that
> has a consequence does not sit in a buffer.

**`Q7a` — the server counts, the client does not.** The violation count shown to the
candidate ("Warning 2 of 5") comes back from the ingest response. A client-side counter can
be reset by a reload; the whole point of the limit is that it cannot.

**`Q7b` — event types are a closed set in `packages/core`.** A string union, not free text,
so Phase 8's monitor and CSV have something to switch on and the detail JSON has a shape per
type.

**`Q7c` — the ingest is rate-limited.** Phase 6 Task 4 built a rate limiter; an endpoint a
candidate's browser can call in a loop uses it. `rate_limit` row expiry is still Phase 8's
retention job, as recorded in the Phase 6 row.

## 11. `Q8` — the proctoring editor is the sixth setting row

> **Ruling.** `D7`'s panel of setting rows gains a sixth: "Proctoring — Strict · camera
> required · snapshots every 60 s · locks at 5 violations". It opens in place like the other
> five, addressable as `?panel=proctoring`, and its summary states the resolved setting the
> way the other five state theirs.
>
> **Why.** 6.5d shipped `PanelKey` with "the five settings only" because five was all that
> existed. Proctoring is a test-level setting in `schemas/test-1.json` beside timing, access
> and branding; putting it anywhere else would make the builder's information architecture
> have an exception in its first month.
>
> **Cost if wrong.** Twelve overrides is more controls than any of the other five panels
> carries, and a panel that opens in place must still fit. `D16`'s three-track field-row grid
> is the shape it uses, grouped — gating, camera, consequences — with `D16`'s "explanation of
> the whole group is one note under the row" doing the work that per-field help would
> otherwise do twelve times.

**`Q8a` — the profile is the panel's first control and it rewrites the rest.** Choosing
Standard sets the twelve to Standard's defaults, visibly. An override that differs from its
profile default is marked as such, so "what did I change" is answerable without a diff.

**`Q8b` — this is the last panel 6.5d's pattern absorbs without being revisited.** Consent
and retention are still unbuilt (Phase 6 and Phase 8 own them). If either becomes a seventh
and eighth row, the panel's density becomes a real question. Phase 7 notes this and does not
solve it.

## 12. `Q9` — the watermark is paint, not protection

> **Ruling.** The watermark is a CSS overlay carrying the candidate's identity and the
> current time over the paper, `pointer-events: none`, excluded from the accessibility tree,
> and never part of the copy buffer. It exists so that a photograph of a screen identifies
> who took it.
>
> **Why.** It is named in the PRD as one control among ten and is frequently mistaken for a
> security measure. It deters the photograph; it does not survive a determined candidate with
> a DOM inspector, and nothing in this phase pretends otherwise.
>
> **Cost if wrong.** A watermark over a paper is a contrast and legibility hazard on the one
> surface in the product where legibility matters most. It takes a `contrast-usage.test.ts`
> entry like everything else, it is measured against the runtime's grounds, and `D8`'s frozen
> geometry means it must not move a single thing a candidate's hand is already on.

**`Q9a` — copy, paste and right-click blocking is the same honesty.** It stops the casual
copy. It is `event.preventDefault()` on three events and a recorded event, not a protection
boundary, and the consent copy says so.

## 13. `Q10` — how this phase is proved

> **Ruling.** The owner validates the real-device matrix by hand, once, and the result is
> recorded in the roadmap row. CI proves everything that can be proved without hardware, and
> every guard is broken on purpose to show it can fail.
>
> **Why.** `AC-17` needs an Android phone, an iPhone and a desktop-mode iPad; `AC-19` needs a
> camera physically unplugged. A real-device cloud buys the first and cannot buy the second,
> for money and an account. The owner has the devices.
>
> **Cost if wrong.** A hand-run matrix does not re-run on a regression. The mitigation is
> that the *decision* is a pure function and the *devices* are only its inputs.

| criterion | how |
| --- | --- |
| `AC-17` device rule | The detection function is pure over `Sec-CH-UA-Mobile`, user agent, `maxTouchPoints` and viewport width. A table test covers the Android, iPhone and desktop-mode-iPad signatures and the desktop ones, **both ways** — blocked when `desktop_only` is on, admitted when it is off (`Q1`). Real devices: by hand, once, by the owner. |
| `AC-18` fullscreen and window-leave | Playwright: drive `fullscreenchange`, `visibilitychange` and `blur`, assert the warning text, the count, and one event row with a duration. Counting is server-side (`Q7a`), so the count is assertable without trusting the page. |
| `AC-19` camera in Strict | A fake media stream (`--use-fake-device-for-media-stream`) starts the attempt; stopping its tracks stands in for the unplug and must raise the overlay inside 5 s. Permission denial is a separate, fully automatable case. The physical unplug: by hand, once. |
| `AC-20` snapshot count | A clock-driven test over a simulated 60 minutes counting upload calls, plus `Q4d`'s content-type guard for "no audio or video file exists anywhere in storage" — which is the half of `AC-20` that is actually load-bearing and is fully mechanical. |
| `AC-21` violation limit | Fully automatable, all four actions, and the only one with no hardware in it. Includes `Q5`'s unlock. |

**`Q10a` — probe verification, as standard.** Each new guard — `Q3b`'s no-biometrics test,
`Q4d`'s content-type scan, the `ROUTE_AUTH` coverage of the new routes — is deliberately
broken once to prove it fails, and the probe is recorded in the ledger.

**`Q10b` — `D14` reachability.** Every web assertion starts at `OrganiserApp` or `ExamApp`
and clicks its way there. No component is mounted in isolation to make a test shorter.

## 14. What Phase 7 inherits from 6.5

Not a list of suggestions. These are gates that will fail.

- **`D1`'s accent rule.** The organiser's new panel paints on the Signal ground in both modes;
  the candidate's overlays, warnings and watermark take **voltage**, the runtime's accent. An
  accent may not cross grounds. Every colour-setting selector this phase adds needs a
  `SURFACE` entry in `contrast-usage.test.ts` — **two of them**, one per ground, under `D20`.
- **`DESIGN.md` is the only place a colour is declared.** `no-hex-colors.test.ts` fails a raw
  hex anywhere else, and it strips only `/* */` comments, so an issue reference in a CSS
  comment goes in a block comment.
- **`D16`'s field-row grid and `D17`'s controls** for the proctoring panel. Twelve controls,
  one grid per group, ids from `useId()`.
- **`D8`'s frozen geometry.** The candidate runtime's layout does not move. The watermark and
  the overlays sit over it; they do not reflow it.
- **`axe` assertions** on every new surface, including the overlays — which are the hardest
  case in the phase, because an overlay that hides questions must be announced, focus-trapped
  and escapable to a screen reader without being escapable as a proctoring control.
- **`component-dimensions.test.ts`** pins sizing for anything new.

## 15. Constraints the builder must respect

Carried from the 6.5 spec because they have each cost a previous session real time.

- `pnpm build` needs `SITE_URL`: `SITE_URL='https://pariksha.example' pnpm build`.
- `pnpm test --force` does not work. Use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside a checkout** — pnpm junctions have twice deleted
  `packages/core/**` and `packages/db/**`. There are three fixed clones; read a frozen commit
  with `git show <sha>:<path>`.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`. Not a knob.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`, independent of the 10 s
  `testTimeout`. Not a knob either.
- Every merge to `main` needs `node deploy/cloudflare/setup.mjs` afterwards.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A` where
  untracked phase notes live.
- Migrations are written for D1, SQLite **and** Postgres with the parity test green.
- Stop for the four classes: an irreversible operation, a security-sensitive action, a side
  effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken
  every path is a guess.
- Every ruling recorded as `Ruling: … — why — cost if wrong` in
  `.superpowers/sdd/<plan-name>/progress.md`.

## 16. Left to the builder

- The snapshot JPEG's exact encode path — `canvas.toBlob` quality to land near `P-06`'s
  ~25 KB at 320×240. A measured figure, not a guessed one.
- Event type names and each type's detail JSON shape, within `Q7b`'s closed set.
- The buffer interval and flush size for `Q7`, and which event types flush immediately
  beyond the violation that triggers an action.
- Grouping and summary wording for the proctoring panel's twelve controls, within `Q8`.
- Whether the extra-monitor check prompts for the Window Management permission or reads only
  what is available without a prompt. `P-08` says "where the browser exposes it"; a
  permission prompt mid-exam is a `Q2` hazard and the quieter reading is probably right.
- The browser support check's copy and its exact version floor, from `P-02`.
- Where the "unobserved" state (`Q6b`) appears on the attempt, given Phase 8 owns the review
  page this phase does not build.
- Test naming and placement, following `apps/api/test/` and `apps/web/test/`'s shapes.

## 17. The plan split

Five plans, each shipping working, testable software on its own.

| plan | ships | goals | depends on |
| --- | --- | --- | --- |
| **7a — the contract** | `resolveProctoring()` in core, the `ResolvedProctoring` type, `Q7b`'s event union, the `ROUTE_AUTH` re-check, the publish-checklist rows, `Q1b`'s start-page requirements | `G1` | — |
| **7b — the editor** | the sixth setting row, all twelve controls, `Q8a`'s profile behaviour, both grounds | `G4` | 7a |
| **7c — the gates** | device and browser gating, fullscreen, window-leave, copy/paste/right-click, the watermark, extra monitors, `Q7`'s ingest | `G2`, `G3` (part) | 7a |
| **7d — the eye** | camera, identity photo, `Q4`'s storage seam and presigned PUT, snapshots, `Q3`'s MediaPipe face count | `G2`, `G3` (part) | 7a, 7c |
| **7e — the consequences** | violation counting, the limit, all four actions, `Q5`'s lock and unlock, `Q6`'s integrity flag | `G3`, `G5` | 7a, 7c, 7d |

**Order.** 7a first and alone — everything consumes its types. 7b and 7c are then independent
of each other. 7d needs 7c's event ingest. 7e needs all of them, because it is the phase's
consequences and there is nothing to have consequences about until the signals exist.

## 18. Cut order, and what this phase does not fix

**Cut first: `Q3`'s face check (7d's last task).** It is the most expensive control, the one
with the weakest gate behind it (no acceptance criterion names `P-07` directly), and `Q3`'s
own fail-open shape means an attempt with no face counting is an attempt the product already
knows how to run. If it is cut, `face_check` ships as a disabled toggle naming Phase 8, the
way `T-19`'s `check_reachable` did — and the roadmap row says so rather than leaving it to be
rediscovered.

**Cut second: `Q9`'s watermark.** Paint, by its own ruling, and the only control whose
absence changes nothing a candidate can do.

**Nothing else has a cut order. A third cut stops and asks.**

**Not fixed here.** The live monitor, proctor actions and the attempt review page (Phase 8);
`C-10`'s broadcast; the snapshot ZIP and events CSV; retention and deletion of what this
phase writes; the phone field's country picker; pointer drag for reordering; and the
consent-editor half of Phase 5's deferral, which belongs to the phase that owns consent copy
rather than to proctoring.
