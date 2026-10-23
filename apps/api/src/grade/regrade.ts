// Regrade after a key change (Phase 8b Task 4, `K17`/`K18`): an organiser
// edits a question's answer key after candidates have already been graded
// against the old one, and every score computed from it is now silently
// wrong. This file offers the fix and drains it.
//
// `K17`: scoped to one test **version**, one `audit_log` row naming it, the
// count rescored and the count whose total actually changed.
//
// `K18`: the cron drains it, never the request. 300 attempts is at minimum
// 300 D1 reads (`rescoreAttempt`'s own `liveQuestions`, `K5` — it is reused
// as-is, the one scoring path, so it cannot share a bank read across
// attempts the way this file shares its *own* award-reconstruction read)
// and 300 writes, six times the 50-subrequest ceiling. `REGRADE_BATCH_SIZE`
// is this phase's number; `countingDeps` proves it stays under the ceiling
// even on the tick that also writes the completion row.
//
// **There is no regrade queue table.** The queue is `audit_log` itself:
// `enqueueRegrade` writes one `"regrade.requested"` row naming the version
// and how many attempts it covers; `regradeJob` finds, per version, the
// latest such row with no later `"regrade"` (completed) row for the same
// version, and rescores forward from wherever the last tick's own
// `"regrade.batch"` progress row left off. A second table would store the
// same fact `S-13`'s own audit requirement already needs recorded.
//
// **D1 rows read.** Every tick pays `recentAuditRows`'s one scan: a seek to
// `REGRADE_LOOKBACK_MS` ago on `audit_log_at_idx` (not the table's whole
// history — see `regrade-scan.ts`'s header for why that still is not free),
// plus `7 + REGRADE_BATCH_SIZE` subrequests for whichever version it works
// on this tick (measured at 37 against a 300-attempt fixture,
// `test/grade/regrade.test.ts`'s own "stays inside the subrequest ceiling"
// test), plus up to 3 more on the tick that finishes a version. At this
// phase's audit volume that is a few hundred rows per tick, not the
// whole-table scan an *unbounded* cross-workspace read would be — and once
// a version's `"regrade"` row is written, every later tick's grouping
// (`resolvePendingRegrades`) drops it in one comparison with no further
// attempt or response read, which is what keeps a completed regrade from
// costing anything beyond the bytes `recentAuditRows` re-reads until
// `REGRADE_LOOKBACK_MS` ages them out of the window.

import { Hono } from "hono";
import type { DbClient } from "@pariksha/db";
import {
  appendAudit,
  countSubmittedAttemptsForVersion,
  latestVerdicts,
  listResponsesForAttempts,
  listSubmittedAttemptsForVersion,
  publishedVersionsForQuestion,
  recentAuditRows,
  testVersionSettings,
  writeScores,
  type RegradeAuditRow,
} from "@pariksha/db";
import { deriveAward, type ResponseValue, type RubricAward } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { actorOr401, requires } from "../middleware/authorize.js";
import type { ScheduledJob } from "../scheduled.js";
import type { PinnedLayout } from "../run/attempt.js";
import { liveQuestions } from "../run/submit.js";
import { rescoreAttempt } from "../run/rescore.js";

/** The cron this job runs under (`K18`) — the frequent one 8d's webhook
 *  drain also uses, not the nightly one. Declared here, matched verbatim
 *  against `deploy/cloudflare/wrangler.toml`'s `[triggers].crons`. */
export const REGRADE_CRON = "*/5 * * * *";

/**
 * One attempt's `rescoreAttempt` call costs one D1 read no `batch()` can
 * absorb (`liveQuestions`, called *inside* that function, not by this
 * file). `7 + REGRADE_BATCH_SIZE` subrequests on the common tick
 * (`recentAuditRows`, the batch fetch, `testVersionSettings`, this file's
 * own award-reconstruction bank read, `listResponsesForAttempts`,
 * `writeScores`' one `db.batch()`, and the progress audit append — measured
 * at 37 against a 300-attempt fixture), `10 + REGRADE_BATCH_SIZE` on the
 * one that also finishes a version (the extra attempt-id read,
 * `latestVerdicts`, and the completion audit row in place of the progress
 * one) must stay at or under `SUBREQUEST_LIMIT` (50) with real headroom —
 * 30 leaves 13.
 */
export const REGRADE_BATCH_SIZE = 30;

/**
 * How far back `recentAuditRows` looks for an unresolved `"regrade.*"` row.
 * A cron tick every 5 minutes means 6 missed ticks still land inside this —
 * a Worker outage longer than that drops the request silently, and an
 * organiser re-clicking Regrade is the recovery, not a retry this file
 * invents for them.
 *
 * ponytail: a fixed window, not a persisted watermark — there is no column
 * or table to keep one in (`K10`). If audit volume ever makes 30 minutes of
 * cross-workspace rows too wide to read every 5, the fix is an index on
 * `audit_log(action, at)` (stop and ask before adding it) or a narrower
 * window traded against a shorter outage tolerance — not a second table.
 */
export const REGRADE_LOOKBACK_MS = 30 * 60 * 1000;

interface RegradeRequestedDetail {
  testVersionId: string;
  requestedBy: string;
  queued: number;
}

interface RegradeBatchDetail {
  testVersionId: string;
  cursor: string;
  rescoredSoFar: number;
  changedSoFar: number;
}

/** Enqueues. Returns how many attempts will be rescored — `K18`. Takes a
 *  raw `DbClient`, not `AppDeps`: counting and logging the request need
 *  nothing else. */
export async function enqueueRegrade(
  db: DbClient,
  workspaceId: string,
  input: { testVersionId: string; requestedBy: string; now: number },
): Promise<{ queued: number }> {
  const queued = await countSubmittedAttemptsForVersion(db, workspaceId, input.testVersionId);
  const detail: RegradeRequestedDetail = { testVersionId: input.testVersionId, requestedBy: input.requestedBy, queued };
  await appendAudit(db, workspaceId, {
    actor: input.requestedBy,
    action: "regrade.requested",
    target: input.testVersionId,
    detail,
    now: input.now,
  });
  return { queued };
}

interface PendingRegrade {
  workspaceId: string;
  testVersionId: string;
  requestedAt: number;
  queued: number;
  cursor: string | undefined;
  rescoredSoFar: number;
  changedSoFar: number;
}

/**
 * Groups `recentAuditRows`' flat list by `(workspaceId, testVersionId)` and
 * keeps only versions whose **latest** `"regrade.requested"` row has no
 * `"regrade"` (completed) row at or after it — a version regraded once and
 * never asked for again drops out here, which is what keeps a finished
 * regrade from costing anything beyond the re-read `recentAuditRows` itself
 * already accounts for. Oldest request first, so a backlog drains FIFO.
 *
 * Pure — no I/O — so it is the one piece of this file's batching logic a
 * test can call directly instead of only through a live tick.
 */
export function resolvePendingRegrades(rows: readonly RegradeAuditRow[]): PendingRegrade[] {
  const byKey = new Map<string, RegradeAuditRow[]>();
  for (const row of rows) {
    if (!row.action.startsWith("regrade")) continue;
    const key = `${row.workspaceId}:${row.target}`;
    const group = byKey.get(key);
    if (group) group.push(row);
    else byKey.set(key, [row]);
  }

  const pending: PendingRegrade[] = [];
  for (const group of byKey.values()) {
    // `recentAuditRows` hands back oldest-first; the latest request is the
    // last `"regrade.requested"` row in that order.
    let requested: RegradeAuditRow | undefined;
    for (const row of group) if (row.action === "regrade.requested") requested = row;
    if (!requested) continue;

    const completed = group.some((row) => row.action === "regrade" && row.at >= requested!.at);
    if (completed) continue;

    let latestBatch: RegradeAuditRow | undefined;
    for (const row of group) {
      if (row.action === "regrade.batch" && row.at >= requested.at) latestBatch = row;
    }

    const requestedDetail = requested.detail as RegradeRequestedDetail | null;
    const batchDetail = latestBatch?.detail as RegradeBatchDetail | undefined;

    pending.push({
      workspaceId: requested.workspaceId,
      testVersionId: requested.target,
      requestedAt: requested.at,
      queued: requestedDetail?.queued ?? 0,
      cursor: batchDetail?.cursor,
      rescoredSoFar: batchDetail?.rescoredSoFar ?? 0,
      changedSoFar: batchDetail?.changedSoFar ?? 0,
    });
  }

  pending.sort((a, b) => a.requestedAt - b.requestedAt);
  return pending;
}

function totalOf(score: { total: number } | null): number | null {
  return score === null ? null : score.total;
}

/**
 * One tick: picks the single oldest pending regrade (never more than one —
 * `K18`'s subrequest math is per version, and working two at once would
 * double it with no test proving the combined cost stays under the
 * ceiling), rescores up to `REGRADE_BATCH_SIZE` of its still-pending
 * attempts, and either leaves a `"regrade.batch"` progress row or, once the
 * version is exhausted, the one `"regrade"` completion row `K17` requires.
 */
export const regradeJob: ScheduledJob = {
  name: "regrade",
  cron: REGRADE_CRON,
  async run(deps: AppDeps) {
    const since = deps.now() - REGRADE_LOOKBACK_MS;
    const rows = await recentAuditRows(deps.db, since);
    const pending = resolvePendingRegrades(rows);
    if (pending.length === 0) return { summary: "no regrades pending" };

    const next = pending[0]!;
    const batchOpts = next.cursor === undefined ? { limit: REGRADE_BATCH_SIZE } : { afterId: next.cursor, limit: REGRADE_BATCH_SIZE };
    const batch = await listSubmittedAttemptsForVersion(deps.db, next.workspaceId, next.testVersionId, batchOpts);

    let changedThisBatch = 0;
    if (batch.length > 0) {
      const version = await testVersionSettings(deps.db, next.workspaceId, next.testVersionId);
      // Review Focus (Task 1, F2 / `deriveAward`'s own `score.ts:75` rule):
      // a `null` award is left OUT of `awards`, never inserted as a zero —
      // a rubric level edited out from under an already-graded answer must
      // send the question back to pending, not silently zero it. Same bank
      // read `recordAward` (`grade/award.ts`) uses for the same purpose,
      // paid once for the whole batch here rather than once per attempt.
      const byId = await liveQuestions(deps, next.workspaceId);
      const responsesByAttempt = await listResponsesForAttempts(
        deps.db,
        next.workspaceId,
        batch.map((a) => a.attemptId),
      );

      const writes: { attemptId: string; score: unknown }[] = [];
      for (const attempt of batch) {
        const responses = responsesByAttempt.get(attempt.attemptId) ?? [];
        const awards: Record<string, RubricAward> = {};
        const responseValues: Record<string, ResponseValue | null> = {};
        for (const r of responses) {
          responseValues[r.questionId] = r.value as ResponseValue | null;
          if (r.gradedBy === null) continue;
          const award = deriveAward(byId.get(r.questionId), r.points ?? 0);
          if (award !== null) awards[r.questionId] = award;
        }

        // `K5`: the one scoring path, reused as-is — see this file's own
        // header for why that costs one bank read per attempt and not one
        // per batch.
        const { score } = await rescoreAttempt(deps, {
          workspaceId: next.workspaceId,
          layout: attempt.layout as PinnedLayout,
          settings: version?.settings ?? {},
          responses: responseValues,
          awards,
        });

        const oldTotal = totalOf((attempt.scoreJson as { total: number } | null) ?? null);
        const newTotal = totalOf(score);
        if (newTotal !== oldTotal) changedThisBatch += 1;
        writes.push({ attemptId: attempt.attemptId, score });
      }

      // `writeScores`'s own guard (`K18`'s header, Task 1's CRITICAL): a
      // regrade never stamps `score_json` onto an attempt that is not
      // `submitted_at IS NOT NULL`, and never touches `flag` — a
      // `scoring_blocked` attempt stays flagged.
      await writeScores(deps.db, next.workspaceId, writes);
    }

    const rescoredSoFar = next.rescoredSoFar + batch.length;
    const changedSoFar = next.changedSoFar + changedThisBatch;
    const now = deps.now();
    const done = batch.length < REGRADE_BATCH_SIZE;

    if (!done) {
      const cursor = batch[batch.length - 1]!.attemptId;
      const detail: RegradeBatchDetail = { testVersionId: next.testVersionId, cursor, rescoredSoFar, changedSoFar };
      await appendAudit(deps.db, next.workspaceId, {
        actor: "system",
        action: "regrade.batch",
        target: next.testVersionId,
        detail,
        now,
      });
      return { summary: `${rescoredSoFar} of ${next.queued} attempts rescored` };
    }

    // Carried from Task 3's review: `review` and `attempt.score_json` are
    // independent by construction, which is correct — but silent
    // independence is not. A verdict recorded before this rescore is now
    // judging a score that no longer exists; surfaced in the one audit row
    // `K17` already writes, never by touching the verdict itself (only a
    // human retracts one).
    const all = await listSubmittedAttemptsForVersion(deps.db, next.workspaceId, next.testVersionId, {
      limit: 1000,
    });
    const verdicts = await latestVerdicts(
      deps.db,
      next.workspaceId,
      all.map((a) => a.attemptId),
    );
    let staleVerdicts = 0;
    for (const verdict of verdicts.values()) if (verdict.at < now) staleVerdicts += 1;

    await appendAudit(deps.db, next.workspaceId, {
      actor: "system",
      action: "regrade",
      target: next.testVersionId,
      detail: { testVersionId: next.testVersionId, rescored: rescoredSoFar, changed: changedSoFar, staleVerdicts },
      now,
    });
    return { summary: `${rescoredSoFar} of ${next.queued} attempts rescored (done)` };
  },
};

/** `POST /api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade` —
 *  `workspace` authority, `attempts.grade`. The question editor
 *  (`apps/web/src/routes/question.tsx`) is bank-scoped and knows nothing
 *  about tests or versions, so this route resolves them server-side
 *  (`publishedVersionsForQuestion`, `packages/db/src/repo/banks.ts`) and
 *  enqueues one regrade per published version the question's key now
 *  belongs to — `AC-08`'s "any published version", not just one. */
export function regradeRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/:id/banks/:bankId/questions/:qid/regrade", requires("attempts.grade"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const questionId = c.req.param("qid");

    const testVersionIds = await publishedVersionsForQuestion(deps.db, workspaceId, bankId, questionId);
    const now = deps.now();
    let queued = 0;
    for (const testVersionId of testVersionIds) {
      const result = await enqueueRegrade(deps.db, workspaceId, {
        testVersionId,
        requestedBy: actor.userId,
        now,
      });
      queued += result.queued;
    }

    return c.json({ queued, versions: testVersionIds.length });
  });

  return routes;
}
