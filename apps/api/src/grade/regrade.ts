// Regrade after a key change (Phase 8b Task 4, `K17`/`K18`): an organiser
// edits a question's answer key after candidates have already been graded
// against the old one, and every score computed from it is now silently
// wrong. This file offers the fix and drains it.
//
// `K17`: scoped to one test **version**, one `audit_log` row naming it, the
// count rescored and the count whose total actually changed.
//
// `K18`: the cron drains it, never the request. 300 attempts is at minimum
// 300 D1 reads and 300 writes, six times the 50-subrequest ceiling.
// `REGRADE_BATCH_SIZE` is this phase's number; `countingDeps` proves it
// stays well under the ceiling even on the tick that also finishes a
// version.
//
// **There is no regrade queue table.** The queue is `audit_log` itself:
// `enqueueRegrade` writes one `"regrade.requested"` row naming the version
// and how many attempts it covers; `regradeJob` finds, per version, the
// latest such row (or, once it has aged out of the window, the latest
// `"regrade.batch"` progress row — branch review C1, below) with no later
// `"regrade"` (completed) row for the same version, and rescores forward
// from wherever the last tick's own progress row left off. A second table
// would store the same fact `S-13`'s own audit requirement already needs
// recorded.
//
// **Branch review C1 (fixed here): a request row ages out of the window
// before a large drain can finish.** The lookback window is 30 minutes —
// six ticks. A version needing more than six ticks (more than
// `6 × REGRADE_BATCH_SIZE` ≈ 180 attempts) used to lose its
// `"regrade.requested"` row to `REGRADE_LOOKBACK_MS` mid-drain:
// `resolvePendingRegrades` required that row specifically, so the version
// vanished from `pending` with some attempts rescored under the new key,
// the rest still under the old one, and no completion row ever written —
// worse than the disclosed "an outage drops a request", because this
// happened on every healthy run past the brief's own 300-attempt fixture.
// The fix: a `"regrade.batch"` row is now an equally valid anchor, and
// every tick that does real work writes a **fresh** one — so a version
// being actively drained keeps its own progress row inside the window for
// as long as work keeps happening, and the 30-minute window reverts to
// what it was meant to be, tolerance for a gap *between* ticks, not a cap
// on how long one regrade may take. `countSubmittedAttemptsForVersion`'s
// old doc comment claimed this fallback and did not implement it; `queued`
// now also rides along on the batch row itself instead, which is what lets
// `resolvePendingRegrades` stay pure (no I/O) rather than needing a count
// query to rebuild a request it can no longer see.
//
// A version that stops being worked at all (starved behind an older,
// larger regrade in the same workspace — `pending[0]` is strict FIFO) can
// still age out: its last batch row eventually leaves the window with
// nothing after it. That residual case is not closed here — genuine
// detection needs rows the window has already dropped, which
// `recentAuditRows` by design does not fetch — and is named as a known gap
// in the Task 4 report rather than patched with a second, wider scan.
//
// **D1 rows read.** Every tick pays `recentAuditRows`'s one scan: a seek to
// `REGRADE_LOOKBACK_MS` ago on `audit_log_at_idx` (not the table's whole
// history — see `regrade-scan.ts`'s header for why that still is not
// free), plus a **flat** `REGRADE_TICK_SUBREQUESTS` (7) for whichever
// version it works this tick, regardless of batch size — branch review M6:
// `rescoreAttempt` used to re-read the whole live bank once per attempt
// (`liveQuestions`, called inside that function); this file already reads
// it once for its own award reconstruction and now hands that same map
// back in, so a batch of 30 costs the same one bank read a batch of 1
// would. Measured at `REGRADE_TICK_SUBREQUESTS` exactly
// (`test/grade/regrade.test.ts`'s own "stays inside the subrequest
// ceiling" test pins it, not just bounds it — branch review MIN4), plus up
// to 1 more on the tick that finishes a version (the completion row in
// place of the progress one; branch review MIN3 removed the separate
// attempt-id re-read that used to cost 1 more again). At this phase's
// audit volume that is a few hundred *audit* rows per tick from the scan,
// plus `Q` bank rows (not `31 × Q`, branch review M6) and the batch's own
// attempt/response rows — nowhere near the 5M/day free allowance at
// realistic workspace sizes, and bounded by traffic inside the rolling
// window, never by the table's total history — a completed regrade leaves
// the *working* set (no further attempt or response read, no further
// write) the instant its completion row exists, even though the bytes
// `recentAuditRows` reads keep including it until the window ages past it.
import { Hono } from "hono";
import type { DbClient } from "@pariksha/db";
import {
  appendAudit,
  appendAuditBatch,
  countSubmittedAttemptsForVersion,
  countSubmittedAttemptsForVersions,
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

// The cron this job runs under (`K18`) — frequent, not the nightly one, but
// deliberately not the same string as `main`'s `webhookDrainJob` cron
// (every 5 minutes on the hour).
//
// Branch review C2, coordinator follow-up: `runScheduled` matches
// `job.cron !== cron` verbatim — two jobs share an invocation only when
// their cron strings are identical, not merely "both frequent". The same
// string here would make every tick run both this job and 8d's webhook
// drain in the same `scheduled()` call, 37 + 22 = 59 against the shared
// 50-subrequest ceiling (fixed to 8 + 22 = 30 by `M6`'s bank-read hoist,
// but still one invocation, one ceiling, for however many jobs land on
// that trigger later). Staggering is the real fix, not a workaround: this
// expression fires at :02, :07, :12 and on — the same twelve times an hour
// as the drain's, interleaved rather than coincident, so the two jobs
// never share an invocation and each gets the full 50 to itself. Matched
// verbatim against `deploy/cloudflare/wrangler.toml`'s `[triggers].crons`,
// which carries both expressions.
export const REGRADE_CRON = "2-59/5 * * * *";

/**
 * The flat, batch-size-independent cost of a working tick (branch review
 * M6): `recentAuditRows` (1) + the batch fetch (1) + `testVersionSettings`
 * (1) + this file's own award-reconstruction bank read, now shared with
 * `rescoreAttempt` (1) + `listResponsesForAttempts` (1) + `writeScores`'
 * one `db.batch()` (1) + the progress/completion audit append (1) = 7.
 * `test/grade/regrade.test.ts`'s "stays inside the subrequest ceiling" test
 * pins this exactly (branch review MIN4) rather than only bounding it.
 */
export const REGRADE_TICK_SUBREQUESTS = 7;

/**
 * `REGRADE_TICK_SUBREQUESTS` plus the one extra subrequest a completion
 * tick spends (the `"regrade"` row in place of the `"regrade.batch"` one —
 * `latestVerdicts` replaced the old separate attempt-id re-read, branch
 * review MIN3, so it adds nothing new). The worst case, and what
 * `regradeJob.maxSubrequests` declares for `scheduled.ts`'s per-cron budget
 * check (branch review C2).
 *
 * Measured **against the full 50-subrequest ceiling alone**, not a shared
 * one: `REGRADE_CRON`'s own header explains why this job and `main`'s
 * `webhookDrainJob` are staggered onto two different cron strings rather
 * than splitting one invocation's budget between them. 8, alone, leaves 42
 * — real headroom for a future job that genuinely does need this exact
 * trigger, decided then rather than assumed now.
 */
export const REGRADE_TICK_SUBREQUESTS_MAX = REGRADE_TICK_SUBREQUESTS + 1;

/**
 * `7 + 0 = 7` regardless of `REGRADE_BATCH_SIZE` now that `M6` is fixed —
 * the batch size no longer drives subrequest cost, only how many ticks a
 * drain needs. Branch review C2: `webhookDrainJob` (8d, `main`) is staggered
 * onto a different cron string (`REGRADE_CRON`'s own header), so this job's
 * 8 (worst case) is measured against the full `SUBREQUEST_LIMIT` (50) alone,
 * not split with it — `scheduled.test.ts` still pins the per-cron sum
 * generally, so a *future* job that does land on the exact same trigger
 * fails loudly rather than recreating C2 silently. `REGRADE_BATCH_SIZE`
 * stays 30: a smaller batch would only mean more ticks (more exposure to
 * the residual starvation gap noted in this file's header), with no
 * subrequest benefit now that the bank read does not scale with it, and
 * there is no shared-budget pressure left to trade it against.
 */
export const REGRADE_BATCH_SIZE = 30;

/**
 * How far back `recentAuditRows` looks for an unresolved `"regrade.*"` row.
 * A cron tick every 5 minutes means 6 missed ticks still land inside this —
 * a Worker outage longer than that drops a request that nothing is
 * actively progressing, and an organiser re-clicking Regrade is the
 * recovery, not a retry this file invents for them. A version **being**
 * drained no longer depends on this ceiling at all (this file's header,
 * branch review C1): its own fresh `"regrade.batch"` row each tick keeps
 * it inside the window for as long as it keeps moving.
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
  /** Carried on every progress row, not just the request (branch review
   *  C1): once a request row ages out, this is the only place a resumed
   *  tick can still read "how many attempts this version covers" from,
   *  without `resolvePendingRegrades` making a database call of its own. */
  queued: number;
  rescoredSoFar: number;
  changedSoFar: number;
  /** Branch review M1: `writeScores`' own `{ updated }` — a row whose
   *  `submitted_at` changed between the batch read and the write, or a
   *  workspace mismatch — folded in here rather than thrown, so one raced
   *  row costs a number instead of the whole tick's progress. */
  skippedSoFar: number;
  /** Branch review MIN1: the ids `K17`'s own `changed` count refers to,
   *  carried forward so the completion tick can ask `latestVerdicts` about
   *  exactly the attempts whose score actually moved — never the whole
   *  version, which made the old `staleVerdicts` vacuously true for every
   *  verdict regardless of whether its attempt changed at all. */
  changedAttemptIds: string[];
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
  /** The anchor row's own `at` — the latest `"regrade.requested"` row when
   *  one is still visible, otherwise the latest `"regrade.batch"` row
   *  (branch review C1). FIFO ordering and the "is this already done"
   *  check both key off it; neither cares which kind of row it came from. */
  anchorAt: number;
  queued: number;
  cursor: string | undefined;
  rescoredSoFar: number;
  changedSoFar: number;
  skippedSoFar: number;
  changedAttemptIds: string[];
}

/**
 * Groups `recentAuditRows`' flat list by `(workspaceId, testVersionId)` and
 * keeps only versions whose **latest** anchor row — a `"regrade.requested"`
 * row when one is still inside the window, otherwise the latest
 * `"regrade.batch"` progress row (branch review C1) — has no `"regrade"`
 * (completed) row at or after it. A version regraded once and never asked
 * for again drops out here, which is what keeps a finished regrade from
 * costing anything beyond the re-read `recentAuditRows` itself already
 * accounts for. Oldest anchor first, so a backlog drains FIFO.
 *
 * Pure — no I/O — so it is the one piece of this file's batching logic a
 * test can call directly instead of only through a live tick. Staying pure
 * is why `queued`/`changedAttemptIds` ride on the batch row itself (above)
 * rather than this function falling back to a count query when the request
 * row is gone.
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
    // `recentAuditRows` hands back oldest-first; "latest" is the last match
    // in that order for each action.
    let requested: RegradeAuditRow | undefined;
    let latestBatch: RegradeAuditRow | undefined;
    for (const row of group) {
      if (row.action === "regrade.requested") requested = row;
      else if (row.action === "regrade.batch") latestBatch = row;
    }

    // The request anchors the round while it is visible; once it has aged
    // out, the latest progress row (which only exists because a tick
    // actually worked this version since) takes over. Either way there is
    // exactly one anchor per round, because `latestBatch` here is already
    // the newest in the group — it cannot belong to an *earlier*, already-
    // completed round, or the `completed` check below would have dropped
    // this group at that round's own completion row.
    const anchor = requested ?? latestBatch;
    if (!anchor) continue;

    const completed = group.some((row) => row.action === "regrade" && row.at >= anchor.at);
    if (completed) continue;

    // A batch row only belongs to the *current* round when a request is
    // still visible to compare it against; when the request has aged out,
    // `latestBatch` (if set at all) is by construction the newest row in
    // the group and therefore the current round's own.
    const currentBatch = requested
      ? latestBatch && latestBatch.at >= requested.at
        ? latestBatch
        : undefined
      : latestBatch;
    const batchDetail = currentBatch?.detail as RegradeBatchDetail | undefined;
    const requestedDetail = requested?.detail as RegradeRequestedDetail | undefined;

    pending.push({
      workspaceId: anchor.workspaceId,
      testVersionId: anchor.target,
      anchorAt: anchor.at,
      queued: requestedDetail?.queued ?? batchDetail?.queued ?? 0,
      cursor: batchDetail?.cursor,
      rescoredSoFar: batchDetail?.rescoredSoFar ?? 0,
      changedSoFar: batchDetail?.changedSoFar ?? 0,
      skippedSoFar: batchDetail?.skippedSoFar ?? 0,
      changedAttemptIds: batchDetail?.changedAttemptIds ?? [],
    });
  }

  pending.sort((a, b) => a.anchorAt - b.anchorAt);
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
  maxSubrequests: REGRADE_TICK_SUBREQUESTS_MAX,
  async run(deps: AppDeps) {
    const since = deps.now() - REGRADE_LOOKBACK_MS;
    const rows = await recentAuditRows(deps.db, since);
    const pending = resolvePendingRegrades(rows);
    if (pending.length === 0) return { summary: "no regrades pending" };

    const next = pending[0]!;
    const batchOpts = next.cursor === undefined ? { limit: REGRADE_BATCH_SIZE } : { afterId: next.cursor, limit: REGRADE_BATCH_SIZE };
    const batch = await listSubmittedAttemptsForVersion(deps.db, next.workspaceId, next.testVersionId, batchOpts);

    let changedThisBatch = 0;
    let skippedThisBatch = 0;
    const changedIdsThisBatch: string[] = [];
    if (batch.length > 0) {
      const version = await testVersionSettings(deps.db, next.workspaceId, next.testVersionId);
      // Review Focus (Task 1, F2 / `deriveAward`'s own `score.ts:75` rule):
      // a `null` award is left OUT of `awards`, never inserted as a zero —
      // a rubric level edited out from under an already-graded answer must
      // send the question back to pending, not silently zero it. Same bank
      // read `recordAward` (`grade/award.ts`) uses for the same purpose,
      // and (branch review M6) the same map `rescoreAttempt` below is
      // handed so it never re-reads it — one bank read for the whole
      // batch, not one per attempt.
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

        // `K5`: the one scoring path, reused as-is. `questions: byId`
        // (branch review M6) is what keeps this a flat, per-batch bank
        // read instead of one per attempt.
        const { score } = await rescoreAttempt(deps, {
          workspaceId: next.workspaceId,
          layout: attempt.layout as PinnedLayout,
          settings: version?.settings ?? {},
          responses: responseValues,
          awards,
          questions: byId,
        });

        // Branch review M2: a grading-engine throw returns `score: null`.
        // `submit.ts` deliberately never writes that — `...(score === null
        // ? {} : { score })`, its own rule 3 — because a null score
        // overwrites a real one with nothing. This path used to push it
        // into `writes` unconditionally, wiping every attempt's score for
        // the whole version on one bad question. Skip the write and count
        // it instead; the old score (and any `scoring_blocked` flag)
        // survives untouched, and the shortfall is visible in the detail
        // rather than silent.
        if (score === null) {
          skippedThisBatch += 1;
          continue;
        }

        const oldTotal = totalOf((attempt.scoreJson as { total: number } | null) ?? null);
        const newTotal = totalOf(score);
        if (newTotal !== oldTotal) {
          changedThisBatch += 1;
          changedIdsThisBatch.push(attempt.attemptId);
        }
        writes.push({ attemptId: attempt.attemptId, score });
      }

      // `writeScores`'s own guard (`K18`'s header, Task 1's CRITICAL): a
      // regrade never stamps `score_json` onto an attempt that is not
      // `submitted_at IS NOT NULL`, and never touches `flag` — a
      // `scoring_blocked` attempt stays flagged. Branch review M1: its
      // `{ updated }` return is asserted, not discarded — a row `writes`
      // named but the guard refused (raced out from under the batch
      // between the read and this write) folds into `skipped` rather than
      // being silently counted as rescored.
      const { updated } = await writeScores(deps.db, next.workspaceId, writes);
      skippedThisBatch += writes.length - updated;
    }

    const rescoredSoFar = next.rescoredSoFar + batch.length;
    // Branch review MIN5: if a tick fails after `writeScores` but before
    // the progress row below, the cursor does not advance and the next
    // tick reprocesses the same attempts — rescoring is idempotent, so no
    // score is ever wrong, but `oldTotal` already equals the just-written
    // `newTotal` on replay, so a changed attempt reprocessed this way is
    // not re-counted. `changedSoFar` can therefore undercount by the width
    // of one failed, replayed tick; not fixed here (the fix is tracking
    // which ids a *failed* tick wrote even though its own progress row
    // never landed, which needs state a thrown tick cannot leave behind
    // under this file's own audit-log-only design) — acknowledged rather
    // than silently accepted.
    const changedSoFar = next.changedSoFar + changedThisBatch;
    const skippedSoFar = next.skippedSoFar + skippedThisBatch;
    const changedAttemptIds = [...next.changedAttemptIds, ...changedIdsThisBatch];
    const now = deps.now();
    const done = batch.length < REGRADE_BATCH_SIZE;

    if (!done) {
      const cursor = batch[batch.length - 1]!.attemptId;
      const detail: RegradeBatchDetail = {
        testVersionId: next.testVersionId,
        cursor,
        queued: next.queued,
        rescoredSoFar,
        changedSoFar,
        skippedSoFar,
        changedAttemptIds,
      };
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
    //
    // Branch review MIN1/MIN3: scoped to `changedAttemptIds` — the
    // attempts whose total actually moved — not to every submitted attempt
    // of the version. The old version compared every verdict's `.at`
    // against `now`, which every stored verdict predates by construction,
    // so it was vacuously `verdicts.size` regardless of whether a single
    // attempt's score had moved. It also re-read up to 1000 full attempt
    // rows (`layout_json`/`score_json` included) for their ids alone;
    // `changedAttemptIds` is already the exact, usually far smaller, list
    // this tick needs, walked as the drain went rather than re-fetched.
    const verdicts = await latestVerdicts(deps.db, next.workspaceId, changedAttemptIds);
    let staleVerdicts = 0;
    for (const verdict of verdicts.values()) if (verdict.at < now) staleVerdicts += 1;

    await appendAudit(deps.db, next.workspaceId, {
      actor: "system",
      action: "regrade",
      target: next.testVersionId,
      detail: {
        testVersionId: next.testVersionId,
        rescored: rescoredSoFar,
        changed: changedSoFar,
        skipped: skippedSoFar,
        staleVerdicts,
      },
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
 *  belongs to — `AC-08`'s "any published version", not just one.
 *
 *  Branch review M5(b): `publishedVersionsForQuestion` is inherited from
 *  the private `testsUsingQuestion` this route's own file does not own,
 *  and its `bankId` arm matches **every** published version that draws
 *  from the bank at all (any `pool` source), not only ones this specific
 *  question is actually drawn into. That over-matching is correct for
 *  `testsUsingQuestion`'s own job — refusing a delete must never miss a
 *  real reference — and wrong for this one, which turns a match into real
 *  work: a bank shared by many published tests can enqueue a regrade for
 *  every one of them on a single key edit. Not fixed here — the correct
 *  long-run test is the attempt's own pinned `layout_json`/pool draw
 *  record, which is a later phase's work — named at this call site rather
 *  than left as a silently-borrowed semantics mismatch, per the review. */
export function regradeRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/:id/banks/:bankId/questions/:qid/regrade", requires("attempts.grade"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const questionId = c.req.param("qid");

    const testVersionIds = await publishedVersionsForQuestion(deps.db, workspaceId, bankId, questionId);
    if (testVersionIds.length === 0) return c.json({ queued: 0, versions: 0 });

    const now = deps.now();
    // Branch review M5(a): flat regardless of how many published versions
    // matched — one grouped count (`countSubmittedAttemptsForVersions`)
    // and one batched audit write (`appendAuditBatch`) in place of the old
    // per-version loop (`enqueueRegrade` called once per match, 2
    // subrequests each), which made the declared budget of 5 false past
    // one matching version and, past ~24, would have exceeded the
    // subrequest ceiling outright — and left a partial enqueue with no
    // record of which versions got one if it had.
    const counts = await countSubmittedAttemptsForVersions(deps.db, workspaceId, testVersionIds);
    const entries = testVersionIds.map((testVersionId) => {
      const queued = counts.get(testVersionId) ?? 0;
      const detail: RegradeRequestedDetail = { testVersionId, requestedBy: actor.userId, queued };
      return { actor: actor.userId, action: "regrade.requested", target: testVersionId, detail, now };
    });
    await appendAuditBatch(deps.db, workspaceId, entries);

    const queued = [...counts.values()].reduce((sum, n) => sum + n, 0);
    return c.json({ queued, versions: testVersionIds.length });
  });

  return routes;
}
