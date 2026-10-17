// The three demo questions for the v4 hero's three-card exam demo, lifted
// verbatim from examples/reasoning-aptitude/questions.json (owner approval
// 2026-10-17, .planning/landing/v4-hero-prototype.html). A future
// apps/web/test/demo-questions.test.ts — owned by the hero/markup
// assignment — asserts this file stays byte-identical to that source file.
//
// Two named exports so Rollup can tree-shake: PROMPTS is consumed only by
// the React hero at build time (stems, option text, the matching rows —
// never ships); GRADING is consumed only by the island (exam-demo.ts) and
// is the one place in the shipped bundle that carries a demo question's
// key — the honest analogue of "on the server" for a page with no server.

export interface PromptOption {
  readonly id: string;
  readonly text: string;
}

export interface Prompt {
  readonly id: string;
  readonly type: "single" | "multiple" | "matching";
  readonly prompt: string;
  /** single / multiple only. */
  readonly options?: readonly PromptOption[];
  /** matching only: the left column, in display order. */
  readonly left?: readonly string[];
  /** matching only: the right column (the `<select>` options), in display order. */
  readonly right?: readonly string[];
  readonly points: number;
}

export const PROMPTS: readonly Prompt[] = [
  {
    id: "LOG-001",
    type: "single",
    prompt: "What comes next in the series?\n\n3, 7, 15, 31, 63, ?",
    options: [
      { id: "a", text: "95" },
      { id: "b", text: "117" },
      { id: "c", text: "127" },
      { id: "d", text: "131" },
    ],
    points: 2,
  },
  {
    id: "QNT-004",
    type: "multiple",
    prompt: "Which of these numbers are divisible by 6? (Select all that apply.)",
    options: [
      { id: "a", text: "114" },
      { id: "b", text: "128" },
      { id: "c", text: "222" },
      { id: "d", text: "345" },
      { id: "e", text: "432" },
    ],
    points: 2,
  },
  {
    id: "LOG-003",
    type: "matching",
    prompt: "Match each series to the rule that generates it.",
    left: ["2, 4, 8, 16", "2, 5, 10, 17", "1, 4, 9, 16", "3, 6, 9, 12"],
    right: [
      "Each term is twice the one before it",
      "Add the next odd number, starting at 3",
      "Squares of the natural numbers",
      "Multiples of 3",
    ],
    points: 2,
  },
];

// `ChoiceGrading` / `MatchingGrading` carry only the fields the real grader
// reads (`gradeChoice` / `gradeStructured` in @pariksha/core) — the
// `QuestionBase` fields they never read (`prompt`, `options`, `right`) are
// deliberately absent so the island does not ship a second copy of what the
// React hero already prerenders from `PROMPTS`. The cast in exam-demo.ts is
// what that omission costs, and it is the only cast in that file.
export interface ChoiceGrading {
  readonly id: string;
  readonly type: "single" | "multiple";
  readonly key: string | readonly string[];
  readonly scoring: { readonly mode: "all_or_nothing" | "partial"; readonly points: number };
  readonly explanation: string;
}

export interface MatchingGrading {
  readonly id: string;
  readonly type: "matching";
  /** Only `.length` is read (one part per left item) — the strings themselves never matter to grading. */
  readonly left: readonly string[];
  readonly key: Readonly<Record<string, string>>;
  readonly scoring: { readonly mode: "partial"; readonly points: number };
  readonly explanation: string;
}

export type GradingQuestion = ChoiceGrading | MatchingGrading;

export const GRADING: readonly GradingQuestion[] = [
  {
    id: "LOG-001",
    type: "single",
    key: "c",
    scoring: { mode: "all_or_nothing", points: 2 },
    explanation: "Each term is double the previous term plus one: 63 × 2 + 1 = 127.",
  },
  {
    id: "QNT-004",
    type: "multiple",
    key: ["a", "c", "e"],
    scoring: { mode: "partial", points: 2 },
    explanation:
      "A number is divisible by 6 when it is even and its digits add to a multiple of 3. 128 fails the digit test (1+2+8 = 11) and 345 is odd.",
  },
  {
    id: "LOG-003",
    type: "matching",
    left: ["2, 4, 8, 16", "2, 5, 10, 17", "1, 4, 9, 16", "3, 6, 9, 12"],
    key: {
      "2, 4, 8, 16": "Each term is twice the one before it",
      "2, 5, 10, 17": "Add the next odd number, starting at 3",
      "1, 4, 9, 16": "Squares of the natural numbers",
      "3, 6, 9, 12": "Multiples of 3",
    },
    scoring: { mode: "partial", points: 2 },
    explanation: "In 2, 5, 10, 17 the gaps are 3, 5 and 7.",
  },
];
