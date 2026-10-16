import { describe, it, expect } from "vitest";
import { SCORING_MODES, QUESTION_TYPES } from "../../src/types.js";
import type { Question } from "../../src/types.js";
import { applyMode, resolveScoring, round2, APPLICABLE_MODES } from "../../src/grade/result.js";

describe("applyMode", () => {
  it("all_or_nothing awards full points only when every part is correct", () => {
    expect(
      applyMode({
        mode: "all_or_nothing",
        points: 2,
        negativeFraction: 0,
        parts: { correct: 3, wrong: 0, total: 3 },
        answered: true,
      }).points,
    ).toBe(2);
    expect(
      applyMode({
        mode: "all_or_nothing",
        points: 2,
        negativeFraction: 0,
        parts: { correct: 2, wrong: 1, total: 3 },
        answered: true,
      }).points,
    ).toBe(0);
  });

  it("partial is points times (correct minus wrong) over total, floored at zero", () => {
    expect(
      applyMode({
        mode: "partial",
        points: 2,
        negativeFraction: 0,
        parts: { correct: 2, wrong: 0, total: 3 },
        answered: true,
      }).points,
    ).toBe(1.33);
    expect(
      applyMode({
        mode: "partial",
        points: 2,
        negativeFraction: 0,
        parts: { correct: 1, wrong: 2, total: 3 },
        answered: true,
      }).points,
    ).toBe(0);
  });

  it("negative subtracts the fraction on a wrong answer and allows a negative question score", () => {
    expect(
      applyMode({
        mode: "negative",
        points: 4,
        negativeFraction: 0.25,
        parts: { correct: 0, wrong: 1, total: 1 },
        answered: true,
      }).points,
    ).toBe(-1);
  });

  it("negative awards full points when every part is correct", () => {
    expect(
      applyMode({
        mode: "negative",
        points: 4,
        negativeFraction: 0.25,
        parts: { correct: 1, wrong: 0, total: 1 },
        answered: true,
      }).points,
    ).toBe(4);
  });

  it("negative awards nothing (but no penalty) when nothing is wrong but the answer is incomplete", () => {
    expect(
      applyMode({
        mode: "negative",
        points: 4,
        negativeFraction: 0.25,
        parts: { correct: 1, wrong: 0, total: 2 },
        answered: true,
      }).points,
    ).toBe(0);
  });

  it("position awards points proportional to items in the correct position", () => {
    expect(
      applyMode({
        mode: "position",
        points: 4,
        negativeFraction: 0,
        parts: { correct: 3, wrong: 1, total: 4 },
        answered: true,
      }).points,
    ).toBe(3);
  });

  it("rubric always reports correct as null, awaiting a reviewer, with no points awarded here", () => {
    const result = applyMode({
      mode: "rubric",
      points: 5,
      negativeFraction: 0,
      parts: { correct: 0, wrong: 0, total: 1 },
      answered: true,
    });
    expect(result.points).toBe(0);
    expect(result.correct).toBeNull();
    expect(result.max).toBe(5);
  });

  it("a blank response scores zero in every mode and never loses points", () => {
    for (const mode of SCORING_MODES) {
      expect(
        applyMode({
          mode,
          points: 4,
          negativeFraction: 0.25,
          parts: { correct: 0, wrong: 0, total: 1 },
          answered: false,
        }).points,
      ).toBe(0);
    }
  });

  it("reports max as the question's points, rounded, regardless of mode outcome", () => {
    expect(
      applyMode({
        mode: "all_or_nothing",
        points: 2,
        negativeFraction: 0,
        parts: { correct: 0, wrong: 1, total: 1 },
        answered: true,
      }).max,
    ).toBe(2);
  });
});

describe("round2", () => {
  it("rounds half up to two decimal places", () => {
    expect(round2(7.199999999999999)).toBe(7.2);
    expect(round2(0.125)).toBe(0.13);
  });

  it("handles negative numbers symmetrically", () => {
    expect(round2(-0.125)).toBe(-0.13);
    expect(round2(-1)).toBe(-1);
  });

  it("leaves already-exact values alone", () => {
    expect(round2(0)).toBe(0);
    expect(round2(2)).toBe(2);
  });
});

describe("resolveScoring", () => {
  const base: Question = {
    id: "q1",
    prompt: "2 + 2 = ?",
    type: "single",
    options: [
      { id: "a", text: "3" },
      { id: "b", text: "4" },
    ],
    key: "b",
  };

  it("takes mode, points and negative_fraction from the question's own scoring block when present", () => {
    const q: Question = { ...base, scoring: { mode: "negative", points: 3, negative_fraction: 0.5 } };
    expect(resolveScoring(q, { mode: "all_or_nothing", negativeFraction: 0 })).toEqual({
      mode: "negative",
      points: 3,
      negativeFraction: 0.5,
    });
  });

  it("falls back to the defaults field by field when the question omits them", () => {
    const q: Question = { ...base, scoring: { points: 3 } };
    expect(resolveScoring(q, { mode: "partial", negativeFraction: 0.5 })).toEqual({
      mode: "partial",
      points: 3,
      negativeFraction: 0.5,
    });
  });

  it("falls back to the engine default of 1 point when neither the question nor the defaults supply one", () => {
    const q: Question = { ...base, scoring: { mode: "all_or_nothing" } };
    expect(resolveScoring(q, { mode: "all_or_nothing", negativeFraction: 0 }).points).toBe(1);
  });

  it("falls back entirely to the defaults when the question has no scoring block at all", () => {
    expect(resolveScoring(base, { mode: "position", negativeFraction: 0.33 })).toEqual({
      mode: "position",
      points: 1,
      negativeFraction: 0.33,
    });
  });
});

describe("APPLICABLE_MODES", () => {
  it("lists an entry for exactly the 12 declared question types", () => {
    expect(new Set(Object.keys(APPLICABLE_MODES))).toEqual(new Set(QUESTION_TYPES));
  });

  it("applies all_or_nothing and negative to every auto-graded type, and only rubric to manual types", () => {
    for (const type of QUESTION_TYPES) {
      const modes = APPLICABLE_MODES[type];
      if (type === "short_answer" || type === "long_answer") {
        expect(modes).toEqual(["rubric"]);
      } else {
        expect(modes).toContain("all_or_nothing");
        expect(modes).toContain("negative");
        expect(modes).not.toContain("rubric");
      }
    }
  });

  it("restricts partial to the five part-counted types", () => {
    const partialTypes = QUESTION_TYPES.filter((type) => APPLICABLE_MODES[type].includes("partial"));
    expect(new Set(partialTypes)).toEqual(
      new Set(["multiple", "select_k", "matching", "multi_matching", "fill_blank"]),
    );
  });

  it("restricts position to ordering only", () => {
    const positionTypes = QUESTION_TYPES.filter((type) => APPLICABLE_MODES[type].includes("position"));
    expect(positionTypes).toEqual(["ordering"]);
  });
});
