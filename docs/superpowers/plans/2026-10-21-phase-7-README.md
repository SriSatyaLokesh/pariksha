# Phase 7 — proctoring: plan index

**Spec:** [`../specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md)
— approved 2026-10-21, twelve rulings, `Q3` pre-cut and `Q4` settled on the Worker POST path after
a costed advisory.

The spec covers five independently shippable subsystems, so it is five plans. Each produces working,
testable software on its own.

**Rebased onto 6.5e (#203) on 2026-10-22, and re-checked against it.** Phase 6.5 is complete — a
(#196), b (#195), c (#199), d (#202), e (#203) and f (#198) are all on `main`. What the re-check
found:

- **Nothing these plans build on moved.** `SettingRow.tsx`, `PANEL_KEYS`, `routes/test.tsx`,
  `exam.css` and all of `components/exam/` came through 6.5e untouched, so 7b's panel, 7c's layer and
  7d's camera work sit on exactly the interfaces they were planned against, and `D8`'s frozen
  geometry is frozen against the same bytes.
- **Four guards arrived that the plans did not name**, and every plan's Global Constraints now
  carries them: `css-chain.ts` as the one `@import` resolver (which strips comments, so a rule named
  only in prose cannot satisfy a scan), `CHAINS` deciding which stylesheet a component's rules live
  in, `THEME_SELECTOR` fixing the two grounds as `:root` and `:root[data-theme="light"]` as the only
  selectors that may assign a semantic name, and `SEMANTIC_NAMES` as a contract list to consume
  rather than extend.
- **One new ruling fell out of it**: 6.5e shipped a live density registry, and 7e's locked-attempts
  list declines to join it, with the reason recorded in 7e Task 4.
- `testbuilder.css` grew ~400 lines and `primitives.css` ~200. 7b reads both before adding a
  selector.

| plan | ships | goals | depends on |
| --- | --- | --- | --- |
| [7a — the contract](2026-10-21-phase-7a-the-contract.md) | `resolveProctoring()`, the event vocabulary, three new overrides + ADR 0011, the `integrity_flag`/`observed` migration, the three converted `profile` readers, the advisory checklist rows | `G1` | — |
| [7b — the editor](2026-10-21-phase-7b-the-editor.md) | the sixth setting row, fifteen controls, the profile's visible rewrite, the cost line | `G4` | a |
| [7c — the gates](2026-10-21-phase-7c-the-gates.md) | the event ingest, the signal layer, device and browser gating, fullscreen, window-leave, copy blocking, the watermark, extra monitors | `G2` (part), `G3` (part) | a |
| [7d — the eye](2026-10-21-phase-7d-the-eye.md) | the camera start gate, the identity photo, the snapshot route, the capture schedule, the microphone's level monitor | `G2` (part), `G3` (part) | a, c |
| [7e — the consequences](2026-10-21-phase-7e-the-consequences.md) | the violation limit and all four actions, lock and the first organiser attempt routes, the integrity flag | `G3`, `G5` | a, c, d |

## Order

**7a first and alone.** Every other plan consumes its types, and 7e consumes its migration. Nothing
else may start until it lands.

**7b and 7c are then independent** of each other — either order, or in parallel. 7b enforces nothing
and 7c reads nothing the editor writes.

**7d needs 7c** for the queue, the layer and `ProctoringOverlay`. **7e needs a, c and d**, because it
is the phase's consequences and there is nothing to have consequences about until the signals exist.

## What is shared across plans

| produced by | name | consumed by |
| --- | --- | --- |
| a | `resolveProctoring()`, `ResolvedProctoring`, `PROCTORING_DEFAULTS`, `ProctoringOverrides` | b, c, d, e |
| a | `PROCTORING_EVENTS`, `ProctoringEventType`, `VIOLATION_EVENTS`, `FAILURE_EVENTS`, `isViolation()` | c, d, e |
| a | `proctoringRequirements()` | c, d |
| a | `setIntegrity()` and the `integrity_flag` / `observed` columns | e |
| a | `LandingPayload.proctoring: { profile, requirements }` — a **replacement**, not an addition | c, d |
| c | `createProctoringQueue()` — `push`, `pushImmediate` | d, e |
| c | `ProctoringLayer`, `ProctoringOverlay` | d, e |
| d | `acquireCamera()`, `captureJpeg()` | — |
| d | `POST /api/v1/run/attempt/snapshot` and `recordSnapshot()` | e (reads the rows) |
| e | `violationOutcome()`, `integrityFor()` | — |

## Cut order

**Already cut before planning: `Q3`'s on-device face check.** Not a contingency. MediaPipe needs
`'wasm-unsafe-eval'`, and `hosting.test.ts`'s own comment reads *"A design that needed a CSP change
would be the wrong design."* `face_check` ships as a disabled control naming Phase 8, the way
`T-19`'s `check_reachable` did.

**Cut first: `Q12b`'s noise monitoring** (7d Task 5), if the worklet cannot be made free on a weak
machine. The microphone permission and its browser indicator survive the cut; only the event goes.

**Cut second: `Q9`'s watermark** (7c Task 5). Paint, by its own ruling, and the only control whose
absence changes nothing a candidate can do.

**Nothing else has a cut order. A third cut stops and asks.**

## What the owner validates by hand

`Q10` settled this: CI proves everything provable without hardware, and three things are not.

- **`AC-17`** — an Android phone, an iPhone and a desktop-mode iPad, each refused with `desktop_only`
  on and admitted with it off. The pure decision is table-tested in 7c Task 3; the devices are one
  pass by hand.
- **`AC-19`** — a camera physically unplugged mid-attempt. The track-ended and black-frame paths are
  automated in 7d Task 3; the unplug is one pass by hand.
- **`AC-20`**'s real-encoder figure — 7d Task 2 measures the JPEG quality that lands nearest the
  25 KB `Tail.tsx:125` already promises publicly, and records it in the ledger.

Each result goes in the roadmap's Phase 7 row, not only in a task report.

## Still open, and deliberately not planned

- **A contact route for a locked candidate.** `Q5` wanted a blocking checklist row requiring one;
  no support-email, reply-to or from-address field exists anywhere in the schema, so the row is
  **advisory** and the overlay says "contact the organiser". A real field is a branding change that
  belongs to whoever owns organiser contact details.
- **The noise threshold** — whether it is organiser-settable or a constant. 7d Task 5 ships a
  constant; a sixteenth control waits for someone to ask.
- **Whether `observed: false` gets a surface beyond the attempt row.** Phase 8 owns the review page.
- **Phase 8's inheritance:** the monitor, proctor actions, `C-10`'s broadcast, the snapshot ZIP and
  events CSV, retention of everything this phase writes, and on-device face counting.
