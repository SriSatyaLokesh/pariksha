// Regrade after a key change (Phase 8b Task 4, `K17`/`K18`): the data this
// cron job needs that no earlier file exposes.
//
// `K17`/`K18`'s own ruling: no second queue table — `audit_log` already
// carries `enqueueRegrade`'s `"regrade.requested"` row, so the job's real
// work is reading attempts of exactly **one** `test_version_id`, never the
// whole test (`listAttemptsForTest`, 8a Task 7, is test-scoped, not
// version-scoped, and this phase edits a key on one published version at a
// time). `attempt_test_version_idx` already covers `test_version_id`, so
// this needs no join through `test_version` the way `listAttemptsForTest`
// does.

import type { DbClient } from "../client.js";
import { scoped } from "./guard.js";
import type { ResponseRow } from "./attempts.js";

export interface RegradeAttempt {
  attemptId: string;
  layout: unknown;
  /** The score as stored *before* this tick's rescore — compared against
   *  the fresh one to count how many actually changed (`K17`). */
  scoreJson: unknown;
}

interface RegradeAttemptRecord {
  id: string;
  layout_json: unknown;
  score_json: unknown;
}

/**
 * Submitted attempts of one test version, oldest-id-first — `K18`'s bounded
 * batch, one page at a time. `id` is the cursor (not `started_at`, the way
 * `listAttemptsForTest` orders): this job has no UI to keep a page stable
 * for, only a tick that has to resume exactly where the last one stopped,
 * and an opaque, monotonic primary key does that with no second column.
 */
export const listSubmittedAttemptsForVersion = scoped(
  "listSubmittedAttemptsForVersion",
  async (
    db: DbClient,
    workspaceId: string,
    testVersionId: string,
    opts: { afterId?: string; limit: number },
  ): Promise<RegradeAttempt[]> => {
    const clauses = ["workspace_id = ?", "test_version_id = ?", "submitted_at IS NOT NULL"];
    const params: unknown[] = [workspaceId, testVersionId];
    if (opts.afterId) {
      clauses.push("id > ?");
      params.push(opts.afterId);
    }
    const rows = await db.query<RegradeAttemptRecord>(
      `SELECT id, layout_json, score_json FROM attempt WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`,
      [...params, opts.limit],
    );
    return rows.map((row) => ({
      attemptId: row.id,
      layout: db.jsonValue(row.layout_json),
      scoreJson: row.score_json == null ? null : db.jsonValue(row.score_json),
    }));
  },
);

/** `enqueueRegrade`'s own count (`K18`: "how many attempts will be
 *  rescored"), and the job's fallback when a `"regrade.requested"` row
 *  predates this addition and carries no `queued` of its own. Same
 *  no-join shape as `listSubmittedAttemptsForVersion`. */
export const countSubmittedAttemptsForVersion = scoped(
  "countSubmittedAttemptsForVersion",
  async (db: DbClient, workspaceId: string, testVersionId: string): Promise<number> => {
    const rows = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM attempt WHERE workspace_id = ? AND test_version_id = ? AND submitted_at IS NOT NULL",
      [workspaceId, testVersionId],
    );
    return Number(rows[0]?.n ?? 0);
  },
);

/** The one `test_version` read a regrade tick needs: the settings every
 *  attempt in the batch shares (they are all pinned to the same version),
 *  read once per tick rather than once per attempt. */
export const testVersionSettings = scoped(
  "testVersionSettings",
  async (
    db: DbClient,
    workspaceId: string,
    testVersionId: string,
  ): Promise<{ testId: string; settings: unknown } | null> => {
    const rows = await db.query<{ test_id: string; settings_json: unknown }>(
      "SELECT test_id, settings_json FROM test_version WHERE workspace_id = ? AND id = ?",
      [workspaceId, testVersionId],
    );
    const row = rows[0];
    if (!row) return null;
    return { testId: row.test_id, settings: db.jsonValue(row.settings_json) };
  },
);

/**
 * Every stored response for a page of attempts, in one statement —
 * `identityForAttempts` (`grading.ts`)'s own shape, a batched `IN` rather
 * than `listResponses` (`attempts.ts`) called once per attempt. D1 caps
 * bound parameters at 100; `REGRADE_BATCH_SIZE` (`apps/api/src/grade/
 * regrade.ts`) stays well under that, so this never needs to chunk.
 */
export const listResponsesForAttempts = scoped(
  "listResponsesForAttempts",
  async (
    db: DbClient,
    workspaceId: string,
    attemptIds: readonly string[],
  ): Promise<Map<string, ResponseRow[]>> => {
    const byAttempt = new Map<string, ResponseRow[]>();
    if (attemptIds.length === 0) return byAttempt;
    const placeholders = attemptIds.map(() => "?").join(", ");
    const rows = await db.query<{
      attempt_id: string;
      question_id: string;
      value_json: unknown;
      client_seq: number;
      saved_at: number;
      points: number | null;
      graded_by: string | null;
    }>(
      "SELECT attempt_id, question_id, value_json, client_seq, saved_at, points, graded_by " +
        `FROM response WHERE workspace_id = ? AND attempt_id IN (${placeholders})`,
      [workspaceId, ...attemptIds],
    );
    for (const row of rows) {
      const entry: ResponseRow = {
        questionId: row.question_id,
        value: db.jsonValue(row.value_json),
        clientSeq: Number(row.client_seq),
        savedAt: Number(row.saved_at),
        points: row.points === null ? null : Number(row.points),
        gradedBy: row.graded_by,
      };
      const existing = byAttempt.get(row.attempt_id);
      if (existing) existing.push(entry);
      else byAttempt.set(row.attempt_id, [entry]);
    }
    return byAttempt;
  },
);

/**
 * Writes every rescored attempt's `score_json` in one `db.batch()` —
 * `K18`'s whole point: N individual `writeScore` (`grading.ts`) calls would
 * cost N subrequests, one `batch()` costs one regardless of N.
 *
 * **Carries `writeScore`'s own guard**, the one Task 1's CRITICAL exists
 * because of: `WHERE ... AND submitted_at IS NOT NULL`. This file's own
 * batch read (`listSubmittedAttemptsForVersion`) already filters to
 * submitted attempts, so the guard here is belt-and-suspenders, not the
 * only thing standing between a regrade and an in-progress attempt — but a
 * second guard at the write is what `recordAward`'s own history (`grade/
 * award.ts`'s header) says to insist on rather than trust a read upstream.
 */
export const writeScores = scoped(
  "writeScores",
  async (
    db: DbClient,
    workspaceId: string,
    entries: readonly { attemptId: string; score: unknown }[],
  ): Promise<{ updated: number }> => {
    if (entries.length === 0) return { updated: 0 };
    const results = await db.batch(
      entries.map((entry) => ({
        sql: "UPDATE attempt SET score_json = ? WHERE workspace_id = ? AND id = ? AND submitted_at IS NOT NULL",
        params: [db.jsonParam(entry.score), workspaceId, entry.attemptId],
      })),
    );
    return { updated: results.filter((r) => r.changes > 0).length };
  },
);
