// Candidates, attempts, responses and events — the candidate runtime's data.
//
// This module owns the hottest path in the product: saving one answer. ADR
// 0002 budgets it at one D1 write plus at most one R2 call, so `upsertResponse`
// is a single statement and nothing here loops a query over questions.

import { isViolation, type ProctoringEventType } from "@pariksha/core";
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
      /**
       * Minted by the caller, not here (Phase 6 Task 5). `/start` seeds
       * `layoutForAttempt` with this id, so the shuffle is reproducible
       * from the row and nothing else has to store a seed — which it
       * could not be if the id first existed inside this function.
       */
      id: string;
      candidateId: string;
      testVersionId: string;
      setNo: number;
      layout: unknown;
      startedAt: number;
      deadlineAt: number;
      tokenHash: string;
    },
  ): Promise<string> => {
    await db.run(
      "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.id,
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
        // The first question, and nothing entered yet: a per-section
        // clock starts when the candidate reaches a timed section, not
        // when the paper is minted.
        0,
        null,
      ],
    );
    return input.id;
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
    integrityFlag: string;
    observed: boolean;
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
      integrity_flag: string;
      observed: unknown;
    }>(
      "SELECT id, candidate_id, test_version_id, set_no, layout_json, started_at, deadline_at, submitted_at, flag, integrity_flag, observed FROM attempt WHERE workspace_id = ? AND id = ?",
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
      integrityFlag: row.integrity_flag,
      // SQLite hands this back as 0/1; Boolean(...) is what the same
      // `review_requested` read already does in repo/tests.ts.
      observed: Boolean(row.observed),
    };
  },
);

/** The closed set `setIntegrity` ever writes. The **writer's** input is
 *  typed to it because this is the only place a value is produced; the
 *  reader (`getAttempt`'s `integrityFlag`) stays `string` — the database
 *  can hold anything, and a reader that claims otherwise is worse than one
 *  that admits it does not know. */
export type IntegrityFlag = "clean" | "review" | "high_risk";

/**
 * Sets the integrity verdict and whether this attempt was observed —
 * proctoring's axis, independent of `flag` (grading's). Phase 7e computes
 * `integrityFlag` from `observed` and other signals; this is only the
 * writer, which is why it never touches `flag`.
 *
 * `updated` says whether a row was actually written, the way `DbClient.run`
 * reports for every other writer in this file — a later plan's recompute
 * needs to tell a written verdict from a no-op against an attempt that was
 * since deleted.
 */
export const setIntegrity = scoped(
  "setIntegrity",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string; integrityFlag: IntegrityFlag; observed: boolean },
  ): Promise<{ updated: boolean }> => {
    const { changes } = await db.run(
      "UPDATE attempt SET integrity_flag = ?, observed = ? WHERE workspace_id = ? AND id = ?",
      [input.integrityFlag, input.observed ? 1 : 0, workspaceId, input.attemptId],
    );
    return { updated: changes > 0 };
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
      /**
       * Phase 6 Tasks 9 and 10: how far the candidate has now got.
       *
       * Only ever supplied when the target is *ahead* of `max_index`, which
       * is the uncommon case — re-editing an answer in place, the common
       * one, supplies nothing and stays a single statement. When it is
       * supplied the progress update rides the **same** `db.batch` as the
       * upsert, which D1 counts as one subrequest, so the answer route's
       * pinned budget of 2 does not move.
       *
       * **The statement decides whether to stamp `section_started_at`, not
       * the caller.** `section_started_at` is the one thing a per-section
       * deadline cannot be derived from, and re-stamping it on every save
       * inside a section would hand the candidate an unlimited section — so
       * the stamp is conditional on `max_index < sectionStartsAt`, the flat
       * index that the target's section begins at, evaluated against the
       * **committed** row. A caller deciding it in JS from its own read
       * loses the race: two tabs that both read `max_index = 0` and target
       * different indices in the same later section (A→5, B→7) each satisfy
       * `max_index < maxIndex`, and the second would re-stamp the column
       * with its own `now` and extend the section's clock.
       */
      advance?: { maxIndex: number; sectionStartsAt: number; sectionStartedAt: number };
    },
  ): Promise<{ stored: boolean; advanced?: boolean }> => {
    const upsert = {
      sql:
        "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (attempt_id, question_id) DO UPDATE SET " +
        "value_json = excluded.value_json, saved_at = excluded.saved_at, client_seq = excluded.client_seq " +
        "WHERE excluded.client_seq > response.client_seq",
      params: [
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
    };

    const advance = input.advance;
    if (!advance) {
      const { changes } = await db.run(upsert.sql, upsert.params);
      return { stored: changes > 0 };
    }

    // `AND max_index < ?` is what makes "max_index never falls" a property
    // of the statement rather than of the caller reading first: two saves
    // racing from two tabs cannot reopen a question the lock has passed.
    const [response, progress] = await db.batch([
      upsert,
      {
        sql:
          "UPDATE attempt SET max_index = ?, " +
          "section_started_at = CASE WHEN max_index < ? THEN ? ELSE section_started_at END " +
          "WHERE workspace_id = ? AND id = ? AND max_index < ?",
        params: [
          advance.maxIndex,
          advance.sectionStartsAt,
          advance.sectionStartedAt,
          workspaceId,
          input.attemptId,
          advance.maxIndex,
        ],
      },
    ]);
    if (response === undefined || progress === undefined) {
      throw new Error("batch() answered no result for the response upsert");
    }
    /**
     * `advanced` is the **progress statement's own** outcome, returned only
     * when an advance was asked for. It is not a tidier `stored`: the two
     * statements are guarded by different things, so a save can store and
     * not advance (another tab already committed a higher `max_index`, so
     * `max_index < ?` no-ops) or advance and not store (a stale
     * `client_seq`). A caller that reports `max_index` back to the browser
     * off its own pre-read row reports a number the row may not hold —
     * see `attempt.ts`.
     */
    return { stored: response.changes > 0, advanced: progress.changes > 0 };
  },
);

/**
 * Stamps the end of an attempt. `WHERE submitted_at IS NULL` so the first
 * writer wins: a candidate pressing Submit at the same moment the server
 * materialises a timeout must not have their reason overwritten.
 *
 * Phase 6 Task 9 mints it for `submit_reason = "timeout"` — there is no
 * sweeper in this phase (nothing here gets a Cron Trigger), so an attempt
 * whose candidate closed the tab is submitted the next time anything reads
 * it. Task 11's candidate-pressed submission is the same statement with a
 * different reason **and the score in the same `SET`**: that is what makes
 * "the client at zero, the timeout materialisation and a double-click
 * cannot produce two scores" a property of one statement rather than of
 * the order two callers happen to run in.
 *
 * `score` and `flag` are optional because Task 9's materialisation stamps
 * the end of an attempt it has not scored; omitting them leaves both
 * columns exactly as they were.
 */
export const finishAttempt = scoped(
  "finishAttempt",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      attemptId: string;
      submittedAt: number;
      reason: string;
      /** `AttemptScore`, as stored. `unknown` here because
       *  `packages/db` does not depend on the grading engine's shape. */
      score?: unknown;
      /** The organiser-facing marker, when this submission raised one —
       *  `"scoring_blocked"` for a question whose pattern the bound
       *  refused (#129). */
      flag?: string;
    },
  ): Promise<{ submitted: boolean }> => {
    const sets = ["submitted_at = ?", "submit_reason = ?"];
    const params: unknown[] = [input.submittedAt, input.reason];
    if (input.score !== undefined) {
      sets.push("score_json = ?");
      params.push(db.jsonParam(input.score));
    }
    if (input.flag !== undefined) {
      sets.push("flag = ?");
      params.push(input.flag);
    }
    const { changes } = await db.run(
      `UPDATE attempt SET ${sets.join(", ")} ` +
        "WHERE workspace_id = ? AND id = ? AND submitted_at IS NULL",
      [...params, workspaceId, input.attemptId],
    );
    return { submitted: changes > 0 };
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

/**
 * `Q7a`/`Q2`: the server-side violation count a candidate's response is
 * judged by — every stored event whose type `isViolation()` admits, for
 * this attempt. One statement, reading only the `type` column, so a long
 * attempt's event history is never pulled over the wire for its own sake.
 *
 * `type` is stored as `string` — `appendEvents` writes whatever its caller
 * sends — but every row the ingest route writes was validated against
 * `PROCTORING_EVENTS` before the insert, so the cast here is a boundary
 * cast on trusted data, not a narrowing of what the column can hold.
 */
export const countViolations = scoped(
  "countViolations",
  async (db: DbClient, workspaceId: string, attemptId: string): Promise<number> => {
    const rows = await db.query<{ type: string }>(
      "SELECT type FROM event WHERE workspace_id = ? AND attempt_id = ?",
      [workspaceId, attemptId],
    );
    return rows.filter((row) => isViolation(row.type as ProctoringEventType)).length;
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
