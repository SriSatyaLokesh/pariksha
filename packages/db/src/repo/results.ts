// The organiser's attempt reads (Phase 8a Task 7, #186's plan).
//
// Pre-flight: there was no organiser-side attempt read of any kind before
// this file — `repo/attempts.ts` is candidate-scoped, one attempt by its
// own token. This is the first, and `K9`/`KG3` are the budget it is judged
// against: one statement for the list, however many candidates a cohort
// has, never one per attempt/candidate/question. `countAttemptsForCandidate`
// (`run.ts`) and `countViolations` (`attempts.ts`) are the shape this
// follows — a `scoped()` export, not a bare `function`.
//
// `K43` removed a `lastContactAt` field from `AttemptSummary`: it has no
// caller until 8g's monitor ships (deferred with 7e), and a field with no
// reader is `#186`'s own defect. Do not add it back speculatively.

import { VIOLATION_EVENTS, type AttemptFigure } from "@pariksha/core";
import type { DbClient } from "../client.js";
import { scoped } from "./guard.js";

export interface AttemptSummary {
  attemptId: string;
  candidateId: string;
  setNo: number;
  startedAt: number;
  deadlineAt: number;
  submittedAt: number | null;
  submitReason: string | null;
  scoreJson: unknown;
  flag: string;
  integrityFlag: string;
  observed: boolean;
  violations: number;
  answered: number;
  /** 7e's `0011`. Null means "never locked" — the same shape `submittedAt`
   *  already has.
   *
   *  Two Phase 8c tasks arrived at this projection independently, which is
   *  the argument for it being here rather than in either caller: Task 1's
   *  analytics needs it because a locked attempt has no `submittedAt`, so a
   *  reader that only sees that column files it under "in progress"
   *  forever; Task 3's results CSV needs it for the "Locked at" column. It
   *  is the same row `listAttemptsForTest` already reads, so neither pays a
   *  second scoped call for it. */
  lockedAt: number | null;
}

// Same construction `attempts.ts` uses for `countViolations`: generated once
// from the one set `isViolation()` reads, so the violation vocabulary still
// has exactly one definition.
const VIOLATION_TYPES = [...VIOLATION_EVENTS];
const VIOLATION_PLACEHOLDERS = VIOLATION_TYPES.map(() => "?").join(", ");

// Same two-column opaque cursor `listQuestions` (`banks.ts`) uses — `id`
// alone does not sort (Crockford IDs are random, not time-ordered), so the
// tiebreaker column rides along in the cursor too.
function encodeCursor(startedAt: number, id: string): string {
  return `${startedAt}:${id}`;
}

function decodeCursor(cursor: string): [number, string] {
  const separator = cursor.indexOf(":");
  return [Number(cursor.slice(0, separator)), cursor.slice(separator + 1)];
}

interface AttemptSummaryRecord {
  id: string;
  candidate_id: string;
  set_no: number;
  started_at: number;
  deadline_at: number;
  submitted_at: number | null;
  submit_reason: string | null;
  score_json: unknown;
  flag: string;
  integrity_flag: string;
  observed: unknown;
  violations: number;
  answered: number;
  locked_at: number | null;
}

function toAttemptSummary(db: DbClient, row: AttemptSummaryRecord): AttemptSummary {
  return {
    attemptId: row.id,
    candidateId: row.candidate_id,
    setNo: Number(row.set_no),
    startedAt: Number(row.started_at),
    deadlineAt: Number(row.deadline_at),
    submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
    submitReason: row.submit_reason,
    scoreJson: row.score_json === null ? null : db.jsonValue(row.score_json),
    flag: row.flag,
    integrityFlag: row.integrity_flag,
    observed: Boolean(row.observed),
    violations: Number(row.violations),
    answered: Number(row.answered),
    lockedAt: row.locked_at === null ? null : Number(row.locked_at),
  };
}

/**
 * Every attempt against any version of a test, **oldest-start-first** —
 * `K9`: one statement, whatever the cohort size.
 *
 * `ORDER BY a.started_at ASC, a.id ASC` is deliberate and the docstring
 * said the opposite until Task 7's review caught it. Ascending with the id
 * as a tiebreaker is what makes the cursor a stable keyset: a page boundary
 * cannot shift under an attempt that starts while an organiser is paging,
 * and two attempts starting in the same millisecond still have one defined
 * order. A newest-first list would want its own cursor, not this one — so
 * reverse at the surface that wants it, never here. `violations` and `answered` are
 * correlated subqueries in the **same** statement (portable SQL: a scalar
 * subquery correlated on the outer row, no dialect-specific JSON syntax),
 * not a second query per row.
 *
 * Joins through `test_version` because `attempt` carries `test_version_id`,
 * not `test_id` — so an attempt sat under a version that has since been
 * superseded is still this test's.
 */
export const listAttemptsForTest = scoped(
  "listAttemptsForTest",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ rows: AttemptSummary[]; nextCursor: string | null }> => {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const clauses = ["a.workspace_id = ?", "tv.test_id = ?"];
    const params: unknown[] = [workspaceId, testId];

    if (opts.cursor) {
      const [startedAt, id] = decodeCursor(opts.cursor);
      clauses.push("(a.started_at > ? OR (a.started_at = ? AND a.id > ?))");
      params.push(startedAt, startedAt, id);
    }

    // One extra row fetched, never returned, to know a next page exists
    // without a second round trip — the same trick `listQuestions` uses.
    const rows = await db.query<AttemptSummaryRecord>(
      "SELECT a.id AS id, a.candidate_id AS candidate_id, a.set_no AS set_no, " +
        "a.started_at AS started_at, a.deadline_at AS deadline_at, a.submitted_at AS submitted_at, " +
        "a.submit_reason AS submit_reason, a.score_json AS score_json, a.flag AS flag, " +
        "a.integrity_flag AS integrity_flag, a.observed AS observed, a.locked_at AS locked_at, " +
        "(SELECT COUNT(*) FROM event e WHERE e.workspace_id = a.workspace_id AND e.attempt_id = a.id " +
        `AND e.type IN (${VIOLATION_PLACEHOLDERS})) AS violations, ` +
        "(SELECT COUNT(*) FROM response r WHERE r.workspace_id = a.workspace_id AND r.attempt_id = a.id) " +
        "AS answered " +
        "FROM attempt a " +
        "JOIN test_version tv ON tv.workspace_id = a.workspace_id AND tv.id = a.test_version_id " +
        `WHERE ${clauses.join(" AND ")} ` +
        "ORDER BY a.started_at ASC, a.id ASC LIMIT ?",
      [...VIOLATION_TYPES, ...params, limit + 1],
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(Number(last.started_at), last.id) : null;

    return { rows: page.map((row) => toAttemptSummary(db, row)), nextCursor };
  },
);

interface FigureRecord {
  id: string;
  candidate_id: string;
  submitted_at: number;
  score_json: unknown;
}

/**
 * `K6`'s `countedScore` input, for every candidate who has attempted this
 * test — one statement for the whole cohort (`K9`), grouped by candidate in
 * JS over the rows this already fetched, not a second query per candidate.
 * Same submitted-and-scored filter `attemptFiguresForCandidate` (`run.ts`)
 * uses, widened from one candidate to the whole test via the same
 * `test_version` join `listAttemptsForTest` uses above it.
 */
export const countedFiguresForTest = scoped(
  "countedFiguresForTest",
  async (db: DbClient, workspaceId: string, testId: string): Promise<Map<string, AttemptFigure[]>> => {
    const rows = await db.query<FigureRecord>(
      "SELECT a.id AS id, a.candidate_id AS candidate_id, a.submitted_at AS submitted_at, " +
        "a.score_json AS score_json " +
        "FROM attempt a " +
        "JOIN test_version tv ON tv.workspace_id = a.workspace_id AND tv.id = a.test_version_id " +
        "WHERE a.workspace_id = ? AND tv.test_id = ? " +
        "AND a.submitted_at IS NOT NULL AND a.score_json IS NOT NULL",
      [workspaceId, testId],
    );

    const byCandidate = new Map<string, AttemptFigure[]>();
    for (const row of rows) {
      const figure: AttemptFigure = {
        attemptId: row.id,
        percent: db.jsonValue<{ percent: number }>(row.score_json).percent,
        submittedAt: Number(row.submitted_at),
      };
      const existing = byCandidate.get(row.candidate_id);
      if (existing) existing.push(figure);
      else byCandidate.set(row.candidate_id, [figure]);
    }
    return byCandidate;
  },
);

/**
 * Phase 8c Task 3 (`R-08`, Review Focus 2): the results CSV's `Rank`
 * column, from **one** page-independent ordering rather than a page's own
 * row position — a `RANK()` window function over the whole test's scored
 * attempts, so a candidate's rank cannot "restart at 1" on page two the way
 * it would if each page ranked only the rows it happened to fetch.
 *
 * One statement, flat in cohort size (`K9`), the same `json_extract`/`->>`
 * split `listIntegrityCounts` (`attempts.ts`) already draws for a numeric
 * value inside a JSON column: `pg`'s `->>` returns text and is cast to
 * `numeric` so `ORDER BY` compares it as a number, not lexically;
 * `sqlite`/`d1`'s `json_extract` already returns a real JSON number.
 *
 * Scoped to `submitted_at IS NOT NULL AND score_json IS NOT NULL` —
 * ranking an in-progress attempt against a percent it does not have yet
 * would be meaningless, and `R-10`'s "available during the test" is served
 * by that attempt's row simply carrying no rank, not by a fabricated one.
 * Ties share a rank and leave a gap after them (`RANK()`'s own semantics,
 * e.g. `1, 1, 3`) — standard leaderboard behaviour, and nothing in `R-08`
 * asks for a different tiebreak.
 */
export const rankedScoresForTest = scoped(
  "rankedScoresForTest",
  async (db: DbClient, workspaceId: string, testId: string): Promise<Map<string, number>> => {
    const percentExtract =
      db.dialect === "pg" ? "(a.score_json ->> 'percent')::numeric" : "json_extract(a.score_json, '$.percent')";
    const rows = await db.query<{ id: string; rnk: number }>(
      `SELECT a.id AS id, RANK() OVER (ORDER BY ${percentExtract} DESC) AS rnk ` +
        "FROM attempt a " +
        "JOIN test_version tv ON tv.workspace_id = a.workspace_id AND tv.id = a.test_version_id " +
        "WHERE a.workspace_id = ? AND tv.test_id = ? " +
        "AND a.submitted_at IS NOT NULL AND a.score_json IS NOT NULL",
      [workspaceId, testId],
    );
    const ranks = new Map<string, number>();
    for (const row of rows) ranks.set(row.id, Number(row.rnk));
    return ranks;
  },
);

interface ResponseRecord {
  attempt_id: string;
  question_id: string;
  value_json: unknown;
}

/**
 * Phase 8c Task 3 (`R-09`'s per-answer CSV): every response for a **page**
 * of attempts, in one statement — the `IN (...)` sibling of `latestVerdicts`
 * (`review.ts`)'s whole-table scan, chosen instead of it because `response`
 * is not small the way `review` is (it is one row per candidate per
 * question, not one per human click), so reading it whole per export would
 * cost more than the page it is answering for, not less.
 *
 * **Callers must keep `attemptIds.length` well under D1's 100-bound-
 * parameter cap** (one placeholder per id, plus `workspaceId`) — this
 * function does not chunk, the same restraint `latestVerdicts`'s own doc
 * comment explains chunking would break. `export/results.ts`'s answers
 * route is the only caller, and it pages attempts in small enough batches
 * that this is always true; a second caller must keep that invariant
 * itself rather than assume this one enforces it.
 *
 * `correct` and `points` are deliberately not read here: they live in the
 * attempt's own `score_json.perQuestion`, which the caller already has from
 * `listAttemptsForTest`, and re-deriving them from the question bank would
 * be the second reader `K6`'s own precedent warns against — and would put
 * this function one `SELECT *` away from the answer key `KG1` forbids.
 */
export const responsesForAttempts = scoped(
  "responsesForAttempts",
  async (
    db: DbClient,
    workspaceId: string,
    attemptIds: readonly string[],
  ): Promise<Map<string, { questionId: string; value: unknown }[]>> => {
    if (attemptIds.length === 0) return new Map();
    const placeholders = attemptIds.map(() => "?").join(", ");
    const rows = await db.query<ResponseRecord>(
      `SELECT attempt_id, question_id, value_json FROM response ` +
        `WHERE workspace_id = ? AND attempt_id IN (${placeholders}) ` +
        "ORDER BY attempt_id, question_id",
      [workspaceId, ...attemptIds],
    );
    const byAttempt = new Map<string, { questionId: string; value: unknown }[]>();
    for (const row of rows) {
      const value = row.value_json === null ? null : db.jsonValue(row.value_json);
      const list = byAttempt.get(row.attempt_id);
      if (list) list.push({ questionId: row.question_id, value });
      else byAttempt.set(row.attempt_id, [{ questionId: row.question_id, value }]);
    }
    return byAttempt;
  },
);

// --- Phase 8c Task 4 (`R-09`, `K38`): the events CSV and the snapshot
// manifest's own reads --------------------------------------------------

export interface EventRow {
  id: string;
  attemptId: string;
  candidateId: string;
  type: string;
  detail: unknown;
  clientTs: number;
  serverTs: number;
}

interface EventRecord {
  id: string;
  attempt_id: string;
  candidate_id: string;
  type: string;
  detail_json: unknown;
  client_ts: number;
  server_ts: number;
}

// Same two-column keyset shape `listAttemptsForTest` uses above, over
// `(server_ts, id)` instead of `(started_at, id)` — events of one attempt
// arrive in `server_ts` order, but a test's events interleave across
// attempts, so the whole-test ordering (not an attempt-scoped one) is what a
// stable page boundary needs.
function encodeEventCursor(serverTs: number, id: string): string {
  return `${serverTs}:${id}`;
}

function decodeEventCursor(cursor: string): [number, string] {
  const separator = cursor.indexOf(":");
  return [Number(cursor.slice(0, separator)), cursor.slice(separator + 1)];
}

/**
 * Every event behind any attempt of a test, oldest-first — `K38`'s own
 * contract: one statement per page, a filled page always carries a
 * `nextCursor`, and the ordering is a stable keyset (`server_ts` then `id`)
 * so a page boundary cannot shift under an event written mid-export.
 *
 * Joins through `test_version` for the same reason `listAttemptsForTest`
 * does: `attempt` carries `test_version_id`, not `test_id`.
 */
export const listEventsForTest = scoped(
  "listEventsForTest",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<{ rows: EventRow[]; nextCursor: string | null }> => {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const clauses = ["e.workspace_id = ?", "tv.test_id = ?"];
    const params: unknown[] = [workspaceId, testId];

    if (opts.cursor) {
      const [serverTs, id] = decodeEventCursor(opts.cursor);
      clauses.push("(e.server_ts > ? OR (e.server_ts = ? AND e.id > ?))");
      params.push(serverTs, serverTs, id);
    }

    const rows = await db.query<EventRecord>(
      "SELECT e.id AS id, e.attempt_id AS attempt_id, a.candidate_id AS candidate_id, e.type AS type, " +
        "e.detail_json AS detail_json, e.client_ts AS client_ts, e.server_ts AS server_ts " +
        "FROM event e " +
        "JOIN attempt a ON a.workspace_id = e.workspace_id AND a.id = e.attempt_id " +
        "JOIN test_version tv ON tv.workspace_id = a.workspace_id AND tv.id = a.test_version_id " +
        `WHERE ${clauses.join(" AND ")} ` +
        "ORDER BY e.server_ts ASC, e.id ASC LIMIT ?",
      [...params, limit + 1],
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeEventCursor(Number(last.server_ts), last.id) : null;

    return {
      rows: page.map((row) => ({
        id: row.id,
        attemptId: row.attempt_id,
        candidateId: row.candidate_id,
        type: row.type,
        detail: row.detail_json === null ? null : db.jsonValue(row.detail_json),
        clientTs: Number(row.client_ts),
        serverTs: Number(row.server_ts),
      })),
      nextCursor,
    };
  },
);

export interface SnapshotRow {
  id: string;
  attemptId: string;
  candidateId: string;
  storageKey: string;
  takenAt: number;
  reason: string;
  faceCount: number | null;
}

interface SnapshotRecord {
  id: string;
  attempt_id: string;
  candidate_id: string;
  storage_key: string;
  taken_at: number;
  reason: string;
  face_count: number | null;
}

/**
 * Every `snapshot` row behind a **page** of attempts, one statement — the
 * `responsesForAttempts` sibling for the manifest. Callers must keep
 * `attemptIds.length` well under D1's 100-bound-parameter cap, the same
 * restraint that function's own doc comment states.
 */
export const listSnapshotsForAttempts = scoped(
  "listSnapshotsForAttempts",
  async (db: DbClient, workspaceId: string, attemptIds: readonly string[]): Promise<SnapshotRow[]> => {
    if (attemptIds.length === 0) return [];
    const placeholders = attemptIds.map(() => "?").join(", ");
    const rows = await db.query<SnapshotRecord>(
      "SELECT s.id AS id, s.attempt_id AS attempt_id, a.candidate_id AS candidate_id, s.storage_key AS storage_key, " +
        "s.taken_at AS taken_at, s.reason AS reason, s.face_count AS face_count " +
        "FROM snapshot s " +
        "JOIN attempt a ON a.workspace_id = s.workspace_id AND a.id = s.attempt_id " +
        `WHERE s.workspace_id = ? AND s.attempt_id IN (${placeholders}) ` +
        "ORDER BY s.attempt_id, s.taken_at",
      [workspaceId, ...attemptIds],
    );
    return rows.map((row) => ({
      id: row.id,
      attemptId: row.attempt_id,
      candidateId: row.candidate_id,
      storageKey: row.storage_key,
      takenAt: Number(row.taken_at),
      reason: row.reason,
      // `K1`: `null` means "not counted", never zero faces — carried through
      // unconverted, so the caller (never this file) decides how to render it.
      faceCount: row.face_count === null ? null : Number(row.face_count),
    }));
  },
);
