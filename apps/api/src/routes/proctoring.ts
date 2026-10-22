// `POST /api/v1/run/attempt/events` — the one route every later gate in
// Phase 7c posts to (`Q7`). One route, `attempt` authority, taking an
// array and calling `appendEvents()` (`packages/db/src/repo/attempts.ts`)
// unchanged. **Ten events per request**, the cap that function already
// documents and the daily write budget it already protects.
//
// **Ids are minted server-side, as `evt_`.** No client-generated id and no
// idempotency key — `Q7`'s own ruling: an event is evidence, not an
// answer, and at-least-once delivery is fine for it. `appendEvents`'s own
// header explains why a duplicate row after a retry is a cosmetic defect
// rather than a correctness one.
//
// `Q7a`: **the server counts.** The response carries the authoritative
// violation count straight off the database, never a client-side tally
// that resets on reload — the same count `GET /api/v1/run/attempt` now
// reports, so the two can never disagree.
//
// `Q7c`: rate-limited through Phase 6 Task 4's limiter (`attempt_events`
// in `run/limit.ts`) and a measured `ROUTE_BUDGETS` entry — declared in
// `app.ts`, next to the route's mount and its `ROUTE_AUTH` line.
//
// `detail` stays `unknown` here, deliberately: `Q7b` wants a declared
// shape per event type, but that belongs to the plan that emits each
// event (Tasks 4 and 5), not to the route that merely stores whatever it
// is handed.

import { Hono } from "hono";
import { z } from "zod";
import { appendEvents, countViolations } from "@pariksha/db";
import { PROCTORING_EVENTS } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { attemptContext } from "../middleware/attemptContext.js";
import { limitOrThrow } from "../run/limit.js";
import { resolvedProctoringOf } from "../run/attempt.js";

/** `Q7`: the cap `appendEvents` already documents and the daily write
 *  budget it protects. Real, not advisory — refused before the request
 *  touches the database or the rate limiter. */
export const MAX_EVENTS_PER_REQUEST = 10;

/** `ROUTE_BUDGETS` and `ROUTE_AUTH` key on this literally; the test suite
 *  and `scrub-scan.test.ts`'s derived endpoint list import it rather than
 *  retyping it, the same way `ANSWER_PATH` keeps `/attempt/answer` in one
 *  place. */
export const EVENTS_PATH = "/api/v1/run/attempt/events";

const eventItem = z.object({
  type: z.enum(PROCTORING_EVENTS),
  detail: z.unknown().optional(),
  clientTs: z.number(),
});

const eventsRequest = z.object({
  events: z.array(eventItem).max(MAX_EVENTS_PER_REQUEST),
});

export function proctoringRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/attempt/events", attemptContext(deps), async (c) => {
    const attempt = c.get("attempt");

    // Closed-set `type` and the ten-event cap, before anything is spent:
    // neither the rate limiter nor the database is touched by a request
    // that fails this.
    const parsed = eventsRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "That event could not be read. Try again.");
    }

    // `Q7c`: volume is the risk here, not a wrong guess, so every request
    // is charged — the way `email_code`'s bucket is and `test_access`'s
    // is not. Keyed per attempt, never per candidate or per test: one
    // attempt's flapping browser must not cost another candidate theirs.
    await limitOrThrow(deps, "attempt_events", attempt.attemptId);

    await appendEvents(deps.db, attempt.workspaceId, {
      attemptId: attempt.attemptId,
      events: parsed.data.events,
      serverTs: deps.now(),
    });

    const violations = await countViolations(deps.db, attempt.workspaceId, attempt.attemptId);
    // `Q1`: `limit` and `action` come from the resolved object, never from
    // the raw overrides and never from a branch on `profile`. The same
    // `resolvedProctoringOf` helper `GET /attempt` uses — one boundary
    // cast from the stored, `unknown` settings column, not two.
    const resolved = resolvedProctoringOf(attempt.settings);

    return c.json({ violations, limit: resolved.violationLimit, action: resolved.violationAction });
  });

  return routes;
}
