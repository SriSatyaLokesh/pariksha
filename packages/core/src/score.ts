// Aggregates per-question grades into section and attempt totals. Rounding
// happens at each boundary, not only at the end: `applyMode` /
// `gradeManual` already round each question's points to 2dp, and this file
// rounds again after summing a section's questions, and again after
// summing an attempt's sections. Summing dozens of already-rounded 2dp
// numbers in binary floating point drifts (`26.8` becomes
// `26.800000000000004`); rounding at every boundary is what keeps the
// numbers that reach the results CSV exact.
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

import type { Question, ResponseValue } from "./types.js";
import type { GradeResult, ScoringDefaults } from "./grade/result.js";
import { round2 } from "./grade/result.js";
import { gradeQuestion } from "./grade/index.js";
import { gradeManual, type ManualQuestion, type RubricAward } from "./grade/manual.js";

export interface SectionScore {
  sectionId: string;
  points: number;
  max: number;
}

export interface AttemptScore {
  perQuestion: Record<string, GradeResult>;
  sections: SectionScore[];
  /** Clamped at 0, rounded to 2dp. */
  total: number;
  max: number;
  /** 0-100, rounded to 2dp. */
  percent: number;
  /** null when the test sets no pass mark. */
  passed: boolean | null;
  /** IDs of manual questions with no reviewer award yet, blank or not. */
  pending: string[];
}

function isManual(q: Question): q is ManualQuestion {
  return q.type === "short_answer" || q.type === "long_answer";
}

export function scoreAttempt(input: {
  questionsBySection: { sectionId: string; questions: Question[] }[];
  responses: Record<string, ResponseValue | null>;
  awards: Record<string, RubricAward>;
  defaults: ScoringDefaults;
  passMarkPercent?: number;
}): AttemptScore {
  const { questionsBySection, responses, awards, defaults, passMarkPercent } = input;

  const perQuestion: Record<string, GradeResult> = {};
  const pending: string[] = [];
  const sections: SectionScore[] = [];

  for (const { sectionId, questions } of questionsBySection) {
    let rawPoints = 0;
    let rawMax = 0;

    for (const q of questions) {
      const response = responses[q.id] ?? null;
      const award = awards[q.id];
      const result = isManual(q) ? gradeManual(q, award ?? null, defaults) : gradeQuestion(q, response, defaults);

      perQuestion[q.id] = result;
      rawPoints += result.points;
      rawMax += result.max;

      // `pending` reports a fact about the data, not a presentation-layer
      // filter: whether a reviewer has ever recorded an award for this
      // question. A blank answer still needs that same yes/no — it is the
      // only signal that distinguishes "never graded" from "graded zero",
      // which matters the moment a result is disputed. A view that wants to
      // hide blanks from a grading queue can filter `pending` itself.
      if (isManual(q) && award === undefined) {
        pending.push(q.id);
      }
    }

    sections.push({
      sectionId,
      points: round2(Math.max(0, rawPoints)),
      max: round2(rawMax),
    });
  }

  const total = round2(Math.max(0, sections.reduce((sum, s) => sum + s.points, 0)));
  const max = round2(sections.reduce((sum, s) => sum + s.max, 0));
  const percent = max > 0 ? round2((total / max) * 100) : 0;
  const passed = passMarkPercent === undefined ? null : percent >= passMarkPercent;

  return { perQuestion, sections, total, max, percent, passed, pending };
}
