import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { Bank, MatchingQuestion, MultiMatchingQuestion, OrderingQuestion } from "../../src/types.js";
import { gradeStructured } from "../../src/grade/structured.js";
import type { ScoringDefaults } from "../../src/grade/result.js";

const bank = JSON.parse(
  readFileSync(new URL("../../../../examples/reasoning-aptitude/questions.json", import.meta.url), "utf8"),
) as Bank;

function findQuestion<T extends { id: string }>(id: string): T {
  const q = bank.questions.find((candidate) => candidate.id === id);
  if (!q) throw new Error(`fixture question ${id} not found`);
  return q as unknown as T;
}

const LOG_003 = findQuestion<MatchingQuestion>("LOG-003");
const LOG_004 = findQuestion<MultiMatchingQuestion>("LOG-004");
const LOG_006 = findQuestion<OrderingQuestion>("LOG-006");

const defaults: ScoringDefaults = { mode: "partial", negativeFraction: 0.25 };

describe("gradeStructured", () => {
  describe("matching (LOG-003)", () => {
    it("grades with partial credit per left item: full, half, none", () => {
      const full = gradeStructured(LOG_003, { kind: "map", pairs: { ...LOG_003.key } }, defaults);
      expect(full.points).toBe(2);
      expect(full.max).toBe(2);
      expect(full.correct).toBe(true);
      expect(full.parts).toEqual({ correct: 4, wrong: 0, total: 4 });

      // Two of the four left items answered correctly, the rest omitted.
      const half = gradeStructured(
        LOG_003,
        {
          kind: "map",
          pairs: {
            "2, 4, 8, 16": LOG_003.key["2, 4, 8, 16"] as string,
            "1, 4, 9, 16": LOG_003.key["1, 4, 9, 16"] as string,
          },
        },
        defaults,
      );
      expect(half.points).toBe(1);
      expect(half.correct).toBe(false);
      expect(half.parts).toEqual({ correct: 2, wrong: 0, total: 4 });

      // Every left item answered, every one wrong.
      const none = gradeStructured(
        LOG_003,
        {
          kind: "map",
          pairs: {
            "2, 4, 8, 16": "Multiples of 3",
            "2, 5, 10, 17": "Squares of the natural numbers",
            "1, 4, 9, 16": "Add the next odd number, starting at 3",
            "3, 6, 9, 12": "Each term is twice the one before it",
          },
        },
        defaults,
      );
      expect(none.points).toBe(0);
      expect(none.correct).toBe(false);
      expect(none.parts).toEqual({ correct: 0, wrong: 4, total: 4 });
    });

    it("a response omitting some left items scores only the ones answered, and is not a blank", () => {
      const result = gradeStructured(
        LOG_003,
        {
          kind: "map",
          pairs: {
            "2, 4, 8, 16": LOG_003.key["2, 4, 8, 16"] as string,
            "1, 4, 9, 16": LOG_003.key["1, 4, 9, 16"] as string,
          },
        },
        defaults,
      );
      // Half the left items answered correctly, the other half not
      // mentioned at all — still scores 1 of 2 points, not the 0 a blank
      // response would score.
      expect(result.points).toBe(1);
      expect(result.parts).toEqual({ correct: 2, wrong: 0, total: 4 });
    });

    it("a null response is blank: zero points, not correct, no penalty", () => {
      const result = gradeStructured(LOG_003, null, defaults);
      expect(result.points).toBe(0);
      expect(result.max).toBe(2);
      expect(result.correct).toBe(false);
    });
  });

  describe("multi_matching (LOG-004)", () => {
    it("counts pairs, not left items: a 3-pair left item scores 3, a spurious pair scores wrong", () => {
      // LOG-004's key has 6 pairs across 4 left items: 12→Even (1),
      // 17→Prime (1), 36→Even/Perfect square/Divisible by 9 (3),
      // 45→Divisible by 9 (1).
      const result = gradeStructured(
        LOG_004,
        {
          kind: "multimap",
          pairs: {
            "12": ["Even"], // 1 correct pair
            "36": ["Even", "Perfect square", "Divisible by 9"], // 3 correct pairs
            "45": ["Even"], // spurious: "Even" is not a pair the key has for 45
            // "17" left unanswered entirely — contributes nothing, not wrong
          },
        },
        defaults,
      );
      expect(result.parts).toEqual({ correct: 4, wrong: 1, total: 6 });
      // partial: points * (correct - wrong) / total = 2 * (4 - 1) / 6 = 1
      expect(result.points).toBe(1);
      expect(result.correct).toBe(false);
    });

    it("grades a fully correct response with full credit", () => {
      const result = gradeStructured(LOG_004, { kind: "multimap", pairs: { ...LOG_004.key } }, defaults);
      expect(result.parts).toEqual({ correct: 6, wrong: 0, total: 6 });
      expect(result.points).toBe(2);
      expect(result.correct).toBe(true);
    });

    it("a null response is blank", () => {
      const result = gradeStructured(LOG_004, null, defaults);
      expect(result.points).toBe(0);
      expect(result.correct).toBe(false);
      expect(result.parts).toEqual({ correct: 0, wrong: 0, total: 6 });
    });
  });

  describe("ordering (LOG-006)", () => {
    const position: ScoringDefaults = { mode: "position", negativeFraction: 0 };

    it("grades by position: 3 of 5 items in their authored index", () => {
      // LOG-006 items: Abandon, Abdomen, Abide, Ability, Abject. Keep the
      // first three in place, swap the last two.
      const result = gradeStructured(
        LOG_006,
        { kind: "order", items: ["Abandon", "Abdomen", "Abide", "Abject", "Ability"] },
        position,
      );
      expect(result.parts).toEqual({ correct: 3, wrong: 2, total: 5 });
      // position: points * correct / total = 2 * 3 / 5 = 1.2
      expect(result.points).toBe(1.2);
      expect(result.correct).toBe(false);
    });

    it("under all_or_nothing, scores zero unless the whole sequence matches", () => {
      const allOrNothing: OrderingQuestion = {
        ...LOG_006,
        scoring: { mode: "all_or_nothing", points: 2 },
      };
      const partial = gradeStructured(
        allOrNothing,
        { kind: "order", items: ["Abandon", "Abdomen", "Abide", "Abject", "Ability"] },
        defaults,
      );
      expect(partial.points).toBe(0);
      expect(partial.correct).toBe(false);

      const exact = gradeStructured(allOrNothing, { kind: "order", items: [...LOG_006.items] }, defaults);
      expect(exact.points).toBe(2);
      expect(exact.correct).toBe(true);
    });
  });
});
