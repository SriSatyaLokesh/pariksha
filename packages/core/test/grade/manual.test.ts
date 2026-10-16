import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Question } from "../../src/types.js";
import type { ScoringDefaults } from "../../src/grade/result.js";
import { gradeManual, type ManualQuestion, type RubricAward } from "../../src/grade/manual.js";
import { gradeQuestion } from "../../src/grade/index.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const bank = JSON.parse(
  readFileSync(join(repoRoot, "examples/reasoning-aptitude/questions.json"), "utf8"),
) as { questions: Question[] };

function byId(id: string): Question {
  const q = bank.questions.find((candidate) => candidate.id === id);
  if (!q) throw new Error(`fixture question ${id} not found`);
  return q;
}

const defaults: ScoringDefaults = { mode: "all_or_nothing", negativeFraction: 0 };

// A custom fixture whose rubric levels are chosen so a reviewer picking two
// of them sums to an unambiguous, hand-checkable total (3 + 2 = 5).
const TWO_LEVEL_RUBRIC: ManualQuestion = {
  id: "RUB-001",
  type: "long_answer",
  prompt: "Explain the argument's weakness and propose a test.",
  rubric: [
    { level: "names-the-flaw", points: 3 },
    { level: "proposes-evidence", points: 2 },
  ],
  scoring: { mode: "rubric", points: 5 },
};

describe("gradeManual", () => {
  it("an ungraded long_answer (WRI-002) scores zero, counts toward max, and reports correct: null", () => {
    const result = gradeManual(byId("WRI-002") as ManualQuestion, null, defaults);
    expect(result.points).toBe(0);
    expect(result.max).toBe(5);
    expect(result.correct).toBeNull();
  });

  it("an ungraded short_answer (WRI-001) scores zero and counts toward max", () => {
    const result = gradeManual(byId("WRI-001") as ManualQuestion, null, defaults);
    expect(result.points).toBe(0);
    expect(result.max).toBe(3);
    expect(result.correct).toBeNull();
  });

  it("rubric mode sums the levels a reviewer picked", () => {
    const award: RubricAward = { levels: ["names-the-flaw", "proposes-evidence"] };
    const result = gradeManual(TWO_LEVEL_RUBRIC, award, defaults);
    expect(result.points).toBe(5);
    expect(result.max).toBe(5);
    expect(result.correct).toBeNull();
  });

  it("a reviewer picking a single level only sums that level's points", () => {
    const award: RubricAward = { levels: ["names-the-flaw"] };
    expect(gradeManual(TWO_LEVEL_RUBRIC, award, defaults).points).toBe(3);
  });

  it("an empty levels array is a graded zero, not an ungraded question (still correct: null)", () => {
    const result = gradeManual(TWO_LEVEL_RUBRIC, { levels: [] }, defaults);
    expect(result.points).toBe(0);
    expect(result.correct).toBeNull();
  });
});

describe("gradeQuestion (type dispatch)", () => {
  it("dispatches every one of the 12 types without throwing", () => {
    const allTwelveTypes = new Set(bank.questions.map((q) => q.type));
    expect(allTwelveTypes.size).toBe(12);
    for (const q of bank.questions) {
      expect(() => gradeQuestion(q, null, defaults)).not.toThrow();
    }
  });

  it("a manual question graded through gradeQuestion is always pending (no award channel), correct: null", () => {
    const result = gradeQuestion(byId("WRI-002"), null, defaults);
    expect(result.correct).toBeNull();
    expect(result.points).toBe(0);
  });

  it("an auto-graded question dispatches to its real grader and scores correctly", () => {
    expect(gradeQuestion(byId("LOG-007"), { kind: "boolean", value: true }, defaults).points).toBe(1);
    expect(gradeQuestion(byId("LOG-007"), { kind: "boolean", value: false }, defaults).points).toBe(0);
  });
});
