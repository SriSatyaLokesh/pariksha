// Phase 7e Task 4: the unlock, and the one read it needs — the product's
// first organiser-side attempt routes.
//
// `Q5a` (the brief's own ruling): there is no organiser attempt route in
// this product at all yet — `attempts.monitor` has sat in the permission
// matrix since Phase 3 with nothing behind it. This is deliberately a
// minimal pair, not a monitor: a locked-attempts read, and the unlock.
// Phase 8's monitor replaces both; neither is designed to survive it.
//
// `Q5b`: audited through Phase 3's append-only log (`appendAudit`), behind
// the permission matrix — not a `review` row, which is Phase 8's verdict
// model and not this task's to pre-empt.
//
// `attempts.monitor` gates both routes — the matrix's `proctor` role holds
// it, and so do `admin` and `owner` (`packages/core/src/permissions.ts`).

import { Hono } from "hono";
import {
  appendAudit,
  appendEvents,
  getAttemptLockState,
  getTest,
  listLockedAttempts,
  unlockAttempt,
} from "@pariksha/db";
import type { ProctoringEventType } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";

/** The brief's own wire type, verbatim. */
export interface LockedAttemptRow {
  attemptId: string;
  candidateLabel: string;
  lockedAt: number;
  violations: number;
  remainingSeconds: number;
}

export function attemptsRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/tests/:testId/attempts", requires("attempts.monitor"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");

    // `Q5a`'s minimal pair reads one status only — there is no other list
    // this route can answer yet, so a caller asking for anything else is
    // told rather than silently handed the same rows back.
    if (c.req.query("status") !== "locked") {
      throw new ApiError(400, "invalid_request", 'status must be "locked".');
    }

    // S-09: a test in another workspace is simply not found.
    const test = await getTest(deps.db, workspaceId, testId);
    if (!test) throw new ApiError(404, "not_found", "No such resource.");

    const rows = await listLockedAttempts(deps.db, workspaceId, testId);
    const now = deps.now();
    const attempts: LockedAttemptRow[] = rows.map((row) => ({
      attemptId: row.attemptId,
      candidateLabel: row.candidateLabel,
      lockedAt: row.lockedAt,
      violations: row.violations,
      // `Q5c`: a read, never a write — this is the same clock `GET
      // /api/v1/run/attempt`'s own `remainingMs` reads, just in seconds and
      // never negative.
      remainingSeconds: Math.max(0, Math.round((row.deadlineAt - now) / 1000)),
    }));
    return c.json({ attempts });
  });

  routes.post("/:id/tests/:testId/attempts/:attemptId/unlock", requires("attempts.monitor"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    const attemptId = c.req.param("attemptId");
    const now = deps.now();

    // The existence-and-scope read: an attempt that does not exist, or
    // belongs to a different test, is 404 — never 403 or a silent no-op
    // (S-09's own posture, applied to a path this phase is the first to
    // name an attempt id on).
    const existing = await getAttemptLockState(deps.db, workspaceId, { attemptId, testId });
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    const { unlocked } = await unlockAttempt(deps.db, workspaceId, { attemptId });
    if (!unlocked) {
      throw new ApiError(409, "not_locked", "This attempt is not locked.");
    }

    // m5: the audit row is `Q5b`'s whole point of this route, so it goes
    // right after the write it is auditing — before the event marker,
    // which is the lower-stakes of the two. Writing it last (the original
    // order) meant a throw between the two left the attempt unlocked with
    // no audit row at all: a silently unaudited privileged write. This
    // ordering cannot make that failure disappear (D1 has no multi-
    // statement transaction across these three repo calls), but it shrinks
    // the unaudited window to "the event marker didn't write" instead of
    // "the audit never happened".
    //
    // `Q5b`: Phase 3's append-only log, not a `review` row. `KG9`:
    // `detail_json` carries ids only — there is nothing else to say here
    // that is not already the actor (the row's own `actor`) and the
    // attempt (its own `target`).
    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "attempt.unlock",
      target: attemptId,
      now,
    });

    // `attempt_unlocked` (`SERVER_SYNTHESIZED_EVENTS`, `packages/core/src/
    // proctoring.ts`) — written directly through `appendEvents`, the exact
    // shape `routes/proctoring.ts`'s own `attempt_locked` marker uses,
    // never through the candidate's own ingest schema.
    await appendEvents(deps.db, workspaceId, {
      attemptId,
      events: [{ type: "attempt_unlocked" satisfies ProctoringEventType, clientTs: now }],
      serverTs: now,
    });

    return c.json({ unlocked: true });
  });

  return routes;
}
