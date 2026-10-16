# Phase 1 — Foundation and Scoring Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm + Turborepo monorepo with a green CI pipeline, and build `packages/core` — pure TypeScript with no I/O that grades all 12 question types under all 5 scoring modes, aggregates an attempt's score, shuffles and selects questions deterministically, and enforces the cross-field import rules.

**Architecture:** `packages/core` is a leaf package. It imports nothing from the workspace and performs no I/O — no file reads, no network, no clock, no `Math.random`. Everything it needs arrives as an argument, including the random seed. Grading is one dispatch function over four type families (choice, structured, text, manual), each family in its own file, with the scoring-mode arithmetic factored out so `Regrade` can re-run it against stored responses. The JSON Schemas in `schemas/` stay the structural authority; `packages/core` adds only the cross-field rules a schema cannot express.

**Tech Stack:** TypeScript 5.9 (strict), pnpm 10 workspaces, Turborepo 2, Vitest 3, ESLint 9 flat config, Prettier 3, Ajv 8 (draft 2020-12) for schema validation in tests.

**Spec:** [`docs/PRD.md`](../../PRD.md) · [`docs/question-format.md`](../../question-format.md) · [`docs/ROADMAP.md`](../../ROADMAP.md#phase-1--foundation-and-scoring-core) · [`schemas/question-1.json`](../../../schemas/question-1.json), [`schemas/bank-1.json`](../../../schemas/bank-1.json)

## Global Constraints

- Node 22. Package manager pnpm, enabled through `corepack`. Turborepo for task orchestration (`.gitignore` already expects `.pnpm-store/` and `.turbo/`).
- `packages/core` has **zero runtime dependencies** and performs no I/O. No `Date.now()`, no `Math.random()`, no `fs`, no `fetch` in `src/`.
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `erasableSyntaxOnly: true`. No `any` in exported signatures.
- Every commit is signed off with a Developer Certificate of Origin line (`git commit -s`), per [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) and PRD `O-01`.
- The 12 type names are exactly those in `schemas/question-1.json`: `single`, `multiple`, `select_k`, `true_false`, `assertion_reason`, `matching`, `multi_matching`, `ordering`, `fill_blank`, `numeric`, `short_answer`, `long_answer`.
- The 5 scoring modes are exactly: `all_or_nothing`, `partial`, `negative`, `position`, `rubric`.
- Points are rounded to 2 decimal places at the question, section and total boundaries, using half-up rounding.
- A blank response scores 0 and never loses points, in every mode (PRD: "blank loses nothing").
- `partial` is `max(0, points × (correct − wrong) ÷ total)`. `negative` on a wrong answer is `−negative_fraction × points`; a single question may go below zero, but section and attempt totals are clamped at zero.
- Existing CI (`.github/workflows/ci.yml`) already validates schemas and examples. Its jobs must keep passing unchanged.

## Review Focus

Five input classes the spec implies but no obvious task exercises. Each has its test pinned to the task that owns the code.

1. **A `fill_blank` answer with `match: "regex"` runs author-supplied regex against candidate input.** A catastrophically backtracking pattern hangs the grading worker for every attempt that touches that question. Patterns must be length-capped, implicitly anchored and rejected at import if they contain nested unbounded quantifiers. — Tasks 5 and 10.
2. **A `numeric` key with `value: 0` and `tolerance_type: "percent"`.** Percent tolerance of zero is zero, so the only accepted answer is exactly 0, and a naive `|given − value| ÷ value` divides by zero and yields `NaN`, which compares false against every threshold and silently scores 0 for a correct answer. — Task 5.
3. **A pool asking for more questions than the filtered bank holds.** `T-11` says publishing warns; grading-time behaviour is unspecified. Returning fewer questions silently gives two candidates different-length papers. Selection must throw a named error the caller can surface. — Task 9.
4. **`case_insensitive` matching on non-Latin and mixed-case scripts.** Telugu and Devanagari text can arrive decomposed from one keyboard and composed from another; lowercasing with the Turkish locale maps `I` to `ı`. Comparison must normalise to NFC and case-fold locale-independently. — Task 5.
5. **Float accumulation across a 40-question partial-credit section.** Summing `0.6667`-style per-question points yields totals like `7.199999999999999`, which reach the results CSV and fail a hand-scoring check (`AC-27`). Rounding happens at each boundary, not only at the end. — Task 7.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `turbo.json` | Workspace root, task graph |
| `tsconfig.base.json` | Shared compiler options, extended by each package |
| `eslint.config.js`, `.prettierrc.json` | Lint and format |
| `vitest.workspace.ts` | Test discovery across packages |
| `packages/core/src/types.ts` | Question, option, key, response and scoring types |
| `packages/core/src/rng.ts` | Seeded deterministic PRNG and shuffle |
| `packages/core/src/grade/result.ts` | `GradeResult`, `ScoringDefaults`, the mode arithmetic |
| `packages/core/src/grade/choice.ts` | `single`, `multiple`, `select_k`, `true_false`, `assertion_reason` |
| `packages/core/src/grade/structured.ts` | `matching`, `multi_matching`, `ordering` |
| `packages/core/src/grade/text.ts` | `fill_blank`, `numeric` |
| `packages/core/src/grade/manual.ts` | `short_answer`, `long_answer`, rubric |
| `packages/core/src/grade/index.ts` | `gradeQuestion` dispatch |
| `packages/core/src/score.ts` | Attempt aggregation: section, total, percent, pass/fail |
| `packages/core/src/select.ts` | Fixed lists, pool draws, set assignment, option order |
| `packages/core/src/validate.ts` | Cross-field import rules |
| `packages/core/src/index.ts` | Public surface |
| `packages/core/test/**` | Vitest suites, one per source module |
| `packages/core/test/fixtures/scoring.json` | The type × mode fixture matrix (`AC-06`) |

---

## Task 1: Monorepo skeleton and CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `vitest.workspace.ts`, `.npmrc`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`
- Modify: `.github/workflows/ci.yml` (add the `build` job; leave the `schemas` job untouched)

**Interfaces:**
- Produces: the `@pariksha/core` package name, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` as root scripts routed through Turborepo.

- [ ] **Step 1: Write the failing test**

`packages/core/test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CORE_VERSION } from "../src/index.js";

describe("core package", () => {
  it("exports a version string", () => {
    expect(CORE_VERSION).toBe("1");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/smoke.test.ts`
Expected: FAIL — the workspace does not exist yet, or `CORE_VERSION` is not exported.

- [ ] **Step 3: Create the workspace root**

`pnpm-workspace.yaml` lists `apps/*` and `packages/*`. Root `package.json` is `private: true`, sets `"packageManager": "pnpm@10.18.0"` and `"engines": { "node": ">=22" }`, and defines scripts `lint`, `typecheck`, `test`, `build`, each delegating to `turbo run <task>`. `turbo.json` declares those four tasks, with `build` depending on `^build` and `typecheck` depending on `^build`. `.npmrc` sets `engine-strict=true`.

- [ ] **Step 4: Create the shared TypeScript, lint and format configuration**

`tsconfig.base.json` targets `ES2023`, module `NodeNext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `declaration`, `isolatedModules`, no emit on the base. `eslint.config.js` is flat config with `typescript-eslint` recommended-type-checked, plus a rule banning `any` in exported positions. `.prettierrc.json` matches `.editorconfig` (read it first; do not contradict it).

- [ ] **Step 5: Create `packages/core`**

`packages/core/package.json` is named `@pariksha/core`, `"type": "module"`, `"private": true`, exports `./dist/index.js` with types, has `"dependencies": {}`, and scripts for `build` (`tsc -p tsconfig.json`), `lint`, `typecheck` and `test`. `src/index.ts` exports `export const CORE_VERSION = "1";`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm install && pnpm test`
Expected: PASS, 1 test.

- [ ] **Step 7: Add the CI job**

In `.github/workflows/ci.yml`, add a `build` job on `ubuntu-latest`: checkout, `actions/setup-node@v7` with Node 22, `corepack enable`, `pnpm install --frozen-lockfile`, then `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`. Replace the trailing comment about v0.1 with the job.

- [ ] **Step 8: Verify lint, type-check and build all pass locally**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
Expected: all four succeed with no warnings.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -s -m "build: pnpm + turborepo workspace with core package and CI"
```

---

## Task 2: Question model and schema-backed loading

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/test/types.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: the discriminated union `Question` keyed on `type`, plus `Bank`, `QuestionOption`, `Blank`, `NumericKey`, `RubricLevel`, `ScoringConfig`, `ScoringMode`, `Difficulty`, and the response union `ResponseValue`. Every later task consumes these.

The types mirror `schemas/question-1.json` exactly — same field names, same optionality. Where the schema says a field is required for one `type`, that variant of the union requires it.

Response shapes, one per type, as the `ResponseValue` union members:

| Type | Response |
| --- | --- |
| `single`, `assertion_reason` | `{ kind: "option"; option: string }` |
| `multiple`, `select_k` | `{ kind: "options"; options: string[] }` |
| `true_false` | `{ kind: "boolean"; value: boolean }` |
| `matching` | `{ kind: "map"; pairs: Record<string, string> }` |
| `multi_matching` | `{ kind: "multimap"; pairs: Record<string, string[]> }` |
| `ordering` | `{ kind: "order"; items: string[] }` |
| `fill_blank` | `{ kind: "blanks"; values: Record<string, string> }` |
| `numeric` | `{ kind: "number"; value: number }` |
| `short_answer`, `long_answer` | `{ kind: "text"; text: string }` |

- [ ] **Step 1: Write the failing test**

`packages/core/test/types.test.ts` loads `examples/reasoning-aptitude/questions.json`, validates it against `schemas/bank-1.json` and `schemas/question-1.json` with Ajv (`strict: false`, `ajv-formats`), then asserts:

```ts
it("the example bank satisfies the schema", () => {
  expect(validate(bank)).toBe(true);
});

it("every type the example bank uses is a declared type", () => {
  const used = new Set(bank.questions.map((q: Question) => q.type));
  for (const t of used) expect(QUESTION_TYPES).toContain(t);
});

it("QUESTION_TYPES lists exactly the 12 types the schema enumerates", () => {
  expect(new Set(QUESTION_TYPES)).toEqual(new Set(schemaEnum("question-1.json", "type")));
  expect(QUESTION_TYPES).toHaveLength(12);
});
```

Export `QUESTION_TYPES` as a `readonly` tuple from `types.ts` so this assertion has something to compare against. Ajv and `ajv-formats` are **devDependencies of `packages/core`**, never runtime dependencies.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/types.test.ts`
Expected: FAIL — `QUESTION_TYPES` is not exported.

- [ ] **Step 3: Write `types.ts`**

Define `QUESTION_TYPES`, `SCORING_MODES`, the `Question` discriminated union, `Bank`, and `ResponseValue` per the table above. Types only — no functions, no runtime logic beyond the two `as const` tuples.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/test/types.test.ts packages/core/src/index.ts
git commit -s -m "feat(core): question, bank and response types mirroring the schemas"
```

---

## Task 3: Grade result and scoring-mode arithmetic

**Files:**
- Create: `packages/core/src/grade/result.ts`
- Create: `packages/core/test/grade/result.test.ts`

**Interfaces:**
- Consumes: `ScoringConfig`, `ScoringMode` from `types.ts`.
- Produces:
  ```ts
  export interface GradeResult {
    points: number;          // rounded to 2 dp
    max: number;             // the question's points
    correct: boolean | null; // null for manual types awaiting a reviewer
    parts?: { correct: number; wrong: number; total: number };
  }
  export interface ScoringDefaults {
    mode: ScoringMode;
    negativeFraction: number;
  }
  export function resolveScoring(q: Question, d: ScoringDefaults): { mode: ScoringMode; points: number; negativeFraction: number };
  export function applyMode(input: { mode: ScoringMode; points: number; negativeFraction: number; parts: { correct: number; wrong: number; total: number }; answered: boolean }): GradeResult;
  export function round2(n: number): number;
  ```

`applyMode` is the single place mode arithmetic lives. Every grader reduces its type to a `parts` count and hands it here; `Regrade` in a later phase calls it directly.

- [ ] **Step 1: Write the failing test**

`packages/core/test/grade/result.test.ts`:

```ts
it("all_or_nothing awards full points only when every part is correct", () => {
  expect(applyMode({ mode: "all_or_nothing", points: 2, negativeFraction: 0, parts: { correct: 3, wrong: 0, total: 3 }, answered: true }).points).toBe(2);
  expect(applyMode({ mode: "all_or_nothing", points: 2, negativeFraction: 0, parts: { correct: 2, wrong: 1, total: 3 }, answered: true }).points).toBe(0);
});

it("partial is points times (correct minus wrong) over total, floored at zero", () => {
  expect(applyMode({ mode: "partial", points: 2, negativeFraction: 0, parts: { correct: 2, wrong: 0, total: 3 }, answered: true }).points).toBe(1.33);
  expect(applyMode({ mode: "partial", points: 2, negativeFraction: 0, parts: { correct: 1, wrong: 2, total: 3 }, answered: true }).points).toBe(0);
});

it("negative subtracts the fraction on a wrong answer and allows a negative question score", () => {
  expect(applyMode({ mode: "negative", points: 4, negativeFraction: 0.25, parts: { correct: 0, wrong: 1, total: 1 }, answered: true }).points).toBe(-1);
});

it("a blank answer scores zero in every mode and never loses points", () => {
  for (const mode of SCORING_MODES) {
    expect(applyMode({ mode, points: 4, negativeFraction: 0.25, parts: { correct: 0, wrong: 0, total: 1 }, answered: false }).points).toBe(0);
  }
});

it("rounds half up to two decimal places", () => {
  expect(round2(7.199999999999999)).toBe(7.2);
  expect(round2(0.125)).toBe(0.13);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/grade/result.test.ts`
Expected: FAIL with "applyMode is not a function".

- [ ] **Step 3: Implement `result.ts`**

`round2` must not use `Number(n.toFixed(2))` alone — `(0.125).toFixed(2)` is `"0.13"` on some values and `"0.12"` on others because of binary representation. Scale by 100, apply `Math.round` to the scaled value with an epsilon correction, divide. `resolveScoring` takes the question's own `scoring` block where present and falls back to the defaults, field by field.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/grade/result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/grade/result.ts packages/core/test/grade/result.test.ts
git commit -s -m "feat(core): scoring mode arithmetic and two-decimal rounding"
```

---

## Task 4: Choice-family graders

**Files:**
- Create: `packages/core/src/grade/choice.ts`
- Create: `packages/core/test/grade/choice.test.ts`

**Interfaces:**
- Consumes: `applyMode`, `resolveScoring` from `grade/result.ts`.
- Produces: `gradeChoice(q: ChoiceQuestion, r: ResponseValue | null, d: ScoringDefaults): GradeResult`, where `ChoiceQuestion` is the `single | multiple | select_k | true_false | assertion_reason` narrowing of `Question`.

Part counting per type: `single`, `true_false` and `assertion_reason` are one part. `multiple` counts each key option the candidate chose as correct and each non-key option chosen as wrong, with `total` the key's length. `select_k` is the same, with a response holding more than `k` options treated as wrong in every part rather than silently truncated.

- [ ] **Step 1: Write the failing test**

Assertions, using the real example questions by ID:

```ts
it("grades QNT-004 (multiple, partial, 2 points, key a,c,e)", () => {
  expect(grade("QNT-004", { kind: "options", options: ["a", "c", "e"] }).points).toBe(2);
  expect(grade("QNT-004", { kind: "options", options: ["a", "c"] }).points).toBe(1.33);
  expect(grade("QNT-004", { kind: "options", options: ["a", "b"] }).points).toBe(0);
  expect(grade("QNT-004", null).points).toBe(0);
});

it("grades QNT-003 (select_k, k = 2, key b,d) and rejects more than k choices", () => {
  expect(grade("QNT-003", { kind: "options", options: ["b", "d"] }).points).toBe(2);
  expect(grade("QNT-003", { kind: "options", options: ["b", "d", "a"] }).points).toBe(0);
});

it("grades LOG-007 (true_false) and LOG-005 (assertion_reason) all-or-nothing", () => { /* … */ });

it("an option ID not present in the question's options counts as wrong, never as an error", () => {
  expect(grade("LOG-001", { kind: "option", option: "zzz" }).correct).toBe(false);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/grade/choice.test.ts`
Expected: FAIL — `gradeChoice` is not defined.

- [ ] **Step 3: Implement `gradeChoice`**

Compare option IDs as strings; order never matters for `multiple` and `select_k`. An unknown option ID is wrong, not an exception — a stale layout must not crash grading.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/grade/choice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/grade/choice.ts packages/core/test/grade/choice.test.ts
git commit -s -m "feat(core): grade single, multiple, select_k, true_false and assertion_reason"
```

---

## Task 5: Structured-family graders

**Files:**
- Create: `packages/core/src/grade/structured.ts`
- Create: `packages/core/test/grade/structured.test.ts`

**Interfaces:**
- Produces: `gradeStructured(q: StructuredQuestion, r: ResponseValue | null, d: ScoringDefaults): GradeResult` for `matching`, `multi_matching` and `ordering`.

Part counting: `matching` has one part per left item. `multi_matching` has one part per *pair* in the key — a left item mapped to three right items is three parts — and a pair the candidate added that is not in the key counts as wrong. `ordering` under `position` mode scores `points × items in the correct index ÷ items`; under `all_or_nothing` the whole sequence must match.

- [ ] **Step 1: Write the failing test**

```ts
it("grades LOG-003 (matching) with partial credit per left item", () => { /* full, half, none */ });

it("grades LOG-004 (multi_matching) counting pairs, not left items", () => {
  // key with 5 pairs across 3 left items: 3 right pairs and 1 spurious pair scores 2/5 of points under partial
});

it("grades LOG-006 (ordering) by position", () => {
  // a sequence with 3 of 5 items in place scores points * 3/5
});

it("ordering under all_or_nothing scores zero unless the whole sequence matches", () => { /* … */ });

it("a matching response omitting some left items scores only the ones answered, and is not a blank", () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/grade/structured.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `gradeStructured`**

`ordering` keys are implicit: `items` in the question are written in the correct order (question-format.md), so the key is the array as authored. Treat a response as answered when it has at least one entry.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/grade/structured.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/grade/structured.ts packages/core/test/grade/structured.test.ts
git commit -s -m "feat(core): grade matching, multi_matching and ordering"
```

---

## Task 6: Text-family graders

**Files:**
- Create: `packages/core/src/grade/text.ts`
- Create: `packages/core/test/grade/text.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function gradeText(q: TextQuestion, r: ResponseValue | null, d: ScoringDefaults): GradeResult; // fill_blank, numeric
  export function matchBlank(given: string, blank: Blank): boolean;
  export function withinTolerance(given: number, key: NumericKey): boolean;
  export const MAX_REGEX_LENGTH = 200;
  ```

This task owns Review Focus items 1, 2 and 4.

- `matchBlank` normalises both sides with `String.prototype.normalize("NFC")` and trims surrounding whitespace before comparing. `case_insensitive` (the default) folds case with `toLowerCase("en-US")` — an explicit locale, never the host locale, so a Turkish-locale server cannot map `I` to `ı`.
- `match: "regex"` compiles the pattern with implicit anchors (`^(?:…)$`), the `u` flag and no `g`, and only after `assertSafeRegex` passes. A pattern longer than `MAX_REGEX_LENGTH`, or containing a quantified group that itself contains an unbounded quantifier, is rejected.
- `withinTolerance` with `tolerance_type: "percent"` computes the allowance as `|key.value| × tolerance ÷ 100`. When `key.value` is 0 the allowance is 0, so only an exact 0 passes — and the function must reach that by multiplication, never by dividing by `key.value`.

- [ ] **Step 1: Write the failing test**

```ts
it("grades QNT-001 (numeric, tolerance 0) exactly", () => {
  expect(withinTolerance(72, { value: 72, tolerance: 0, tolerance_type: "absolute" })).toBe(true);
  expect(withinTolerance(72.1, { value: 72, tolerance: 0, tolerance_type: "absolute" })).toBe(false);
});

it("grades QNT-002 (numeric, absolute tolerance 0.05) at both edges", () => {
  expect(withinTolerance(7.25, { value: 7.2, tolerance: 0.05, tolerance_type: "absolute" })).toBe(true);
  expect(withinTolerance(7.26, { value: 7.2, tolerance: 0.05, tolerance_type: "absolute" })).toBe(false);
});

it("a percent tolerance around a key value of zero accepts only zero and never yields NaN", () => {
  expect(withinTolerance(0, { value: 0, tolerance: 5, tolerance_type: "percent" })).toBe(true);
  expect(withinTolerance(0.1, { value: 0, tolerance: 5, tolerance_type: "percent" })).toBe(false);
});

it("case_insensitive matching folds case locale-independently and normalises to NFC", () => {
  expect(matchBlank("İstanbul", { id: "b1", accepted: ["istanbul"], match: "case_insensitive" })).toBe(false);
  expect(matchBlank("పరీక్ష".normalize("NFD"), { id: "b1", accepted: ["పరీక్ష"], match: "case_insensitive" })).toBe(true);
});

it("regex blanks are anchored, so a substring match is not accepted", () => {
  expect(matchBlank("xx42xx", { id: "b1", accepted: ["\\d+"], match: "regex" })).toBe(false);
  expect(matchBlank("42", { id: "b1", accepted: ["\\d+"], match: "regex" })).toBe(true);
});

it("a catastrophically backtracking pattern is rejected rather than executed", () => {
  expect(() => assertSafeRegex("(a+)+$")).toThrow(/unsafe/i);
  expect(() => assertSafeRegex("a".repeat(MAX_REGEX_LENGTH + 1))).toThrow(/too long/i);
});

it("grades QNT-005 (fill_blank, two blanks) with partial credit", () => { /* 1 of 2 blanks right */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/grade/text.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `text.ts` and `assertSafeRegex`**

`assertSafeRegex(pattern: string): void` rejects on length over `MAX_REGEX_LENGTH`, and on a group with a quantifier (`*`, `+`, `{n,}`) applied to a group that itself contains an unbounded quantifier — the nested-quantifier shape that produces exponential backtracking. Throw an `Error` whose message names which rule failed; `validate.ts` in Task 10 surfaces it at import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/grade/text.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/grade/text.ts packages/core/test/grade/text.test.ts
git commit -s -m "feat(core): grade fill_blank and numeric with safe regex and tolerance rules"
```

---

## Task 7: Manual grading, dispatch and attempt aggregation

**Files:**
- Create: `packages/core/src/grade/manual.ts`, `packages/core/src/grade/index.ts`, `packages/core/src/score.ts`
- Create: `packages/core/test/grade/manual.test.ts`, `packages/core/test/score.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `gradeChoice`, `gradeStructured`, `gradeText`.
- Produces:
  ```ts
  export function gradeManual(q: ManualQuestion, award: RubricAward | null, d: ScoringDefaults): GradeResult;
  export function gradeQuestion(q: Question, r: ResponseValue | null, d: ScoringDefaults): GradeResult;
  export interface SectionScore { sectionId: string; points: number; max: number }
  export interface AttemptScore {
    perQuestion: Record<string, GradeResult>;
    sections: SectionScore[];
    total: number;      // clamped at 0, rounded to 2 dp
    max: number;
    percent: number;    // 0–100, 2 dp
    passed: boolean | null; // null when the test sets no pass mark
    pending: string[];  // IDs of manual questions awaiting a reviewer
  }
  export function scoreAttempt(input: {
    questionsBySection: { sectionId: string; questions: Question[] }[];
    responses: Record<string, ResponseValue | null>;
    awards: Record<string, RubricAward>;
    defaults: ScoringDefaults;
    passMarkPercent?: number;
  }): AttemptScore;
  ```

An ungraded manual question contributes `0` points and `max` to the maximum, and its ID appears in `pending`. This task owns Review Focus item 5.

- [ ] **Step 1: Write the failing test**

```ts
it("an ungraded long_answer scores zero, counts toward max, and is listed as pending", () => { /* WRI-002 */ });

it("rubric mode sums the levels a reviewer picked", () => { /* two levels, 3 + 2 points */ });

it("gradeQuestion dispatches every one of the 12 types without throwing", () => {
  for (const q of allTwelveFixtures) expect(() => gradeQuestion(q, null, defaults)).not.toThrow();
});

it("a 40-question partial-credit section totals exactly, with no float residue", () => {
  const s = scoreAttempt(fortyTwoThirdsCorrect);
  expect(s.sections[0].points).toBe(26.8);   // not 26.799999999999997
  expect(Number.isInteger(s.percent * 100)).toBe(true);
});

it("negative marking can take one question below zero but never the section or the total", () => {
  expect(scoreAttempt(allWrongUnderNegative).total).toBe(0);
  expect(scoreAttempt(allWrongUnderNegative).perQuestion["LOG-001"].points).toBeLessThan(0);
});

it("passed is null when no pass mark is set, and compares against percent when one is", () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/score.test.ts packages/core/test/grade/manual.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `manual.ts`, `index.ts` and `score.ts`**

`gradeQuestion` is a `switch` on `q.type` with no `default` branch, so adding a 13th type becomes a compile error rather than a runtime surprise. `scoreAttempt` rounds at each boundary: per question (already done by `applyMode`), per section, then total.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/grade/manual.ts packages/core/src/grade/index.ts packages/core/src/score.ts packages/core/test packages/core/src/index.ts
git commit -s -m "feat(core): manual grading, type dispatch and attempt aggregation"
```

---

## Task 8: Seeded randomness and shuffling

**Files:**
- Create: `packages/core/src/rng.ts`
- Create: `packages/core/test/rng.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function makeRng(seed: string): () => number;   // uniform in [0, 1)
  export function shuffle<T>(items: readonly T[], rng: () => number): T[];
  export function shuffleOptions(options: readonly QuestionOption[], rng: () => number): QuestionOption[];
  ```

`makeRng` hashes the seed string to a 32-bit integer and drives a mulberry32 generator — deterministic, dependency-free, and good enough for paper shuffling (it is not and must never be used for tokens or access codes). `shuffle` is Fisher–Yates. `shuffleOptions` holds every option with `pinned: true` at its authored index and shuffles only the rest (PRD `T-10`).

- [ ] **Step 1: Write the failing test**

```ts
it("the same seed gives the same order, a different seed usually gives another", () => {
  expect(shuffle(TEN, makeRng("att_1"))).toEqual(shuffle(TEN, makeRng("att_1")));
  expect(shuffle(TEN, makeRng("att_1"))).not.toEqual(shuffle(TEN, makeRng("att_2")));
});

it("shuffle is a permutation: same length, same members", () => { /* … */ });

it("pinned options keep their index while the rest move", () => {
  const opts = [a, b, c, { ...d, pinned: true }];           // "All of the above" last
  for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
    expect(shuffleOptions(opts, makeRng(seed))[3].id).toBe("d");
  }
});

it("an empty list and a single-item list are returned unchanged", () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/rng.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `rng.ts`**

Add a file-level comment stating plainly that this generator is for presentation order only and is not cryptographically secure.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/rng.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rng.ts packages/core/test/rng.test.ts
git commit -s -m "feat(core): seeded shuffling with pinned options held in place"
```

---

## Task 9: Question selection and set assignment

**Files:**
- Create: `packages/core/src/select.ts`
- Create: `packages/core/test/select.test.ts`

**Interfaces:**
- Consumes: `makeRng`, `shuffle` from `rng.ts`; the `section` and `source` shapes from `schemas/test-1.json`.
- Produces:
  ```ts
  export class PoolTooSmallError extends Error { constructor(readonly sectionId: string, readonly wanted: number, readonly available: number) }
  export function selectForSection(input: { section: Section; bank: Question[]; seed: string; setNo?: string }): Question[];
  export function assignSet(input: { sets: readonly string[]; assignment: SetAssignment; registrationIndex: number; candidateId: string; listValue?: string }): string;
  export function layoutForAttempt(input: { sections: Section[]; bank: Question[]; seed: string; setNo?: string }): AttemptLayout;
  export interface AttemptLayout { sections: { sectionId: string; questionIds: string[]; optionOrder: Record<string, string[]> }[]; setNo?: string }
  ```

`layoutForAttempt` is what the candidate runtime stores as `attempt.layout_json` (PRD data model), so a refresh reproduces the same paper. This task owns Review Focus item 3.

- [ ] **Step 1: Write the failing test**

```ts
it("AC-09: five sets, round robin, 50 registrations split 10 each with no two neighbours alike", () => {
  const got = Array.from({ length: 50 }, (_, i) => assignSet({ sets: ["A","B","C","D","E"], assignment: "round_robin", registrationIndex: i, candidateId: `c${i}` }));
  expect(countBy(got)).toEqual({ A: 10, B: 10, C: 10, D: 10, E: 10 });
  for (let i = 1; i < got.length; i++) expect(got[i]).not.toBe(got[i - 1]);
});

it("AC-10: a pool of 'count 10, tag sql, difficulty medium' yields 10 distinct matching questions", () => { /* … */ });

it("a pool that asks for more than the filter yields throws PoolTooSmallError naming both counts", () => {
  expect(() => selectForSection(poolOf({ count: 20, available: 7 }))).toThrow(PoolTooSmallError);
});

it("hash assignment is stable for one candidate and spreads across sets", () => { /* … */ });

it("AC-11: two seeds give different question and option orders, and one seed reproduces its own", () => { /* … */ });

it("a fixed source returns exactly the listed questions in the listed order when shuffle_questions is false", () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/select.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `select.ts`**

Round-robin is `sets[registrationIndex % sets.length]`, which satisfies both halves of `AC-09` directly. `hash` uses the same 32-bit string hash as `makeRng`, reduced modulo the set count. Pool draws filter by tags, difficulty and types, then `shuffle` and take `count`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/select.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/select.ts packages/core/test/select.test.ts
git commit -s -m "feat(core): pool draws, set assignment and per-attempt layouts"
```

---

## Task 10: Cross-field import validation

**Files:**
- Create: `packages/core/src/validate.ts`
- Create: `packages/core/test/validate.test.ts`
- Create: `packages/core/test/fixtures/bad-bank.json`

**Interfaces:**
- Consumes: `assertSafeRegex` from `grade/text.ts`.
- Produces:
  ```ts
  export interface ImportIssue { questionId: string | null; index: number; field: string; message: string }
  export function validateBank(bank: unknown): { ok: true; bank: Bank } | { ok: false; issues: ImportIssue[] };
  ```

The rules are exactly the list in [question-format.md](../../question-format.md#rules-checked-on-import), plus the regex-safety rule from Task 6. Validation is all-or-nothing: any issue means nothing imports, and every issue found is reported, not just the first.

- [ ] **Step 1: Write the failing test**

`bad-bank.json` holds one question per rule, each broken a different way. Then:

```ts
it("AC-05: a bank with one bad key imports nothing and names the question and the reason", () => {
  const r = validateBank(oneBadKey);
  expect(r.ok).toBe(false);
  expect(r.issues).toEqual([{ questionId: "LOG-001", index: 5, field: "key", message: expect.stringContaining("not among the options") }]);
});

it("reports every issue in the file, not only the first", () => {
  expect(validateBank(badBank).issues.length).toBe(7);
});

it("rejects a select_k whose key length is not k", () => { /* … */ });
it("rejects a matching key reusing one right item twice", () => { /* … */ });
it("rejects a fill_blank placeholder with no blank, and a blank with no placeholder", () => { /* … */ });
it("rejects a duplicate question ID and a group reference that does not exist", () => { /* … */ });
it("rejects a regex blank that assertSafeRegex refuses, quoting its message", () => { /* … */ });
it("accepts the example bank unchanged", () => { expect(validateBank(exampleBank).ok).toBe(true); });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `validate.ts`**

Structural checking stays in Ajv against the JSON Schema — do not reimplement it here. `validateBank` assumes a structurally valid document and checks only the cross-field rules. `index` is the question's position in `bank.questions`, so an importer can point at a line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/validate.ts packages/core/test/validate.test.ts packages/core/test/fixtures/bad-bank.json
git commit -s -m "feat(core): all-or-nothing cross-field import validation"
```

---

## Task 11: The AC-06 fixture matrix and the phase gate

**Files:**
- Create: `packages/core/test/fixtures/scoring.json`
- Create: `packages/core/test/acceptance.test.ts`
- Modify: `packages/core/src/index.ts` (final public surface)
- Modify: `README.md` (status line for `packages/core`)

**Interfaces:**
- Consumes: everything above.
- Produces: the public surface other packages import — `gradeQuestion`, `scoreAttempt`, `layoutForAttempt`, `assignSet`, `validateBank`, `makeRng`, `shuffleOptions`, and the types.

`scoring.json` is the gate for `AC-06`. It is table-driven: one entry per (type, mode, case) triple, where case is `correct`, `partial`, `wrong` or `blank`, each with its expected points. `partial` entries exist only for the types the spec says take partial credit.

- [ ] **Step 1: Write the failing test**

```ts
const matrix = JSON.parse(readFileSync("fixtures/scoring.json", "utf8"));

it("AC-06: every type scores as specified under every mode that applies to it", () => {
  for (const c of matrix.cases) {
    expect(gradeQuestion(c.question, c.response, c.defaults).points, `${c.type}/${c.mode}/${c.case}`).toBe(c.expected);
  }
});

it("the matrix covers all 12 types and every applicable mode", () => {
  expect(new Set(matrix.cases.map(c => c.type))).toEqual(new Set(QUESTION_TYPES));
  for (const type of QUESTION_TYPES) {
    expect(modesIn(matrix, type)).toEqual(APPLICABLE_MODES[type]);
  }
});

it("AC-07: select_k rejects a response holding more than k options, and multi_matching accepts several right items per left item", () => { /* … */ });
```

`APPLICABLE_MODES` is exported from `grade/result.ts` as the mode-to-type table from question-format.md, so the coverage assertion has a source of truth rather than a hand-kept list.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/acceptance.test.ts`
Expected: FAIL — the fixture file is missing or incomplete.

- [ ] **Step 3: Write `scoring.json` and finish the public surface**

Build the matrix from the example bank's questions where one of the right type exists, and author the rest inline. Export the full public surface from `src/index.ts`; nothing else in the workspace may import from `@pariksha/core/src/...`.

- [ ] **Step 4: Run the whole suite and the lint and type gates**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`
Expected: all pass. Coverage of `packages/core/src` is at or above 95% lines.

- [ ] **Step 5: Update `README.md` and commit**

Change the `packages/core` status from planned to shipped, and link this plan.

```bash
git add packages/core README.md
git commit -s -m "test(core): AC-06 scoring matrix across all 12 types and 5 modes"
```

---

## Done when

- `pnpm lint typecheck build test` passes locally and in CI on a pull request.
- `AC-06` and `AC-07` pass from `scoring.json`.
- `packages/core/package.json` has an empty `dependencies` block.
- No file under `packages/core/src` references `Date`, `Math.random`, `fs`, `process` or `fetch`.
