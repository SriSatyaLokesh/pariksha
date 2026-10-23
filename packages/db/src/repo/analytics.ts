// The organiser's test analytics (Phase 8c Task 1, `R-06`, `K19`).
//
// Everything below is one fetch (`listAttemptsForTest`) plus one small
// `COUNT` (registered candidates), walked once in JS to produce every
// figure the screen renders — never a query per candidate, never a query
// per set. `K9`/`KG3`'s budget (`results.ts`) is inherited rather than
// re-earned: this file adds exactly one statement to it.
//
// Three things 7e and 7a already shipped that a naive count gets wrong,
// each worth stating once here rather than at every call site:
//
//   - **`locked` is not "in progress".** `attempt.locked_at` (migration
//     `0011`) is set and `submitted_at` stays null forever — a plain
//     `submitted_at IS NULL` reader would count a locked attempt as still
//     running, and the organiser's headline number would never settle for
//     a test that had any proctoring locks at all.
//   - **Integrity is a different axis from completion**, and is counted
//     only over attempts that have actually ended (submitted,
//     auto-submitted or locked) — an attempt still in progress has not
//     finished accumulating the signal `integrity_flag` summarises, so
//     folding it in early would understate risk on the organiser's own
//     "how many are flagged" question while the test is still open.
//   - **`completionRate`'s denominator excludes locked attempts**: a
//     locked candidate was prevented from completing by the product, not
//     by their own choice, so counting them against "did everyone finish"
//     punishes the test for stopping a violation.
//
// `countedScore` (`K6`) collapses a candidate's attempts to the one figure
// that counts — mean, median, the histogram, the pass rate and the per-set
// comparison all read that collapsed figure, never a raw per-attempt one,
// so a candidate who retried contributes to this screen exactly once.
//
// ponytail: the counted mode is always `"latest"` here, not the test's own
// `counted_attempt` setting (`release.ts`'s own `countedFor` reads it).
// Every mode agrees in the common case — one attempt per candidate — and
// reading the setting costs a fourth statement this screen does not
// otherwise need. Thread `getPublishedVersion`'s `settings.timing` through
// if an organiser ever points out a retake-heavy test whose analytics
// disagree with its own `counted_attempt` export.

import type { AttemptFigure, AttemptScore, ItemStat } from "@pariksha/core";
import { countedScore, itemAnalysis, round2 } from "@pariksha/core";
import type { DbClient } from "../client.js";
import { scoped } from "./guard.js";
import { listAttemptsForTest, type AttemptSummary } from "./results.js";

const HISTOGRAM_BUCKETS = 10;

export interface TestAnalytics {
  counts: {
    registered: number;
    inProgress: number;
    submitted: number;
    autoSubmitted: number;
    /** 7e's `0011`. Neither in progress nor submitted — its own count. */
    locked: number;
  };
  /** Fixed 10-bucket histogram over percent, 0-10, 10-20, … 90-100. */
  distribution: number[];
  mean: number | null;
  median: number | null;
  /** null when the test sets no pass mark — `AttemptScore.passed` is null
   *  on every attempt in that case, never a figure this file invents. */
  passRate: number | null;
  /** Excludes locked attempts from the denominator — Review Focus 1. */
  completionRate: number;
  averageSeconds: number | null;
  integrity: { clean: number; review: number; high_risk: number };
  /** One entry per set, so an organiser can see whether sets were equally
   *  hard. Sorted by set number. */
  perSet: { setNo: number; n: number; mean: number | null }[];
}

async function registeredCount(db: DbClient, workspaceId: string, testId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    // `consent_at IS NOT NULL` is the one definition of "registered"
    // (`repo/candidates.ts`'s own `CandidateRow.registeredAt` comment) — a
    // list row nobody has claimed yet is not a registered candidate.
    "SELECT COUNT(*) AS n FROM candidate WHERE workspace_id = ? AND test_id = ? AND consent_at IS NOT NULL",
    [workspaceId, testId],
  );
  return Number(rows[0]?.n ?? 0);
}

function medianOf(sortedAscending: readonly number[]): number | null {
  const n = sortedAscending.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 0
    ? round2((sortedAscending[mid - 1]! + sortedAscending[mid]!) / 2)
    : round2(sortedAscending[mid]!);
}

const INTEGRITY_FLAGS = ["clean", "review", "high_risk"] as const;
type IntegrityFlag = (typeof INTEGRITY_FLAGS)[number];
function isIntegrityFlag(value: string): value is IntegrityFlag {
  return (INTEGRITY_FLAGS as readonly string[]).includes(value);
}

/**
 * `GET /api/v1/workspaces/:id/tests/:testId/analytics`'s own figures.
 * `K19`: `listAttemptsForTest` plus one `COUNT`, never a statement per
 * candidate — the budget test below pins this at the measured number.
 */
export const testAnalytics = scoped(
  "testAnalytics",
  async (db: DbClient, workspaceId: string, testId: string): Promise<TestAnalytics> => {
    const [{ rows: attempts }, registered] = await Promise.all([
      listAttemptsForTest(db, workspaceId, testId, { limit: 500 }),
      registeredCount(db, workspaceId, testId),
    ]);

    let inProgress = 0;
    let submitted = 0;
    let autoSubmitted = 0;
    let locked = 0;
    const integrity = { clean: 0, review: 0, high_risk: 0 };
    let secondsTotal = 0;
    let secondsCount = 0;

    // One candidate may own several attempts (a retake); grouped here so
    // `countedScore` runs once per candidate rather than being simulated
    // by hand per row.
    const figuresByCandidate = new Map<string, AttemptFigure[]>();

    for (const a of attempts) {
      if (a.lockedAt !== null) {
        locked += 1;
      } else if (a.submittedAt === null) {
        inProgress += 1;
      } else if (a.submitReason === "manual") {
        submitted += 1;
      } else {
        // "timeout" or "limit" (`SubmitReason`, `apps/api/src/run/submit.ts`)
        // — the candidate did not choose to end this attempt.
        autoSubmitted += 1;
      }

      // Counted only once an attempt has ended (this file's own header) —
      // an in-progress attempt's flag is still being written to, and
      // folding it in early would understate risk while the test is still
      // open.
      if (a.lockedAt !== null || a.submittedAt !== null) {
        if (isIntegrityFlag(a.integrityFlag)) integrity[a.integrityFlag] += 1;
      }

      if (a.submittedAt !== null) {
        secondsTotal += (a.submittedAt - a.startedAt) / 1000;
        secondsCount += 1;
      }

      if (a.submittedAt !== null && a.scoreJson !== null) {
        const figure: AttemptFigure = {
          attemptId: a.attemptId,
          percent: (a.scoreJson as AttemptScore).percent,
          submittedAt: a.submittedAt,
        };
        const existing = figuresByCandidate.get(a.candidateId);
        if (existing) existing.push(figure);
        else figuresByCandidate.set(a.candidateId, [figure]);
      }
    }

    const attemptById = new Map(attempts.map((a) => [a.attemptId, a]));
    // One counted score per candidate, paired with the attempt that
    // produced it — so the per-set comparison and the pass rate read the
    // same collapsed figure the mean and the histogram do.
    const counted: { percent: number; attempt: AttemptSummary }[] = [];
    for (const figures of figuresByCandidate.values()) {
      const result = countedScore(figures, "latest");
      if (result === null) continue;
      // `"latest"` always names an `attemptId` (`countedScore`'s own
      // contract — only `"average"` returns null there, and this file
      // never asks for `"average"`).
      const attempt = result.attemptId === null ? undefined : attemptById.get(result.attemptId);
      if (attempt) counted.push({ percent: result.percent, attempt });
    }

    const percents = counted.map((c) => c.percent).sort((a, b) => a - b);
    const mean = percents.length === 0 ? null : round2(percents.reduce((sum, p) => sum + p, 0) / percents.length);
    const median = medianOf(percents);

    const distribution = new Array(HISTOGRAM_BUCKETS).fill(0) as number[];
    for (const p of percents) {
      const bucket = Math.min(Math.floor(p / 10), HISTOGRAM_BUCKETS - 1);
      distribution[bucket] = distribution[bucket]! + 1;
    }

    // `AttemptScore.passed` is null on every attempt when the test sets no
    // pass mark (`score.ts`) — never computed here, only read.
    const passedValues = counted
      .map((c) => (c.attempt.scoreJson as AttemptScore).passed)
      .filter((p): p is boolean => p !== null);
    const passRate =
      passedValues.length === 0 ? null : round2(passedValues.filter(Boolean).length / passedValues.length);

    // Locked attempts are excluded from the denominator (Review Focus 1):
    // a locked candidate was prevented from completing, not given the
    // chance and declining it.
    const completionDenominator = registered - locked;
    const completionRate = completionDenominator > 0 ? (submitted + autoSubmitted) / completionDenominator : 0;

    const perSetFigures = new Map<number, number[]>();
    for (const c of counted) {
      const list = perSetFigures.get(c.attempt.setNo);
      if (list) list.push(c.percent);
      else perSetFigures.set(c.attempt.setNo, [c.percent]);
    }
    const perSet = [...perSetFigures.entries()]
      .sort(([a], [b]) => a - b)
      .map(([setNo, ps]) => ({
        setNo,
        n: ps.length,
        mean: ps.length === 0 ? null : round2(ps.reduce((sum, p) => sum + p, 0) / ps.length),
      }));

    return {
      counts: { registered, inProgress, submitted, autoSubmitted, locked },
      distribution,
      mean,
      median,
      passRate,
      completionRate: round2(completionRate),
      averageSeconds: secondsCount === 0 ? null : Math.round(secondsTotal / secondsCount),
      integrity,
      perSet,
    };
  },
);

interface ResponseRow {
  attempt_id: string;
  question_id: string;
  value_json: unknown;
}

/**
 * `itemAnalysis`'s (`@pariksha/core`, Task 2, #240) own fetch — Task 1's
 * `listAttemptsForTest` again (for `percent` and each attempt's already-
 * parsed `score_json.perQuestion`, which is where `correct` comes from —
 * `response` carries no correctness column of its own) plus one join over
 * `response` for `value_json`, the one thing `listAttemptsForTest` does not
 * carry. Two statements, flat in cohort size (`K19`); `itemAnalysis` itself
 * is the one pass over both.
 *
 * **Ordering determinism (carried forward deliberately):** `itemAnalysis`'s
 * top/bottom 27% split sorts by `percent` with `Array.prototype.sort`,
 * which is stable — so attempts tied on `percent` keep *this* function's
 * own input order. `listAttemptsForTest`'s `ORDER BY a.started_at ASC,
 * a.id ASC` is already deterministic (K9's own tiebreaker), which is what
 * makes two calls against the same data return the same discrimination
 * index — asserted below rather than only reasoned about.
 *
 * Only a scored attempt's responses are read: an in-progress attempt has no
 * `score_json.perQuestion` to look `correct` up in, so its answers (if any
 * were saved) are excluded rather than reported with a fabricated
 * correctness.
 */
export const testItemAnalysis = scoped(
  "testItemAnalysis",
  async (db: DbClient, workspaceId: string, testId: string): Promise<ItemStat[]> => {
    const { rows } = await listAttemptsForTest(db, workspaceId, testId, { limit: 500 });
    const scored = rows.filter((a) => a.submittedAt !== null && a.scoreJson !== null);

    const attempts = scored.map((a) => ({
      attemptId: a.attemptId,
      percent: (a.scoreJson as AttemptScore).percent,
    }));
    const perQuestionByAttempt = new Map(
      scored.map((a) => [a.attemptId, (a.scoreJson as AttemptScore).perQuestion]),
    );

    const responseRows = await db.query<ResponseRow>(
      "SELECT r.attempt_id AS attempt_id, r.question_id AS question_id, r.value_json AS value_json " +
        "FROM response r " +
        "JOIN attempt a ON a.workspace_id = r.workspace_id AND a.id = r.attempt_id " +
        "JOIN test_version tv ON tv.workspace_id = a.workspace_id AND tv.id = a.test_version_id " +
        "WHERE r.workspace_id = ? AND tv.test_id = ?",
      [workspaceId, testId],
    );

    const responses = responseRows.flatMap((row) => {
      const perQuestion = perQuestionByAttempt.get(row.attempt_id);
      // A response belonging to an attempt that never finished scoring
      // (still in progress, or locked before it was) — excluded, not
      // reported with a fabricated correctness.
      if (!perQuestion) return [];
      return [
        {
          attemptId: row.attempt_id,
          questionId: row.question_id,
          correct: perQuestion[row.question_id]?.correct ?? null,
          value: db.jsonValue(row.value_json),
        },
      ];
    });

    return itemAnalysis({ attempts, responses });
  },
);
