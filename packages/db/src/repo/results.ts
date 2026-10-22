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
  };
}

/**
 * Every attempt against any version of a test, newest-start-first — `K9`:
 * one statement, whatever the cohort size. `violations` and `answered` are
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
        "a.integrity_flag AS integrity_flag, a.observed AS observed, " +
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
