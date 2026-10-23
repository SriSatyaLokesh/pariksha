// Candidates, attempts, responses and events — the candidate runtime's data.
//
// This module owns the hottest path in the product: saving one answer. ADR
// 0002 budgets it at one D1 write plus at most one R2 call, so `upsertResponse`
// is a single statement and nothing here loops a query over questions.

import { FAILURE_EVENTS, VIOLATION_EVENTS, type ProctoringEventType } from "@pariksha/core";
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

/** Review finding 8: `VIOLATION_EVENTS` as SQL placeholders — generated
 *  once from the same set `isViolation()` reads, so the violation
 *  vocabulary still has exactly one definition. */
const VIOLATION_TYPES = [...VIOLATION_EVENTS];
const VIOLATION_PLACEHOLDERS = VIOLATION_TYPES.map(() => "?").join(", ");

/**
 * `Q7a`/`Q2`: the server-side violation count a candidate's response is
 * judged by. Review finding 8: this used to `SELECT type` for every event
 * row the attempt ever had and filter in JS — a result set that grows with
 * the attempt's whole history and was pulled over the wire on every
 * `GET /api/v1/run/attempt` and every ingest POST, to count a number
 * bounded by 5. One `COUNT(*)`, one row back, same one subrequest
 * (`event_attempt_idx` already covers it) — the projection was the
 * problem, not the index.
 */
export const countViolations = scoped(
  "countViolations",
  async (db: DbClient, workspaceId: string, attemptId: string): Promise<number> => {
    const rows = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM event WHERE workspace_id = ? AND attempt_id = ? AND type IN (${VIOLATION_PLACEHOLDERS})`,
      [workspaceId, attemptId, ...VIOLATION_TYPES],
    );
    return Number(rows[0]?.n ?? 0);
  },
);

/**
 * Phase 7e Task 5 (`Q6`): `integrityFor`'s (`@pariksha/core`) own event
 * input — the subset of an attempt's events the flag can possibly care
 * about, not its whole history. `VIOLATION_EVENTS ∪ FAILURE_EVENTS` is 10 of
 * `PROCTORING_EVENTS`' 17; the other 7 (restores, lifecycle markers,
 * `noise_above_threshold`, the identity capture) never move `integrityFor`'s
 * output, so there is no reason to pull them over the wire on every
 * recompute — the same reasoning `countViolations`' own header gives for
 * not projecting a whole attempt's event history to count a number bounded
 * by a handful of rows.
 */
const INTEGRITY_EVENT_TYPES = [...VIOLATION_EVENTS, ...FAILURE_EVENTS];
const INTEGRITY_EVENT_PLACEHOLDERS = INTEGRITY_EVENT_TYPES.map(() => "?").join(", ");

export const listIntegrityEvents = scoped(
  "listIntegrityEvents",
  async (
    db: DbClient,
    workspaceId: string,
    attemptId: string,
  ): Promise<{ type: ProctoringEventType; detail: unknown }[]> => {
    const rows = await db.query<{ type: string; detail_json: unknown }>(
      `SELECT type, detail_json FROM event WHERE workspace_id = ? AND attempt_id = ? ` +
        `AND type IN (${INTEGRITY_EVENT_PLACEHOLDERS})`,
      [workspaceId, attemptId, ...INTEGRITY_EVENT_TYPES],
    );
    return rows.map((row) => ({
      type: row.type as ProctoringEventType,
      detail: row.detail_json === null ? undefined : db.jsonValue(row.detail_json),
    }));
  },
);

/**
 * `integrityFor`'s other input, reduced to the two facts it actually reads
 * off a snapshot row: how many there are (`snapshots.length`, for the
 * silent-shortfall check) and how many show more than one face
 * (`multiFaceCount`, for the `high_risk` threshold). `face_count` is always
 * `null` today (`Q3`: face detection is pre-cut), so `multiFaceCount` is
 * always 0 — the field and the threshold exist for the reader that
 * eventually writes a real count.
 *
 * Branch-review M1: used to project every `face_count` row and let the
 * caller filter in JS — one row per snapshot instead of the one row this
 * aggregate returns. `recomputeIntegrity` (`apps/api/src/run/submit.ts`)
 * reconstructs the minimal array `integrityFor`'s pure signature expects
 * from these two numbers, rather than this function's own shape changing
 * what `integrityFor` (and its own, already-sound test suite) takes.
 */
export const listSnapshotFaceCounts = scoped(
  "listSnapshotFaceCounts",
  async (
    db: DbClient,
    workspaceId: string,
    attemptId: string,
  ): Promise<{ count: number; multiFaceCount: number }> => {
    const rows = await db.query<{ n: number; multi: number }>(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN face_count > 1 THEN 1 ELSE 0 END) AS multi " +
        "FROM snapshot WHERE workspace_id = ? AND attempt_id = ?",
      [workspaceId, attemptId],
    );
    const row = rows[0];
    return { count: Number(row?.n ?? 0), multiFaceCount: Number(row?.multi ?? 0) };
  },
);

/**
 * Phase 7e Task 1 fix round (F2, Major): `violationOutcome`'s own
 * `alreadyActioned` input, made atomic. The ingest route used to `SELECT
 * COUNT(*)` for "has this already fired" and, several lines later, `INSERT`
 * the marker — a plain read-then-write race: two concurrent posts for the
 * same attempt, both past the limit, could both read "not yet" and both
 * fire (auto-submitting or locking a candidate twice once Tasks 2/3 wire
 * those actions to this outcome).
 *
 * This is one statement instead: the `violation_limit_reached` marker is
 * attempted unconditionally, and `event_violation_limit_uq` (migration
 * 0010) — a unique index on `event(attempt_id)` filtered to this one event
 * type — is the conflict target `ON CONFLICT … DO NOTHING` names. Whichever
 * of two concurrent inserts the database serialises first is the only one
 * that ever gets a row back; the loser's `RETURNING` is empty. `claimed`
 * *is* "did this call just become the first one to reach the limit" —
 * there is no separate read to go stale between it and the write, because
 * there is no separate read.
 *
 * The caller still gates this on `violations >= limit` itself (`routes/
 * proctoring.ts`) — this function does not re-check that, the same way
 * `countViolations` does not decide anything either, it only counts.
 */
export const claimViolationLimit = scoped(
  "claimViolationLimit",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string; now: number },
  ): Promise<{ claimed: boolean }> => {
    const rows = await db.query<{ id: string }>(
      "INSERT INTO event (id, workspace_id, attempt_id, type, detail_json, client_ts, server_ts) " +
        "VALUES (?, ?, ?, ?, NULL, ?, ?) " +
        "ON CONFLICT (attempt_id) WHERE type = 'violation_limit_reached' DO NOTHING " +
        "RETURNING id",
      [
        newId("evt"),
        workspaceId,
        input.attemptId,
        "violation_limit_reached" satisfies ProctoringEventType,
        input.now,
        input.now,
      ],
    );
    return { claimed: rows.length > 0 };
  },
);

/**
 * Phase 7e Task 3 (`E-R1`): the lock itself — `locked_at`, nullable,
 * migration 0011. The caller (`routes/proctoring.ts`'s ingest) reaches
 * this only once per attempt: `claimViolationLimit` above is the atomic
 * claim that decides "has the limit already fired", and this function does
 * not re-decide that — the same division `claimViolationLimit`'s own doc
 * comment draws between deciding and counting. No second idempotency
 * check is built here on top of it.
 *
 * `WHERE submitted_at IS NULL AND locked_at IS NULL` is defence in depth,
 * not the thing that makes "once" true — it mirrors `finishAttempt`'s own
 * `WHERE submitted_at IS NULL` idiom so a caller that somehow reached this
 * twice (or reached it for an attempt that finished between the route's own
 * `attempt.submittedAt === null` check and this write) still cannot lock a
 * submitted attempt or re-stamp an already-locked one. `locked` reports
 * whether this call is the one that actually wrote it, the same shape
 * `finishAttempt`'s own `{ submitted }` already answers with.
 */
export const lockAttempt = scoped(
  "lockAttempt",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string; now: number },
  ): Promise<{ locked: boolean }> => {
    const { changes } = await db.run(
      "UPDATE attempt SET locked_at = ? " +
        "WHERE workspace_id = ? AND id = ? AND submitted_at IS NULL AND locked_at IS NULL",
      [input.now, workspaceId, input.attemptId],
    );
    return { locked: changes > 0 };
  },
);

/**
 * Phase 7e Task 4 (`Q5a`): the organiser's one read — a locked attempt's
 * candidate label, lock time, violation count and remaining time, for the
 * one test this read is scoped to. Joined on `candidate` (not
 * `test_version`, which `attempt` itself points at) because `candidate.
 * test_id` is the direct column every attempt's own candidate carries —
 * one join, not two.
 *
 * `violations` is a correlated subquery rather than a second round trip,
 * the same "flat in row count" shape `invites.ts`'s own batch is: ten
 * locked attempts cost the same one statement as one.
 */
export interface LockedAttemptRecord {
  attemptId: string;
  candidateLabel: string;
  lockedAt: number;
  deadlineAt: number;
  violations: number;
}

export const listLockedAttempts = scoped(
  "listLockedAttempts",
  async (db: DbClient, workspaceId: string, testId: string): Promise<LockedAttemptRecord[]> => {
    const rows = await db.query<{
      id: string;
      locked_at: number;
      deadline_at: number;
      external_id: string | null;
      candidate_id: string;
      violations: number;
    }>(
      "SELECT a.id, a.locked_at, a.deadline_at, c.external_id, c.id AS candidate_id, " +
        `(SELECT COUNT(*) FROM event e WHERE e.workspace_id = a.workspace_id AND e.attempt_id = a.id ` +
        `AND e.type IN (${VIOLATION_PLACEHOLDERS})) AS violations ` +
        "FROM attempt a JOIN candidate c ON c.id = a.candidate_id " +
        "WHERE a.workspace_id = ? AND c.test_id = ? AND a.locked_at IS NOT NULL " +
        "ORDER BY a.locked_at DESC",
      [...VIOLATION_TYPES, workspaceId, testId],
    );
    return rows.map((row) => ({
      attemptId: row.id,
      // The candidate's identity column — the same fallback `emailOf`'s own
      // header documents (`apps/api/src/import/candidates.ts`): a
      // self-registered candidate (Task 3's `createCandidate`) carries no
      // `external_id` at all, so the row id is what is left to show.
      candidateLabel: row.external_id ?? row.candidate_id,
      lockedAt: Number(row.locked_at),
      deadlineAt: Number(row.deadline_at),
      violations: Number(row.violations),
    }));
  },
);

/**
 * Phase 7e Task 4: the one existence-and-scope read the unlock route needs
 * before it writes — whether `attemptId` names a real attempt belonging to
 * `testId` in this workspace, and whether it is currently locked. Kept
 * separate from `unlockAttempt`'s own write below (rather than folding the
 * `testId` scope into that `UPDATE`'s `WHERE`) because the two failures read
 * differently to a caller: no such attempt on this test is 404, and an
 * attempt that exists but is not locked is 409 — `invites.ts`'s own
 * existence-check-then-write shape, not a new one.
 */
export const getAttemptLockState = scoped(
  "getAttemptLockState",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string; testId: string },
  ): Promise<{ lockedAt: number | null } | null> => {
    const rows = await db.query<{ locked_at: number | null }>(
      "SELECT a.locked_at FROM attempt a JOIN candidate c ON c.id = a.candidate_id " +
        "WHERE a.workspace_id = ? AND a.id = ? AND c.test_id = ?",
      [workspaceId, input.attemptId, input.testId],
    );
    const row = rows[0];
    if (!row) return null;
    return { lockedAt: row.locked_at === null ? null : Number(row.locked_at) };
  },
);

/**
 * Phase 7e Task 4 (`Q5a`/`Q5c`): the only way out of a lock. The mirror of
 * `lockAttempt` above — same `UPDATE`, same defence-in-depth `WHERE`, same
 * `{ unlocked }` shape — and, like that function, not a second idempotency
 * check of its own: the route calls `getAttemptLockState` first for the 404
 * and 409 this needs, and this statement only writes once that is settled.
 *
 * Touches `locked_at` and nothing else. `deadline_at` is not in this
 * `UPDATE`'s `SET` list, which is `Q5c`'s "no refund" ruling made structural
 * rather than merely documented: there is no code path here that could
 * extend an attempt's clock even by accident.
 */
export const unlockAttempt = scoped(
  "unlockAttempt",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string },
  ): Promise<{ unlocked: boolean }> => {
    const { changes } = await db.run(
      "UPDATE attempt SET locked_at = NULL " + "WHERE workspace_id = ? AND id = ? AND locked_at IS NOT NULL",
      [workspaceId, input.attemptId],
    );
    return { unlocked: changes > 0 };
  },
);

/**
 * `Q4f`: call this only after the object `input.storageKey` names has
 * actually been written — that ordering is the route's job, not this
 * function's, the same way `upsertResponse` trusts its caller on sequencing.
 * A `put` that fails must never reach this far.
 *
 * `faceCount` is written `null`, always: `Q3` pre-cut on-device face
 * counting, so nothing here ever has a number to put in it.
 *
 * `reason` is `string`, not a closed union — the same trust boundary
 * `appendEvents`'s `type` draws. The route validates the three allowed
 * values (`interval` / `violation` / `identity`) before this is ever
 * called, so a bad value here would be this package's own bug, not a
 * candidate's input reaching the database unchecked.
 */
export const recordSnapshot = scoped(
  "recordSnapshot",
  async (
    db: DbClient,
    workspaceId: string,
    input: { attemptId: string; storageKey: string; takenAt: number; reason: string },
  ): Promise<void> => {
    await db.run(
      "INSERT INTO snapshot (id, workspace_id, attempt_id, storage_key, taken_at, reason, face_count) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      [newId("snp"), workspaceId, input.attemptId, input.storageKey, input.takenAt, input.reason, null],
    );
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
