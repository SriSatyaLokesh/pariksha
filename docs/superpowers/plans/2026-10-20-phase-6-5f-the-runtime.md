# Phase 6.5f — The Candidate Runtime's Type-Scale Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `exam.css`'s literal font sizes to type-scale tokens with the geometry frozen — nothing moves that a candidate's hand is already on (`D8`).

**Architecture:** `exam.css` is **1,399 lines** carrying **63 literal `font-size:` declarations** against **158 `var(--type-*)` uses** (both counted, not estimated). This plan converts the 63, adding a front-matter scale entry only where no existing step fits. Voltage stays here and only here: under `D1` the runtime is the sole surface still using the vermilion family, which makes the palette square and the focus ring read as singular again. `signal.css`'s own 36 literals are **out of scope** — the landing page is not in #187's scope list.

**Tech Stack:** CSS custom properties, `scripts/tokens.mjs`, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md`](../specs/2026-10-20-phase-6-5-design-pass-design.md) — §7 (`D8`), §12, §15.

**Depends on:** **6.5b** only, and only for the regenerated tokens. It touches no organiser screen.

> **§15 — this plan is cut first.** If Phase 6.5 runs long, `D8`'s literal sweep waits; the accent re-ground, the shell, the builder and the two UX defects ship. **Nothing else has a cut order; a second cut stops and asks.**

**Goals covered:** `G6` — the candidate runtime takes the type-scale sweep, geometry frozen.

## Global Constraints

Copied verbatim from the spec's §12. Every task's requirements implicitly include this section.

- **`DESIGN.md` front matter is the only place a colour or a type step may be declared.** `scripts/tokens.mjs` generates `tokens.css` and `tokens.ts`. A scale decision propagates by regeneration.
- `no-hex-colors.test.ts` strips only `/* */` comments. **Issue references in CSS go in block comments.**
- **The geometry is frozen.** No layout, spacing, position or dimension changes. This is a token sweep, not a redesign.
- **`AG2`** — never make a gate green by moving a bar. `component-dimensions.test.ts` pins sizing; if it fails, the sweep changed a size it should not have.
- **`AG3`** — every guard exercises behaviour or asserts an invariant.
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-6-5f/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

**Why this plan is the careful one.** A runtime mistake falls on the user who **cannot report a bug mid-attempt**. That asymmetry is why `D8` freezes the layout rather than "carefully changing" it, and why this plan measures before and after rather than trusting a diff.

## Review Focus

1. **A literal that is not a font size at all** — `font: ` shorthand, a `line-height` with a unit, a `clamp()` whose middle term is a size. A regex over `font-size:` misses these and a blind sweep corrupts them. Task 1.
2. **A literal inside a media query or a `@supports` block** — the same declaration at two widths, where only one has a matching scale step. Task 2.
3. **A size that no existing scale step fits** — the spec allows a new front-matter entry here, and the temptation is to round to the nearest step and call it done. Rounding changes the runtime's appearance, which is exactly what `D8` forbids. Task 2.
4. **The question palette's "you are here" square and the focus ring** — the two places voltage survives. A sweep that touches their sizing changes the one affordance a candidate navigates by. Task 3.
5. **A candidate mid-attempt across a deploy** — the runtime is cached; a changed token name with a stale stylesheet is an unstyled exam. Task 3.

---

### Task 1: inventory every literal before changing one

**Files:**
- Create: `docs/superpowers/notes/2026-10-20-exam-css-type-inventory.md`

**Interfaces:**
- Produces: the mapping every later step applies. No code.

**Why an inventory first:** 63 declarations, and the decision for each is "which existing step" or "a new step". Making 63 decisions inside a diff means making them invisibly.

- [ ] **Step 1: List every type literal, including the ones a naive grep misses**

Record each as: line, selector, declared value, the media or `@supports` context if any, the scale step that fits, and **whether rounding to it would change the rendered size**. Search for `font-size:`, the `font:` shorthand, and any `clamp()`/`min()`/`max()` carrying a length in a type position. `grep -c "font-size:" apps/web/src/styles/exam.css` returns **63**; if your inventory has fewer rows than that plus the shorthand hits, it is incomplete.

- [ ] **Step 2: Mark the entries needing a new scale step**

The spec allows front-matter scale entries **only where no existing step fits**. Each one carries a line of reason.

- [ ] **Step 3: Flag the untouchables**

The question palette's current-question square and the focus ring. These keep voltage and keep their geometry; note their lines so Task 3 can assert they did not move.

- [ ] **Step 4: Commit the inventory**

```bash
git add docs/superpowers/notes/2026-10-20-exam-css-type-inventory.md
git commit -m "docs: inventory exam.css's 63 type literals before the sweep (D8)"
```

---

### Task 2: capture the before-sizes, then sweep

**Files:**
- Modify: `DESIGN.md` (only if Task 1 found a size no step fits), regenerate tokens
- Modify: `apps/web/src/styles/exam.css`
- Create: `apps/web/e2e/runtime-type.spec.ts`
- Test: `apps/web/test/component-dimensions.test.ts` (existing, must stay green)

**Interfaces:**
- Consumes: the generated `--type-*` custom properties and Task 1's mapping.
- Produces: no new interface. Every `var(--type-*)` substitution must be **size-identical**.

**`D8`'s earlier wording was a no-op, and the builder check caught it.** "Takes the regenerated tokens and the type scale" regenerates nothing: `DESIGN.md` already carries both colour families and the whole typography scale, and `tokens.css` is already generated from them. **The literal sweep is the real work.**

- [ ] **Step 1: Write the before/after spec and capture the before-figures**

```ts
// apps/web/e2e/runtime-type.spec.ts
const BEFORE = { /* selector -> computed px, captured in Step 2 */ };

it("renders every runtime text element at the size it did before the sweep", async ({ page }) => {
  await openAttempt(page);
  for (const [selector, px] of Object.entries(BEFORE)) {
    expect(await computedFontSize(page, selector)).toBeCloseTo(px, 1);
  }
});
```

Reuse 6.5a's `seedWorkspace` from `apps/web/e2e/seed.ts` — do not write a second seeding helper.

- [ ] **Step 2: Fill `BEFORE` from the current runtime and commit it first**

Run the spec in reporting mode against the unswept `exam.css`, write the figures in, and **commit before touching a single declaration**. A before-figure captured after the change proves nothing. Record the commit sha in the inventory note.

- [ ] **Step 3: Add any new scale steps to front matter and regenerate**

Run: `pnpm tokens`

- [ ] **Step 4: Apply the sweep, in several commits**

Work through the inventory in groups of related selectors, committing each group, so a bisect lands on a handful of declarations rather than 63. **Change nothing but the value of `font-size`.**

- [ ] **Step 5: Run the before/after spec after every group**

Run: `npx playwright test apps/web/e2e/runtime-type.spec.ts --reporter=line`
Expected: PASS. A failure means a substitution changed a rendered size — **fix the substitution, never the figure** (`AG2`).

- [ ] **Step 6: Run the dimension and contrast gates**

Run: `npx turbo run test --filter=@pariksha/web -- component-dimensions contrast`
Expected: PASS unchanged.

---

### Task 3: the runtime still behaves, and voltage still lives here

**Files:**
- Test: `apps/web/test/exam/` (the existing suite), `apps/web/e2e/runtime-type.spec.ts`

**`D1`** — voltage retreats to the candidate runtime alone, where it keeps its existing job: the "you are here" square in the question palette and the focus ring. **Under `D1` the runtime is the sole surface still using the vermilion family.**

- [ ] **Step 1: Write the standing guards**

```ts
it("keeps voltage in the runtime and nowhere else", () => {
  expect(stylesheetsUsing("voltage").sort()).toEqual(["exam.css", "question.css"].sort());
});
it("leaves the current-question square and the focus ring untouched", async ({ page }) => {
  expect(await boxOf(page, ".palette-item[aria-current]")).toEqual(BEFORE_PALETTE_BOX);
  expect(await outlineOf(page, ".answer-row:focus-visible")).toEqual(BEFORE_FOCUS_RING);
});
```

Adjust the stylesheet list to whatever Task 1's inventory proves; the assertion is the invariant — **exactly the runtime, and nothing else**.

- [ ] **Step 2: Run the whole candidate suite**

Run: `npx turbo run test --filter=@pariksha/web -- exam`
Expected: PASS, including the clock, autosave, queue and submit tests. The sweep must not touch behaviour.

- [ ] **Step 3: Run everything**

Run: `npx turbo run test --force --concurrency=1` and `npx playwright test --reporter=line`

- [ ] **Step 4: Build**

Run: `SITE_URL='https://pariksha.example' pnpm build`
Expected: success; `bundle.test.ts` still enforces that no page loads both typeface pairs, which is what bounds `D2`'s four families.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/styles/exam.css apps/web/e2e/runtime-type.spec.ts \
        DESIGN.md apps/web/src/styles/tokens.css apps/web/src/styles/tokens.ts
git commit -m "refactor(web): exam.css takes the type scale, geometry frozen (D8)"
```

---

## What this plan does not do

It does not touch `signal.css`'s 36 literals — the landing page is not in #187's scope list. It does not change one pixel of runtime geometry. It builds **no candidate-runtime prototype**: `D11`'s gate applies to visual change, and a sweep whose success condition is "nothing looks different" is proved by the before/after spec, not by a drawing.
