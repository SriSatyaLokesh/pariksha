// Manual grading's data layer (Phase 8b Task 1, `K14`): the award itself
// lands on `response.points`/`response.graded_by` — the two columns `0009`
// already added and left unwritten — and nothing else. There is no awards
// table (`K14`'s own ruling), so "what did a reviewer award" is answered by
// re-deriving it from the question's own rubric and the stored points,
// never by reading a second store.
//
// `newId`/`scoped` follow the same shape every file under `repo/` does;
// `workspaceQuestions` (`banks.ts`) is reused rather than re-queried, the
// same way `liveQuestions` (`apps/api/src/run/submit.ts`) already wraps it
// for the candidate side.

import type { Question, RubricAward } from "@pariksha/core";
import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";
import { workspaceQuestions } from "./banks.js";

/** `0009`'s `response.points`/`response.graded_by`: the award, stored. */
export const writeAward = scoped(
  "writeAward",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string; questionId: string; points: number; gradedBy: string; now: number },
  ): Promise<{ written: boolean }> => {
    // Grading a question nobody answered still needs a row to carry the
    // award — `upsertResponse` (`attempts.ts`) never ran for it — so this
    // is an upsert too, and the `DO UPDATE` names only the two grading
    // columns: a re-grade must never touch the candidate's own
    // `value_json`, `saved_at` or `client_seq`.
    const { changes } = await db.run(
      "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (attempt_id, question_id) DO UPDATE SET points = excluded.points, graded_by = excluded.graded_by",
      [
        newId("rsp"),
        workspaceId,
        input.attemptId,
        input.questionId,
        db.jsonParam(null),
        input.now,
        0,
        input.points,
        input.gradedBy,
      ],
    );
    return { written: changes > 0 };
  },
);

/**
 * The fresh `score_json` `K14` requires after every award — `finishAttempt`
 * (`attempts.ts`) is the submission-time sibling and guards
 * `submitted_at IS NULL`; this is the opposite guard, because grading only
 * ever happens after submission and must never stamp a score onto an
 * attempt still in progress.
 */
export const writeScore = scoped(
  "writeScore",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string; score: unknown },
  ): Promise<{ updated: boolean }> => {
    const { changes } = await db.run(
      "UPDATE attempt SET score_json = ? WHERE workspace_id = ? AND id = ? AND submitted_at IS NOT NULL",
      [db.jsonParam(input.score), workspaceId, input.attemptId],
    );
    return { updated: changes > 0 };
  },
);

export interface AttemptForGrading {
  attemptId: string;
  testId: string;
  /** `PinnedLayout`, as stored — `rescoreAttempt`'s own input shape. */
  layout: unknown;
  /** The pinned version's `settings_json` — `scoringOf`/`defaultsOf`
   *  (`apps/api/src/run/submit.ts`) read it the same way the candidate
   *  side does. */
  settings: unknown;
  submittedAt: number | null;
}

interface AttemptForGradingRecord {
  id: string;
  test_id: string;
  layout_json: unknown;
  settings_json: unknown;
  submitted_at: number | null;
}

/** The one read `recordAward` needs of the attempt itself — the same join
 *  `readAttemptByTokenHash` (`candidate-entry.ts`) does, scoped by
 *  workspace and attempt id instead of by token, for the organiser side. */
export const attemptForGrading = scoped(
  "attemptForGrading",
  async (db: DbClient, workspaceId: string, attemptId: string): Promise<AttemptForGrading | null> => {
    const rows = await db.query<AttemptForGradingRecord>(
      "SELECT a.id AS id, v.test_id AS test_id, a.layout_json AS layout_json, " +
        "v.settings_json AS settings_json, a.submitted_at AS submitted_at " +
        "FROM attempt a JOIN test_version v ON v.workspace_id = a.workspace_id AND v.id = a.test_version_id " +
        "WHERE a.workspace_id = ? AND a.id = ?",
      [workspaceId, attemptId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      attemptId: row.id,
      testId: row.test_id,
      layout: db.jsonValue(row.layout_json),
      settings: db.jsonValue(row.settings_json),
      submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
    };
  },
);

function isManual(q: Question): q is Question & { rubric?: { level: string; points: number }[] } {
  return q.type === "short_answer" || q.type === "long_answer";
}

/**
 * Reconstructs a `RubricAward` from a graded response's stored `points`,
 * matched against the question's own rubric.
 *
 * ponytail: `K14` stores only `points`/`graded_by`, never the levels a
 * reviewer actually picked, so this is a best-effort replay rather than a
 * record — it finds a rubric level whose points equal the stored amount
 * and awards that one level. Exact whenever the rubric has not changed
 * since grading, which is the ordinary case; 0 points round-trips exactly
 * always (`{ levels: [] }` sums to 0 under any rubric). The one case this
 * degrades is a rubric edited to remove the matching level between a grade
 * and a later rescore, which loses the credit back to 0 rather than
 * reproducing a wrong nonzero figure. Upgrade path, if that drift ever
 * actually bites: persist the award itself in a new column — out of reach
 * this task under `K10` (0009 is the phase's one migration).
 */
function deriveAward(q: Question | undefined, points: number): RubricAward {
  if (points === 0 || q === undefined || !isManual(q)) return { levels: [] };
  const level = (q.rubric ?? []).find((l) => l.points === points);
  return { levels: level ? [level.level] : [] };
}

export interface PendingAward {
  attemptId: string;
  questionId: string;
  /** The candidate's answer. Never the model answer (`KG1`). */
  value: unknown;
  /** Present only when a grader already awarded one. */
  award: RubricAward | null;
  points: number | null;
}

interface PendingAwardRecord {
  attempt_id: string;
  question_id: string;
  value_json: unknown;
  points: number | null;
  graded_by: string | null;
}

function encodeCursor(attemptId: string, questionId: string): string {
  return `${attemptId}:${questionId}`;
}

function decodeCursor(cursor: string): [string, string] {
  const separator = cursor.indexOf(":");
  return [cursor.slice(0, separator), cursor.slice(separator + 1)];
}

/**
 * Manual questions across one test, one page at a time — `K9`: one
 * statement for the response data whatever the cohort size, never one per
 * attempt or candidate. The question bank read that finds which ids are
 * even manual (`workspaceQuestions`) is a second statement, bounded by the
 * workspace's bank size rather than its candidate count, same as
 * `rescoreAttempt`'s own `liveQuestions` call.
 */
export const listPendingAwards = scoped(
  "listPendingAwards",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    opts: { questionId?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ rows: PendingAward[]; nextCursor: string | null }> => {
    const questions = await workspaceQuestions(db, workspaceId);
    const manual = new Map(questions.filter((q) => isManual(q.document)).map((q) => [q.id, q.document]));

    const ids = opts.questionId
      ? manual.has(opts.questionId)
        ? [opts.questionId]
        : []
      : [...manual.keys()];
    if (ids.length === 0) return { rows: [], nextCursor: null };

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const placeholders = ids.map(() => "?").join(", ");
    const clauses = [
      "r.workspace_id = ?",
      "v.test_id = ?",
      "a.submitted_at IS NOT NULL",
      `r.question_id IN (${placeholders})`,
    ];
    const params: unknown[] = [workspaceId, testId, ...ids];

    if (opts.cursor) {
      const [attemptId, questionId] = decodeCursor(opts.cursor);
      clauses.push("(r.attempt_id > ? OR (r.attempt_id = ? AND r.question_id > ?))");
      params.push(attemptId, attemptId, questionId);
    }

    // One extra row fetched, never returned, to know a next page exists
    // without a second round trip — `listAttemptsForTest` (`results.ts`)
    // uses the same trick.
    const rows = await db.query<PendingAwardRecord>(
      "SELECT r.attempt_id AS attempt_id, r.question_id AS question_id, r.value_json AS value_json, " +
        "r.points AS points, r.graded_by AS graded_by " +
        "FROM response r " +
        "JOIN attempt a ON a.workspace_id = r.workspace_id AND a.id = r.attempt_id " +
        "JOIN test_version v ON v.workspace_id = a.workspace_id AND v.id = a.test_version_id " +
        `WHERE ${clauses.join(" AND ")} ` +
        "ORDER BY r.attempt_id ASC, r.question_id ASC LIMIT ?",
      [...params, limit + 1],
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.attempt_id, last.question_id) : null;

    return {
      rows: page.map((row) => ({
        attemptId: row.attempt_id,
        questionId: row.question_id,
        value: db.jsonValue(row.value_json),
        award:
          row.graded_by === null ? null : deriveAward(manual.get(row.question_id), Number(row.points ?? 0)),
        points: row.points === null ? null : Number(row.points),
      })),
      nextCursor,
    };
  },
);
