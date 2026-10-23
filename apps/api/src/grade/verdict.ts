// Reviewer verdicts (Phase 8b Task 3, `K16`): a human judgement about one
// attempt, recorded alongside the machine score `grade/award.ts` writes —
// never replacing it, and never replaced by it. See
// `packages/db/src/repo/review.ts` for why a regrade after a verdict exists
// leaves the verdict untouched.

import { Hono } from "hono";
import { z } from "zod";
import { getAttempt, recordVerdict } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";

const verdictBody = z.object({
  verdict: z.enum(["clear", "suspicious", "disqualified"]),
  note: z.string().optional(),
});

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new ApiError(400, "invalid_request", "The request body is not valid.", {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

/** `POST /api/v1/workspaces/:id/attempts/:attemptId/verdict` — `workspace`
 *  authority, `attempts.grade`. Mounted by `createApp` under
 *  `/api/v1/workspaces`, like every other workspace route. */
export function verdictRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post(
    "/:id/attempts/:attemptId/verdict",
    requires("attempts.grade"),
    async (c) => {
      const actor = actorOr401(c);
      const workspaceId = c.req.param("id");
      const attemptId = c.req.param("attemptId");
      const body = parse(verdictBody, await c.req.json().catch(() => null));

      // Same 404-not-403 shape every other attempt-scoped route in this
      // phase uses (`attemptForGrading` in `grade/award.ts`): an attempt
      // belonging to another workspace, or no attempt at all, answers the
      // same as a workspace the actor cannot see.
      const attempt = await getAttempt(deps.db, workspaceId, attemptId);
      if (attempt === null) {
        throw new ApiError(404, "not_found", "No such resource.");
      }

      const input: {
        attemptId: string;
        reviewer: string;
        verdict: typeof body.verdict;
        now: number;
        note?: string;
      } = {
        attemptId,
        reviewer: actor.userId,
        verdict: body.verdict,
        now: deps.now(),
      };
      if (body.note !== undefined) input.note = body.note;

      const result = await recordVerdict(deps.db, workspaceId, input);
      return c.json(result);
    },
  );

  return routes;
}
