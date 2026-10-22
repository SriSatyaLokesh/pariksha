// One scoring path (Phase 8, `K5`): submission, grading and regrade all
// score an attempt through this single function. Moved out of
// `submit.ts`, which carries the fuller story (deleted questions, the
// regex bound, a throwing engine) in its own header and on
// `blockedQuestions` — read those before changing anything here.
//
// `K5` (`docs/superpowers/specs/2026-10-22-phase-8-results-design.md`):
// Phase 8 adds no second place where an `AttemptScore` is produced.

import {
  scoreAttempt,
  type AttemptScore,
  type Question,
  type ResponseValue,
  type RubricAward,
} from "@pariksha/core";
import type { AppDeps } from "../app.js";
import type { PinnedLayout } from "./attempt.js";
import { blockedQuestions, defaultsOf, liveQuestions, scoringOf } from "./submit.js";

export interface RescoreResult {
  /** null when the grading engine threw — the attempt is stamped with no
   *  score and `blocked` carries `{ questionId: "*", reason }`. */
  score: AttemptScore | null;
  blocked: { questionId: string; reason: string }[];
  /** The live bank read this call already paid for, handed back so a
   *  caller that also needs the full question documents (`submit.ts`'s
   *  release payload) never pays a second one — `K9`. */
  questions: ReadonlyMap<string, Question>;
}

/**
 * Scores one attempt: reads the live bank once, nulls every question
 * `blockedQuestions` finds before the grader ever sees it, and never lets
 * a throw out of the engine become anything worse than an unscored,
 * flagged attempt. See `submit.ts`'s header (rule 3) for why that last
 * part is a rule and not a convenience.
 */
export async function rescoreAttempt(
  deps: AppDeps,
  input: {
    workspaceId: string;
    layout: PinnedLayout;
    settings: unknown;
    responses: Record<string, ResponseValue | null>;
    awards: Record<string, RubricAward>;
  },
): Promise<RescoreResult> {
  const { workspaceId, layout, settings, responses, awards } = input;

  const byId = await liveQuestions(deps, workspaceId);
  const blocked = blockedQuestions(layout, byId);
  const blockedIds = new Set(blocked.map((one) => one.questionId));

  const questionsBySection = layout.sections.map((section) => ({
    sectionId: section.sectionId,
    questions: section.questionIds.flatMap((id) => {
      const q = byId.get(id);
      return q === undefined ? [] : [q];
    }),
  }));
  const scoring = scoringOf(settings);
  // **A blocked question is never handed to the grader.** Grading one
  // scores the candidate *wrong* — `compilePattern` returns `null` and
  // `matchBlank` answers "did not match" — and under `scoring.mode:
  // "negative"` that takes marks off for a regex the organiser typed, on
  // the same question this `AttemptScore` simultaneously lists as
  // pending. `bounded.ts`'s header says precisely this must not happen. A
  // blank response scores 0 and never loses points **in any mode**
  // (`grade/result.ts`), so the question still costs its points and still
  // counts towards `max` — the ruling `bounded.test.ts` pins — without
  // ever moving the total in either direction.
  const graded: Record<string, ResponseValue | null> = { ...responses };
  for (const id of blockedIds) graded[id] = null;

  let score: AttemptScore | null;
  try {
    const scored = scoreAttempt({
      questionsBySection,
      responses: graded,
      awards,
      defaults: defaultsOf(scoring),
      ...(scoring.pass_mark_percent === undefined
        ? {}
        : { passMarkPercent: scoring.pass_mark_percent }),
    });
    // A blocked question joins the manual ones: awaiting a human, not
    // wrong. Deduplicated, because a manual question cannot also be a
    // `fill_blank` but a deleted one can already be neither.
    score = { ...scored, pending: [...new Set([...scored.pending, ...blockedIds])] };
  } catch (error) {
    // **The attempt completes anyway**, which is rule 3 of `submit.ts`'s
    // header and the plan's own property. The pre-scan above knows two
    // ways a question can be ungradeable; the grading engine can still
    // throw for a third nobody anticipated — a stored document whose
    // shape a grader does not survive. Letting that out is a 500 with no
    // score ever stamped and a retry that fails identically. Instead the
    // caller gets **no score**, flagged, and a reason to audit.
    // `questionId: "*"` is the whole paper, because a throw out of the
    // engine does not say which question it came from.
    score = null;
    blocked.push({
      questionId: "*",
      reason: `the grading engine threw: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return { score, blocked, questions: byId };
}
