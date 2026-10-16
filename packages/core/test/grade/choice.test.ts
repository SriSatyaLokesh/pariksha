import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Question, ResponseValue } from "../../src/types.js";
import type { GradeResult } from "../../src/grade/result.js";
import { gradeChoice, type ChoiceQuestion } from "../../src/grade/choice.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const bank = JSON.parse(
  readFileSync(join(repoRoot, "examples/reasoning-aptitude/questions.json"), "utf8"),
) as { questions: Question[] };

function byId(id: string): ChoiceQuestion {
  const q = bank.questions.find((candidate) => candidate.id === id);
  if (!q) throw new Error(`fixture question ${id} not found`);
  return q as ChoiceQuestion;
}

const defaults = { mode: "all_or_nothing", negativeFraction: 0.25 } as const;

function grade(id: string, r: ResponseValue | null): GradeResult {
  return gradeChoice(byId(id), r, defaults);
}

describe("gradeChoice", () => {
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

  it("grades LOG-007 (true_false) and LOG-005 (assertion_reason) all-or-nothing", () => {
    const tf = grade("LOG-007", { kind: "boolean", value: true });
    expect(tf.points).toBe(1);
    expect(tf.correct).toBe(true);
    expect(grade("LOG-007", { kind: "boolean", value: false }).points).toBe(0);

    const ar = grade("LOG-005", { kind: "option", option: "both_true_explains" });
    expect(ar.points).toBe(2);
    expect(ar.correct).toBe(true);
    expect(grade("LOG-005", { kind: "option", option: "a_true_r_false" }).points).toBe(0);
  });

  it("an option ID not present in the question's options counts as wrong, never as an error", () => {
    expect(grade("LOG-001", { kind: "option", option: "zzz" }).correct).toBe(false);
  });

  it("order never matters for multiple and select_k", () => {
    expect(grade("QNT-003", { kind: "options", options: ["d", "b"] }).points).toBe(2);
  });

  it("a null response is blank and scores zero without penalty, even in negative mode", () => {
    const negativeDefaults = { mode: "negative", negativeFraction: 0.5 } as const;
    expect(gradeChoice(byId("LOG-001"), null, negativeDefaults).points).toBe(0);
    expect(gradeChoice(byId("QNT-004"), null, negativeDefaults).points).toBe(0);
  });

  it("an empty options array is treated as answered-with-nothing-selected, not blank", () => {
    const result = grade("QNT-004", { kind: "options", options: [] });
    expect(result.points).toBe(0);
    expect(result.correct).toBe(false);
    // Distinguish from blank: a blank result reports parts.total 0-matching but
    // here parts.total must still be the key length (3), proving the question
    // was actually scored rather than short-circuited as unanswered.
    expect(result.parts).toEqual({ correct: 0, wrong: 0, total: 3 });
  });

  // A response whose `kind` doesn't match the question type's expected
  // shape (e.g. {kind:"number"} on a `single` question) must be treated as
  // blank, the same way structured.ts and text.ts already treat it — not
  // as answered-and-all-wrong. Before this fix, LOG-001 (single) scored
  // -1 under negative with a 0.25 fraction on 4 points, exactly as if the
  // candidate had guessed wrong; QNT-004 (multiple) and QNT-003
  // (select_k) scored 0 for the identical mismatched response because
  // countKeyedOptions' fallback happened not to apply a penalty — same
  // candidate behaviour, inconsistent cost depending on question type.
  it("a response whose kind doesn't match the question type scores 0 with no penalty under negative, for each choice type", () => {
    const negativeDefaults = { mode: "negative", negativeFraction: 0.25 } as const;
    const mismatched: ResponseValue = { kind: "number", value: 1 };

    for (const id of ["LOG-001" /* single */, "LOG-007" /* true_false */, "LOG-005" /* assertion_reason */]) {
      const result = gradeChoice(byId(id), mismatched, negativeDefaults);
      expect(result.points).toBe(0);
      expect(result.correct).toBe(false);
      expect(result.parts.wrong).toBe(0);
    }

    for (const id of ["QNT-004" /* multiple */, "QNT-003" /* select_k */]) {
      const result = gradeChoice(byId(id), mismatched, negativeDefaults);
      expect(result.points).toBe(0);
      expect(result.correct).toBe(false);
      expect(result.parts.wrong).toBe(0);
    }
  });
});
