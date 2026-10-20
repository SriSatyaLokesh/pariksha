# Phase 6.5e — The Remaining Organiser Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dress the remaining organiser screens in the language the first three plans established, settle what moves out of `signal.css`, and migrate every test file touched along the way to reachability (`G5`, `D10`, `D12`, `D18`, `D19`, `D21a`, `D14`).

**Architecture:** No new screens and no new capability. Each screen loses its bespoke chrome to 6.5c's `OrganiserShell`, swaps `admin.css`'s 196 lines of placeholder styling for 6.5b's semantic names, and takes the component rules the prototypes settled. The one genuinely new construct is the **sticky action gutter** (`D21a`), written once in the shared table rules so every table in the product inherits it. `ImportDialog` becomes a page, and `QuestionPickerDrawer` becomes a docked column.

**Tech Stack:** Preact/React + TypeScript, Vitest + Testing Library, Playwright, CSS custom properties.

**Spec:** [`docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md`](../specs/2026-10-20-phase-6-5-design-pass-design.md) — §9 (`D10`), §11 (`D12`, `D14`, `D15`, `D18`, `D19`, `D21a`), §12.

**Depends on:** **6.5a** for the density gate, **6.5b** for `theme.css`, **6.5c** for `OrganiserShell` and `readView`/`writeView`, **6.5d** for the field-row rule and the two controls (`D16`, `D17`) which this plan reuses rather than redefines.

**Goals covered:** `G5` — the twelve organiser screens are dressed in the resulting language.

## Global Constraints

Copied verbatim from the spec's §12. Every task's requirements implicitly include this section.

- **`DESIGN.md` front matter is the only place a colour may be declared.** All CSS reads 6.5b's semantic names. `no-hex-colors.test.ts` strips only `/* */` comments — **issue references in CSS go in block comments**.
- **`AG1` — a scanning surface must not show fewer rows than `main`.** Enforced by 6.5a's `apps/web/e2e/density.spec.ts` against figures captured on `main`. **Scope (`D12`): scanning surfaces only** — test list, bank list, bank browser, question picker. It does **not** apply to the question editor, the wizard or sign-in, which are editing surfaces and get air.
- **`AG2`** — never make a gate green by moving a bar. If a scanning surface is short of rows, fix the surface.
- **`AG3`** — every guard exercises behaviour or asserts an invariant.
- **Reachability (`D14`)** — every assertion starts at `OrganiserApp` and clicks its way there. `apps/web/test/authoring/` and `apps/web/test/testbuilder/` are **7,604 lines**; `bank-browser.test.tsx` renders `BankBrowser` directly 13 times. Every file this plan edits is rewritten to that standard. §12's reachability rule exists because **three defects shipped in Phase 6 behind component-level tests**.
- **`D15` — two spacing scales.** Inside a component: 4 / 6 / 8 / 12 / 16. Between the page and its edges: 20 / 28 / 36 / 56.
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-6-5e/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **A table wider than its page** — the sticky action gutter is opaque, so when the table overflows it covers the column it scrolls over. Fixing the gutter without fixing the width moves the defect rather than removing it. Task 1.
2. **A prompt long enough to overflow its cell** — the picker's original bug was `white-space: nowrap` inherited from the table rules. Task 5.
3. **An import whose report is long, and a browser Back press mid-import** — import becomes a page, so Back is now reachable where a modal used to trap it. Task 4.
4. **A question type whose example drawer is opened by keyboard, not hover** — `D18` requires hover *and* focus; a hover-only drawer is unreachable from the keyboard. Task 3.
5. **A section whose shuffle state is toggled while a published version exists** — `shuffle_questions` already ships and defaults to `true`; surfacing it must not change the default or touch a published version. Task 6.

---

### Task 1: the action gutter, written once

**Files:**
- Modify: `apps/web/src/styles/primitives.css` (shared table rules)
- Test: `apps/web/test/tables.test.tsx`, plus one assertion in `apps/web/e2e/density.spec.ts`

**`D21a` — a row action can never be clipped, in any table.** The reported defect was an action button cut off at a bank row's edge. The cause was **two things at once**: the action cell had no reserved width, and the table was wider than the page. Both are fixed as rules so every table inherits them:

- `th.acts, td.acts` are `position: sticky; right: 0` inside their own scroll container, with width **always reserved**.
- The reveal is `opacity` alone, **never `visibility`** — the buttons stay tabbable, and tabbing onto one reveals the set through `tr:focus-within`.
- **Revealing an action must never widen a row.**

**Where a table still does not fit, the fix is the table** — fold the id under the name, let one column wrap — **not the gutter.** An opaque sticky cell over a column that is scrolling under it is the same defect wearing a different hat.

- [ ] **Step 1: Write the failing tests**

```tsx
it("reserves the action column's width whether or not the actions show", async () => {
  const before = columnWidths(); await hoverRow(0);
  expect(columnWidths()).toEqual(before);
});
it("keeps action buttons focusable before they are revealed", async () => {
  await user.tab(); /* … */ expect(exportButton()).toHaveFocus();
});
it("reveals the actions when one of them takes focus", async () => { /* tr:focus-within */ });
```

- [ ] **Step 2: Add the browser assertion to the density spec**

```ts
it("never clips a row action, on any scanning surface", async ({ page }) => {
  for (const surface of SURFACES) {
    await openAndHoverFirstRow(page, surface);
    expect(await actionsFullyInsidePanel(page)).toBe(true);
    expect(await pageScrollsSideways(page)).toBe(false);
  }
});
```

jsdom has no layout, so the clipping claim has to be made in a browser (`AG3`).

- [ ] **Step 3: Run both, implement the rules, run again**

Run: `npx turbo run test --filter=@pariksha/web -- tables` and `npx playwright test apps/web/e2e/density.spec.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/primitives.css apps/web/test/tables.test.tsx apps/web/e2e/density.spec.ts
git commit -m "feat(web): a row action can never be clipped, in any table (D21a)"
```

---

### Task 2: the test list, the bank list and the bank browser

**Files:**
- Modify: the test-list, bank-list and bank-browser screens under `apps/web/src/routes/` and `apps/web/src/components/`
- Modify: `apps/web/src/styles/admin.css` (196 lines — the placeholder this phase retires)
- Test: `apps/web/test/testbuilder/`, `apps/web/test/authoring/bank-browser.test.tsx`

**`D7c` — the test list distinguishes two kinds of draft.** "Draft · never published" (`currentVersion === null`) versus "Draft · changes since v1" (`draftVersion > currentVersion`), which the wire already supports. **No readiness meter here** — the list route loads version heads, not draft bodies, so a real "5 / 7" is one checklist call per row. If Phase 8 adds an aggregate, the meter moves here for free.

The prototype split this across two columns: **State** is the lifecycle (Open / Scheduled / Draft / Closed), **Version** is the publish history (never published / v1 live / v1 live · v2 draft). Test state carries **no hue** (`D1`) — glyph and label on inherited ink; the only colour is the review flag.

**`D18` — the bank browser opens with the rail collapsed.** Browsing is where the page wants width; the toggle still restores it.

**`D14`** — `bank-browser.test.tsx` renders `BankBrowser` directly 13 times. Rewrite every one to start at `OrganiserApp`. `D3` deletes props those tests pass, so they must be touched anyway.

- [ ] **Step 1: Write the failing tests**

```tsx
it("tells a never-published draft from one with changes since publish", async () => {
  await openTests();
  expect(rowFor("Data structures midterm")).toHaveTextContent("never published");
  expect(rowFor("Quant practice 1")).toHaveTextContent("v1 live · v2 draft");
});
it("shows no readiness meter in the list", async () => {
  expect(screen.queryByText(/\d \/ \d/)).toBeNull();
});
it("makes one tests() call and no checklist call", async () => {
  expect(clientCalls().filter((c) => c === "checklist")).toHaveLength(0);
});
it("carries no hue on test state", async () => { /* invariant: no state-coloured selector */ });
it("opens the bank browser with the rail collapsed, and restores it", async () => { /* … */ });
```

The third is the guard that keeps `D7c` honest — an invariant, not a mechanism.

- [ ] **Step 2: Run, restyle the three screens, run again**

- [ ] **Step 3: Run the density gate**

Run: `npx playwright test apps/web/e2e/density.spec.ts`
Expected: PASS against `main`'s figures. **If a surface shows fewer rows, fix the surface** (`AG2`). The known lever: the id under the name costs 16.5px a row — 11 visible against 15 without it, with 0px of horizontal slack to inline it into. **This is the trade `D13` was built to settle; settle it with the measurement, not by eye.**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): dress the three list surfaces, and tell the two drafts apart (G5, D7c)"
```

---

### Task 3: the question type picker

**Files:**
- Modify: `apps/web/src/components/authoring/TypePicker.tsx` (65 lines)
- Test: `apps/web/test/authoring/type-picker.test.tsx`

**`D18`** — type picker cards are `align-content: start` and open a **drawn miniature** of that question type on hover *and* keyboard focus, animated `0fr→1fr` so nothing jumps. **Twelve distinct examples — a description is not an example.**

`align-content: start` pins the title and description to the top, so a card whose example is closed does not centre its text in the gap left by a taller neighbour.

- [ ] **Step 1: Write the failing tests**

```tsx
it("opens the example on keyboard focus, not only on hover", async () => {
  await user.tab(); expect(exampleFor("single")).toBeVisible();
});
it("draws a distinct example for each of the twelve types", async () => {
  expect(new Set(TYPES.map(exampleMarkupFor)).size).toBe(12);
});
it("does not change the card grid's height when an example opens", async () => { /* 0fr→1fr */ });
```

- [ ] **Step 2: Run, implement, run again, commit**

```bash
git add apps/web/src/components/authoring/TypePicker.tsx apps/web/test/authoring/type-picker.test.tsx
git commit -m "feat(web): the type picker draws each type rather than describing it (D18)"
```

---

### Task 4: import becomes a page

**Files:**
- Delete: `apps/web/src/components/authoring/ImportDialog.tsx` (295 lines)
- Create: `apps/web/src/routes/import.tsx`
- Modify: `apps/web/src/lib/view-url.ts` — import is **its own view** (`?view=import&bank=`), not a `?panel=` value. `PanelKey` in 6.5d names the five settings panels only; reusing it here would collide.
- Create: the sample generator and its route
- Test: `apps/web/test/authoring/import.test.tsx`

**`D18`** — import is a **page, not a modal** (owner's preference): linkable, no focus trap, room for a long report, sticky action bar. It carries **"Download a sample"** — generated from `schemas/question-1.json`, one question of every type, **so it cannot drift from what the importer accepts.**

A generated sample is the whole point: a hand-written one is a second source of truth that silently rots.

- [ ] **Step 1: Write the failing tests**

```tsx
it("is reachable at its own address and traps no focus", async () => {
  await openOrganiser({ search: "?view=import&bank=bnk_1" });
  await user.tab(); /* focus leaves the form freely */
});
it("survives a Back press mid-import without losing the report", async () => { /* … */ });
it("offers a sample generated from the schema, with one question of every type", async () => {
  const sample = await downloadSample();
  expect(new Set(sample.questions.map((q) => q.type)).size).toBe(12);
});
it("validates the generated sample against the importer", async () => {
  expect(await importDryRun(await downloadSample())).toEqual({ errors: [] });
});
```

The last one is the guard that makes "cannot drift" true rather than aspirational.

- [ ] **Step 2: Run, build the page and the generator, run again**

Keep the existing import validation and dry-run behaviour **unchanged** — this task moves the surface, not the rules. Import stays all-or-nothing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/import.tsx apps/web/test/authoring/import.test.tsx
git rm apps/web/src/components/authoring/ImportDialog.tsx
git commit -m "feat(web): import is a page with a schema-generated sample (D18)"
```

---

### Task 5: the question picker docks beside the paper

**Files:**
- Modify: `apps/web/src/components/testbuilder/QuestionPickerDrawer.tsx`
- Test: `apps/web/test/testbuilder/question-picker.test.tsx`

**`D18`** — the picker **docks as a right-hand column** beside the paper rather than floating over it, which serves `UX-14` better. Prompts **wrap and clamp to two lines**; the overflow bug was `white-space: nowrap` inherited from the table rules.

- [ ] **Step 1: Write the failing tests**

```tsx
it("keeps the paper visible while picking", async () => {
  await openPicker(); expect(screen.getByRole("heading", { name: /Sections/ })).toBeVisible();
});
it("wraps a long prompt and clamps it to two lines", async () => {
  expect(whiteSpaceOf(promptEl())).not.toBe("nowrap");
});
it("traps no focus and closes on Escape", async () => { /* … */ });
```

- [ ] **Step 2: Run, implement, run again, commit**

```bash
git add apps/web/src/components/testbuilder/QuestionPickerDrawer.tsx \
        apps/web/test/testbuilder/question-picker.test.tsx
git commit -m "feat(web): the question picker docks beside the paper (D18, UX-14)"
```

---

### Task 6: shuffling — surface the half that exists, disable the half that does not

**Files:**
- Modify: `apps/web/src/components/testbuilder/SectionList.tsx`
- Test: `apps/web/test/testbuilder/shuffle.test.tsx`

**`D19`, verified in the code, not assumed:**

- **Questions within a section: already supported and already built.** `shuffle_questions` is a per-section boolean defaulting to `true` (`schemas/test-1.json:235`), and `SectionList.tsx:681` renders a `ShuffleFieldset`. The redesign surfaces it as a **chip on each section row**.
- **Options within a question: supported.** `shuffle_options` per question, written by `QuestionEditor.tsx:39`.
- **Order of the sections themselves: NOT supported.** No `shuffle_sections` anywhere. It needs a new field in `pariksha/test@1`, a format version bump, and a decision about whether per-section time limits still hold when order varies.

**Ruling — section-order shuffling is out of scope.** A feature and an ADR, not a design control. Render the control **disabled**, saying exactly that, so the control has a home when it lands **and nobody draws a toggle that does nothing.**

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows each section's shuffle state as a chip", async () => { /* on by default */ });
it("does not change the default when surfacing it", async () => {
  expect(draftAfterRender().sections[0].shuffle_questions).toBe(true);
});
it("renders the section-order control disabled and says why", async () => {
  const el = screen.getByLabelText(/Order of the sections themselves/);
  expect(el).toBeDisabled();
  expect(screen.getByText(/Not supported today/)).toBeVisible();
});
it("sends no shuffle_sections field", async () => {
  expect(JSON.stringify(lastDraftPatch())).not.toContain("shuffle_sections");
});
```

The last is the guard that keeps the disabled control inert.

- [ ] **Step 2: Run, implement, run again, commit**

```bash
git add apps/web/src/components/testbuilder/SectionList.tsx apps/web/test/testbuilder/shuffle.test.tsx
git commit -m "feat(web): surface shuffle where it exists, disable where it does not (D19)"
```

---

### Task 7: `D10` — what moves out of `signal.css`

**Files:**
- Modify: `apps/web/src/styles/signal.css` (1,005 lines), `apps/web/src/styles/primitives.css` (140 lines)
- Create: `docs/superpowers/notes/2026-10-20-d10-moved-constructs.md`
- Test: `apps/web/test/contrast-usage.test.ts`, `apps/web/test/landing.test.tsx`

**`D10`** — a construct moves from `signal.css` to `primitives.css` **only when the organiser needs the same structure**. A construct whose *reason for existing* is the marketing page — the hero field, the demo, the metric tiles, the comparison band, the FAQ accordion — **stays put even where its geometry would be reusable.**

Structure-versus-purpose is the only line checkable by reading one selector. **Over-moving is worse than under-moving**: it is `admin.css:99-101`'s own warning about marketing styling in an editing tool.

Candidates to judge, one line of reason each: `.signal-btn` / `--ghost`, `.signal-chip`, `.signal-field`, `.signal-panel`, `.signal-card`, `.signal-row`, `.signal-pill` / `--clean` / `--review` / `--risk`, `.signal-scroll-x`, `.signal-eyebrow`, `.signal-fine`, `.signal-list`. Stay-put by purpose: `.signal-hero`, `.signal-metric(s)`, `.signal-cmp`, `.signal-faq`, `.signal-split`, `.signal-footer`, `.signal-nav`.

- [ ] **Step 1: Write the note first — the decision is the deliverable**

One table: construct, verdict, one line of reason. Write it **before** moving anything; #181 names deciding this wrong in either direction as expensive.

- [ ] **Step 2: Write the failing test**

```ts
it("leaves the landing page rendering exactly as before", async () => { /* landing.test.tsx, unchanged */ });
it("declares no moved construct in both files", () => {
  expect(selectorsDefinedTwice(signalCss, primitivesCss)).toEqual([]);
});
```

- [ ] **Step 3: Move only what the note justifies, run both suites**

Run: `npx turbo run test --filter=@pariksha/web -- landing contrast`
Expected: PASS. The landing page is **not** in #187's scope and must not change.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/signal.css apps/web/src/styles/primitives.css \
        docs/superpowers/notes/2026-10-20-d10-moved-constructs.md
git commit -m "refactor(web): move shared structure out of signal.css, by purpose (D10)"
```

---

### Task 8: sign-in and the first-run wizard

**Files:**
- Modify: the sign-in and setup arms of `apps/web/src/routes/organiser.tsx`
- Test: `apps/web/test/organiser.test.tsx`

**`D18`** — sign-in and the first-run wizard use a **split layout**: the Signal field quieted to one masked radial glow plus a grid, carrying the wordmark, a headline and three checkable facts; the form on the right. **Below 900px the brand half drops and the form stands alone.**

**A bare screen is a `block`, not a grid with zero-width columns.** With the bar and rail `display: none`, auto-placement put the page in the 0-wide first column and the screen rendered empty. This is the same trap as `D3a` and it has now been hit twice.

These are **editing surfaces** — `AG1` does not apply (`D12`).

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders the sign-in form with no shell around it", async () => { /* not empty */ });
it("renders content, not an empty screen, when the rail and bar are absent", async () => {
  expect(signInRoot()).not.toBeEmptyDOMElement();
});
it("drops the brand half below 900px and keeps the form", async () => { /* … */ });
it("numbers the three facts and names the mechanism in each", async () => { /* … */ });
```

- [ ] **Step 2: Run, implement, run again, commit**

```bash
git add apps/web/src/routes/organiser.tsx apps/web/test/organiser.test.tsx
git commit -m "feat(web): split layout for sign-in and the wizard (D18)"
```

---

### Task 9: the whole-phase gates

- [ ] **Step 1: Run every suite on both grounds**

Run: `npx turbo run test --force --concurrency=1`
Expected: PASS, including the 35 `axe` files and `contrast-usage` on dark and light.

- [ ] **Step 2: Run the density gate and the e2e suite**

Run: `npx playwright test --reporter=line`
Expected: PASS against `main`'s before-figures. **No figure may be lowered** (`AG2`).

- [ ] **Step 3: Confirm `admin.css`'s expired comment is gone**

`admin.css:99-101` explained why the organiser had no persistent navigation. That reason has expired. Run `grep -n "" apps/web/src/styles/admin.css` and confirm the file is either deleted or reduced to what the shell does not cover.

- [ ] **Step 4: Build**

Run: `SITE_URL='https://pariksha.example' pnpm build`
Expected: success, and `bundle.test.ts` still enforces that no page loads both typeface pairs.
