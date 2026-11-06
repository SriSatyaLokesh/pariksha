# Scientific Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin set a paper's calculator to Off / Basic / Scientific, and give candidates a GATE-style scientific calculator when it is Scientific.

**Architecture:** A new `calculator` proctoring override (`"off" | "basic" | "scientific"`) replaces the `allow_calculator` boolean everywhere it is written, and `resolveProctoring` maps the legacy key so frozen published versions keep working without a DB migration. The resolved value flows through the attempt payload as `calculator`. The scientific maths is a pure, hand-written reducer module (`scientific.ts`) with no dependency, and a thin React component renders it. Basic is untouched.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library + jest-axe, pnpm/turbo monorepo.

**Spec:** `docs/superpowers/specs/2026-11-06-scientific-calculator-design.md`. Read it before any task. Its numbered rules (5, 6, 8, 9, 10, 10a, 11) are the behaviour contract for Tasks 4 and 5.

## Global Constraints

- No new npm dependency anywhere. Candidate bundle budget: 300 KB gzipped.
- Basic calculator (`Calculator.tsx`, its tests, its CSS) is unchanged except for the Runner choosing it.
- Published versions with `allow_calculator: true` must resolve to `"basic"`, and `false` to `"off"`. No SQL migration.
- All three profiles default to `calculator: "off"`.
- Never create a git worktree. Never run a Cloudflare/wrangler command except `--dry-run`.
- Build `packages/core` (`pnpm build`) before type-checking or testing apps after Task 1 changes core.
- Run targeted tests per task. Run the full suite only once at the end, alone: `npx turbo run test --concurrency=1 -- --no-file-parallelism`. Read its output, not its exit status.
- Commit as `Satya K <srisatyalokesh2.12@gmail.com>`. **No `Co-authored-by: Claude` trailer, no "Generated with Claude Code" line, no attribution of any kind.** Never `git add -A`; add named paths.
- Every code-writing subagent loads the `ponytail` skill first.

## Review Focus

1. **Legacy paper with `allow_calculator: true` and no `calculator`.** It must still show the Basic calculator. Pinned in Task 1 (resolver) and Task 2 (`sets5` start test).
2. **A paper with both keys present** (an old draft re-saved before the editor cleaned it up). `calculator` must win. Pinned in Task 1.
3. **Error, then keep typing.** After "Error", any key must recover and `C` must always reset. A wedged calculator in a live exam is the worst failure. Pinned in Task 4.
4. **Unclosed brackets and a trailing operator at `=`.** `(2+3` `=` gives 5. `2+` `=` gives Error, never a crash or a NaN on screen. Pinned in Task 4.
5. **Close and reopen mid-calculation.** Memory, Deg/Rad and the display survive. Pinned in Task 5.

---

### Task 1: `calculator` override in core, schema and format docs

**Files:**
- Modify: `packages/core/src/proctoring.ts` (types ~L30-63, defaults ~L112/131/150, resolver ~L222)
- Modify: `schemas/test-1.json:218`
- Modify: `docs/test-format.md:133`
- Modify: `examples/reasoning-aptitude/test.json:151`
- Test: `packages/core/test/proctoring.test.ts`

**Interfaces:**
- Produces:
  - `export type CalculatorMode = "off" | "basic" | "scientific";` and `export const CALCULATOR_MODES: readonly CalculatorMode[] = ["off", "basic", "scientific"];` from `@pariksha/core`.
  - `ResolvedProctoring.calculator: CalculatorMode` replaces `allowCalculator: boolean`.
  - `ProctoringOverrides` gains `calculator: CalculatorMode` and **keeps** `allow_calculator: boolean`, marked `/** @deprecated legacy, read only; the editor writes `calculator` */`.

- [ ] **Step 1: Write failing tests** in `proctoring.test.ts`. Also update the three existing `allowCalculator: false` expectations (L60/82/104) to `calculator: "off"`.

```ts
describe("calculator mode", () => {
  it("defaults to off on every profile", () => {
    for (const profile of ["off", "standard", "strict"] as const)
      expect(resolveProctoring({ profile }).calculator).toBe("off");
  });
  it("reads the new key", () => {
    expect(resolveProctoring({ overrides: { calculator: "scientific" } }).calculator).toBe("scientific");
  });
  it("maps legacy allow_calculator: true to basic and false to off", () => {
    expect(resolveProctoring({ overrides: { allow_calculator: true } }).calculator).toBe("basic");
    expect(resolveProctoring({ overrides: { allow_calculator: false } }).calculator).toBe("off");
  });
  it("lets calculator win over the legacy key", () => {
    expect(resolveProctoring({ overrides: { allow_calculator: true, calculator: "off" } }).calculator).toBe("off");
  });
});
```

- [ ] **Step 2: Run and see it fail.** `pnpm --filter @pariksha/core test -- proctoring`. Expected: FAIL on `calculator` undefined.

- [ ] **Step 3: Implement.** In the resolver: `calculator` override if present (use `overrideOr`'s presence rule), else legacy `allow_calculator` (true gives `"basic"`, false gives `"off"`), else `defaults.calculator`. Defaults table: `calculator: "off"` on all three profiles. Schema: add `"calculator": { "enum": ["off", "basic", "scientific"] }` beside `allow_calculator`, and give `allow_calculator` a `"description"` saying it is legacy, read as basic/off, and superseded by `calculator`. `docs/test-format.md`: replace the `allow_calculator` row with `calculator` | `off` / `basic` / `scientific`, and add one sentence below the table that older documents' `allow_calculator: true/false` still reads as `basic`/`off`. Example JSON: `"calculator": "basic"`.

- [ ] **Step 4: Run core tests.** `pnpm --filter @pariksha/core test`. Expected: all pass. Then `pnpm --filter @pariksha/core build`.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/proctoring.ts packages/core/test/proctoring.test.ts schemas/test-1.json docs/test-format.md examples/reasoning-aptitude/test.json
git commit -m "feat(core): calculator mode override with legacy allow_calculator mapping"
```

---

### Task 2: carry `calculator` through the attempt payload

**Files:**
- Modify: `apps/api/src/run/attempt.ts:228,278,592`
- Modify: `apps/web/src/lib/paper.ts:106`
- Modify: `apps/web/src/components/exam/Runner.tsx:265`
- Modify: `apps/web/src/lib/demo-test.ts:156,172` (keep `"basic"` for now; Task 6 switches the demo)
- Modify: every fixture/test listed by `grep -rln "allowCalculator" apps --include=*.ts --include=*.tsx | grep -v dist` (about 25 files: `apps/api/test/run/*`, `apps/web/test/exam/*`)
- Test: `apps/api/test/run/start.test.ts:564-576`

**Interfaces:**
- Consumes: `CalculatorMode`, `ResolvedProctoring.calculator` (Task 1).
- Produces: `AttemptPaper.calculator: CalculatorMode` (API) and the mirrored `calculator: CalculatorMode` on the web paper type. `paper.proctoring.calculator` carries the same value.

- [ ] **Step 1: Rewrite the start test.** Keep the `sets5` fixture's legacy `allow_calculator: true` as it is. It is the legacy proof.

```ts
it("calculator comes from proctoring.overrides; legacy allow_calculator still reads as basic", async () => {
  expect((await paperOf(await startFresh("sets5"))).calculator).toBe("basic");
  expect((await paperOf(await startFresh("paper"))).calculator).toBe("off");
});
// and the nested one at L576:
expect(paper.proctoring.calculator).toBe("basic");
```

- [ ] **Step 2: Run and see it fail.** `pnpm --filter @pariksha/api test -- start`. Expected: FAIL, `calculator` undefined.

- [ ] **Step 3: Implement.** Rename the field and the helper (`calculatorOf(settings): CalculatorMode`). In Runner, show the Calculator button when `paper.calculator !== "off"`, and keep opening `<Calculator>` for now. Fixtures: `allowCalculator: true` becomes `calculator: "basic"`, `false` becomes `"off"`, including inside `proctoring: {...}` spreads.

- [ ] **Step 4: Run.** `pnpm --filter @pariksha/api test -- run/` then `pnpm --filter @pariksha/web test -- exam/`. Expected: all pass. `grep -rn "allowCalculator" apps packages --include=*.ts --include=*.tsx | grep -v dist` prints nothing.

- [ ] **Step 5: Commit** the named files: `feat: attempt payload carries calculator mode`.

---

### Task 3: admin control in the proctoring panel

**Files:**
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx` (`BoolOverrideKey` L83, `OVERRIDE_KEY_TO_RESOLVED` L116, Gating group L430, the `setOverride` writer)
- Test: `apps/web/test/testbuilder/proctoring-controls.test.tsx` (L113, L205)

**Interfaces:**
- Consumes: `CalculatorMode`, `CALCULATOR_MODES`, `ResolvedProctoring.calculator`.
- Produces: none used later.

- [ ] **Step 1: Write failing tests.** Remove `"Allow the calculator"` from both lists (L113, L205). Add:

```ts
it("the Calculator control shows the resolved mode, legacy included", async () => {
  await openProctoringPanel({ profile: "standard", overrides: { allow_calculator: true } });
  expect(screen.getByLabelText(/^Calculator/i)).toHaveValue("basic");
});
it("choosing Scientific writes calculator and drops the legacy key", async () => {
  const onChange = vi.fn();
  await openProctoringPanel({ overrides: { allow_calculator: true } }, { onChange });
  fireEvent.change(screen.getByLabelText(/^Calculator/i), { target: { value: "scientific" } });
  const last = onChange.mock.lastCall![0];
  expect(last.overrides.calculator).toBe("scientific");
  expect("allow_calculator" in last.overrides).toBe(false);
});
it("marks Calculator as changed from the profile when not off", async () => {
  await openProctoringPanel({ profile: "standard", overrides: { calculator: "scientific" } });
  // assert the same "changed from Standard" marker the other fields get
});
```

The last test uses the file's existing marker assertion style. Copy it from a neighbouring marker test.

- [ ] **Step 2: Run and see it fail.** `pnpm --filter @pariksha/web test -- proctoring-controls`.

- [ ] **Step 3: Implement.** Remove `allow_calculator` from `BoolOverrideKey`. Type `OVERRIDE_KEY_TO_RESOLVED` as `Record<Exclude<keyof ProctoringOverrides, "allow_calculator">, keyof ResolvedProctoring>` with `calculator: "calculator"`. This keeps the legacy key out of the marker and confirmation counts. Add a `<select>` labelled **"Calculator"** in the Gating group where the checkbox was, built like the `violation_action` select (L530-555). Options: `Off`, `Basic`, `Scientific`, valued by `CALCULATOR_MODES`, with `value={resolved.calculator}`, marker via `fieldMarker("calculator")`. When it writes, it sets `calculator` and deletes `allow_calculator` from the overrides object. Spec rule 13 allows a segmented control instead. Pick `<select>`, because it reuses the existing pattern.

- [ ] **Step 4: Run.** `pnpm --filter @pariksha/web test -- testbuilder/`. Expected: all pass.

- [ ] **Step 5: Commit:** `feat(web): Off / Basic / Scientific calculator setting in the proctoring panel`.

---

### Task 4: scientific engine (pure reducer)

**Files:**
- Create: `apps/web/src/components/exam/scientific.ts`
- Test: `apps/web/test/exam/scientific.test.ts`

**Interfaces:**
- Produces:

```ts
export type SciKey =
  | "0"|"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9"|"."
  | "+"|"-"|"*"|"/"|"^"|"mod"|"logy"            // binary
  | "("|")"|"="|"C"|"Backspace"|"EXP"
  | "sin"|"cos"|"tan"|"asin"|"acos"|"atan"|"sinh"|"cosh"|"tanh"
  | "log"|"ln"|"exp"|"pow10"|"sq"|"sqrt"|"cbrt"|"fact"|"abs"|"inv"|"neg"|"pct" // unary
  | "pi"|"e"|"MC"|"MR"|"MS"|"M+"|"M-"|"deg"|"rad";
export interface SciState { /* implementer's choice; must include angle: "deg" | "rad" and memory: number */ }
export const SCI_START: SciState;
export function sciReduce(state: SciState, key: SciKey): SciState;
export function sciView(state: SciState): { expression: string; result: string; memory: boolean; angle: "deg" | "rad" };
```

Behaviour is spec rules 5, 6, 8, 9 and 10a exactly. Evaluation: tokenize the built expression and evaluate with shunting-yard over `+ − × ÷ mod ^ logy`. `^` and `logy` share the top level and are right-associative. `a logy b` = `Math.log(a) / Math.log(b)`. Format results with Basic's rule (`Number(v.toPrecision(12))`, non-finite gives `"Error"`). Port `show()` rather than importing it, since `Calculator.tsx` stays untouched.

- [ ] **Step 1: Write failing tests.** Add a helper `run(...keys: SciKey[]) => sciView(keys.reduce(sciReduce, SCI_START)).result`. Use these assertions with these exact values:

```ts
it("precedence", () => {
  expect(run("2","+","3","*","4","=")).toBe("14");
  expect(run("2","^","3","^","2","=")).toBe("512");          // right-assoc
  expect(run("(","2","+","3",")","*","4","=")).toBe("20");
  expect(run("1","7","mod","5","=")).toBe("2");
});
it("unary keys act on the entry at once", () => {
  expect(run("3","0","sin")).toBe("0.5");                    // deg default
  expect(run("2","+","9","sqrt","=")).toBe("5");
  expect(run("5","fact")).toBe("120");
  expect(run("4","inv")).toBe("0.25");
  expect(run("5","0","pct")).toBe("0.5");
  expect(run("7","neg")).toBe("-7");
  expect(run("2","7","cbrt")).toBe("3");
  expect(run("1","0","0","log")).toBe("2");
});
it("logy is x first, base second", () => { expect(run("8","logy","2","=")).toBe("3"); });
it("EXP", () => { expect(run("2","EXP","3")).toBe("2000"); });
it("deg/rad and trig snapping", () => {
  expect(run("1","8","0","sin")).toBe("0");
  expect(run("9","0","cos")).toBe("0");
  expect(run("4","5","tan")).toBe("1");
  expect(run("rad","pi","sin")).toBe("0");
  expect(run("rad","1","asin")).toBe(String(Number((Math.PI/2).toPrecision(12))));
  expect(run("1","EXP","1","3","inv")).toBe("1e-13");        // tiny non-trig result is NOT snapped (rule 8)
});
it("errors and recovery", () => {
  for (const seq of [["1","/","0","="],["9","0","tan"],["0","log"],["3",".","5","fact"],["2","+","="]] as SciKey[][])
    expect(run(...seq)).toBe("Error");
  expect(run("1","/","0","=","7")).toBe("7");
  expect(run("1","/","0","=","C")).toBe("0");
});
it("unclosed brackets close at =", () => { expect(run("(","2","+","3","=")).toBe("5"); });
it("after a result: digit starts fresh, operator continues", () => {
  expect(run("2","+","3","=","4")).toBe("4");
  expect(run("2","+","3","=","*","2","=")).toBe("10");
  expect(run("3","0","=","sin")).toBe("0.5");
});
it("pi replaces the entry (no implicit multiplication)", () => {
  expect(run("2","pi")).toBe(String(Number(Math.PI.toPrecision(12))));
});
it("memory", () => {
  const s = ["5","MS","C","MR"].reduce(sciReduce as any, SCI_START);
  expect(sciView(s).result).toBe("5");
  expect(sciView(s).memory).toBe(true);
  expect(run("5","MS","2","M+","C","MR")).toBe("7");
  expect(sciView(["5","MS","MC"].reduce(sciReduce as any, SCI_START)).memory).toBe(false);
  expect(run("1","/","0","=","MS","C","MR")).toBe("0");    // MS on Error does nothing
});
it("expression line", () => {
  const v = sciView(["3","0","sin","+"].reduce(sciReduce as any, SCI_START));
  expect(v.expression).toBe("sin(30)+");
  expect(sciView(["8","logy","2"].reduce(sciReduce as any, SCI_START)).expression).toContain("log");
});
```

- [ ] **Step 2: Run and see it fail.** `pnpm --filter @pariksha/web test -- scientific.test`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `scientific.ts`.** Factorial: integers 0-170 only, otherwise Error. Trig in deg mode: convert, and if the degree argument is a multiple of 90 (for sin, cos, tan) return the exact value. `tan` at an odd multiple of 90° gives Error. All trig outputs with `|v| < 1e-12` become 0. Every exported function is total: no input sequence throws.

- [ ] **Step 4: Run.** Same command. Expected: all pass.

- [ ] **Step 5: Commit:** `feat(web): scientific calculator engine`.

---

### Task 5: `ScientificCalculator` component, CSS and Runner wiring

**Files:**
- Create: `apps/web/src/components/exam/ScientificCalculator.tsx`
- Modify: `apps/web/src/styles/exam.css` (new `.exam-sci-*` rules after `.exam-calculator` ~L1775)
- Modify: `apps/web/src/components/exam/Runner.tsx:204,265,399`
- Test: `apps/web/test/exam/scientific-calculator.test.tsx`, plus one case in `apps/web/test/exam/runner.test.tsx`

**Interfaces:**
- Consumes: `SciState`, `SCI_START`, `sciReduce`, `sciView`, `SciKey` (Task 4). `paper.calculator` (Task 2).
- Produces: `export function ScientificCalculator(props: { state: SciState; onState: (next: SciState) => void; onClose: () => void }): JSX.Element`. State is lifted to Runner so it survives close and reopen (spec rule 10).

- [ ] **Step 1: Write failing tests** (style as in `calculator.test.tsx`: real buttons, `fireEvent`, no user-event):
  - Dialog named "Scientific calculator", and `axe` passes.
  - Clicking `3`, `0`, `Sine sin` shows `0.5` in the `status` output.
  - Every key in the spec's key table has a button whose accessible name contains its visible glyph (WCAG 2.5.3), e.g. `/sin⁻¹/`, `/logᵧx/`, `/xʸ/`.
  - The Deg/Rad pair are radio buttons, and Deg is checked by default.
  - Keyboard: typing `2`, `^`, `3`, Enter on the dialog shows `8`. Escape closes. `c` clears.
  - Runner test: a paper with `calculator: "scientific"` opens the scientific dialog. Type `5`, MS, close, reopen: the "M" marker is still shown and Rad/Deg still holds. A paper with `"basic"` opens the existing `Calculator`.

- [ ] **Step 2: Run and see it fail.** `pnpm --filter @pariksha/web test -- scientific-calculator runner`.

- [ ] **Step 3: Implement.** Reuse `useDialogKeys(true, onClose, { trapTab: true })` and copy Basic's drag handle and arrow-key nudge (the `getBounds`, pointer and `onHandleKeyDown` code) with a 440px width fallback. Don't refactor Basic to share it. Layout follows the approved mockup: `.superpowers/brainstorm/268-1793974691/content/calculator-v1.html` (gitignored, but in the primary checkout). Use the spec's 8-column key table, with the royal accent on `=` only, using existing tokens. Keys are at least 24px square. The keyboard map follows spec rule 11, with `^` mapping to `"^"`. Runner holds `const [sciState, setSciState] = useState(SCI_START)` and renders `ScientificCalculator` or `Calculator` by `paper.calculator`.

- [ ] **Step 4: Run.** `pnpm --filter @pariksha/web test -- exam/` and `pnpm --filter @pariksha/web test -- contrast-usage`. Expected: all pass.

- [ ] **Step 5: Commit:** `feat(web): scientific calculator for candidates`.

---

### Task 6: demo and documentation

**Files:**
- Modify: `apps/web/src/lib/demo-test.ts:156,172` (to `"scientific"`)
- Modify: `README.md:62`, `docs/PRD.md:276`, `docs/candidate-faq.md:28`, `apps/web/src/seo/files.ts:54`, `CHANGELOG.md` (`[Unreleased]` / `### Added`)

- [ ] **Step 1: Edit.** The demo uses `"scientific"`. The docs say the calculator is Off / Basic (four-function) / Scientific (GATE-style), set per test. CHANGELOG entry: one line under Added. Any test that pins demo copy or the seo file text gets its expectation updated in the same commit.
- [ ] **Step 2: Run.** `pnpm --filter @pariksha/web test -- demo seo proctoring-demo`. Expected: pass.
- [ ] **Step 3: Full suite, alone.** `npx turbo run test --concurrency=1 -- --no-file-parallelism`. Read the output and confirm both `apps/api` and `apps/web` ran with 0 failures. A single timing failure must be re-run alone before it counts (CLAUDE.md).
- [ ] **Step 4: Commit:** `docs: scientific calculator in demo, README, PRD and FAQ`.
