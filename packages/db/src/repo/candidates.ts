// The candidate list (Task 9, #60 / #56, P5.7b).
//
// These are the rows Phase 6 mints invite links against and matches
// registrations to. **Phase 5 mints nothing**: there is no token column
// here, and `POST /tests/{id}/invites`, the single-use signed token, its
// hash and its expiry are Phase 6's — the token's hashing and lifetime
// belong to the runtime that consumes them, and `S-06` is written about
// attempt tokens rather than list rows.
//
// Two kinds of row share the table, told apart by `source`. A `"list"` row
// came from an upload; a `"registration"` row came from a candidate
// signing themselves up (`createCandidate`, repo/attempts.ts).
//
// **A re-upload replaces every `"list"` row and touches no registration —
// and that is not yet the same as being safe** (whole-branch security
// review, L3). `replaceCandidateList` deletes `WHERE source = 'list'` and
// then inserts, while the table carries `(test_id, external_id)` unique
// (migration `0005`). A registration row correctly survives the delete,
// so its `external_id` is still in the index when the insert for the same
// candidate arrives: the batch violates the constraint, nothing is
// written, and the route answers 500 rather than a positioned issue.
// Inert in Phase 5, because nothing writes a `registration` row yet.
// **Phase 6 must fix this before it adds registration** — either widen the
// delete to `source = 'list' OR external_id IN (…)`, or upsert — so that
// the property this comment claims is the property the SQL has.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export type CandidateSource = "list" | "registration";

export interface CandidateRow {
  id: string;
  testId: string;
  /** The value of the test's first `unique: true` registration field for
   *  this row — the key an invite is minted against and a registration
   *  matched to. Null for a self-registration that matched no list row. */
  externalId: string | null;
  /** The CSV's `set` column: a set *label* ("A"), not `attempt.set_no`. */
  setLabel: string | null;
  /** Prefill, keyed by registration field id. */
  formValues: Record<string, unknown>;
  source: CandidateSource;
  consentVersion: string | null;
  /** `candidate.consent_at`: when this person accepted the consent text,
   *  and therefore **the** definition of registered. Null for a list row
   *  nobody has claimed yet. */
  registeredAt: number | null;
  createdAt: number;
}

export interface NewCandidate {
  externalId: string;
  setLabel: string | null;
  formValues: Record<string, unknown>;
}

interface CandidateRecord {
  id: string;
  test_id: string;
  external_id: string | null;
  set_label: string | null;
  source: string;
  form_values_json: unknown;
  consent_version: string | null;
  consent_at: number | null;
  created_at: number;
}

const COLUMNS =
  "id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at";

const toCandidateRow = (db: DbClient, row: CandidateRecord): CandidateRow => ({
  id: row.id,
  testId: row.test_id,
  externalId: row.external_id,
  setLabel: row.set_label,
  formValues: row.form_values_json == null ? {} : db.jsonValue(row.form_values_json),
  // Cast: a plain text column with three writers, all in this repository
  // — `replaceCandidateList` below, `registerCandidate` (repo/run.ts) and
  // `createCandidate` (repo/attempts.ts).
  source: row.source as CandidateSource,
  consentVersion: row.consent_version,
  registeredAt: row.consent_at == null ? null : Number(row.consent_at),
  createdAt: Number(row.created_at),
});

export const listCandidates = scoped(
  "listCandidates",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    filter: { source?: CandidateSource } = {},
  ): Promise<CandidateRow[]> => {
    const where = filter.source === undefined ? "" : " AND source = ?";
    const params = filter.source === undefined ? [workspaceId, testId] : [workspaceId, testId, filter.source];
    const rows = await db.query<CandidateRecord>(
      // `external_id` before `id`: every row of one upload shares a
      // `created_at`, so without it the order a list is read back in is
      // the random `cnd_` ids and changes on every re-upload. Alphabetical
      // within an upload is both stable and the order a person reading a
      // candidate list expects.
      `SELECT ${COLUMNS} FROM candidate WHERE workspace_id = ? AND test_id = ?${where} ` +
        "ORDER BY created_at, external_id, id",
      params,
    );
    return rows.map((row) => toCandidateRow(db, row));
  },
);

/** Phase 6's `invite_only` gate reads this to turn the identity a candidate
 *  typed into the list row an invite was minted for. */
export const getCandidateByExternalId = scoped(
  "getCandidateByExternalId",
  async (db: DbClient, workspaceId: string, testId: string, externalId: string): Promise<CandidateRow | null> => {
    const rows = await db.query<CandidateRecord>(
      `SELECT ${COLUMNS} FROM candidate WHERE workspace_id = ? AND test_id = ? AND external_id = ?`,
      [workspaceId, testId, externalId],
    );
    const row = rows[0];
    return row === undefined ? null : toCandidateRow(db, row);
  },
);

/** The same row by its own id — what Phase 6's registration reads to tell
 *  "this list row is free" from "someone has already registered on it"
 *  before it writes anything (`consent_at`, exposed as `registeredAt`). */
export const getCandidateById = scoped(
  "getCandidateById",
  async (db: DbClient, workspaceId: string, testId: string, candidateId: string): Promise<CandidateRow | null> => {
    const rows = await db.query<CandidateRecord>(
      `SELECT ${COLUMNS} FROM candidate WHERE workspace_id = ? AND test_id = ? AND id = ?`,
      [workspaceId, testId, candidateId],
    );
    const row = rows[0];
    return row === undefined ? null : toCandidateRow(db, row);
  },
);

/**
 * The two numbers Task 13's `candidate_list_empty` and `candidate_no_set`
 * advisory rows are about, in one query — the checklist is computed
 * server-side from facts, and fetching every row to count two of them
 * would put a list's worth of personal data through a path that needs
 * neither.
 */
export const countCandidates = scoped(
  "countCandidates",
  async (db: DbClient, workspaceId: string, testId: string): Promise<{ total: number; withoutSet: number }> => {
    const rows = await db.query<{ total: number; without_set: number }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN set_label IS NULL THEN 1 ELSE 0 END) AS without_set " +
        "FROM candidate WHERE workspace_id = ? AND test_id = ?",
      [workspaceId, testId],
    );
    const row = rows[0];
    // `SUM` over no rows is NULL in every dialect; `COUNT` is 0.
    return { total: Number(row?.total ?? 0), withoutSet: Number(row?.without_set ?? 0) };
  },
);

/**
 * `countCandidates`'s own two numbers, for every test in the workspace at
 * once — one `GROUP BY test_id`, never one query per test. The readiness
 * aggregate's fourth statement (`apps/api/src/publish/readiness.ts`, `D7c`,
 * Phase 8c Task 5, `K21`). A test absent from the map has no candidate rows
 * at all, the same way `SUM`/`COUNT` over no rows reads in `countCandidates`
 * above.
 */
export const candidateCountsByWorkspace = scoped(
  "candidateCountsByWorkspace",
  async (db: DbClient, workspaceId: string): Promise<Map<string, { total: number; withoutSet: number }>> => {
    const rows = await db.query<{ test_id: string; total: number; without_set: number }>(
      "SELECT test_id, COUNT(*) AS total, SUM(CASE WHEN set_label IS NULL THEN 1 ELSE 0 END) AS without_set " +
        "FROM candidate WHERE workspace_id = ? GROUP BY test_id",
      [workspaceId],
    );
    const map = new Map<string, { total: number; withoutSet: number }>();
    for (const row of rows) {
      map.set(row.test_id, { total: Number(row.total), withoutSet: Number(row.without_set) });
    }
    return map;
  },
);

/**
 * Replaces the uploaded list for this test, in one `db.batch` — so it is a
 * single subrequest on D1 however many rows the file had, and a
 * half-replaced list cannot exist.
 *
 * **Replace means "replace what nobody has claimed".** The delete is
 * `source = 'list' AND consent_at IS NULL` and the inserts are
 * `ON CONFLICT (test_id, external_id) DO NOTHING`, which is the property
 * `AccessPanel.tsx` already promises ("Candidates who have already
 * registered are kept") and the only one of the three candidate fixes that
 * loses nothing:
 *
 *   * a registered candidate's typed `form_values_json`, their consent and
 *     the row `attempt.candidate_id` points at are untouched — a widened
 *     delete would orphan every running attempt;
 *   * their `set_label` is untouched, so the row cannot disagree with the
 *     `set_no` their attempt already pinned — `DO UPDATE` would rewrite
 *     it mid-window;
 *   * an unregistered row absent from the new file is gone, so "replace"
 *     still means replace for everyone it can.
 *
 * The one thing this deliberately cannot do is move a registered-but-not-
 * started candidate to another set. That is a proctor action (`R-02`), not
 * an upload side effect.
 *
 * ponytail: `imported` stays the file's own row count, not the number of
 * rows actually written — `db.batch` reports no row counts in any dialect
 * and a second statement to find out would cost the import route a
 * subrequest for a number nothing reads. Upgrade path, when an organiser
 * needs "N already registered, kept as they are": count the intersection
 * before the batch.
 */
export const replaceCandidateList = scoped(
  "replaceCandidateList",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    rows: readonly NewCandidate[],
    now: number,
  ): Promise<{ imported: number }> => {
    await db.batch([
      {
        sql:
          "DELETE FROM candidate WHERE workspace_id = ? AND test_id = ? AND source = ? " +
          "AND consent_at IS NULL",
        params: [workspaceId, testId, "list"],
      },
      ...rows.map((row) => ({
        sql:
          "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, " +
          "form_values_json, consent_version, consent_at, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?) " +
          "ON CONFLICT (test_id, external_id) DO NOTHING",
        params: [
          newId("cnd"),
          workspaceId,
          testId,
          row.externalId,
          row.setLabel,
          "list",
          db.jsonParam(row.formValues),
          now,
        ],
      })),
    ]);
    return { imported: rows.length };
  },
);
