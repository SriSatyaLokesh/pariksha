# Phase 7b — The Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The organiser sets every proctoring control from the builder before publishing, sees what the current settings cost per candidate, and can switch every observation off independently.

**Architecture:** 6.5d shipped `SettingRow` and `PANEL_KEYS` with exactly five settings. This plan adds the sixth — `"proctoring"` — as a row that states its resolved setting and opens in place like the others. Inside it, fifteen controls in three `D16` field-row grids (gating, camera and microphone, consequences), with `D17`'s controls and a cost line computed from the same `resolveProctoring` the runtime enforces. No new disclosure pattern: this is 6.5d's pattern used a sixth time.

**Tech Stack:** Preact/React + TypeScript, Vitest + Testing Library, CSS custom properties, `axe`.

**Spec:** [`docs/superpowers/specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md) — `Q8`, `Q8a`, `Q8b`, `Q11`, `Q11a`, `Q11b`, `Q12`, `Q3`, §16.

**Depends on:** **7a** for `resolveProctoring`, `ResolvedProctoring`, `PROCTORING_DEFAULTS` and the schema's three new overrides. Independent of 7c, 7d and 7e — nothing here enforces anything.

**Rebased onto 6.5e (#203).** `SettingRow.tsx`, `PANEL_KEYS` and `routes/test.tsx` are **untouched** by 6.5e, so this plan's shape stands. `testbuilder.css` grew by ~400 lines and `primitives.css` by ~200 — read both before adding a selector, and reuse what 6.5e already named rather than declaring a neighbour.

**Goals covered:** `G4` — the organiser can set all of it from the builder before publishing, can switch every observation off independently, and can see what each setting costs them.

## Global Constraints

Copied from the spec's §16 and §17. Every task's requirements implicitly include this section.

- **`D1`'s accent rule.** This panel paints on the **Signal ground, both modes**. An accent may not cross grounds — nothing here takes the runtime's voltage. Every colour-setting selector needs a `SURFACE` entry in `contrast-usage.test.ts`, **two of them**, one per ground (`D20`).
- **`DESIGN.md` front matter is the only place a colour may be declared.** `no-hex-colors.test.ts` strips only `/* */` comments — issue references in CSS go in block comments.
- **`apps/web/test/css-chain.ts` is the one `@import` resolver**, shared by `theme.test.ts`, `contrast-usage.test.ts` and `signal-boundary.test.ts` (6.5b/6.5e). It **strips comments**, so a rule named only in prose cannot satisfy a scan.
- **A component's chain decides which stylesheet its rules live in** (`CHAINS` in `css-chain.ts`): `components/exam/` and `routes/exam.tsx` are the **candidate runtime** (`exam.css`); `components/testbuilder/`, `components/authoring/` and `components/organiser/` are the **organiser** (`admin.css` and its imports). Putting a shared control's rule in `primitives.css` is what caused **#201** — it reaches `admin.css` and `landing.css` and **not** `exam.css`.
- **The two grounds are selectors, not a guess**: dark is `:root`, light is `:root[data-theme="light"]` (`THEME_SELECTOR`). They are the **only** two selectors permitted to assign a semantic name, and `theme.test.ts` enforces it.
- **`SEMANTIC_NAMES` is a contract list.** Use the names that exist; adding one after a consuming plan has started is a change to three stylesheets and a gate, and 6.5b's own note says so.
- **`D16`'s field-row rule** — one grid with three tracks per row, each field a `subgrid` spanning all three, `@supports not` reserving the help track. A unit goes inside the control as an affix; a constraint or consequence goes in the help track; an explanation of the whole group is **one note under the row**, never repeated per field.
- **`D16a`** — every `id`, `for` and `aria-describedby` derives from `useId()`. A settings panel is a repeated construct.
- **`D17`** — one checkbox and one radio for the whole product, from `registration.css`. No browser default anywhere.
- **`D12`** — the builder is an **editing** surface and gets air. `AG1`'s rows-visible gate governs scanning surfaces, not this one.
- **`D15`** — inside a component 4 / 6 / 8 / 12 / 16; between the page and its edges 20 / 28 / 36 / 56.
- **`AG5`** — never make a gate green by moving a bar.
- **Reachability (`D14`)** — every assertion starts at `OrganiserApp` and clicks its way there.
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`; `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-7b/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **A profile changed after overrides were set** — `Q8a` says choosing Standard sets the controls to Standard's defaults *visibly*. The destructive reading (silently discard the organiser's fifteen edits) and the useless reading (change nothing) are both wrong; the behaviour must be one the organiser can see and undo. Task 3.
2. **`snapshot_interval_seconds: 0` rendered as an empty or absent field** — a number input bound with `||` shows blank for 0, and blank reads as "unset", which is how the off switch gets lost in the UI after `Q11` went to the trouble of adding it. Task 2.
3. **The cost line on a test with no duration** — `#179` was exactly this (a test with no duration could be published). Images per candidate is `duration × 60 / interval`; with no duration there is no figure, and the line must say so rather than render `NaN` or `Infinity`. Task 4.
4. **A screen reader meeting the disabled `face_check` control** — `Q3` ships it disabled with copy naming the phase. A bare `disabled` attribute with the explanation only in adjacent text is a control whose reason is invisible to anyone not reading the page visually. Task 2.
5. **The panel opened while another is open, and `?panel=proctoring` typed by hand** — 6.5d ruled one at a time with a deterministic resolution; a sixth key must not be the one that breaks it. Task 1.

---

### Task 1: the sixth setting row

**Files:**
- Modify: `apps/web/src/components/testbuilder/SettingRow.tsx:42-44`
- Modify: `apps/web/src/routes/test.tsx`
- Create: `apps/web/src/components/testbuilder/ProctoringPanel.tsx`
- Test: `apps/web/test/testbuilder/proctoring-row.test.tsx`

**Interfaces:**
- Consumes: `SettingRow` and `PanelKey` from 6.5d, unchanged in shape; `resolveProctoring` from 7a.
- Produces: `PANEL_KEYS` with six entries, and

```tsx
export function ProctoringPanel(props: {
  value: { profile: ProctoringProfile; overrides: ProctoringOverrides };
  durationMinutes: number | null;
  onChange: (next: { profile: ProctoringProfile; overrides: ProctoringOverrides }) => void;
}): JSX.Element;
```

**`Q8`** — the row states its resolved setting the way the other five state theirs: *"Proctoring — Strict · camera required · images every 60 s · warns at 5 violations · ≈ 1.5 MB per candidate"*. A summary that describes the setting instead of stating its value fails this task (6.5d Task 1's rule, inherited).

- [ ] **Step 1: Write the failing tests**

```tsx
it("states the resolved proctoring setting while collapsed", async () => {
  await openBuilder({ proctoring: { profile: "strict", overrides: {} } });
  expect(await screen.findByText(/Strict · camera required · images every 60 s/)).toBeVisible();
});

it("states Off plainly when there is no proctoring block at all", async () => {
  await openBuilder({});
  expect(await screen.findByText(/Proctoring — Off/)).toBeVisible();
});

// Review Focus 5 — one at a time, and a hand-typed key resolves deterministically.
it("retracts an open settings panel when proctoring opens", async () => {
  await openBuilder({});
  await user.click(screen.getByRole("button", { name: /Timing/ }));
  await user.click(screen.getByRole("button", { name: /Proctoring/ }));
  expect(screen.queryByRole("group", { name: /Timing/ })).toBeNull();
});

it("opens from ?panel=proctoring", async () => {
  await openBuilder({}, { panel: "proctoring" });
  expect(await screen.findByRole("group", { name: /Proctoring/ })).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-row.test.tsx`
Expected: FAIL — `"proctoring"` is not a `PanelKey`.

- [ ] **Step 3: Add `"proctoring"` to `PANEL_KEYS` and mount `ProctoringPanel` as the sixth row**

The summary string is built from `resolveProctoring`, not from the raw overrides, so a row reads the same as the runtime behaves. `ProctoringPanel` is a shell in this task — the controls arrive in Task 2.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-row.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/testbuilder apps/web/src/routes/test.tsx apps/web/test/testbuilder/proctoring-row.test.tsx
git commit -m "feat(web): proctoring becomes the sixth setting row"
```

---

### Task 2: fifteen controls in three groups

**Files:**
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx`
- Modify: `apps/web/src/styles/testbuilder.css`
- Test: `apps/web/test/testbuilder/proctoring-controls.test.tsx`

**Interfaces:**
- Consumes: `ProctoringOverrides` and `PROCTORING_DEFAULTS` (7a); `registration.css`'s `--control-accent` / `--control-accent-ink` / `--control-edge` (`D17`).

**`Q8`** — three `D16` grids: **gating** (`desktop_only`, `require_fullscreen`, `block_copy_paste`, `watermark`, `extra_monitor_check`, `allow_calculator`), **camera and microphone** (`require_camera`, `identity_photo`, `snapshot_interval_seconds`, `face_check`, `require_microphone`), **consequences** (`violation_limit`, `violation_action`, `camera_outage_seconds`, `multi_face_snapshots`).

Each group gets **one note under the row**, not help per field. Units are affixes inside the control: `seconds`, `violations`, `snapshots`.

**`Q3`** — `face_check` renders **disabled**, and its reason reaches a screen reader: `aria-describedby` pointing at the copy that names the phase, not adjacent prose.

**`Q11b`** — `snapshot_interval_seconds: 0` means off, and the control must show 0 rather than blank.

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders all fifteen controls across three groups", async () => {
  await openProctoringPanel({});
  for (const name of ["Block phones and tablets", "Require fullscreen", "Require a camera",
    "Identity photo", "Images every", "Count faces in each image", "Require a microphone",
    "Warn after", "When the limit is reached", "Camera may be lost for", "Flag on faces in",
    "Block copy and paste", "Watermark the paper", "Detect extra monitors", "Allow the calculator"]) {
    expect(screen.getByLabelText(new RegExp(name, "i")), name).toBeInTheDocument();
  }
});

// Review Focus 2 — 0 is a value, and the off switch must survive the round trip to the DOM.
it("shows 0 in the interval field rather than a blank", async () => {
  await openProctoringPanel({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } });
  expect(screen.getByLabelText(/Images every/i)).toHaveValue(0);
});

it("sends 0 up when the interval is cleared to zero", async () => {
  const onChange = vi.fn();
  await openProctoringPanel({ profile: "strict", overrides: {} }, { onChange });
  await user.clear(screen.getByLabelText(/Images every/i));
  await user.type(screen.getByLabelText(/Images every/i), "0");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ overrides: expect.objectContaining({ snapshot_interval_seconds: 0 }) }),
  );
});

// Review Focus 4 — the disabled control explains itself to a screen reader.
it("names the phase in the face check's own accessible description", async () => {
  await openProctoringPanel({});
  const control = screen.getByLabelText(/Count faces in each image/i);
  expect(control).toBeDisabled();
  expect(control).toHaveAccessibleDescription(/Phase 8/);
});

it("uses no browser-default checkbox or radio", async () => {
  await openProctoringPanel({});
  for (const el of screen.getAllByRole("checkbox")) {
    expect(getComputedStyle(el).appearance).toBe("none");
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-controls.test.tsx`
Expected: FAIL — the panel is a shell.

- [ ] **Step 3: Implement the three grids**

Each group is one grid with three tracks; each field a `subgrid` spanning all three, `align-self: start`; `@supports not (grid-template-columns: subgrid)` reserves the help track. Every `id`, `for` and `aria-describedby` from `useId()`.

- [ ] **Step 4: Run the controls test and `D16`'s spread measurement**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-controls.test.tsx apps/web/test/exam/controls.test.tsx`
Expected: PASS. Label and control-top spread measures **0px** on every live row, as 6.5d's rows do.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/testbuilder/ProctoringPanel.tsx apps/web/src/styles/testbuilder.css apps/web/test/testbuilder/proctoring-controls.test.tsx
git commit -m "feat(web): the fifteen proctoring controls, in three field-row groups"
```

---

### Task 3: the profile rewrites the controls, visibly

**Files:**
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx`
- Test: `apps/web/test/testbuilder/proctoring-profile.test.tsx`

**Interfaces:**
- Consumes: `PROCTORING_DEFAULTS` (7a).

**`Q8a`** — the profile is the panel's first control and it rewrites the rest. An override differing from its profile default is marked, so "what did I change" is answerable without a diff.

**Ruling — changing the profile clears the overrides, and says so before it does.** The three readings were: silently discard the organiser's edits (destructive and invisible), keep every override (the profile control then does nothing visible, which is `Q8a`'s whole complaint), or clear with a confirmation. The third ships: changing the profile while any override differs from its default asks first, naming how many settings will change. *Cost if wrong:* one extra click on a control an organiser touches once per test. The alternative costs them fifteen edits with no warning.

- [ ] **Step 1: Write the failing tests**

```tsx
it("marks an override that differs from its profile default", async () => {
  await openProctoringPanel({ profile: "strict", overrides: { require_camera: false } });
  const row = screen.getByRole("group", { name: /Require a camera/i });
  expect(within(row).getByText(/changed from Strict/i)).toBeVisible();
});

it("marks nothing when every control sits at its profile default", async () => {
  await openProctoringPanel({ profile: "strict", overrides: {} });
  expect(screen.queryByText(/changed from/i)).toBeNull();
});

// Review Focus 1 — visible, confirmable, not silent.
it("asks before a profile change discards overrides, and names how many", async () => {
  await openProctoringPanel({ profile: "strict", overrides: { require_camera: false, watermark: false } });
  await user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
  expect(await screen.findByText(/2 settings/)).toBeVisible();
});

it("changes the profile without asking when nothing was overridden", async () => {
  const onChange = vi.fn();
  await openProctoringPanel({ profile: "strict", overrides: {} }, { onChange });
  await user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
  expect(onChange).toHaveBeenLastCalledWith({ profile: "standard", overrides: {} });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-profile.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the marking and the confirmation**

"Differs" is computed against `PROCTORING_DEFAULTS[profile]`, field by field, with the same presence rules Task 1 of 7a fixed — an absent key is not a difference.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-profile.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/testbuilder/ProctoringPanel.tsx apps/web/test/testbuilder/proctoring-profile.test.tsx
git commit -m "feat(web): the profile rewrites the controls, and says what it will change"
```

---

### Task 4: the cost, on the screen

**Files:**
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx`
- Create: `apps/web/src/lib/snapshot-cost.ts`
- Test: `apps/web/test/testbuilder/proctoring-cost.test.tsx`

**Interfaces:**
- Produces:

```ts
/** `Q11`: per candidate, never a total — the product does not know the headcount. */
export function snapshotCost(input: {
  durationMinutes: number | null;
  resolved: ResolvedProctoring;
}): { images: number; megabytes: number; uploads: number } | null;
```

**`Q11`** — the panel states "≈ 60 images · ≈ 1.5 MB · ≈ 60 uploads per candidate". The upload count is there because **requests, not bytes, are the ceiling**: `Q4`'s worst case is 216,000 Worker requests across 300 candidates against a free-plan limit of 100,000 a day.

**`Q11a`** — the per-image constant is the 25 KB `Tail.tsx:125` already states publicly, imported rather than retyped.

- [ ] **Step 1: Write the failing tests**

```ts
it("counts images, megabytes and uploads per candidate", () => {
  expect(snapshotCost({ durationMinutes: 60, resolved: strictResolved })).toEqual({
    images: 60, megabytes: 1.5, uploads: 60,
  });
});

it("adds the identity photo to the count", () => {
  const r = { ...strictResolved, identityPhoto: true };
  expect(snapshotCost({ durationMinutes: 60, resolved: r })?.images).toBe(61);
});

it("returns null when snapshots are off", () => {
  expect(snapshotCost({ durationMinutes: 60, resolved: { ...strictResolved, snapshotIntervalSeconds: 0, identityPhoto: false } })).toBeNull();
});

// Review Focus 3 — #179's shape: a test with no duration.
it("returns null rather than NaN when the test has no duration", () => {
  expect(snapshotCost({ durationMinutes: null, resolved: strictResolved })).toBeNull();
});
```

```tsx
it("says the figure cannot be computed until a duration is set", async () => {
  await openProctoringPanel({ profile: "strict", overrides: {} }, { durationMinutes: null });
  expect(await screen.findByText(/Set a duration under Timing to see what this costs/i)).toBeVisible();
});

it("shows uploads beside megabytes", async () => {
  await openProctoringPanel({ profile: "strict", overrides: {} }, { durationMinutes: 60 });
  expect(await screen.findByText(/≈ 60 images · ≈ 1\.5 MB · ≈ 60 uploads per candidate/)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-cost.test.tsx`
Expected: FAIL — `snapshotCost` does not exist.

- [ ] **Step 3: Implement `snapshotCost` and render the line**

`images = floor(durationMinutes * 60 / snapshotIntervalSeconds) + (identityPhoto ? 1 : 0)`, null when the interval is 0 and no identity photo, null when `durationMinutes` is null. Megabytes rounded to one decimal.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-cost.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/snapshot-cost.ts apps/web/src/components/testbuilder/ProctoringPanel.tsx apps/web/test/testbuilder/proctoring-cost.test.tsx
git commit -m "feat(web): the proctoring panel states what the images cost per candidate"
```

---

### Task 5: both grounds, and the accessibility gate

**Files:**
- Modify: `apps/web/src/styles/testbuilder.css`
- Modify: `apps/web/test/contrast-usage.test.ts`
- Test: `apps/web/test/testbuilder/proctoring-a11y.test.tsx`

**Interfaces:**
- Consumes: 6.5b's `theme.css` semantic names (`--ground`, `--ink`, `--accent`…).

**`D1` and `D20`** — every colour-setting selector this panel adds needs a `SURFACE` entry with **real computed ratios on both grounds**. The "changed from Strict" marker and the disabled `face_check` row are the two that will be tight: a marker that reads as a colour alone fails colour-not-alone, and a disabled control still needs a legible label.

- [ ] **Step 1: Write the failing tests**

```tsx
it("has no axe violations in either ground", async () => {
  for (const ground of ["light", "dark"] as const) {
    await openProctoringPanel({ profile: "strict", overrides: { require_camera: false } }, { ground });
    expect(await axe(document.body)).toHaveNoViolations();
  }
});

it("marks a changed override with text, not colour alone", async () => {
  await openProctoringPanel({ profile: "strict", overrides: { require_camera: false } });
  const row = screen.getByRole("group", { name: /Require a camera/i });
  expect(within(row).getByText(/changed from Strict/i)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/testbuilder/proctoring-a11y.test.tsx apps/web/test/contrast-usage.test.ts`
Expected: FAIL — `contrast-usage` reports selectors with no `SURFACE` entry.

- [ ] **Step 3: Add a `SURFACE` entry per new selector, one per ground**

Fix any ratio that falls short by changing the **token the selector reads**, never by relaxing the assertion (`AG5`).

- [ ] **Step 4: Run the full web suite**

Run: `npx turbo run test --filter=@pariksha/web`
Expected: PASS — including `contrast-usage.test.ts`, `no-hex-colors.test.ts`, `component-dimensions.test.ts` and all 35 `axe` files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/testbuilder.css apps/web/test
git commit -m "feat(web): the proctoring panel on both grounds, with its contrast entries"
```

---

## Done when

The sixth row states its resolved setting; fifteen controls sit in three `D16` grids with `D17`'s painting and `useId()` ids; the profile rewrites them visibly and asks before discarding; the cost line names images, megabytes and uploads per candidate and says plainly when it cannot; and the whole web suite is green on both grounds with no bar moved.
