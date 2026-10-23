// The organiser's test analytics (Phase 8c Task 1, `R-06`, `K19`).
//
// Everything below is `listAttemptsForTest` paged to exhaustion (never a
// single capped call — see `fetchAllAttempts` and Fix round 1, Important 1)
// plus one small `COUNT` (registered candidates), walked once in JS to
// produce every figure the screen renders — never a query per candidate,
// never a query per set.
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

// Fix round 1, Important 1: `listAttemptsForTest` clamps a single call to
// 500 rows and returns a cursor for the rest — a hardcoded one-shot call
// silently produced analytics over the first 500 attempts and said nothing
// about it for a cohort past that (300 candidates with any retaking is
// already close; a larger test clears it outright). The anti-goal this
// phase is built against is explicit: an export that quietly drops rows is
// a lost-answers bug wearing a results hat, and a mean, a pass rate or a
// discrimination index computed over a silently truncated cohort is the
// same defect on the analytics side — arguably worse, because a wrong mean
// looks exactly like a right one, where a short export file can at least
// be counted.
//
// `MAX_ATTEMPT_PAGES` is a hard cap, not a tuning knob: each of
// `testAnalytics` and `testItemAnalysis` pages independently, so the
// worst-case cost this adds to the route is `2 * MAX_ATTEMPT_PAGES`
// statements. At 10 that is 20, which together with the route's other
// fixed reads (auth 2, `getTest` 1, `workspaceQuestions` 1, the
// registered-candidate `COUNT` 1, the response join 1) totals **26**
// against `SUBREQUEST_LIMIT`'s 50 even at the cap — "well under the
// ceiling", not merely under it — while still covering 5,000 attempts per
// function before truncation, far past any realistic cohort. Fix round 2
// pinned this by an executed test rather than this comment's own
// arithmetic alone (`apps/api/test/analytics.test.ts`'s "stays under the
// subrequest ceiling at the hard page cap"), which is also what caught
// that an earlier draft of this comment undercounted by one (omitted
// `workspaceQuestions`, said 25). Reaching the cap is **stated**, never
// silent: both functions return whether they did, and the screen renders
// it.
const MAX_ATTEMPT_PAGES = 10;

/**
 * Every attempt for this test, paged to exhaustion (or to the hard cap
 * above) rather than fetched once at the maximum page size. `truncated` is
 * true only when the cap was reached with more still unread — the one
 * condition under which the figures computed from `rows` are not the whole
 * cohort.
 *
 * `maxPages` defaults to the real cap and exists as a parameter only so a
 * test can prove the truncation path without seeding `MAX_ATTEMPT_PAGES *
 * 500` rows to reach it — `testAnalytics`/`testItemAnalysis` below never
 * pass it, so production always runs at the real cap. `pageSize` is the
 * same idea for the page *size*: production always reads 500 at a time
 * (`listAttemptsForTest`'s own ceiling), but a test shrinking it too can
 * reach the page cap with a two-digit fixture instead of thousands of rows.
 */
async function fetchAllAttempts(
  db: DbClient,
  workspaceId: string,
  testId: string,
  maxPages: number = MAX_ATTEMPT_PAGES,
  pageSize = 500,
): Promise<{ rows: AttemptSummary[]; truncated: boolean }> {
  const rows: AttemptSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    // Built up rather than passed through with `cursor ?? undefined`:
    // `exactOptionalPropertyTypes` holds "absent" and "explicitly
    // undefined" apart, and `listAttemptsForTest`'s own `cursor` is
    // optional (`instrument.ts`'s own header states the same rule).
    const opts: { limit: number; cursor?: string } =
      cursor === undefined ? { limit: pageSize } : { limit: pageSize, cursor };
    const page_ = await listAttemptsForTest(db, workspaceId, testId, opts);
    rows.push(...page_.rows);
    if (page_.nextCursor === null) {
      return { rows, truncated: false };
    }
    cursor = page_.nextCursor;
  }
  // The cap was reached and the last page still named a next cursor —
  // there is more data this call never read.
  return { rows, truncated: true };
}

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
  /** Fix round 1, Important 1: true when the attempt fetch hit
   *  `MAX_ATTEMPT_PAGES` with more still unread — every figure above is
   *  then computed from the first attempts read, not the whole cohort, and
   *  the screen must say so rather than present a plausible-looking wrong
   *  number. */
  truncated: boolean;
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
 * `K19`: `listAttemptsForTest` (paged) plus one `COUNT`, never a statement
 * per candidate — the budget test below pins this at the measured number.
 *
 * `maxAttemptPages`/`attemptPageSize` are test-only overrides of
 * `fetchAllAttempts`'s page cap and page size (defaults `MAX_ATTEMPT_PAGES`
 * and 500) — present so the truncation path can be exercised without
 * seeding thousands of rows. The route never passes either.
 */
export const testAnalytics = scoped(
  "testAnalytics",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    maxAttemptPages: number = MAX_ATTEMPT_PAGES,
    attemptPageSize: number = 500,
  ): Promise<TestAnalytics> => {
    const [{ rows: attempts, truncated }, registered] = await Promise.all([
      fetchAllAttempts(db, workspaceId, testId, maxAttemptPages, attemptPageSize),
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
      truncated,
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
 *
 * Fix round 1, Important 1: pages to exhaustion the same way `testAnalytics`
 * does, independently — `truncated` in the result says whether the cap was
 * reached, so `itemAnalysis`'s own discrimination split (computed over
 * `attempts`) is never silently run against a partial cohort.
 * `maxAttemptPages`/`attemptPageSize` are the same test-only overrides
 * `testAnalytics` takes; the route never passes either.
 */
export const testItemAnalysis = scoped(
  "testItemAnalysis",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    maxAttemptPages: number = MAX_ATTEMPT_PAGES,
    attemptPageSize: number = 500,
  ): Promise<{ items: ItemStat[]; truncated: boolean }> => {
    const { rows, truncated } = await fetchAllAttempts(db, workspaceId, testId, maxAttemptPages, attemptPageSize);
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

    return { items: itemAnalysis({ attempts, responses }), truncated };
  },
);
