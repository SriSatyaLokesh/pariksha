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
// signing themselves up (`createCandidate`, repo/attempts.ts). That
// discriminator is the whole reason a re-upload is safe: it replaces every
// row it owns and touches nobody who has already registered.

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
  created_at: number;
}

const COLUMNS = "id, test_id, external_id, set_label, source, form_values_json, consent_version, created_at";

const toCandidateRow = (db: DbClient, row: CandidateRecord): CandidateRow => ({
  id: row.id,
  testId: row.test_id,
  externalId: row.external_id,
  setLabel: row.set_label,
  formValues: row.form_values_json == null ? {} : db.jsonValue(row.form_values_json),
  // Cast: a plain text column with exactly two writers, both in this
  // repository — `replaceCandidateList` below and `createCandidate`.
  source: row.source as CandidateSource,
  consentVersion: row.consent_version,
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
      `SELECT ${COLUMNS} FROM candidate WHERE workspace_id = ? AND test_id = ?${where} ORDER BY created_at, id`,
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
 * Replaces the whole uploaded list for this test, in one `db.batch` — one
 * `DELETE … WHERE source = 'list'` plus the inserts, so it is a single
 * subrequest on D1 however many rows the file had, and a half-replaced
 * list cannot exist. A row a candidate wrote for themselves
 * (`source: "registration"`) is never touched.
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
        sql: "DELETE FROM candidate WHERE workspace_id = ? AND test_id = ? AND source = ?",
        params: [workspaceId, testId, "list"],
      },
      ...rows.map((row) => ({
        sql:
          "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, " +
          "form_values_json, consent_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)",
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
