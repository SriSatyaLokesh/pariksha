// Manual grading (Phase 8b Task 1, `K14`): a reviewer's rubric award, and
// the one route that records it.
//
// `K14`: an award writes `response.points`/`response.graded_by` and the
// attempt is rescored immediately, through `rescoreAttempt` (`K5`) — the
// single scoring path submission and regrade already share. There is no
// separate awards store and no deferred rescore, so this file never
// computes a score itself; it only assembles `rescoreAttempt`'s input and
// writes what comes back.
//
// `recordAward` passes **every** manual question this attempt already
// carries a grade for, not only the one just graded, because the score is
// of the whole paper and a rescore that only knew about the new award
// would un-grade every question graded before it. `listResponses`
// (`packages/db`) already carries `graded_by`/`points` for the whole
// attempt, so reconstructing that set costs no second read of `response`.

import { Hono } from "hono";
import { z } from "zod";
import { deriveAward, gradeManual, type ResponseValue, type RubricAward } from "@pariksha/core";
import { attemptForGrading, listResponses, writeAward, writeScore } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";
import type { PinnedLayout } from "../run/attempt.js";
import { defaultsOf, liveQuestions, scoringOf } from "../run/submit.js";
import { rescoreAttempt } from "../run/rescore.js";

/** Stores the award and rescores in one call. `K14`. */
export async function recordAward(
  deps: AppDeps,
  workspaceId: string,
  input: { attemptId: string; questionId: string; award: RubricAward; gradedBy: string; now: number },
): Promise<{ points: number; written: boolean }> {
  // `K9`: one bank read, reused for the rubric check below and for
  // reconstructing every other stored award — never a second read of the
  // same workspace-wide question set.
  const byId = await liveQuestions(deps, workspaceId);
  const q = byId.get(input.questionId);
  if (q === undefined || (q.type !== "short_answer" && q.type !== "long_answer")) {
    throw new ApiError(422, "not_manual", `${input.questionId} is not a manually-graded question.`);
  }
  // Review Focus 1: a question authored with no rubric sums to 0 whatever
  // a grader picks (`gradeManual`, `packages/core/src/grade/manual.ts`) —
  // refusing here is what keeps a grader from awarding into that silently.
  if (!q.rubric || q.rubric.length === 0) {
    throw new ApiError(422, "no_rubric", `Question ${input.questionId} defines no rubric to grade against.`);
  }

  const attempt = await attemptForGrading(deps.db, workspaceId, input.attemptId);
  if (attempt === null) {
    throw new ApiError(404, "not_found", "No such resource.");
  }
  // Fix round 1, F1: `writeScore` already refuses to stamp a score onto an
  // attempt still in progress (`submitted_at IS NOT NULL`), but nothing
  // stopped `writeAward` from running first — so grading an in-progress
  // attempt corrupted `response.points` under a fresh score that was never
  // actually written, and answered 200. Refuse before either write runs.
  if (attempt.submittedAt === null) {
    throw new ApiError(409, "not_submitted", "This attempt has not been submitted yet.");
  }

  const defaults = defaultsOf(scoringOf(attempt.settings));
  const { points } = gradeManual(q, input.award, defaults);

  const { written } = await writeAward(deps.db, workspaceId, {
    attemptId: input.attemptId,
    questionId: input.questionId,
    points,
    gradedBy: input.gradedBy,
    now: input.now,
  });

  // Read back after the write, not before: the award just stored is then
  // already part of "every stored award", with no special-casing for the
  // one this call just graded.
  const responses = await listResponses(deps.db, workspaceId, input.attemptId);

  const awards: Record<string, RubricAward> = {};
  for (const r of responses) {
    if (r.gradedBy === null) continue;
    // Fix round 1, F2: a `null` reconstruction (a rubric level edited out
    // from under an already-graded answer) is left **out** of `awards`
    // entirely, not inserted as a zero-scoring one — `scoreAttempt`
    // (`packages/core/src/score.ts`) only re-enters `pending` when a
    // question's id is *absent* from this map, so inserting `{ levels: [] }`
    // here would silently zero a candidate's credit instead of sending the
    // question back to a human.
    const award = deriveAward(byId.get(r.questionId), r.points ?? 0);
    if (award !== null) awards[r.questionId] = award;
  }

  const { score } = await rescoreAttempt(deps, {
    workspaceId,
    layout: attempt.layout as PinnedLayout,
    settings: attempt.settings,
    responses: Object.fromEntries(responses.map((r) => [r.questionId, r.value as ResponseValue | null])),
    awards,
  });

  const { updated } = await writeScore(deps.db, workspaceId, { attemptId: input.attemptId, score });
  // The `submittedAt` guard above is what makes this true — a dropped
  // return here, not a missing guard, is how F1 shipped undetected.
  if (!updated) {
    throw new Error(`recordAward: writeScore did not update attempt ${input.attemptId}`);
  }

  return { points, written };
}

const gradeBody = z.object({
  attemptId: z.string().min(1),
  questionId: z.string().min(1),
  award: z.object({ levels: z.array(z.string()) }),
});

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new ApiError(400, "invalid_request", "The request body is not valid.", {
    issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

/** `POST /api/v1/workspaces/:id/tests/:testId/grade` — `workspace`
 *  authority, `attempts.grade`. Mounted by `createApp` under
 *  `/api/v1/workspaces`, like every other workspace route. */
export function gradeRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/:id/tests/:testId/grade", requires("attempts.grade"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const body = parse(gradeBody, await c.req.json().catch(() => null));

    const result = await recordAward(deps, workspaceId, {
      attemptId: body.attemptId,
      questionId: body.questionId,
      award: body.award,
      gradedBy: actor.userId,
      now: deps.now(),
    });
    return c.json(result);
  });

  return routes;
}
