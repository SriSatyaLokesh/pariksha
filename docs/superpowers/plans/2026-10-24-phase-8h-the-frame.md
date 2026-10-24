# Phase 8h — the frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the measured page-geometry and token-consistency defects on the organiser surfaces, and leave a browser-measured gate behind each one so they cannot return unseen.

**Architecture:** Every task is test-first against a real browser, because `jsdom` has no layout engine and cannot observe any defect in this plan. Tasks 1–3 and 7 each add a reusable assertion to one new Playwright module, `apps/web/e2e/frame.ts`, alongside the existing `e2e/density.ts`; the remaining tasks consume those helpers. Each gate is proven able to fail by breaking the fix on purpose and watching the test go red, then restoring.

**Tech Stack:** Playwright (Chromium, the existing `apps/web` e2e harness), CSS custom properties from `apps/web/src/styles/tokens.css`, Preact/React route components.

**Spec:** `docs/superpowers/specs/2026-10-24-phase-8h-the-frame-design.md`

## Global Constraints

- Binding design language: `docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md` (Signal dark). Where craft advice disagrees with it, the spec wins.
- `apps/web/test/no-hex-colors.test.ts` bans raw hex **and CSS named colours** (`black`, `green`, `blue`) anywhere in `apps/web/src`, and bans the inline `style={}` attribute outright.
- `apps/web/test/contrast-usage.test.ts` requires a `SURFACE` entry for every new colour-setting selector in the `admin.css` / `landing.css` import chain.
- Spacing and radius values come from tokens only: `--space-xs/sm/base/md/lg/xl/2xl/3xl/4xl/5xl` = 4/6/8/12/16/24/32/40/64/96px; `--rounded-none/xs/sm/md/lg/full` = 0/3/4/6/8/9999px.
- **`apps/web/e2e/measurement/density.spec.ts`'s pinned row heights must not move.** `testList` is 182px and that is intentional. A change that moves a baseline is out of scope; stop and report instead.
- Run e2e with an unreserved port: `WEB_PORT=4373`. The harness default collides with the Windows excluded range `4198–4297`.
- Full suite, when run at all, is `npx turbo run test --concurrency=1 -- --no-file-parallelism`. Note the bare `--`; without it turbo rejects the flag and **still exits 0**. Read the output, never the status.
- Build `packages/core`, `packages/db`, `packages/storage` before type-checking an app: `npx turbo run build --filter=@pariksha/core --filter=@pariksha/db --filter=@pariksha/storage --concurrency=1`.
- Lint with `pnpm run lint` in the package, never eslint on a file list.
- Commit as `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`. Never create a git worktree.

## Review Focus

Five conditions the spec implies that no task's own tests would otherwise exercise. Each has its test added to the task that owns the code.

1. **A builder page with more than the current six column-one children** — the existing `span 40` comment admits the rail's sticky behaviour is child-count dependent, so the Task 1 fix must hold when the page grows. Test in Task 1.
2. **A collapsed rail (`data-state="lights"`, 52px) rather than docked (20rem)** — Task 2 widens the editing column against the rail's width; the collapsed state is the other half of that calculation. Test in Task 2.
3. **A control that is large enough only because its text is long** — "Copy short link" is 97×68 because it wraps. A target-size gate that measures rendered boxes passes such a control while a one-word label on the same class would fail. Test in Task 3 with the shortest label on each audited class.
4. **A viewport between the tested breakpoints** — Tasks 1 and 2 assert at 1280 and 1440; the clamp and the grid change behaviour continuously, so a width between them is where an off-by-one gutter hides. Test in Task 2 at 1366, the most common laptop width.
5. **A screen with no rail at all** — the `:has(> .checklist-rail)` selector means every other organiser screen takes a different layout path, and Task 1's fix must not alter them. Test in Task 1 across `tests`, `banks`, `analytics`, `grading`.

---

### Task 1: The dead-scroll gate, and the grid fault behind it

Fixes **F1**. The page scrolls 568px past its content because the rail spans 40 grid rows, 34 of them empty, and each empty row still pays `.organiser`'s inherited 16px `row-gap`.

**Files:**
- Create: `apps/web/e2e/frame.ts`
- Create: `apps/web/e2e/measurement/frame.spec.ts`
- Modify: `apps/web/src/styles/testbuilder.css:937-961` (the `:has(> .checklist-rail)` rules and the comment block above them)
- Modify: `apps/web/src/routes/test.tsx` — wrap the six column-one children in one element

**Interfaces:**
- Consumes: `seedWorkspace`, `signIn`, `ORGANISER` from `apps/web/e2e/seed.ts`; `openSurface` from `apps/web/e2e/density.ts`.
- Produces, in `apps/web/e2e/frame.ts`:
  - `openBuilder(page: Page, testId: string): Promise<void>` — navigates to `?view=test&test=<id>` and waits for the builder to render.
  - `deadScrollPx(page: Page): Promise<number>` — `document.documentElement.scrollHeight` minus the greatest `getBoundingClientRect().bottom + scrollY` over all elements inside `main`.
  - `ORGANISER_VIEWS: readonly string[]` — the view query strings for `tests`, `banks`, `analytics`, `grading`, used by later tasks too.

- [ ] **Step 1: Write the failing test**

In `apps/web/e2e/measurement/frame.spec.ts`:

```ts
const MAX_DEAD_SCROLL = 24; // one page inset, --space-xl

test("the builder does not scroll past its own content", async ({ page }) => {
  await openBuilder(page, testId);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await deadScrollPx(page), `at ${width}`).toBeLessThanOrEqual(MAX_DEAD_SCROLL);
  }
});

test("a longer builder page does not reintroduce dead scroll", async ({ page }) => {
  // Review Focus 1: append eight filler children to the grid, then re-measure.
  await openBuilder(page, testId);
  await page.evaluate(() => {
    const main = document.querySelector("main")!;
    for (let i = 0; i < 8; i++) main.appendChild(document.createElement("p")).textContent = "x";
  });
  expect(await deadScrollPx(page)).toBeLessThanOrEqual(24);
});

test("the no-rail organiser screens keep their layout", async ({ page }) => {
  // Review Focus 5.
  for (const view of ORGANISER_VIEWS) {
    await page.goto(`${ORGANISER}?${view}`);
    expect(await deadScrollPx(page), view).toBeLessThanOrEqual(24);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts -g "does not scroll past"`
Expected: FAIL, roughly `expected 568 to be less than or equal to 24`. Record the actual number in the commit message.

- [ ] **Step 3: Wrap the builder's column-one children in one element**

In `apps/web/src/routes/test.tsx`, put the six children that currently sit beside `checklist-rail` inside a single `<div className="testbuilder-main">`. The grid then has exactly two children and needs no row span.

- [ ] **Step 4: Replace the span with a two-cell grid**

In `apps/web/src/styles/testbuilder.css`, drop `grid-row: 1 / span 40` from `.shell__page > .checklist-rail`, give `.testbuilder-main` the column layout the page used to carry (`display: flex; flex-direction: column; gap: var(--space-lg)`), and set `row-gap: 0` on the two-cell grid so no inherited gap survives.

**Delete the comment above that rule that says the span "costs nothing"** — zero-height rows pay their row-gap, which is the whole defect. Replace it with one clause saying the grid holds exactly two cells so no implicit rows exist.

- [ ] **Step 5: Run to verify all three tests pass**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts`
Expected: PASS.

- [ ] **Step 6: Probe the gate**

Restore `grid-row: 1 / span 40` and confirm the first test goes red with a number near 568. Restore the fix and confirm green. A gate never seen to fail is not known to work.

- [ ] **Step 7: Confirm the rail still sticks and the density baselines have not moved**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/checklist-rail.spec.ts e2e/measurement/density.spec.ts`
Expected: PASS, unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/web/e2e/frame.ts apps/web/e2e/measurement/frame.spec.ts apps/web/src/styles/testbuilder.css apps/web/src/routes/test.tsx
git commit -m "fix(web): the builder's rail spanned 40 grid rows and paid row-gap on 34 empty ones"
```

---

### Task 2: The editing column takes the width it is given

Fixes **F2**. `.organiser--wide`'s 1080px clamp holds the editor at 672px on a 1440px screen while ~990px of right column sits empty.

**Files:**
- Modify: `apps/web/src/styles/admin.css:280-283` (`.organiser--wide`) or `apps/web/src/styles/testbuilder.css` — whichever keeps the clamp intact for non-builder screens
- Modify: `apps/web/e2e/frame.ts` — add `editorWidthRatio`
- Modify: `apps/web/e2e/measurement/frame.spec.ts`

**Interfaces:**
- Consumes: `openBuilder`, `deadScrollPx` from Task 1.
- Produces: `editorWidthRatio(page: Page): Promise<number>` — the width of `.testbuilder-main` divided by the width of the shell's page track (excluding the nav).
- Produces: `collapseRail(page: Page): Promise<void>` — puts the rail into `data-state="lights"` through its own control, not by setting the attribute, so the test exercises the real path.

- [ ] **Step 1: Write the failing test**

```ts
test("the builder's editing column grows with the viewport", async ({ page }) => {
  await openBuilder(page, testId);
  for (const width of [1280, 1366, 1440, 1920]) {   // 1366 is Review Focus 4
    await page.setViewportSize({ width, height: 900 });
    expect(await editorWidthRatio(page), `at ${width}`).toBeGreaterThanOrEqual(0.6);
  }
});

test("a collapsed rail gives its width back to the editor", async ({ page }) => {
  // Review Focus 2: the 52px `data-state="lights"` rail, not the 20rem docked one.
  await openBuilder(page, testId);
  await collapseRail(page);
  expect(await editorWidthRatio(page)).toBeGreaterThanOrEqual(0.75);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts -g "grows with the viewport"`
Expected: FAIL at 1440 with a ratio near 0.47.

- [ ] **Step 3: Raise the clamp for the builder only**

Give the builder page its own max-width above a stated breakpoint, leaving `.organiser--wide`'s 1080px in force for every other screen. `.organiser--full` (`D18`) is the existing precedent for a per-screen opt-out; follow its shape rather than inventing a second mechanism.

- [ ] **Step 4: Run to verify both tests pass**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts`
Expected: PASS, dead-scroll tests from Task 1 still green.

- [ ] **Step 5: Confirm no other screen's width moved**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/density.spec.ts e2e/measurement/split-screen.spec.ts`
Expected: PASS, unchanged. `bankBrowser`'s width is baseline-sensitive — if it moves, stop and report.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles apps/web/e2e/frame.ts apps/web/e2e/measurement/frame.spec.ts
git commit -m "fix(web): the builder's editing column was capped at 672px on a 1440px screen"
```

---

### Task 3: A target-size gate, and every control under 24px

Fixes **F3**'s WCAG half. Known failures: the section-position input at **64×21**, grading's `#grading-blind` at **17×17**, `button.shell__mark` at **64×24** beside `shell__icon-button` at 44px. Same class in the companion register: `G2-05`, `G2-07`, `G5-13`.

**Files:**
- Modify: `apps/web/e2e/frame.ts` — add `undersizedTargets`
- Modify: `apps/web/e2e/measurement/frame.spec.ts`
- Modify: `apps/web/src/styles/testbuilder.css`, `apps/web/src/styles/grading.css`, `apps/web/src/styles/shell.css`, `apps/web/src/styles/primitives.css` as each failure requires
- Modify: `apps/web/src/components/organiser/ApiKeyPanel.tsx`, `apps/web/src/components/organiser/UsagePanel.tsx`

**Interfaces:**
- Produces: `AUDITED_VIEWS: readonly string[]` — `ORGANISER_VIEWS` from Task 1 plus the builder, the question editor and import; the full set this plan's gates run over.
- Produces: `undersizedTargets(page: Page, min = 24): Promise<{sel: string, w: number, h: number}[]>` — every rendered, visible, interactive element whose border box is under `min` in either axis, each identified by a selector a reader can paste into devtools.

- [ ] **Step 1: Write the failing test**

```ts
test.each(AUDITED_VIEWS)("no control under 24px on %s", async (view, page) => {
  await page.goto(`${ORGANISER}?${view}`);
  expect(await undersizedTargets(page)).toEqual([]);
});

test("a one-word label on an audited control class still clears 24px", async ({ page }) => {
  // Review Focus 3: "Copy short link" is 97x68 only because it wraps.
  await page.goto(`${ORGANISER}?view=tests`);
  await page.evaluate(() => {
    document.querySelectorAll("button.button-secondary").forEach(b => (b.textContent = "Go"));
  });
  expect(await undersizedTargets(page)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts -g "under 24px"`
Expected: FAIL listing at least the 64×21 input, the 17×17 `#grading-blind` and the 64×24 `shell__mark`.

- [ ] **Step 3: Raise each failing control to a 24px minimum**

Use `min-block-size` and padding from the token scale; do not set a fixed height on anything that holds wrapping text. `shell__mark` and `shell__icon-button` must end at the same height — that inconsistency is **F3**'s second half and shows on every screen.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts -g "under 24px"`
Expected: PASS.

- [ ] **Step 5: Probe the gate**

Set one fixed control back under 24px, confirm the test names that exact selector, restore.

- [ ] **Step 6: Confirm the density baselines have not moved**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/density.spec.ts`
Expected: PASS, unchanged. Raising a control inside a pinned row is the most likely way this plan breaks a baseline.

- [ ] **Step 7: Commit**

```bash
git commit -m "fix(web): every interactive control now clears WCAG 2.5.8's 24px floor"
```

---

### Task 4: The section row gets one baseline

Fixes **F3**'s alignment half: `↑`/`↓` at 36×26, a label stacked over a number input, and a summary line plus chip — three baselines, nothing shared.

**Files:**
- Modify: `apps/web/src/components/testbuilder/SectionList.tsx`
- Modify: `apps/web/src/styles/testbuilder.css`
- Modify: `apps/web/e2e/measurement/frame.spec.ts`

**Interfaces:**
- Consumes: `openBuilder` from Task 1; `sharedBaseline` added here.
- Produces: `sharedBaseline(page: Page, selector: string): Promise<number>` — the spread in px between the greatest and least text baseline among the matched elements. Task 9 reuses it.

- [ ] **Step 1: Write the failing test**

```ts
test("the section row's controls share one baseline", async ({ page }) => {
  await openBuilder(page, testId);
  expect(await sharedBaseline(page, ".section-list__row > *")).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL with a spread of tens of px.

- [ ] **Step 3: Lay the row out on one line**

The reorder controls, the position field and the section summary sit in one `align-items: baseline` row. The visible label for the position input must stay a real label — use `.visually-hidden` if it does not fit, never drop it. A figure whose meaning rests on position is the defect this project already fixed once on the readiness meter.

- [ ] **Step 4: Run to verify it passes, and that the target-size gate still passes**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts`

- [ ] **Step 5: Run the component's own unit tests**

Run: `cd apps/web && npx vitest run test/testbuilder`
Expected: PASS.

- [ ] **Step 6: Commit**

---

### Task 5: Settings rows read as controls, and two destinations leave Results

Fixes **F4** and register `G3-08`.

**Files:**
- Modify: `apps/web/src/routes/test.tsx:928-940` (the injected "Grading queue" / "Analytics" buttons)
- Modify: `apps/web/src/components/testbuilder/SettingRow.tsx` (or the component that renders `Timing —`)
- Modify: `apps/web/src/styles/testbuilder.css`
- Test: `apps/web/test/testbuilder/` — the existing unit suite for these components

- [ ] **Step 1: Write the failing test**

A unit test asserting each settings row exposes an accessible control — `getByRole("button", { name: /timing/i })` — rather than inert text, and that the "Grading queue" and "Analytics" destinations are **not** descendants of the settings list.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run test/testbuilder`

- [ ] **Step 3: Give each row a control affordance, and move the two destinations**

The rows become buttons with a disclosure affordance that does not rely on colour alone. The two destinations move to the lifecycle toolbar in the test header, beside Publish and Close, where the other navigation already lives.

- [ ] **Step 4: Run to verify it passes**

- [ ] **Step 5: Confirm no axe regression**

Run: `cd apps/web && npx vitest run test/organiser test/testbuilder`
Expected: PASS, including the existing axe assertions.

- [ ] **Step 6: Commit**

---

### Task 6: Remove the dead control above the fold

Fixes **F5**. "Order of the sections themselves" is a checkbox plus a paragraph explaining it does not work.

**Files:**
- Modify: `apps/web/src/components/testbuilder/SectionList.tsx`
- Modify: `apps/web/test/testbuilder/` — remove or invert the test that asserts it renders

- [ ] **Step 1: Write the failing test**

Assert the control is absent: `expect(screen.queryByRole("checkbox", { name: /order of the sections/i })).toBeNull()`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run test/testbuilder`
Expected: FAIL — the checkbox is found.

- [ ] **Step 3: Delete the control and its explanatory paragraph**

Deletion, not disabling. If the capability is still wanted later, the test format needs a new field and a decision about per-section time limits — that is a feature, and it will arrive with its own control.

- [ ] **Step 4: Run to verify it passes**

- [ ] **Step 5: Commit**

---

### Task 7: One rounding system and one type scale, enforced

Fixes **F6**. Measured radius census: builder `3/4/6/9999`, tests `3/6/8/9999`, banks `3/4/8/9999`. The tokens already exist; the drift is in which one each screen reaches for. Same class in the register: `G1-05`, `G1-07`, `G5-15`.

**Files:**
- Modify: `apps/web/e2e/frame.ts` — add `styleCensus`
- Modify: `apps/web/e2e/measurement/frame.spec.ts`
- Modify: the stylesheets each violation lives in
- Create or modify: a unit guard beside `apps/web/test/no-hex-colors.test.ts` that bans a literal `border-radius` or `font-size` value where a token exists

**Interfaces:**
- Produces: `styleCensus(page: Page): Promise<{radii: string[], fontSizes: string[], families: string[]}>` — the distinct computed values in use on the rendered page.

- [ ] **Step 1: Write the failing tests**

A browser test asserting every rendered `border-radius` is one of the six token values, and a source guard asserting no stylesheet in `apps/web/src/styles` sets a literal `border-radius`/`font-size` that a token already names.

- [ ] **Step 2: Run both to verify they fail**

Expected: the source guard names `signal.css`'s `14px` radius (`G1-05`), its subpixel font sizes (`G1-07`), and `analytics.css`'s `10px` headers (`G5-15`).

- [ ] **Step 3: Replace each literal with its token**

`14px` → `var(--rounded-lg)`. Subpixel sizes → the nearest type token. The 10px analytics headers → `var(--type-mono-sm-size)`.

- [ ] **Step 4: Run both to verify they pass**

- [ ] **Step 5: Probe the source guard**

Reintroduce one literal radius, confirm the guard names that file and line, restore.

- [ ] **Step 6: Run the three design guards**

Run: `cd apps/web && npx vitest run test/no-hex-colors.test.ts test/contrast-usage.test.ts test/signal-boundary.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

---

### Task 8: The tests list's action column stops being ragged

Fixes **F7**. "Copy short link" wraps to 97×68 beside 44px siblings; six wrapping control labels on that screen.

**Files:**
- Modify: `apps/web/src/routes/tests.tsx`
- Modify: `apps/web/src/styles/testbuilder.css` or `primitives.css`
- Modify: `apps/web/e2e/measurement/frame.spec.ts`

**Interfaces:**
- Consumes: `sharedBaseline` from Task 4.

- [ ] **Step 1: Write the failing test**

Assert no control label in the action column wraps (`element.clientHeight` within one line-height of its `line-height`), and that the action column's buttons share a height.

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Stop the labels wrapping**

Shorten the label or give the column the width its content needs. **`density.spec.ts` pins this row at 182px** — the fix must not change the row height. If the only way to stop the wrap changes the height, stop and report rather than move the baseline.

- [ ] **Step 4: Run to verify it passes and the baseline holds**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/frame.spec.ts e2e/measurement/density.spec.ts e2e/measurement/row-actions.spec.ts`

- [ ] **Step 5: Commit**

---

### Task 9: The home dashboard's card rows share a line

Fixes **F8**. `span.home__row-time` is 22px off a shared line across two cards in `section.home__pane`.

**Files:**
- Modify: `apps/web/src/styles/home.css`
- Modify: `apps/web/e2e/measurement/frame.spec.ts`

**Interfaces:**
- Consumes: `sharedBaseline` from Task 4.

- [ ] **Step 1: Write the failing test**

```ts
test("the home panes' row times share a line across cards", async ({ page }) => {
  await page.goto(`${ORGANISER}?view=dashboard`);
  expect(await sharedBaseline(page, "section.home__pane span.home__row-time")).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL with a spread near 22.

- [ ] **Step 3: Put the two cards on a shared track**

A shared grid track across the cards, not per-card alignment — the spread exists because each card lays out independently.

- [ ] **Step 4: Run to verify it passes**

- [ ] **Step 5: Run the whole frame gate and the design guards once**

Run: `cd apps/web && WEB_PORT=4373 npx playwright test e2e/measurement/` then `cd apps/web && npx vitest run test/no-hex-colors.test.ts test/contrast-usage.test.ts test/signal-boundary.test.ts`

- [ ] **Step 6: Commit**

---

## Out of scope, named so it is not lost

- **The companion register's other 47 findings** (`docs/UI_UX_AUDIT_REPORT.md`). They are a code-read audit of different defects — destructive actions styled as primary, missing modal scrims, the candidate runtime's broken font scaling, the discrimination-index progress bar. They deserve their own plans, and several are more urgent than anything here: `G4-01` (question deletion with no confirmation), `G5-01` (text scaling does nothing for low-vision candidates), `G5-05` (a screen reader announcing every keystroke during an exam).
- **Verifying that register against the running app.** It scored Group 4 at 7/100 from a code read. This plan's own tooling produced a false positive this session (six contrast failures at ratio 1.0 that are actually ~16:1), so those claims need measuring before they are planned against.
- **`G2-08`**, which proposes changing the tests list's 182px row height. That moves a pinned density baseline.
