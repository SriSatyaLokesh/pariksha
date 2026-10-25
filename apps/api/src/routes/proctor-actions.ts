import { Hono } from "hono";
import type { ProctoringEventType } from "@pariksha/core";
import {
  appendAudit,
  appendEvents,
  countAttemptsForCandidate,
  createAttempt,
  newId,
  setProctorMessage,
  unlockAttempt,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";
import type { AttemptContextVar } from "../middleware/attemptContext.js";
import { TIMING_DEFAULTS, timingOf } from "../run/clock.js";
import { submitAttempt } from "../run/submit.js";

export type ProctorAction =
  | { kind: "extend_time"; minutes: number }
  | { kind: "unlock" }
  | { kind: "reset" }
  | { kind: "force_submit" }
  | { kind: "message"; text: string };

interface AttemptRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  test_version_id: string;
  set_no: number;
  layout_json: unknown;
  started_at: number;
  deadline_at: number;
  submitted_at: number | null;
  submit_reason: string | null;
  section_started_at: number | null;
  max_index: number;
  flag: string;
  locked_at: number | null;
  proctor_message: string | null;
  proctor_message_at: number | null;
  score_json: unknown;
  test_id: string;
  version: number;
  settings_json: unknown;
  sections_json: unknown;
}

export function proctorActionsRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/:id/attempts/:attemptId/action", requires("attempts.monitor"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const attemptId = c.req.param("attemptId");
    const now = deps.now();

    const body = (await c.req.json().catch(() => null)) as ProctorAction | null;
    if (!body || typeof body !== "object" || typeof body.kind !== "string") {
      throw new ApiError(400, "invalid_request", "kind is required.");
    }

    const rows = await deps.db.query<AttemptRow>(
      "SELECT a.id, a.workspace_id, a.candidate_id, a.test_version_id, a.set_no, a.layout_json, " +
        "a.started_at, a.deadline_at, a.submitted_at, a.submit_reason, a.section_started_at, " +
        "a.max_index, a.flag, a.locked_at, a.proctor_message, a.proctor_message_at, a.score_json, " +
        "v.test_id AS test_id, v.version AS version, v.settings_json AS settings_json, " +
        "v.sections_json AS sections_json " +
        "FROM attempt a JOIN test_version v ON v.id = a.test_version_id " +
        "WHERE a.workspace_id = ? AND a.id = ?",
      [workspaceId, attemptId],
    );

    const row = rows[0];
    if (!row) {
      throw new ApiError(404, "not_found", "No such resource.");
    }

    const layout = (deps.db.jsonValue(row.layout_json) ?? {}) as Record<string, unknown>;
    if (!Array.isArray(layout.paper)) {
      layout.paper = [];
    }

    const attempt: AttemptContextVar = {
      attemptId: row.id,
      workspaceId: row.workspace_id,
      candidateId: row.candidate_id,
      testId: row.test_id,
      testVersionId: row.test_version_id,
      version: Number(row.version),
      setNo: Number(row.set_no),
      layout: layout as unknown as AttemptContextVar["layout"],
      startedAt: Number(row.started_at),
      deadlineAt: Number(row.deadline_at),
      submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
      submitReason: row.submit_reason,
      sectionStartedAt: row.section_started_at === null ? null : Number(row.section_started_at),
      maxIndex: Number(row.max_index),
      flag: row.flag,
      lockedAt: row.locked_at === null ? null : Number(row.locked_at),
      proctorMessage: row.proctor_message ?? null,
      proctorMessageAt: row.proctor_message_at == null ? null : Number(row.proctor_message_at),
      score: row.score_json == null ? null : deps.db.jsonValue(row.score_json),
      settings: deps.db.jsonValue(row.settings_json),
      sections: deps.db.jsonValue(row.sections_json),
    };

    switch (body.kind) {
      case "extend_time": {
        if (typeof body.minutes !== "number" || body.minutes <= 0) {
          throw new ApiError(400, "invalid_request", "minutes must be a positive number.");
        }

        if (attempt.submittedAt !== null) {
          await appendAudit(deps.db, workspaceId, {
            actor: actor.userId,
            action: "proctor.extend_time",
            target: attemptId,
            detail: { candidateId: attempt.candidateId, minutes: body.minutes, reason: "already_submitted" },
            now,
          });
          return c.json({ extended: false, reason: "already_submitted" });
        }

        const newDeadlineAt = attempt.deadlineAt + body.minutes * 60_000;
        await deps.db.run(
          "UPDATE attempt SET deadline_at = ? WHERE workspace_id = ? AND id = ? AND submitted_at IS NULL",
          [newDeadlineAt, workspaceId, attemptId],
        );

        await appendAudit(deps.db, workspaceId, {
          actor: actor.userId,
          action: "proctor.extend_time",
          target: attemptId,
          detail: { candidateId: attempt.candidateId, minutes: body.minutes, newDeadlineAt },
          now,
        });

        return c.json({ extended: true, deadlineAt: newDeadlineAt });
      }

      case "unlock": {
        const { unlocked } = await unlockAttempt(deps.db, workspaceId, { attemptId });
        if (unlocked) {
          await appendEvents(deps.db, workspaceId, {
            attemptId,
            events: [{ type: "attempt_unlocked" satisfies ProctoringEventType, clientTs: now }],
            serverTs: now,
          });
        }

        await appendAudit(deps.db, workspaceId, {
          actor: actor.userId,
          action: "proctor.unlock",
          target: attemptId,
          detail: { candidateId: attempt.candidateId, unlocked },
          now,
        });

        return c.json({ unlocked });
      }

      case "reset": {
        const attempts = await countAttemptsForCandidate(deps.db, workspaceId, attempt.candidateId, now);
        const settings = attempt.settings;
        const timing = timingOf(settings);
        const attemptsAllowed = timing.attempts_allowed ?? TIMING_DEFAULTS.attempts_allowed;
        if (attempts.count >= attemptsAllowed) {
          throw new ApiError(409, "attempts_exhausted", "Candidate has reached the maximum number of attempts allowed.");
        }

        const newAttemptId = newId("att");
        const durationMinutes = timing.duration_minutes ?? 60;
        const deadlineAt = now + durationMinutes * 60_000;
        const token = randomToken();
        const tokenHash = await sha256Hex(token);

        await createAttempt(deps.db, workspaceId, {
          id: newAttemptId,
          candidateId: attempt.candidateId,
          testVersionId: attempt.testVersionId,
          setNo: attempt.setNo,
          layout: attempt.layout,
          startedAt: now,
          deadlineAt,
          tokenHash,
        });

        await appendAudit(deps.db, workspaceId, {
          actor: actor.userId,
          action: "proctor.reset",
          target: attemptId,
          detail: { candidateId: attempt.candidateId, previousAttemptId: attemptId, newAttemptId },
          now,
        });

        return c.json({ ok: true, newAttemptId });
      }

      case "force_submit": {
        await submitAttempt(deps, attempt, "manual", now);

        await appendAudit(deps.db, workspaceId, {
          actor: actor.userId,
          action: "proctor.force_submit",
          target: attemptId,
          detail: { candidateId: attempt.candidateId },
          now,
        });

        return c.json({ ok: true, submitted: true });
      }

      case "message": {
        if (typeof body.text !== "string" || body.text.trim() === "") {
          throw new ApiError(400, "invalid_request", "text is required.");
        }

        const messageText = body.text.trim();
        await setProctorMessage(deps.db, workspaceId, attemptId, messageText, now);

        await appendAudit(deps.db, workspaceId, {
          actor: actor.userId,
          action: "proctor.message",
          target: attemptId,
          detail: { candidateId: attempt.candidateId, text: messageText },
          now,
        });

        return c.json({ ok: true, sent: true });
      }

      default:
        throw new ApiError(400, "invalid_request", `Unsupported action kind: ${String((body as { kind?: unknown }).kind)}`);
    }
  });

  return routes;
}
