// The three demo questions for the hero's interactive exam, lifted verbatim
// from examples/reasoning-aptitude/questions.json (v3 spec §2.2, §3.3).
// `apps/web/test/demo-questions.test.ts` — owned by the hero assignment —
// asserts this file stays byte-identical to that source file.
//
// Two named exports so Rollup can tree-shake: PROMPTS is consumed only by
// the React hero at build time (stems, option text — never ships); GRADING
// is consumed only by the island (exam-demo.ts) and is the one place in the
// shipped bundle that carries a demo question's key — the honest analogue
// of "on the server" for a page with no server (v3 spec §2.2, "Why not
// read the keys from the DOM").

export interface PromptOption {
  readonly id: string;
  readonly text: string;
}

export interface Prompt {
  readonly id: string;
  readonly type: "single" | "true_false" | "multiple";
  readonly prompt: string;
  readonly options?: readonly PromptOption[];
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
    id: "LOG-007",
    type: "true_false",
    prompt:
      "In a certain code, EARTH is written as FBSUI. **Statement:** each letter has been replaced by the letter that follows it in the alphabet.",
    points: 1,
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
];

export interface GradingQuestion {
  readonly id: string;
  readonly type: "single" | "true_false" | "multiple";
  readonly key: string | boolean | readonly string[];
  readonly scoring: { readonly mode: "all_or_nothing" | "partial"; readonly points: number };
  readonly explanation: string;
}

export const GRADING: readonly GradingQuestion[] = [
  {
    id: "LOG-001",
    type: "single",
    key: "c",
    scoring: { mode: "all_or_nothing", points: 2 },
    explanation: "Each term is double the previous term plus one: 63 × 2 + 1 = 127.",
  },
  {
    id: "LOG-007",
    type: "true_false",
    key: true,
    scoring: { mode: "all_or_nothing", points: 1 },
    explanation: "E→F, A→B, R→S, T→U, H→I.",
  },
  {
    id: "QNT-004",
    type: "multiple",
    key: ["a", "c", "e"],
    scoring: { mode: "partial", points: 2 },
    explanation:
      "A number is divisible by 6 when it is even and its digits add to a multiple of 3. 128 fails the digit test (1+2+8 = 11) and 345 is odd.",
  },
];
