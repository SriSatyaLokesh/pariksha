import { Hono } from "hono";
import { resolveProctoring, type AttemptLayout } from "@pariksha/core";
import {
  getDraftVersion,
  getPublishedVersion,
  getTest,
  listMonitorAttempts,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";

function extractCandidateName(formValues: Record<string, unknown>): string | undefined {
  const name =
    formValues.name ??
    formValues.fullName ??
    formValues.full_name ??
    formValues.candidateName ??
    formValues["Name"] ??
    formValues["Full Name"];
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

function extractCandidateEmail(
  externalId: string | null,
  formValues: Record<string, unknown>,
): string | undefined {
  const email =
    formValues.email ??
    formValues.emailAddress ??
    formValues.candidateEmail ??
    formValues["Email"] ??
    formValues["Email Address"];
  if (typeof email === "string" && email.trim() !== "") return email.trim();
  if (externalId && externalId.includes("@")) return externalId.trim();
  return undefined;
}

export function monitorRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/tests/:testId/monitor", requires("attempts.monitor"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    const now = deps.now();

    const test = await getTest(deps.db, workspaceId, testId);
    if (!test) throw new ApiError(404, "not_found", "No such resource.");

    const version =
      (await getPublishedVersion(deps.db, workspaceId, testId)) ??
      (await getDraftVersion(deps.db, workspaceId, testId));
    const resolvedProctoring = resolveProctoring(version?.body.settings.proctoring);

    const candCount = await deps.db.query<{ total: number; consented: number }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN consent_at IS NOT NULL THEN 1 ELSE 0 END) AS consented FROM candidate WHERE workspace_id = ? AND test_id = ?",
      [workspaceId, testId],
    );

    const attemptRecords = await listMonitorAttempts(deps.db, workspaceId, testId);

    const registered = Math.max(
      Number(candCount[0]?.consented ?? 0),
      Number(candCount[0]?.total ?? 0),
      attemptRecords.length,
    );

    let inProgress = 0;
    let submitted = 0;
    let autoSubmitted = 0;

    const allRows = attemptRecords.map((rec) => {
      let status: "started" | "in_progress" | "submitted" | "auto_submitted" | "locked";
      if (rec.lockedAt !== null && rec.submittedAt === null) {
        status = "locked";
        inProgress++;
      } else if (rec.submittedAt !== null) {
        if (rec.submitReason === "limit" || rec.submitReason === "timeout") {
          status = "auto_submitted";
          autoSubmitted++;
        } else {
          status = "submitted";
          submitted++;
        }
      } else if (rec.answeredCount > 0) {
        status = "in_progress";
        inProgress++;
      } else {
        status = "started";
        inProgress++;
      }

      let integrityFlag: "clean" | "review" | "scoring_blocked";
      if (rec.flag === "scoring_blocked") {
        integrityFlag = "scoring_blocked";
      } else if (rec.integrityFlag === "review" || rec.integrityFlag === "high_risk") {
        integrityFlag = "review";
      } else {
        integrityFlag = "clean";
      }

      let camera: "active" | "lost" | "not_required";
      if (!resolvedProctoring.requireCamera) {
        camera = "not_required";
      } else if (rec.latestCameraEvent === "camera_lost") {
        camera = "lost";
      } else {
        camera = "active";
      }

      let totalQuestions = 0;
      const layout = rec.layoutJson as AttemptLayout | null;
      if (layout && Array.isArray(layout.sections)) {
        for (const sec of layout.sections) {
          if (Array.isArray(sec.questionIds)) totalQuestions += sec.questionIds.length;
        }
      }
      if (totalQuestions === 0 && version?.body.sections) {
        for (const sec of version.body.sections) {
          const src = sec.source as unknown as { count?: number; questions?: unknown[] } | undefined;
          const count =
            typeof src?.count === "number"
              ? src.count
              : (Array.isArray(src?.questions) ? src.questions.length : 0);
          totalQuestions += count ?? 0;
        }
      }

      const candidateName = extractCandidateName(rec.candidateFormValues);
      const candidateEmail = extractCandidateEmail(rec.candidateExternalId, rec.candidateFormValues);

      return {
        attemptId: rec.attemptId,
        candidateId: rec.candidateId,
        ...(candidateName !== undefined ? { candidateName } : {}),
        ...(candidateEmail !== undefined ? { candidateEmail } : {}),
        status,
        startedAt: rec.startedAt,
        submittedAt: rec.submittedAt,
        deadlineAt: rec.deadlineAt,
        answeredCount: rec.answeredCount,
        totalQuestions,
        violations: rec.violations,
        integrityFlag,
        lastContactAt: rec.lastContactAt,
        camera,
        lockedAt: rec.lockedAt,
      };
    });

    let rows = allRows;
    if (c.req.query("flagged") === "1") {
      rows = rows.filter((r) => r.integrityFlag !== "clean");
    }
    if (c.req.query("inactive") === "1") {
      rows = rows.filter((r) => r.lastContactAt === null || now - r.lastContactAt > 120_000);
    }

    return c.json({
      counts: {
        registered,
        inProgress,
        submitted,
        autoSubmitted,
      },
      rows,
    });
  });

  return routes;
}
