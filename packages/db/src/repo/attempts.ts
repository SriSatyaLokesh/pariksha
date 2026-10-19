// Candidates, attempts, responses and events — the candidate runtime's data.
//
// This module owns the hottest path in the product: saving one answer. ADR
// 0002 budgets it at one D1 write plus at most one R2 call, so `upsertResponse`
// is a single statement and nothing here loops a query over questions.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export interface ResponseRow {
  questionId: string;
  value: unknown;
  clientSeq: number;
  savedAt: number;
  points: number | null;
}

export const createCandidate = scoped(
  "createCandidate",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      testId: string;
      formValues: unknown;
      consentVersion: string;
      now?: number;
    },
  ): Promise<string> => {
    const id = newId("cnd");
    // Task 9 (#60 / #56, P5.7b): `source` says who wrote the row. This is
    // the self-registration writer, so `"registration"` — the half
    // `replaceCandidateList` (packages/db/src/repo/candidates.ts) must
    // never delete. `external_id` and `set_label` stay null here: linking
    // a registration to the list row it matched is Phase 6's, and a null
    // `external_id` does not collide in the unique below it.
    await db.run(
      "INSERT INTO candidate (id, workspace_id, test_id, source, form_values_json, consent_version, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        workspaceId,
        input.testId,
        "registration",
        db.jsonParam(input.formValues),
        input.consentVersion,
        input.now ?? Date.now(),
      ],
    );
    return id;
  },
);

export const createAttempt = scoped(
  "createAttempt",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      candidateId: string;
      testVersionId: string;
      setNo: number;
      layout: unknown;
      startedAt: number;
      deadlineAt: number;
      tokenHash: string;
    },
  ): Promise<string> => {
    const id = newId("att");
    await db.run(
      "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, deadline_at, submitted_at, submit_reason, score_json, flag, token_hash) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        workspaceId,
        input.candidateId,
        input.testVersionId,
        input.setNo,
        // The question and option order is stored per attempt, so a refresh
        // or a crash resumes the same paper (T-10, C-06).
        db.jsonParam(input.layout),
        input.startedAt,
        // The deadline is the server's, not the browser's (AC-13).
        input.deadlineAt,
        null,
        null,
        null,
        "clean",
        input.tokenHash,
      ],
    );
    return id;
  },
);

export const getAttempt = scoped(
  "getAttempt",
  async (
    db: DbClient,
    workspaceId: string,
    attemptId: string,
  ): Promise<{
    id: string;
    candidateId: string;
    testVersionId: string;
    setNo: number;
    layout: unknown;
    startedAt: number;
    deadlineAt: number;
    submittedAt: number | null;
    flag: string;
  } | null> => {
    const rows = await db.query<{
      id: string;
      candidate_id: string;
      test_version_id: string;
      set_no: number;
      layout_json: unknown;
      started_at: number;
      deadline_at: number;
      submitted_at: number | null;
      flag: string;
    }>(
      "SELECT id, candidate_id, test_version_id, set_no, layout_json, started_at, deadline_at, submitted_at, flag FROM attempt WHERE workspace_id = ? AND id = ?",
      [workspaceId, attemptId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      candidateId: row.candidate_id,
      testVersionId: row.test_version_id,
      setNo: Number(row.set_no),
      layout: db.jsonValue(row.layout_json),
      startedAt: Number(row.started_at),
      deadlineAt: Number(row.deadline_at),
      submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
      flag: row.flag,
    };
  },
);

/**
 * Saves one answer.
 *
 * The client retries on a flaky network, so a `clientSeq` of 4 can arrive
 * after 5. Last-write-wins would silently restore the older answer and the
 * candidate would lose work — the one outcome the PRD's durability
 * requirement names as never acceptable.
 *
 * So the write is conditional and happens in a single statement: insert, or
 * on conflict update **only if** the incoming sequence is higher. One D1
 * write, no read-then-write race, and a late retry is a no-op rather than a
 * regression. `stored` says whether this call was the one that won.
 */
export const upsertResponse = scoped(
  "upsertResponse",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      attemptId: string;
      questionId: string;
      value: unknown;
      clientSeq: number;
      savedAt: number;
    },
  ): Promise<{ stored: boolean }> => {
    const { changes } = await db.run(
      "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (attempt_id, question_id) DO UPDATE SET " +
        "value_json = excluded.value_json, saved_at = excluded.saved_at, client_seq = excluded.client_seq " +
        "WHERE excluded.client_seq > response.client_seq",
      [
        newId("rsp"),
        workspaceId,
        input.attemptId,
        input.questionId,
        db.jsonParam(input.value),
        input.savedAt,
        input.clientSeq,
        null,
        null,
      ],
    );
    return { stored: changes > 0 };
  },
);

export const readResponse = scoped(
  "readResponse",
  async (
    db: DbClient,
    workspaceId: string,
    attemptId: string,
    questionId: string,
  ): Promise<ResponseRow | null> => {
    const rows = await db.query<ResponseRecord>(
      `SELECT ${RESPONSE_COLUMNS} FROM response WHERE workspace_id = ? AND attempt_id = ? AND question_id = ?`,
      [workspaceId, attemptId, questionId],
    );
    const row = rows[0];
    return row ? toResponseRow(db, row) : null;
  },
);

export const listResponses = scoped(
  "listResponses",
  async (
    db: DbClient,
    workspaceId: string,
    attemptId: string,
  ): Promise<ResponseRow[]> => {
    // One query for the whole attempt: the 50-subrequest ceiling means no
    // route may fetch answers one question at a time.
    const rows = await db.query<ResponseRecord>(
      `SELECT ${RESPONSE_COLUMNS} FROM response WHERE workspace_id = ? AND attempt_id = ? ORDER BY question_id`,
      [workspaceId, attemptId],
    );
    return rows.map((row) => toResponseRow(db, row));
  },
);

export const appendEvents = scoped(
  "appendEvents",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      attemptId: string;
      events: { type: string; detail?: unknown; clientTs: number }[];
      serverTs: number;
    },
  ): Promise<{ written: number }> => {
    if (input.events.length === 0) return { written: 0 };

    // Events are batched up to 10 per request to stay inside the daily write
    // budget, so they are written as one statement, never one call each.
    const values = input.events.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = input.events.flatMap((event) => [
      newId("evt"),
      workspaceId,
      input.attemptId,
      event.type,
      event.detail === undefined ? null : db.jsonParam(event.detail),
      event.clientTs,
      input.serverTs,
    ]);

    await db.run(
      `INSERT INTO event (id, workspace_id, attempt_id, type, detail_json, client_ts, server_ts) VALUES ${values}`,
      params,
    );
    return { written: input.events.length };
  },
);

const RESPONSE_COLUMNS =
  "question_id, value_json, client_seq, saved_at, points";

interface ResponseRecord {
  question_id: string;
  value_json: unknown;
  client_seq: number;
  saved_at: number;
  points: number | null;
}

const toResponseRow = (db: DbClient, row: ResponseRecord): ResponseRow => ({
  questionId: row.question_id,
  value: db.jsonValue(row.value_json),
  clientSeq: Number(row.client_seq),
  savedAt: Number(row.saved_at),
  points: row.points === null ? null : Number(row.points),
});
