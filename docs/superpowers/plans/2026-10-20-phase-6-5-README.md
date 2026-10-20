# Phase 6.5 — the design pass: plan index

**Spec:** [`../specs/2026-10-20-phase-6-5-design-pass-design.md`](../specs/2026-10-20-phase-6-5-design-pass-design.md)
— direction locked, both prototypes locked (`screens.html` rev 5, `test-builder.html` rev 4),
`D11`'s three gates closed.

The spec covers six independently shippable subsystems, so it is six plans. Each produces working,
testable software on its own.

| plan | ships | goals | depends on |
| --- | --- | --- | --- |
| [6.5a — defects and measurement](2026-10-20-phase-6-5a-defects-and-measurement.md) | #179, #186, the `AG1` density gate | `G4` | — |
| [6.5b — the ground](2026-10-20-phase-6-5b-the-ground.md) | ADR 0010, both palettes, the switch | `G1`, `G7` | — |
| [6.5c — the shell](2026-10-20-phase-6-5c-the-shell.md) | persistent chrome, URL state, Home | `G2` | a, b |
| [6.5d — the builder](2026-10-20-phase-6-5d-the-builder.md) | setting rows, the live checklist rail | `G3` | b, c |
| [6.5e — the screens](2026-10-20-phase-6-5e-the-screens.md) | the remaining surfaces, `D10`, `D14` | `G5` | a, b, c, d |
| [6.5f — the runtime](2026-10-20-phase-6-5f-the-runtime.md) | `exam.css`'s type sweep | `G6` | b |

## Order

**a** and **b** are independent of each other and of everything else — either order, or in parallel.
Everything after needs both. **a must finish before c, d or e**, because `D13`'s before-figures are
captured on `main` and the first restyling commit invalidates them.

**f is cut first** (§15). If the phase runs long, the type sweep waits; the re-ground, the shell, the
builder and the two UX defects ship. **Nothing else has a cut order; a second cut stops and asks.**

## What is shared across plans

| produced by | name | consumed by |
| --- | --- | --- |
| a | `seedWorkspace()`, `countPrimaryRows()` — `apps/web/e2e/seed.ts`, `density.spec.ts` | e, f |
| a | `Receipt.finishMessage: string \| null` | — |
| b | `theme.css`'s semantic names (`--ground`, `--ink`, `--accent`…) | c, d, e |
| b | `readGround()` / `writeGround()` — `apps/web/src/lib/ground.ts` | c |
| c | `OrganiserShell` | d, e |
| c | `readView()` / `writeView()` — `apps/web/src/lib/view-url.ts` | d, e |
| c | `TestWire.closesAt: number \| null` | — |
| d | `SettingRow`, `PanelKey` (the five settings only) | — |
| d | the `D16` field-row rule and the `D17` controls | e |

## Still open, and deliberately not planned

- **Test-list row density** — 16.5px a row, 11 visible against 15, 0px horizontal slack. `D13`'s
  first measurement (6.5a Task 4), settled in 6.5e Task 2 **with the figure, not by eye**.
- **Icons** — placeholders in both prototypes; the real set is an asset list, not a plan.
- Carried out of the phase as new work: section-order shuffling (`D19`), the review panel
  (ADR 0007's deferred half), the readiness meter in the test list (`D7c`), `branding.logo`.
