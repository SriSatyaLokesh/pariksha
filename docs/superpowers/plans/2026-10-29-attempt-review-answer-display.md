# Human-Readable Answer & Key Display in Attempt Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Attempt Review screen from displaying raw JSON string dumps into a human-readable review interface that displays question prompts, option badges, numeric tolerances, and side-by-side comparison tables.

**Architecture:** Enrich the review API payload with question `prompt` and `questionType` from `qDoc`, parse structured answer `kind` payloads and keys on the frontend, and render them with accessible, token-compliant comparison cards.

**Tech Stack:** TypeScript, React, Hono, Node.js, Vitest, CSS design tokens.

**Spec:** [`docs/superpowers/specs/2026-10-29-attempt-review-answer-display-design.md`](file:///docs/superpowers/specs/2026-10-29-attempt-review-answer-display-design.md)

---

## Global Constraints

- **Security & Authorization:** Scoring keys and question prompts remain strictly gated behind `attempts.read_evidence` permission; candidate-facing submit/attempt APIs must not be modified.
- **Design System Tokens:** Styles must strictly use `theme.css` tokens (`--ground`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, `--accent`, `--risk`, `--warn`, `--edge`).
- **Contrast Test Enforcement:** Any selector declaring `color:` in `apps/web/src/styles/admin.css` must have corresponding entries in `SURFACE` in `apps/web/test/contrast-usage.test.ts`.
- **Zero Third-Party Dependencies:** Vanilla React components and standard CSS only; no external formatting or diff libraries (`ponytail` adherence).
- **Git Commit Author:** All git commits must be made with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

## Review Focus

1. **Malformed or unexpected answer payload:** An answer payload with an unknown `kind` or circular object must not throw an error and must fall back gracefully to a sanitized string.
2. **Unanswered / null response:** Candidate answer is `null` or `{ kind: "empty" }` — must render "—" or "Unanswered" cleanly without crashing.
3. **Missing question prompt:** Legacy questions without `prompt` or questions missing from the bank must render the card header "Question N" without breaking layout.
4. **Unspecified / manual grading key:** When `ans.key` is `null` or `undefined`, the key column must render "—" (Manual grading) instead of literal `null`.
5. **Theme contrast compliance:** All newly added text classes (`.attempt-review__question-prompt`, `.attempt-review__choice-badge`, etc.) must pass `test/contrast-usage.test.ts` and `test/theme.test.ts`.

---

### Task 1: Backend: Expose Question Prompt and Type in Attempt Review API

**Files:**
- Modify: `apps/api/src/routes/attempt-review.ts:75-87,320-349`
- Modify: `apps/web/src/lib/api.ts:245-257`
- Test: `apps/api/test/attempt-review.test.ts:330-345`

**Interfaces:**
- Consumes: `questionsMap: Map<string, Question>` from `liveQuestions(deps, workspaceId)`
- Produces: `AttemptReviewPayload["answers"]` enriched with `prompt: string | null` and `questionType: string | null`

- [x] **Step 1: Write the failing test**

In `apps/api/test/attempt-review.test.ts`, update the authorized reviewer answers assertion around line 334 to verify `prompt` and `questionType`:

```ts
    expect(body.answers[0]).toMatchObject({
      questionId: q1Id,
      sectionId: "sec-1",
      prompt: "What is 2 + 2?",
      questionType: "single",
      answer: "b",
      key: "b",
      pointsAwarded: 2,
      maxPoints: 2,
      correct: true,
    });
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/api test -- -t "answers with keys for authorised reviewers"`
Expected: FAIL with `prompt: undefined` or missing property.

- [x] **Step 3: Implement `prompt` and `questionType` in `apps/api/src/routes/attempt-review.ts` and update types**

1. In `apps/api/src/routes/attempt-review.ts`, update `AttemptReviewPayload["answers"]`:
```ts
  answers: Array<{
    questionId: string;
    sectionId: string;
    prompt?: string | null;
    questionType?: string | null;
    answer: unknown;
    key: unknown;
    pointsAwarded: number | null;
    maxPoints: number;
    correct?: boolean | null;
    verdict?: string;
  }>;
```

2. In the answer mapping loop (lines 337-347):
```ts
  answers.push({
    questionId: qId,
    sectionId: section.sectionId,
    prompt: qDoc?.prompt ?? null,
    questionType: qDoc?.type ?? null,
    answer: answerVal,
    key: keyVal,
    pointsAwarded,
    maxPoints,
    correct,
    ...(verdict !== undefined && { verdict }),
  });
```

3. In `apps/web/src/lib/api.ts`, update `AttemptReviewData["answers"]`:
```ts
  answers: Array<{
    questionId: string;
    sectionId: string;
    prompt?: string | null;
    questionType?: string | null;
    answer: unknown;
    key: unknown;
    pointsAwarded: number | null;
    maxPoints: number;
    correct?: boolean | null;
    verdict?: string;
  }>;
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/api test`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/api/src/routes/attempt-review.ts apps/api/test/attempt-review.test.ts apps/web/src/lib/api.ts
git commit -m "feat(api): expose prompt and questionType in attempt review payload (#274)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 2: Frontend: Human-Readable Renderers and Question Prompt Display

**Files:**
- Modify: `apps/web/src/components/organiser/AttemptReview.tsx`
- Test: `apps/web/test/organiser/attempt-review.test.tsx`

**Interfaces:**
- Consumes: `AttemptReviewData["answers"]` with `prompt`, `questionType`, `answer`, `key`, `verdict`
- Produces: Semantic UI elements (`.attempt-review__question-prompt`, `.attempt-review__answer-comparison`, `.attempt-review__choice-badge`, etc.)

- [x] **Step 1: Write the failing tests**

In `apps/web/test/organiser/attempt-review.test.tsx`, add test cases for:
1. Renders question prompt text when present.
2. Formats multiple-choice options into badges and avoids raw `{"kind":"options"}` JSON strings.
3. Formats numeric answer with tolerance (e.g. `25 (± 0.5)`) and avoids raw `{"kind":"number"}` JSON.
4. Formats matching sequence pairs into a table and avoids raw `{"kind":"map"}` JSON.
5. Formats blanks into labeled items and avoids raw `{"kind":"blanks"}` JSON.
6. Handles unknown or null payloads gracefully without throwing.

```tsx
  it("renders human-readable formats and does not leak raw JSON into the UI", () => {
    const reviewWithComplexAnswers: AttemptReviewData = {
      ...SAMPLE_REVIEW,
      answers: [
        {
          questionId: "q_options",
          sectionId: "sec_1",
          prompt: "Which of the following are prime numbers?",
          questionType: "multiple",
          answer: { kind: "options", options: ["e", "b"] },
          key: ["b", "d"],
          pointsAwarded: 0,
          maxPoints: 2,
          correct: false,
          verdict: "incorrect",
        },
        {
          questionId: "q_num",
          sectionId: "sec_1",
          prompt: "Calculate equilibrium temperature",
          questionType: "numeric",
          answer: { kind: "number", value: 23 },
          key: { value: 25, tolerance: 0.5, tolerance_type: "absolute" },
          pointsAwarded: 0,
          maxPoints: 2,
          correct: false,
          verdict: "incorrect",
        },
        {
          questionId: "q_map",
          sectionId: "sec_1",
          prompt: "Match sequences to rules",
          questionType: "matching",
          answer: { kind: "map", pairs: { "2, 4, 8, 16": "Doubling" } },
          key: { "2, 4, 8, 16": "Doubling" },
          pointsAwarded: 2,
          maxPoints: 2,
          correct: true,
          verdict: "correct",
        },
      ],
    };

    render(<AttemptReview review={reviewWithComplexAnswers} />);

    // Assert prompts are rendered
    expect(screen.getByText("Which of the following are prime numbers?")).toBeInTheDocument();
    expect(screen.getByText("Calculate equilibrium temperature")).toBeInTheDocument();

    // Assert human-readable formatted output
    expect(screen.getByText(/25\s*\(±\s*0\.5\)/)).toBeInTheDocument();
    expect(screen.getByText("Doubling")).toBeInTheDocument();

    // Assert no raw JSON is rendered
    expect(screen.queryByText(/\{"kind":/)).not.toBeInTheDocument();
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test -- -t "renders human-readable formats"`
Expected: FAIL (raw JSON is rendered, prompt is missing).

- [x] **Step 3: Implement formatters and update `AttemptReview.tsx`**

1. Create formatter functions/components in `AttemptReview.tsx`:
   - `renderAnswerValue(val: unknown, key?: unknown): JSX.Element | string`:
     - Checks if `val` is object with `kind`:
       - `kind === "option"`: uppercase badge.
       - `kind === "options"`: badges list with matching status.
       - `kind === "number"`: formatted number.
       - `kind === "map"`: key-value table.
       - `kind === "blanks"`: list of blank pill chips.
       - `kind === "text"`: text span.
       - fallback: stringified without JSON if string/number, safe display for objects.
   - `renderKeyValue(key: unknown): JSX.Element | string`:
     - Array of strings: badges list.
     - Object with `{ value, tolerance }`: formatted string `${value} (± ${tolerance}${tolerance_type === "percent" ? "%" : ""})`.
     - Object dictionary: table of key-value matches.
     - Fallback: "—" for null/undefined, string representation.
2. In the answer card layout:
   - Render `ans.prompt` inside `<div className="attempt-review__question-prompt">{ans.prompt}</div>`.
   - Update the answer body to use `.attempt-review__answer-comparison` with two columns: `Candidate Answer` and `Expected Key`.
   - Style the verdict pill with `.status-badge` (`.status-badge--success` / `.status-badge--blocked`).

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test -- -t "AttemptReview"`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/organiser/AttemptReview.tsx apps/web/test/organiser/attempt-review.test.tsx
git commit -m "feat(web): render human-readable answers, keys, and prompts in AttemptReview (#274)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 3: Styling, Contrast Compliance, and Verification

**Files:**
- Modify: `apps/web/src/styles/admin.css`
- Modify: `apps/web/test/contrast-usage.test.ts`

**Interfaces:**
- Consumes: CSS classes referenced in `AttemptReview.tsx`
- Produces: WCAG AA contrast compliance and design token adherence

- [x] **Step 1: Add styling to `apps/web/src/styles/admin.css`**

Add styles for:
- `.attempt-review__question-prompt`: readable typography with `--ink`, margin bottom.
- `.attempt-review__answer-comparison`: responsive grid for candidate answer and expected key.
- `.attempt-review__choice-badge`: inline-flex badge with `--surface-2` or subtle status tint, `--ink`.
- `.attempt-review__choice-badge--correct`: subtle green tint (`rgba(...)`), border.
- `.attempt-review__choice-badge--incorrect`: subtle red tint, border.
- `.attempt-review__match-table`: clean border-collapse table with `--edge` borders, padding, and subtle header.
- `.attempt-review__blank-chip`: pill container with label and value.

- [x] **Step 2: Run contrast and theme tests**

Run: `pnpm --filter @pariksha/web exec vitest run test/contrast-usage.test.ts test/theme.test.ts`
If any new selector setting `color:` is flagged, register it in `apps/web/test/contrast-usage.test.ts` under `SURFACE` and `INHERITED_SIZE_WEIGHT`.

- [x] **Step 3: Run full verification suite**

Run:
1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm --filter @pariksha/api test`
4. `pnpm --filter @pariksha/web test`

Expected: ALL PASS with 0 errors and 0 warnings.

- [x] **Step 4: Commit**

```bash
git add apps/web/src/styles/admin.css apps/web/test/contrast-usage.test.ts
git commit -m "style(web): attempt review answer display tokens and contrast compliance (#274)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```
