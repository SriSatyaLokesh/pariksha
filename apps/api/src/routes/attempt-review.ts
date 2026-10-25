// Phase 8g Task 4: The Per-Attempt Review Page
// Route: GET /api/v1/workspaces/:id/attempts/:attemptId/review
// Gated on `attempts.read_evidence`

import { Hono } from "hono";
import {
  FAILURE_EVENTS,
  VIOLATION_EVENTS,
  type Question,
  type Section,
} from "@pariksha/core";
import { listResponses, type ResponseRow } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";
import type { PinnedLayout } from "../run/attempt.js";
import { resolvedProctoringOf } from "../run/attempt.js";
import { liveQuestions } from "../run/submit.js";

/** Presigned URL TTL: 10 minutes (K3/K4: 600s expiry, 0 storage subrequests). */
const SIGNED_URL_TTL = 600;

export interface AttemptReviewPayload {
  attempt: {
    id: string;
    candidateId: string;
    status: string;
    startedAt: number | null;
    submittedAt: number | null;
    totalScore: number | null;
    maxScore: number | null;
    integrityFlag: "clean" | "review" | "scoring_blocked";
    observed: boolean;
  };
  registration: Record<string, unknown>;
  identityPhotoUrl: string | null;
  timeline: Array<{
    kind: "snapshot" | "event" | "unobserved";
    timestamp: number;
    snapshotUrl?: string;
    flagged?: boolean;
    reason?: string;
    faceCount?: number | null;
    eventKind?: string;
    details?: Record<string, unknown>;
  }>;
  events: Array<{
    id: string;
    kind: string;
    serverTs: number;
    clientTs: number;
    payload: Record<string, unknown>;
  }>;
  answers: Array<{
    questionId: string;
    sectionId: string;
    answer: unknown;
    key: unknown;
    pointsAwarded: number | null;
    maxPoints: number;
    correct?: boolean | null;
    verdict?: string;
  }>;
  sectionScores: Array<{
    sectionId: string;
    title: string;
    score: number;
    maxScore: number;
  }>;
}

export function attemptReviewRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get(
    "/:id/attempts/:attemptId/review",
    requires("attempts.read_evidence"),
    async (c) => {
      const workspaceId = c.req.param("id");
      const attemptId = c.req.param("attemptId");
      const now = deps.now();

      // 1. Attempt lookup (1 query)
      const attemptRows = await deps.db.query<{
        id: string;
        candidate_id: string;
        test_version_id: string;
        set_no: number;
        layout_json: unknown;
        started_at: number;
        deadline_at: number;
        submitted_at: number | null;
        score_json: unknown;
        flag: string;
        integrity_flag: string;
        observed: unknown;
        locked_at: number | null;
      }>(
        "SELECT id, candidate_id, test_version_id, set_no, layout_json, started_at, deadline_at, submitted_at, score_json, flag, integrity_flag, observed, locked_at FROM attempt WHERE workspace_id = ? AND id = ?",
        [workspaceId, attemptId],
      );
      const attemptRow = attemptRows[0];
      if (!attemptRow) {
        throw new ApiError(404, "not_found", "No such resource.");
      }

      // 2. Candidate lookup (1 query)
      const candidateRows = await deps.db.query<{
        id: string;
        form_values_json: unknown;
      }>(
        "SELECT id, form_values_json FROM candidate WHERE workspace_id = ? AND id = ?",
        [workspaceId, attemptRow.candidate_id],
      );
      const registration = candidateRows[0]?.form_values_json
        ? (deps.db.jsonValue(candidateRows[0].form_values_json) as Record<string, unknown>)
        : {};

      // 3. Test version lookup (1 query)
      const versionRows = await deps.db.query<{
        id: string;
        settings_json: unknown;
        sections_json: unknown;
      }>(
        "SELECT id, settings_json, sections_json FROM test_version WHERE workspace_id = ? AND id = ?",
        [workspaceId, attemptRow.test_version_id],
      );
      const versionSettings = versionRows[0]?.settings_json
        ? deps.db.jsonValue(versionRows[0].settings_json)
        : {};
      const versionSections = versionRows[0]?.sections_json
        ? (deps.db.jsonValue(versionRows[0].sections_json) as Section[])
        : [];

      // 4. Snapshots lookup (1 query)
      const snapshotRows = await deps.db.query<{
        id: string;
        storage_key: string;
        taken_at: number;
        reason: string;
        face_count: number | null;
      }>(
        "SELECT id, storage_key, taken_at, reason, face_count FROM snapshot WHERE workspace_id = ? AND attempt_id = ? ORDER BY taken_at ASC",
        [workspaceId, attemptId],
      );

      // 5. Events lookup (1 query)
      const eventRows = await deps.db.query<{
        id: string;
        type: string;
        detail_json: unknown;
        client_ts: number;
        server_ts: number;
      }>(
        "SELECT id, type, detail_json, client_ts, server_ts FROM event WHERE workspace_id = ? AND attempt_id = ? ORDER BY server_ts ASC",
        [workspaceId, attemptId],
      );

      // 6. Responses lookup (1 query)
      const responses: ResponseRow[] = await listResponses(deps.db, workspaceId, attemptId);
      const responseMap = new Map(responses.map((r) => [r.questionId, r]));

      // 7. Questions lookup (1 query)
      const questionsMap = await liveQuestions(deps, workspaceId);

      // --- Identity Photo ---
      const identitySnapshot = snapshotRows.find((s) => s.reason === "identity");
      const identityPhotoUrl = identitySnapshot
        ? await deps.storage.signedUrl(identitySnapshot.storage_key, {
            expiresInSeconds: SIGNED_URL_TTL,
            now,
          })
        : null;

      // --- Timeline ---
      const timeline: AttemptReviewPayload["timeline"] = [];
      const proctoringSettings = resolvedProctoringOf(versionSettings);
      const intervalSec = proctoringSettings.snapshotIntervalSeconds;

      for (const s of snapshotRows) {
        const snapshotUrl = await deps.storage.signedUrl(s.storage_key, {
          expiresInSeconds: SIGNED_URL_TTL,
          now,
        });
        timeline.push({
          kind: "snapshot",
          timestamp: Number(s.taken_at),
          snapshotUrl,
          flagged: s.reason === "violation" || (s.face_count !== null && s.face_count > 1),
          reason: s.reason,
          faceCount: s.face_count === null ? null : Number(s.face_count),
        });
      }

      let hasCameraLost = false;
      for (const e of eventRows) {
        const detail = e.detail_json == null
          ? {}
          : (deps.db.jsonValue(e.detail_json) as Record<string, unknown>);
        const isViolation = VIOLATION_EVENTS.has(e.type as any);
        const isFailure = FAILURE_EVENTS.has(e.type as any);

        timeline.push({
          kind: "event",
          timestamp: Number(e.server_ts),
          eventKind: e.type,
          details: detail,
          flagged: isViolation || isFailure,
        });

        if (e.type === "camera_lost") {
          hasCameraLost = true;
          timeline.push({
            kind: "unobserved",
            timestamp: Number(e.server_ts),
            reason: "camera_lost",
            details: detail,
          });
        }
      }

      // Check snapshot gaps
      const intervalSnapshots = snapshotRows.filter((s) => s.reason === "interval");
      if (intervalSec > 0 && intervalSnapshots.length > 1) {
        for (let i = 0; i < intervalSnapshots.length - 1; i++) {
          const s1 = intervalSnapshots[i]!;
          const s2 = intervalSnapshots[i + 1]!;
          const diffMs = Number(s2.taken_at) - Number(s1.taken_at);
          if (diffMs > Math.max(intervalSec * 2, 60) * 1000) {
            timeline.push({
              kind: "unobserved",
              timestamp: Number(s1.taken_at) + intervalSec * 1000,
              reason: "unobserved",
              details: { gapMs: diffMs },
            });
          }
        }
      }

      // Unobserved attempt fallback
      if (!attemptRow.observed && !hasCameraLost) {
        timeline.push({
          kind: "unobserved",
          timestamp: Number(attemptRow.started_at),
          reason: "unobserved",
        });
      }

      // Sort timeline chronologically
      timeline.sort((a, b) => a.timestamp - b.timestamp);

      // --- Attempt ---
      const status =
        attemptRow.locked_at !== null
          ? "locked"
          : attemptRow.submitted_at !== null
            ? "submitted"
            : now > Number(attemptRow.deadline_at)
              ? "timeout"
              : "in_progress";

      const scoreJson = attemptRow.score_json == null
        ? null
        : (deps.db.jsonValue(attemptRow.score_json) as any);

      const integrityFlag: "clean" | "review" | "scoring_blocked" =
        attemptRow.flag === "scoring_blocked"
          ? "scoring_blocked"
          : attemptRow.integrity_flag === "review" || attemptRow.integrity_flag === "high_risk"
            ? "review"
            : "clean";

      const attempt = {
        id: attemptRow.id,
        candidateId: attemptRow.candidate_id,
        status,
        startedAt: Number(attemptRow.started_at),
        submittedAt: attemptRow.submitted_at === null ? null : Number(attemptRow.submitted_at),
        totalScore: scoreJson?.total ?? null,
        maxScore: scoreJson?.max ?? null,
        integrityFlag,
        observed: Boolean(attemptRow.observed),
      };

      // --- Events ---
      const events = eventRows.map((e) => ({
        id: e.id,
        kind: e.type,
        serverTs: Number(e.server_ts),
        clientTs: Number(e.client_ts),
        payload: e.detail_json == null
          ? {}
          : (deps.db.jsonValue(e.detail_json) as Record<string, unknown>),
      }));

      // --- Answers ---
      const layout = deps.db.jsonValue(attemptRow.layout_json) as PinnedLayout;
      const answers: AttemptReviewPayload["answers"] = [];

      for (const section of layout.sections ?? []) {
        for (const qId of section.questionIds ?? []) {
          const qDoc = questionsMap.get(qId);
          const resp = responseMap.get(qId);
          const scoredQ = scoreJson?.perQuestion?.[qId];

          const answerVal = resp ? resp.value : null;
          const keyVal = qDoc?.key ?? null;
          const pointsAwarded = scoredQ ? scoredQ.points : (resp?.points ?? null);
          const maxPoints = scoredQ ? scoredQ.max : (qDoc?.scoring?.points ?? 1);
          const correct = scoredQ ? scoredQ.correct : null;
          const verdict = scoredQ
            ? (scoredQ.correct === true ? "correct" : scoredQ.correct === false ? "incorrect" : "pending")
            : undefined;

          answers.push({
            questionId: qId,
            sectionId: section.sectionId,
            answer: answerVal,
            key: keyVal,
            pointsAwarded,
            maxPoints,
            correct,
            ...(verdict !== undefined && { verdict }),
          });
        }
      }

      // --- Section Scores ---
      const sectionScores: AttemptReviewPayload["sectionScores"] = [];
      for (const sec of versionSections) {
        const scoredSec = scoreJson?.sections?.find((s: any) => s.sectionId === sec.id);
        const sectionQuestions = (layout.sections?.find((s) => s.sectionId === sec.id)?.questionIds ?? [])
          .map((qid) => questionsMap.get(qid))
          .filter((q): q is Question => q !== undefined);
        const fallbackMax = sectionQuestions.reduce((sum, q) => sum + (q.scoring?.points ?? 1), 0);

        sectionScores.push({
          sectionId: sec.id,
          title: sec.title ?? "Untitled Section",
          score: scoredSec ? scoredSec.points : 0,
          maxScore: scoredSec ? scoredSec.max : fallbackMax,
        });
      }

      const payload: AttemptReviewPayload = {
        attempt,
        registration,
        identityPhotoUrl,
        timeline,
        events,
        answers,
        sectionScores,
      };

      return c.json(payload);
    },
  );

  return routes;
}
