# Phase 6.5d — The Test Builder

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the builder's information architecture so what is required is visible from the first minute rather than at the gate (`D7`): sections stay the spine, the five settings collapse into one panel of self-describing rows, and the publish checklist moves from last to always-present in a right rail with a readiness figure.

**Architecture:** `apps/web/src/routes/test.tsx` (588 lines) renders the section list plus six always-mounted panels down one column, with `PublishChecklist` arriving last. The five settings panels — `TimingPanel`, `AccessPanel`, `ReleasePanel`, `BrandingPanel` and the registration form — become collapsed rows that each state their current setting and open in place, one at a time, addressable as `?panel=`. `PublishChecklist` moves into a sticky right rail that can collapse to a 52px strip of indicator lights. This is **mostly deletion plus one disclosure pattern**; `UX-13` stays as written.

**Tech Stack:** Preact/React + TypeScript, Vitest + Testing Library, CSS custom properties.

**Spec:** [`docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md`](../specs/2026-10-20-phase-6-5-design-pass-design.md) — §6 (`D7`, `D7a`–`D7d`), §11 (`D15`, `D16`, `D16a`, `D17`), §12.

**Depends on:** **6.5b** for `theme.css`'s semantic names; **6.5c** for `OrganiserShell` and `readView`/`writeView`.

**Goals covered:** `G3` — the builder's information architecture changes so what is required is visible from the first minute rather than at the gate.

## Global Constraints

Copied verbatim from the spec's §12. Every task's requirements implicitly include this section.

- **`DESIGN.md` front matter is the only place a colour may be declared.** All CSS reads 6.5b's semantic names. `no-hex-colors.test.ts` strips only `/* */` comments — **issue references in CSS go in block comments**.
- **`AG1` does not apply here.** `D12`: the rows-visible gate governs **scanning** surfaces. The builder is an **editing** surface and gets air. Treating the builder as a table is what produced an airless first revision; without this written down, someone later re-crowds an editing screen and cites `AG1` to justify it.
- **`AG2`** — never make a gate green by moving a bar.
- **`AG3`** — every guard exercises behaviour or asserts an invariant.
- **Reachability (`D14`)** — every assertion starts at `OrganiserApp` and clicks its way there. `apps/web/test/testbuilder/` and `apps/web/test/authoring/` are **7,604 lines** today; every file this plan edits is rewritten to that standard. The lighter mechanical prop-drop was offered and refused.
- **`D15` — two spacing scales.** Inside a component: 4 / 6 / 8 / 12 / 16. Between the page and its edges: 20 / 28 / 36 / 56. A usage rule, not new tokens. One scale produced 24px between a label and its own field while blocks that belong together sat 48px apart.
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-6-5d/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **A `localStorage` read that throws while the rail state is being restored** (`D7d`) — private window, cleared storage. The builder must render with the rail in its default state, not blank. Task 3.
2. **A save burst — several edits inside one settle window** — `D7b` says the rail refetches **once** per settled burst. Naively refetching per keystroke is a request storm; refetching only on mount is a rail that lies while the author works. Task 4.
3. **A checklist row naming a section that was deleted between the read and the click** — "Go to Section B" must not navigate into nothing. Task 4.
4. **Two panels asked to open at once** — a hand-typed `?panel=` plus a click, or a stale URL. One at a time is the rule; the resolution must be deterministic. Task 2.
5. **A field row where one field has help and another does not** — `D16`'s whole reason for existing, and the registration form builder and question editor have the same latent bug. Task 5.

---

### Task 1: the settings become rows that state their own setting

**Files:**
- Modify: `apps/web/src/routes/test.tsx:400-520`
- Create: `apps/web/src/components/testbuilder/SettingRow.tsx`
- Modify: `apps/web/src/styles/testbuilder.css`
- Test: `apps/web/test/testbuilder/settings-rows.test.tsx`

**Interfaces:**
- Produces:

```tsx
export function SettingRow(props: {
  id: PanelKey;              // "timing" | "access" | "registration" | "results" | "branding"
  icon: ReactNode;
  label: string;
  summary: string;           // states the CURRENT setting, never a description
  open: boolean;
  onToggle: (id: PanelKey) => void;
  children: ReactNode;       // the existing panel, unchanged
}): JSX.Element;
```

- Consumes: `TimingPanel`, `AccessPanel`, `ReleasePanel`, `BrandingPanel` and the registration form **unchanged** — they become `children`, not rewrites. This task changes where they live and when they mount, not what they contain.

**`D7`** — sections stay the spine. The five settings collapse into one panel of rows that each state their own setting ("Timing — 60 minutes · opens 24 Oct 09:00 IST · closes 24 Oct 18:00 IST"), opening in place, one at a time.

**Why not a wizard:** it fights `UX-13` and fights re-editing a published test, which is never linear. Offered and refused.

**The cost, and the defence:** a collapsed panel is one an organiser must find. Each row states its current setting, so the collapsed state answers "what is timing set to" without being opened. **A summary that describes the setting instead of stating its value fails this task.**

- [ ] **Step 1: Write the failing tests**

```tsx
it("states each setting's current value while collapsed", async () => {
  await openBuilder();
  expect(screen.getByText(/60 minutes · opens 24 Oct 09:00 IST/)).toBeVisible();
});

it("opens one panel at a time", async () => {
  await user.click(rowFor("Timing"));
  await user.click(rowFor("Access"));
  expect(rowFor("Timing")).toHaveAttribute("aria-expanded", "false");
});

it("updates the summary when the setting changes", async () => {
  await user.click(rowFor("Timing"));
  await setDuration(90);
  await user.click(rowFor("Timing"));           // close it
  expect(screen.getByText(/90 minutes/)).toBeVisible();
});

it("says when a setting is empty rather than omitting it", async () => {
  // "Branding — logo set · start message set · finish message empty"
});
```

The third is the one that matters: a summary computed once at mount is a summary that lies.

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- settings-rows`

- [ ] **Step 3: Build `SettingRow` and wrap the five panels**

The summary is a pure function of the draft, derived at render — never cached. Place the five summary functions beside the component; the exact wording for each is left to the builder within one rule: **state the value, not the field**.

- [ ] **Step 4: Run tests, axe and contrast**

Run: `npx turbo run test --filter=@pariksha/web -- settings-rows contrast`
Expected: PASS. New selectors need `SURFACE` entries **on both grounds**.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/test.tsx apps/web/src/components/testbuilder/SettingRow.tsx \
        apps/web/src/styles/testbuilder.css apps/web/test/testbuilder/settings-rows.test.tsx
git commit -m "feat(web): settings collapse into rows that state their own value (D7)"
```

---

### Task 2: `?panel=` addresses the open panel

**Files:**
- Modify: `apps/web/src/routes/test.tsx`
- Consumes: `readView`/`writeView` from `apps/web/src/lib/view-url.ts` (6.5c, Task 2)
- Test: `apps/web/test/testbuilder/url-check.test.tsx` (199 lines, exists)

- [ ] **Step 1: Write the failing tests**

```tsx
it("opens the panel named in the query string", async () => {
  await openBuilder({ search: "?view=test&test=tst_1&panel=access" });
  expect(rowFor("Access")).toHaveAttribute("aria-expanded", "true");
});
it("puts the open panel in the query string", async () => { /* … */ });
it("follows Back from an open panel to the closed builder", async () => { /* … */ });
it("ignores an unknown panel name and opens none", async () => { /* … */ });
it("opens the section when ?section= and ?panel= are both present, and no panel", async () => {
  // deterministic resolution: the spine wins over a setting
});
```

The last is Review Focus 4. The resolution rule — **the spine wins** — is this plan's ruling; record it in the ledger.

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- url-check`

- [ ] **Step 3: Wire `?panel=` through `readView`/`writeView`**

Do not parse the query string here; 6.5c owns the parser.

- [ ] **Step 4: Run and verify they pass, then commit**

```bash
git add apps/web/src/routes/test.tsx apps/web/test/testbuilder/url-check.test.tsx
git commit -m "feat(web): the open settings panel is addressable (D7, D5)"
```

---

### Task 3: the checklist rail, and both sides collapse

**Files:**
- Modify: `apps/web/src/components/testbuilder/PublishChecklist.tsx`
- Modify: `apps/web/src/routes/test.tsx`, `apps/web/src/styles/testbuilder.css`
- Create: `apps/web/src/lib/rail-state.ts`
- Test: `apps/web/test/testbuilder/checklist-rail.test.tsx`

**Interfaces:**
- Produces: `readRailState()` / `writeRailState(s: RailState)` from `apps/web/src/lib/rail-state.ts`, where `RailState` is `{ nav: "open" | "mini"; checklist: "docked" | "lights" }`. Neither throws.
- Consumes: `client.checklist(workspaceId, testId): Promise<ChecklistRow[]>` from `apps/web/src/lib/api.ts:389` — unchanged. The rows `POST …/publish` computes, so the rail **cannot disagree with the gate** (#64).

**`D7`** — the checklist moves from last to **always present** in a right rail with a readiness figure.

**`D7a` — both sides collapse, and editing collapses them.** The nav rail drops to 56px of icons (6.5c owns that); the checklist rail drops to a **52px strip of indicator lights**, one per row — red blocking, amber advisory, dimmed green passing — with the readiness figure above them. Hovering the strip or tabbing into it floats the full panel **over** the page, absolutely positioned: **it must never reflow what is being edited.** A pin button docks it back. Opening a section or a setting retracts both sides automatically, and **both toggles stay operable while a panel is open — auto-collapse is a convenience, never a lock.**

Each light needs a real accessible name — "Blocking — a pool cannot fill. Go to Section B." An icon plus a colour would fail both the contrast rule and colour-not-alone.

**`D7c` — the readiness meter lives here, not in the test list.** The list route loads version heads, not draft bodies, so a real "5 / 7" there is one checklist call per row — fourteen round trips to decorate a list, or a budget raise that sits too close to `AG2`.

**`D7d`** — rail and panel state are **per-viewer**: `localStorage`, not server state, and the page must render correctly when the read throws.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows the checklist beside the spine from the first paint", async () => { /* not at the end */ });
it("shows a readiness figure matching the rows", async () => { /* "5 / 7" with 2 blocking */ });
it("collapses to a strip of lights and back", async () => { /* … */ });
it("gives every light a name that says what and where", async () => {
  expect(screen.getByRole("button", { name: /Blocking — a pool cannot fill\. Go to Section B\./ }))
    .toBeVisible();
});
it("floats the panel over the page without reflowing the spine", async () => {
  const before = spineBox(); await hoverLights();
  expect(spineBox()).toEqual(before);
});
it("retracts both sides when a section opens, and both toggles still work", async () => { /* … */ });
it("renders with the default rail state when localStorage throws", async () => { /* … */ });
```

The reflow assertion is the one that pins `D7a`'s hard requirement; without it, "floats over" is a comment.

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- checklist-rail`

- [ ] **Step 3: Implement the rail, the lights strip and `rail-state.ts`**

Absolute positioning for the floating panel, not a layout change. Wrap every storage access in try/catch.

- [ ] **Step 4: Run tests, axe and contrast; commit**

```bash
git add apps/web/src/components/testbuilder/PublishChecklist.tsx apps/web/src/routes/test.tsx \
        apps/web/src/lib/rail-state.ts apps/web/src/styles/testbuilder.css \
        apps/web/test/testbuilder/checklist-rail.test.tsx
git commit -m "feat(web): the publish checklist becomes a live rail (D7, D7a, D7d)"
```

---

### Task 4: the rail refetches once per settled save burst

**Files:**
- Modify: `apps/web/src/routes/test.tsx`
- Test: `apps/web/test/testbuilder/checklist-rail.test.tsx`

**`D7b`** — the rail refetches `GET …/checklist` **once per settled save burst**, riding the follow-up draft read the builder already fires. **A rail that reads only on mount lies while the author works.**

- [ ] **Step 1: Write the failing tests**

```tsx
it("refetches the checklist once after a burst of edits settles", async () => {
  await typeSeveralEdits();
  await settle();
  expect(checklistCalls()).toHaveLength(1);
});
it("does not refetch per keystroke", async () => { /* … */ });
it("shows a row that a save just cleared", async () => {
  // set the duration, and watch timing_missing leave the rail
});
it("does not navigate into a section deleted since the rail was read", async () => { /* … */ });
```

- [ ] **Step 2: Run and verify they fail**

- [ ] **Step 3: Ride the existing follow-up draft read**

Do not add a second timer. The builder already fires a draft read after a settled save; the checklist call goes with it. **Do not change any debounce interval** (`AG2`).

- [ ] **Step 4: Run and verify they pass; commit**

```bash
git add apps/web/src/routes/test.tsx apps/web/test/testbuilder/checklist-rail.test.tsx
git commit -m "feat(web): the checklist rail refetches once per settled save (D7b)"
```

---

### Task 5: `D16` — the field-row rule, and one checkbox and one radio

**Files:**
- Modify: `apps/web/src/styles/primitives.css` (the field-row grid and the controls)
- Modify: `apps/web/src/components/testbuilder/FormBuilder.tsx`, `apps/web/src/components/authoring/QuestionEditor.tsx`
- Test: `apps/web/test/testbuilder/field-rows.test.tsx`

**`D16`, structure.** A row of fields is **one grid with three tracks** — label, control, help. Each field is a `subgrid` spanning all three; controls are `align-self: start`. Where `subgrid` is unavailable, the help track is **reserved** instead (`@supports not`): one empty line, never a misalignment.

With each field its own grid, a column without help let its control stretch into the space its neighbours spent on text — controls landed on different lines. Padding fixes would have moved the bug, and "give every field help" degrades the copy into filler. **Measured on the prototype: a mixed row misaligns by 20.4px without the rule and 0px with it, under both the real `subgrid` and the forced fallback. A help-free row resolves its tracks to `15px 36px 0px` — the reserved track collapses rather than costing an empty line.**

**`D16`, content — secondary text has exactly three homes.** A **unit** ("min", "IST", "pts") goes *inside* the control as an affix. A **constraint or consequence** goes in the help track. An explanation of the **whole group** is one note under the row, never repeated per field.

**`D16a` — a field id is scoped to its instance, never a literal.** A section panel and a settings panel are both repeated constructs; with a literal id, every `<label for>` resolves to the first instance and clicking a label focuses another panel's input. Use `useId()` or an explicit per-panel prefix for every `id`, `for` and `aria-describedby`.

**`D17` — one checkbox and one radio for the whole product.** `appearance: none`, drawn in the accent with `accent-ink` glyphs, 17px, custom focus ring, 4px radius for the checkbox and full round for the radio. **No browser default anywhere** — native controls rendered in the UA's blue, which belongs to no palette this product has. Custom controls must keep real `<input>` semantics; only the painting changes.

`subgrid` needs Chrome 117+ / Safari 16+ / Firefox 71+; the `@supports` fallback covers the rest.

- [ ] **Step 1: Write the failing tests**

```tsx
it("puts every label in a row on one line and every control on one line", async () => {
  // a row where one field has help and another does not
});
it("reserves the help track where subgrid is unavailable", async () => { /* @supports not path */ });
it("puts a unit inside its control, never in the help track", async () => { /* no <small>min</small> */ });
it("gives each panel instance its own field ids", async () => {
  const ids = allFieldIds(); expect(new Set(ids).size).toBe(ids.length);
});
it("points every label at a control in its own panel", async () => { /* no orphan for= */ });
it("uses no browser-default checkbox or radio", async () => {
  for (const el of allCheckboxesAndRadios()) expect(appearanceOf(el)).toBe("none");
});
it("keeps real input semantics on the custom controls", async () => { /* role, checked, keyboard */ });
```

jsdom has no layout, so the two alignment assertions are **structural**: assert the grid declarations and the `subgrid`/`@supports` branches via the resolved CSS (`apps/web/test/css-chain.ts`), and assert the *content* rule — units inside controls, no stray unit in help — on the rendered markup. That is an invariant, not a mechanism (`AG3`). **The pixel claim belongs in a browser**: add one assertion to 6.5a's Playwright spec measuring a mixed row's label and control spread at 1440×900 and asserting 0.

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- field-rows`

- [ ] **Step 3: Implement the grid, the fallback, the ids and the two controls**

- [ ] **Step 4: Add the browser-side alignment assertion**

In `apps/web/e2e/density.spec.ts`'s module (or a sibling spec), measure a mixed field row and assert label-top spread and control-top spread are both 0.

- [ ] **Step 5: Run the unit tests, the e2e spec, axe and contrast; commit**

```bash
git add apps/web/src/styles/primitives.css apps/web/src/components/testbuilder/FormBuilder.tsx \
        apps/web/src/components/authoring/QuestionEditor.tsx \
        apps/web/test/testbuilder/field-rows.test.tsx apps/web/e2e/density.spec.ts
git commit -m "feat(web): one field-row rule and one pair of controls (D16, D16a, D17)"
```

---

### Task 6: the reviewers card says what it cannot do

**Files:**
- Modify: `apps/web/src/routes/test.tsx`
- Test: `apps/web/test/testbuilder/checklist-rail.test.tsx`

**`D18`** — the review panel is **not designed** and must not be invented here. `docs/design.md` lists it as screen 10, but `grep -rln "ReviewPanel\|reviewers" apps/web/src` returns nothing — only `review_requested` and the badge shipped. Designing it would invent a feature ADR 0007's deferred half is not delivering.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the review flag and says the rest is not built", async () => {
  await openBuilder({ reviewRequested: true });
  expect(screen.getByText(/In review/)).toBeVisible();
  expect(screen.getByText(/Comments and approvals arrive with ADR 0007's second half/)).toBeVisible();
});
it("offers no comment or approval control", async () => {
  expect(screen.queryByRole("button", { name: /Approve|Comment/ })).toBeNull();
});
```

- [ ] **Step 2: Run, implement the card, run again, commit**

```bash
git add apps/web/src/routes/test.tsx apps/web/test/testbuilder/checklist-rail.test.tsx
git commit -m "feat(web): the builder shows the review flag and names what is missing (D18)"
```

---

## What this plan does not do

It does not touch the **test list** — `D7c` keeps the readiness meter out of it until a Phase 8 aggregate exists; the list distinguishes "Draft · never published" from "Draft · changes since v1", which the wire already supports, and that screen belongs to 6.5e. It does not design the review panel. It does not add section-order shuffling (`D19` — that needs a `pariksha/test@1` field, a format bump and an ADR).
