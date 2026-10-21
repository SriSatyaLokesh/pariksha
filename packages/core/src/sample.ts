// The downloadable import sample (`D18`): "one question of every type, so
// it cannot drift from what the importer accepts".
//
// WHAT "GENERATED FROM schemas/question-1.json" CAN AND CANNOT MEAN. The
// schema's `type` enum is the list of twelve this file walks, and it walks
// it through `QUESTION_TYPES` rather than by reading the JSON at runtime:
// `packages/core/test/types.test.ts` already pins that constant to the
// schema's own enum, so a thirteenth type in the schema reddens there, and
// the exhaustive `Record<QuestionType, …>` below then refuses to compile
// until it has an example. Reading the schema here instead would ship 218
// lines of JSON into the organiser's bundle to recover an array this
// package already holds under guard.
//
// The per-type SHAPES cannot be generated at all, and that is a fact about
// the format rather than a shortcut taken here. A mechanical instance
// generator over the schema's `allOf`/`if`-`then` blocks would satisfy
// every `required` and every `type` and still be refused by the importer:
// `key` must name an option that exists, `select_k`'s key length must equal
// `k`, a `fill_blank` prompt's `{{id}}` placeholders must match its blanks,
// a `matching` key must use items from `left` and `right`. Those rules live
// in `validateBank` precisely because no JSON Schema can express them. So
// the examples are written, and then PROVED:
//
//   packages/core/test/types.test.ts   — against schemas/bank-1.json and
//                                        schemas/question-1.json (Ajv), and
//                                        against `validateBank`
//   apps/api/test/import/json.test.ts  — through the real import route
//
// That inversion is what makes "cannot drift" true. A change to either
// schema that this file does not follow reddens a guard; nothing here is
// asserted against a hand-written copy of what the sample is expected to
// contain.
//
// Pure, like the rest of this package: no I/O, no randomness, no clock. A
// caller that wants a file gets `JSON.stringify` of this.

import { QUESTION_TYPES, type Bank, type Question, type QuestionType } from "./types.js";

/** The file name the organiser is offered. Here rather than in the web
 *  route so the sample and its name travel together. */
export const SAMPLE_BANK_FILENAME = "pariksha-sample-bank.json";

/**
 * One worked example per type, minus the two fields `sampleBank` fills in
 * (`id`, `type`). Written as a mapped type over `QuestionType`, which is
 * the compile-time half of the coverage guarantee: a type added to
 * `QUESTION_TYPES` without an entry here is a type error, not a sample that
 * quietly ships eleven.
 *
 * The content teaches the format — a reader opens this to learn what the
 * importer accepts — so the prompts are real sentences and the optional
 * fields that carry meaning (`explanation`, `tags`, `difficulty`) appear on
 * some questions and not all, which is itself the lesson that they are
 * optional. `scoring` is deliberately absent everywhere: a mode that does
 * not apply to its type is an import issue (`APPLICABLE_MODES`), and a
 * sample is the wrong place to make a reader guess which pairs are legal.
 */
const EXAMPLES: {
  [T in QuestionType]: Omit<Extract<Question, { type: T }>, "id" | "type">;
} = {
  single: {
    prompt: "Which SQL clause removes rows **after** grouping?",
    options: [
      { id: "a", text: "WHERE" },
      { id: "b", text: "HAVING" },
      { id: "c", text: "ORDER BY" },
      { id: "d", text: "LIMIT" },
    ],
    key: "b",
    difficulty: "easy",
    tags: ["sql"],
    explanation: "WHERE filters rows before grouping; HAVING filters the groups themselves.",
  },
  multiple: {
    prompt: "Which of these are ACID properties? Select every one that applies.",
    options: [
      { id: "a", text: "Atomicity" },
      { id: "b", text: "Availability" },
      { id: "c", text: "Isolation" },
      { id: "d", text: "Durability" },
    ],
    key: ["a", "c", "d"],
    tags: ["databases"],
  },
  select_k: {
    prompt: "Name exactly two index structures a relational engine commonly offers.",
    options: [
      { id: "a", text: "B-tree" },
      { id: "b", text: "Hash" },
      { id: "c", text: "Linked list" },
      { id: "d", text: "Stack" },
    ],
    k: 2,
    key: ["a", "b"],
  },
  true_false: {
    prompt: "A PRIMARY KEY column may contain NULL.",
    key: false,
    explanation: "A primary key is NOT NULL and unique by definition.",
  },
  assertion_reason: {
    prompt: "Read the assertion and the reason, then choose how they relate.",
    assertion: "An index can make a query slower to run.",
    reason: "Every index has to be kept up to date when rows are written.",
    key: "both_true_explains",
  },
  matching: {
    prompt: "Match each HTTP status code to what it means.",
    left: ["200", "404", "500"],
    right: ["OK", "Not Found", "Server Error"],
    key: { "200": "OK", "404": "Not Found", "500": "Server Error" },
  },
  multi_matching: {
    prompt: "Match each language to every paradigm it supports. A language may take more than one.",
    left: ["Python", "Haskell"],
    right: ["Object-oriented", "Functional", "Lazy"],
    key: {
      Python: ["Object-oriented", "Functional"],
      Haskell: ["Functional", "Lazy"],
    },
    difficulty: "hard",
  },
  ordering: {
    // The schema's own note: items are listed in the CORRECT order and
    // shown shuffled.
    prompt: "Put these stages of an HTTP request in the order they happen.",
    items: ["DNS lookup", "TCP handshake", "TLS handshake", "Request sent", "Response received"],
  },
  fill_blank: {
    prompt: "The time complexity of binary search is O({{complexity}}), and it needs a {{order}} array.",
    blanks: [
      { id: "complexity", accepted: ["log n", "logn", "log(n)"] },
      { id: "order", accepted: ["sorted", "ordered"] },
    ],
    explanation: "Each comparison halves the range, so the work is logarithmic in the input size.",
  },
  numeric: {
    prompt: "A 2 kB page holds how many 64-byte rows?",
    unit: "rows",
    key: { value: 32, tolerance: 0, tolerance_type: "absolute" },
  },
  short_answer: {
    prompt: "In one sentence, say what a database transaction is for.",
    max_length: 280,
    model_answer: "It groups several changes so that either all of them happen or none of them do.",
    rubric: [
      { level: "Complete", points: 2, description: "Names the all-or-nothing guarantee." },
      { level: "Partial", points: 1, description: "Describes grouping changes but not atomicity." },
      { level: "Absent", points: 0 },
    ],
  },
  long_answer: {
    prompt: "Explain, with an example, why an index speeds up reads and slows down writes.",
    max_length: 2000,
    rubric: [
      { level: "Strong", points: 5, description: "Both directions explained, with a worked example." },
      { level: "Adequate", points: 3, description: "Both directions explained, no example." },
      { level: "Weak", points: 1, description: "Only one direction." },
    ],
  },
};

/**
 * A complete `pariksha/bank@1` document carrying one question of every
 * type (`D18`).
 *
 * A fresh object every call: the caller serialises it, and a shared frozen
 * literal would be one `JSON.parse` away from being mutated by whoever
 * reads it next.
 */
export function sampleBank(): Bank {
  return {
    format: "pariksha/bank@1",
    name: "Pariksha sample bank",
    description:
      "One question of every type Pariksha accepts. Edit it, or use it as the shape for your own file.",
    questions: QUESTION_TYPES.map((type) => ({
      // The type's own name, so a thirteenth type gets an id without a
      // second table to keep in step. Underscores are legal in the
      // schema's `^[A-Za-z0-9_.-]{1,64}$` id pattern.
      id: `sample-${type}`,
      type,
      ...EXAMPLES[type],
      // TypeScript cannot correlate `type` with `EXAMPLES[type]` across a
      // `map` — the callback is not generic in the element — so the
      // discriminated union is restored here. `EXAMPLES`' own mapped type
      // is what actually checks each example against its variant.
    })) as Question[],
  };
}
