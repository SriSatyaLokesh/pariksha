import { Hono } from "hono";
import {
  candidateCountsByWorkspace,
  deriveState,
  getDraftVersion,
  getPublishedVersion,
  getTest,
  headVersionsByTest,
  listAttemptsForTest,
  listCandidates,
  listTests,
  rankedScoresForTest,
  workspaceQuestions,
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

export function resultsRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  // Route 1: Workspace Results Overview
  routes.get("/:id/results/overview", requires("results.export"), async (c) => {
    const workspaceId = c.req.param("id");

    const tests = await listTests(deps.db, workspaceId);
    const heads = await headVersionsByTest(deps.db, workspaceId);
    const candCounts = await candidateCountsByWorkspace(deps.db, workspaceId);

    const attemptRows = await deps.db.query<{
      test_id: string;
      submitted_at: number | null;
      score_json: unknown;
    }>(
      "SELECT tv.test_id, a.submitted_at, a.score_json " +
        "FROM attempt a " +
        "JOIN test_version tv ON tv.workspace_id = a.workspace_id AND tv.id = a.test_version_id " +
        "WHERE a.workspace_id = ?",
      [workspaceId],
    );

    const statsByTest = new Map<
      string,
      {
        totalAttempts: number;
        submittedCount: number;
        totalPercent: number;
        scoredCount: number;
        passCount: number;
      }
    >();

    for (const row of attemptRows) {
      let stat = statsByTest.get(row.test_id);
      if (!stat) {
        stat = { totalAttempts: 0, submittedCount: 0, totalPercent: 0, scoredCount: 0, passCount: 0 };
        statsByTest.set(row.test_id, stat);
      }
      stat.totalAttempts++;
      if (row.submitted_at !== null) {
        stat.submittedCount++;
        if (row.score_json !== null) {
          const score = deps.db.jsonValue<{ percent?: number; passed?: boolean | number }>(row.score_json);
          if (score && typeof score.percent === "number") {
            stat.totalPercent += score.percent;
            stat.scoredCount++;
          }
          if (score && (score.passed === true || score.passed === 1)) {
            stat.passCount++;
          }
        }
      }
    }

    const overviewItems = tests.map((test) => {
      const head = heads.get(test.id);
      const candCount = candCounts.get(test.id)?.total ?? 0;
      const stat = statsByTest.get(test.id);
      const attemptCount = stat?.totalAttempts ?? 0;
      const submittedCount = stat?.submittedCount ?? 0;
      const averageScore =
        stat && stat.scoredCount > 0 ? Math.round((stat.totalPercent / stat.scoredCount) * 10) / 10 : null;
      const passRate =
        stat && submittedCount > 0 ? Math.round((stat.passCount / submittedCount) * 100) / 100 : null;

      return {
        id: test.id,
        name: test.name,
        slug: test.slug,
        state: deriveState(test.status, head?.publishedTiming, deps.now()),
        candidateCount: candCount,
        attemptCount,
        submittedCount,
        averageScore,
        passRate,
      };
    });

    return c.json({ tests: overviewItems });
  });

  // Route 2: Test Results & Candidate Submissions
  routes.get("/:id/tests/:testId/results", requires("results.export"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");

    const test = await getTest(deps.db, workspaceId, testId);
    if (!test) throw new ApiError(404, "not_found", "No such resource.");

    const statusParam = c.req.query("status");
    const integrityParam = c.req.query("integrity");
    const searchParam = c.req.query("search");
    const limitParam = c.req.query("limit");
    const cursor = c.req.query("cursor") || undefined;
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;

    const version =
      (await getPublishedVersion(deps.db, workspaceId, testId)) ??
      (await getDraftVersion(deps.db, workspaceId, testId));
    const candList = await listCandidates(deps.db, workspaceId, testId);
    const ranks = await rankedScoresForTest(deps.db, workspaceId, testId);
    const attemptsPage = await listAttemptsForTest(deps.db, workspaceId, testId, cursor !== undefined ? { limit, cursor } : { limit });
    const rawQuestions = await workspaceQuestions(deps.db, workspaceId);

    const questionsMap = new Map<string, { prompt?: string; scoring?: { points?: number } }>();
    for (const q of rawQuestions) {
      questionsMap.set(q.id, q.document);
      if (q.refId) {
        questionsMap.set(q.refId, q.document);
      }
      if (q.document.id) {
        questionsMap.set(q.document.id, q.document);
      }
    }

    const candidateMap = new Map(candList.map((cand) => [cand.id, cand]));

    let totalPoints = 0;
    for (const row of attemptsPage.rows) {
      const s = row.scoreJson as { max?: number } | null;
      if (typeof s?.max === "number") {
        totalPoints = s.max;
        break;
      }
    }
    if (totalPoints === 0 && version) {
      for (const sec of version.body.sections) {
        if (sec.source.kind === "fixed") {
          for (const qId of sec.source.questions) {
            totalPoints += questionsMap.get(qId)?.scoring?.points ?? 1;
          }
        } else if (sec.source.kind === "sets") {
          for (const qId of sec.source.sets[0]?.questions ?? []) {
            totalPoints += questionsMap.get(qId)?.scoring?.points ?? 1;
          }
        }
      }
    }
    const passMark = version?.body.settings.scoring?.pass_mark_percent ?? null;

    let submittedCount = 0;
    let inProgressCount = 0;
    let lockedCount = 0;
    let totalPercent = 0;
    let scoredCount = 0;
    let passCount = 0;

    for (const row of attemptsPage.rows) {
      if (row.lockedAt !== null && row.submittedAt === null) {
        lockedCount++;
      } else if (row.submittedAt !== null) {
        submittedCount++;
        const s = row.scoreJson as { percent?: number; passed?: boolean | number } | null;
        if (s && typeof s.percent === "number") {
          totalPercent += s.percent;
          scoredCount++;
        }
        if (s && (s.passed === true || s.passed === 1)) {
          passCount++;
        }
      } else {
        inProgressCount++;
      }
    }

    const averageScore = scoredCount > 0 ? Math.round((totalPercent / scoredCount) * 10) / 10 : null;
    const passRate = submittedCount > 0 ? Math.round((passCount / submittedCount) * 100) / 100 : null;

    const summary = {
      totalRegistered: candList.length,
      submittedCount,
      inProgressCount,
      lockedCount,
      averageScore,
      passRate,
    };

    const items = attemptsPage.rows.map((row) => {
      const candidate = candidateMap.get(row.candidateId);
      const formValues = candidate?.formValues ?? {};
      const externalId = candidate?.externalId ?? null;
      const candidateName = extractCandidateName(formValues) ?? externalId ?? null;
      const candidateEmail = extractCandidateEmail(externalId, formValues) ?? null;

      let status: "locked" | "submitted" | "auto_submitted" | "in_progress";
      if (row.lockedAt !== null && row.submittedAt === null) {
        status = "locked";
      } else if (row.submittedAt !== null) {
        if (row.submitReason === "limit" || row.submitReason === "timeout") {
          status = "auto_submitted";
        } else {
          status = "submitted";
        }
      } else {
        status = "in_progress";
      }

      const durationSeconds =
        row.submittedAt !== null ? Math.round((row.submittedAt - row.startedAt) / 1000) : null;

      const s = row.scoreJson as {
        total?: number;
        max?: number;
        percent?: number;
        passed?: boolean | number;
        perQuestion?: Record<string, { points?: number; max?: number; correct?: boolean | null }>;
      } | null;

      const score = s?.total ?? null;
      const maxScore = s?.max ?? null;
      const percentage = s?.percent ?? null;
      const passed =
        typeof s?.passed === "boolean" ? s.passed : s?.passed === 1 ? true : s?.passed === 0 ? false : null;
      const rank = ranks.get(row.attemptId) ?? null;

      const integrityFlag: "clean" | "review" | "scoring_blocked" =
        row.flag === "scoring_blocked"
          ? "scoring_blocked"
          : row.integrityFlag === "review" || row.integrityFlag === "high_risk"
            ? "review"
            : "clean";

      const questionBreakdown: Array<{
        questionId: string;
        promptExcerpt: string;
        pointsEarned: number;
        maxPoints: number;
        correct: boolean | null;
      }> = [];

      if (s?.perQuestion) {
        for (const [qId, scoredQ] of Object.entries(s.perQuestion)) {
          const qDoc = questionsMap.get(qId);
          questionBreakdown.push({
            questionId: qId,
            promptExcerpt: qDoc?.prompt ? qDoc.prompt.slice(0, 120) : "(question removed from the bank)",
            pointsEarned: scoredQ.points ?? 0,
            maxPoints: scoredQ.max ?? 1,
            correct: scoredQ.correct ?? null,
          });
        }
      }

      return {
        attemptId: row.attemptId,
        candidateId: row.candidateId,
        candidateName,
        candidateEmail,
        externalId,
        status,
        startedAt: row.startedAt,
        submittedAt: row.submittedAt,
        durationSeconds,
        score,
        maxScore,
        percentage,
        passed,
        rank,
        integrityFlag,
        violations: row.violations,
        questionBreakdown,
      };
    });

    let results = items;

    if (statusParam && statusParam !== "all") {
      if (statusParam === "submitted") {
        results = results.filter((r) => r.status === "submitted" || r.status === "auto_submitted");
      } else {
        results = results.filter((r) => r.status === statusParam);
      }
    }

    if (integrityParam && integrityParam !== "all") {
      results = results.filter((r) => r.integrityFlag === integrityParam);
    }

    if (searchParam && searchParam.trim() !== "") {
      const term = searchParam.trim().toLowerCase();
      results = results.filter(
        (r) =>
          (r.candidateName && r.candidateName.toLowerCase().includes(term)) ||
          (r.candidateEmail && r.candidateEmail.toLowerCase().includes(term)) ||
          (r.externalId && r.externalId.toLowerCase().includes(term)),
      );
    }

    return c.json({
      test: {
        id: test.id,
        title: test.name,
        totalPoints,
        passMark,
      },
      summary,
      results,
      nextCursor: attemptsPage.nextCursor,
    });
  });

  return routes;
}
