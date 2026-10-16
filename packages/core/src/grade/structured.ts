// Grades the three structured-family types: matching, multi_matching and
// ordering. Each type reduces to a correct/wrong/total part count; applyMode
// (grade/result.ts) does all mode arithmetic and rounding — this file never
// reimplements it.

import type { MatchingQuestion, MultiMatchingQuestion, OrderingQuestion, ResponseValue } from "../types.js";
import type { GradeResult, ScoringDefaults } from "./result.js";
import { applyMode, resolveScoring } from "./result.js";

export type StructuredQuestion = MatchingQuestion | MultiMatchingQuestion | OrderingQuestion;

type Parts = { correct: number; wrong: number; total: number };

export function gradeStructured(q: StructuredQuestion, r: ResponseValue | null, d: ScoringDefaults): GradeResult {
  const { mode, points, negativeFraction } = resolveScoring(q, d);
  const { answered, parts } = evaluate(q, r);
  return applyMode({ mode, points, negativeFraction, parts, answered });
}

/**
 * Reduces the question + response to an answered flag and a part count, in
 * one pass per type so the "is this blank" check and the kind-narrowing it
 * depends on stay next to each other.
 *
 * `null` is blank. An empty collection (no pairs, no items) is also blank —
 * a response is only "answered" once it holds at least one entry. A
 * partially filled `matching` / `multi_matching` map, with some left items
 * omitted, is still answered: it just scores only the entries present.
 */
function evaluate(q: StructuredQuestion, r: ResponseValue | null): { answered: boolean; parts: Parts } {
  switch (q.type) {
    case "matching": {
      // One part per left item (docs/question-format.md: the key maps each
      // left item to one right item).
      const total = q.left.length;
      if (r === null || r.kind !== "map" || Object.keys(r.pairs).length === 0) {
        return { answered: false, parts: { correct: 0, wrong: 0, total } };
      }
      let correct = 0;
      let wrong = 0;
      for (const [left, right] of Object.entries(r.pairs)) {
        if (q.key[left] === right) correct += 1;
        else wrong += 1;
      }
      return { answered: true, parts: { correct, wrong, total } };
    }
    case "multi_matching": {
      // One part per pair in the key, not per left item: a left item mapped
      // to three right items is three parts.
      const total = Object.values(q.key).reduce((sum, rights) => sum + rights.length, 0);
      if (r === null || r.kind !== "multimap" || Object.keys(r.pairs).length === 0) {
        return { answered: false, parts: { correct: 0, wrong: 0, total } };
      }
      let correct = 0;
      let wrong = 0;
      for (const [left, rights] of Object.entries(r.pairs)) {
        const keyRights = new Set(q.key[left] ?? []);
        // Dedupe a left item's chosen rights so repeating one doesn't farm
        // extra parts.
        for (const right of new Set(rights)) {
          if (keyRights.has(right)) correct += 1;
          // A pair not in the key at all (unknown left item, or a right
          // item the key never pairs with that left item) counts wrong.
          else wrong += 1;
        }
      }
      return { answered: true, parts: { correct, wrong, total } };
    }
    case "ordering": {
      // The key is implicit: `items` as authored is the correct order
      // (docs/question-format.md) — Pariksha shuffles them for candidates.
      const total = q.items.length;
      if (r === null || r.kind !== "order" || r.items.length === 0) {
        return { answered: false, parts: { correct: 0, wrong: 0, total } };
      }
      let correct = 0;
      for (let i = 0; i < total; i += 1) {
        if (r.items[i] === q.items[i]) correct += 1;
      }
      return { answered: true, parts: { correct, wrong: total - correct, total } };
    }
  }
}
