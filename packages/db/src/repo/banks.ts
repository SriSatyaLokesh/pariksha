// Question banks and the questions inside them.
//
// `listQuestions` resolves every filter in one SQL statement — type,
// difficulty, tag, "not used in any test" and the cursor are all WHERE
// clauses, never a query per row — and `usedInTests` is a correlated
// subquery for the same reason: SQLite and Postgres both evaluate it inside
// the single round trip this process makes to the database, so it costs one
// subrequest against the Workers budget no matter how many rows come back.
//
// There is no `test_question` junction table (0003_absent_hemingway.sql adds
// none), so "is this question used by a published test" is answered by
// searching `test_version.sections_json` for the question's own ID — the ID
// `response.question_id` already stores, per `select.ts`'s `findQuestion`
// and the fixed/sets sources in packages/core/src/types.ts. `CAST(... AS
// TEXT)` rather than a dialect-specific JSON operator keeps the one query
// portable across SQLite's text column and Postgres's jsonb one.
//
// `SourcePool` (packages/core/src/types.ts) is the exception: a pool section
// carries `bank` + `count` + `filter` and no question IDs at all — it draws
// from the whole bank at grading time. So a question is also "used" when a
// published version's sections name its `bank_id` directly, with no
// question ID in sight, and every usage check below carries that second
// arm. Fixture-review finding 1: a prior version of this file matched the
// question ID only, which reported a pool-drawn question as unused and let
// both `deleteQuestion` and `deleteBank` remove it (and the whole bank, via
// `deleteBank`'s cascade) out from under a live published exam.

import type { DbClient } from "../client.js";
import type { Difficulty, PassageGroup, Question, QuestionType } from "@pariksha/core";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";
import { toQuestionDocument, toQuestionRow, type QuestionRecord } from "./question-document.js";

export interface BankRow {
  id: string;
  name: string;
  description: string | null;
  license: string | null;
  tags: string[];
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface QuestionRow {
  id: string;
  bankId: string;
  refId: string;
  document: Question;
  points: number;
  usedInTests: number;
  updatedAt: number;
}

export interface QuestionFilter {
  type?: QuestionType;
  tag?: string;
  difficulty?: Difficulty;
  unused?: boolean;
  search?: string;
  cursor?: string;
  limit?: number;
}

interface BankRecord {
  id: string;
  name: string;
  description: string | null;
  license: string | null;
  tags_json: unknown;
  created_at: number;
  updated_at: number | null;
  question_count: number;
}

/** Every column `QuestionRecord` wants, plus the row's own identity and the
 * derived "used in how many tests" count. */
interface QuestionFullRecord extends QuestionRecord {
  id: string;
  bank_id: string;
  created_at: number;
  updated_at: number | null;
  used_in_tests: number;
}

const BANK_SELECT =
  "SELECT qb.id, qb.name, qb.description, qb.license, qb.tags_json, qb.created_at, qb.updated_at, " +
  "(SELECT COUNT(*) FROM question q WHERE q.workspace_id = qb.workspace_id AND q.bank_id = qb.id) AS question_count " +
  "FROM question_bank qb";

/**
 * True when a published `test_version` row (correlated as `tv`) references
 * the outer `question` row `q` — directly, by `q.id` (a `fixed`/`sets`
 * source), or indirectly, by `q.bank_id` (a `pool` source, which names only
 * a bank). Both arms are substring scans over the same `CAST(...AS TEXT)`
 * blob, so this is still the one correlated subquery `QUESTION_SELECT`'s
 * header describes, not a second round trip.
 */
const TV_REFERENCES_Q_ROW =
  "(CAST(tv.sections_json AS TEXT) LIKE '%' || q.id || '%' " +
  "OR CAST(tv.sections_json AS TEXT) LIKE '%' || q.bank_id || '%')";

const QUESTION_SELECT =
  "SELECT q.id, q.bank_id, q.ref_id, q.group_ref, q.type, q.prompt_md, q.media_json, q.options_json, " +
  "q.key_json, q.scoring_json, q.points, q.difficulty, q.tags_json, q.explanation_md, q.extra_json, " +
  "q.created_at, q.updated_at, " +
  `(SELECT COUNT(DISTINCT tv.test_id) FROM test_version tv WHERE tv.workspace_id = q.workspace_id ` +
  `AND ${TV_REFERENCES_Q_ROW}) AS used_in_tests ` +
  "FROM question q";

function toBankRow(db: DbClient, row: BankRecord): BankRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    license: row.license,
    tags: row.tags_json == null ? [] : db.jsonValue(row.tags_json),
    questionCount: Number(row.question_count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at ?? row.created_at),
  };
}

function toQuestionRowView(db: DbClient, row: QuestionFullRecord): QuestionRow {
  // `tags_json` is NOT NULL, so a tagless question is stored as `'[]'`, not
  // SQL NULL — there is no way for the column itself to tell "no tags" apart
  // from "explicitly an empty array". Collapsing a decoded empty array back
  // to `null` here (fixture-review finding 9, round 2) is what lets
  // `toQuestionDocument`'s existing `tags_json ?? undefined` restore the
  // absence, the same shape `upsertQuestion`'s freshly-built response
  // already returns on POST/PATCH — so a question reads the same way on a
  // GET as it did on the write that just created it.
  const decodedTags = row.tags_json == null ? null : db.jsonValue<string[]>(row.tags_json);
  const record: QuestionRecord = {
    ref_id: row.ref_id,
    group_ref: row.group_ref,
    type: row.type,
    prompt_md: row.prompt_md,
    media_json: row.media_json == null ? null : db.jsonValue(row.media_json),
    options_json: row.options_json == null ? null : db.jsonValue(row.options_json),
    key_json: row.key_json == null ? null : db.jsonValue(row.key_json),
    scoring_json: row.scoring_json == null ? null : db.jsonValue(row.scoring_json),
    points: Number(row.points),
    difficulty: row.difficulty,
    tags_json: decodedTags != null && decodedTags.length === 0 ? null : decodedTags,
    explanation_md: row.explanation_md,
    extra_json: row.extra_json == null ? null : db.jsonValue(row.extra_json),
  };
  return {
    id: row.id,
    bankId: row.bank_id,
    refId: row.ref_id,
    document: toQuestionDocument(record),
    points: Number(row.points),
    usedInTests: Number(row.used_in_tests),
    updatedAt: Number(row.updated_at ?? row.created_at),
  };
}

/** The tests (by name) whose *published* version references `questionId` —
 * directly (a `fixed`/`sets` source naming it) or through `bankId` (a
 * `pool` source drawing from its bank, which names no question ID at all).
 * A draft test is freely editable (T-04), so only `test_version` is
 * consulted — never `test` itself. */
async function testsUsingQuestion(
  db: DbClient,
  workspaceId: string,
  bankId: string,
  questionId: string,
): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "SELECT DISTINCT t.name AS name FROM test_version tv " +
      "JOIN test t ON t.id = tv.test_id AND t.workspace_id = tv.workspace_id " +
      "WHERE tv.workspace_id = ? " +
      "AND (CAST(tv.sections_json AS TEXT) LIKE ? OR CAST(tv.sections_json AS TEXT) LIKE ?)",
    [workspaceId, `%${questionId}%`, `%${bankId}%`],
  );
  return rows.map((row) => row.name);
}

/** The tests (by name) whose published version references `bankId` — either
 * a `pool` source naming the bank directly, or a `fixed`/`sets` source
 * naming one of its questions. One join plus one direct substring check,
 * never one `testsUsingQuestion` call per question. */
async function testsUsingBank(
  db: DbClient,
  workspaceId: string,
  bankId: string,
): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "SELECT DISTINCT t.name AS name FROM test_version tv " +
      "JOIN test t ON t.id = tv.test_id AND t.workspace_id = tv.workspace_id " +
      "WHERE tv.workspace_id = ? AND (" +
      "CAST(tv.sections_json AS TEXT) LIKE ? " +
      "OR EXISTS (SELECT 1 FROM question q WHERE q.workspace_id = tv.workspace_id AND q.bank_id = ? " +
      "AND CAST(tv.sections_json AS TEXT) LIKE '%' || q.id || '%')" +
      ")",
    [workspaceId, `%${bankId}%`, bankId],
  );
  return rows.map((row) => row.name);
}

function encodeCursor(createdAt: number, id: string): string {
  return `${createdAt}:${id}`;
}

function decodeCursor(cursor: string): [number, string] {
  const separator = cursor.indexOf(":");
  return [Number(cursor.slice(0, separator)), cursor.slice(separator + 1)];
}

export const createBank = scoped(
  "createBank",
  async (db: DbClient, workspaceId: string, input: { name: string; now?: number }): Promise<string> => {
    const id = newId("bnk");
    const now = input.now ?? Date.now();
    // UX-02: a name and nothing else is required — every other column
    // starts null or empty, editable later through `updateBank`.
    await db.run(
      "INSERT INTO question_bank (id, workspace_id, name, description, license, groups_json, tags_json, created_at, updated_at) " +
        "VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?)",
      [id, workspaceId, input.name, db.jsonParam([]), now, now],
    );
    return id;
  },
);

export const getBank = scoped(
  "getBank",
  async (db: DbClient, workspaceId: string, bankId: string): Promise<BankRow | null> => {
    const rows = await db.query<BankRecord>(`${BANK_SELECT} WHERE qb.workspace_id = ? AND qb.id = ?`, [
      workspaceId,
      bankId,
    ]);
    const row = rows[0];
    return row ? toBankRow(db, row) : null;
  },
);

export const listBanks = scoped(
  "listBanks",
  async (db: DbClient, workspaceId: string): Promise<BankRow[]> => {
    const rows = await db.query<BankRecord>(`${BANK_SELECT} WHERE qb.workspace_id = ? ORDER BY qb.created_at DESC`, [
      workspaceId,
    ]);
    return rows.map((row) => toBankRow(db, row));
  },
);

export const updateBank = scoped(
  "updateBank",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    patch: { name?: string; description?: string; license?: string; tags?: string[] },
  ): Promise<boolean> => {
    const { changes } = await db.run(
      "UPDATE question_bank SET name = COALESCE(?, name), description = COALESCE(?, description), " +
        "license = COALESCE(?, license), tags_json = COALESCE(?, tags_json), updated_at = ? " +
        "WHERE workspace_id = ? AND id = ?",
      [
        patch.name ?? null,
        patch.description ?? null,
        patch.license ?? null,
        patch.tags === undefined ? null : db.jsonParam(patch.tags),
        Date.now(),
        workspaceId,
        bankId,
      ],
    );
    return changes > 0;
  },
);

export const deleteBank = scoped(
  "deleteBank",
  async (db: DbClient, workspaceId: string, bankId: string): Promise<{ deleted: boolean; blockedBy: string[] }> => {
    const blockedBy = await testsUsingBank(db, workspaceId, bankId);
    if (blockedBy.length > 0) return { deleted: false, blockedBy };

    await db.run("DELETE FROM question WHERE workspace_id = ? AND bank_id = ?", [workspaceId, bankId]);
    const { changes } = await db.run("DELETE FROM question_bank WHERE workspace_id = ? AND id = ?", [
      workspaceId,
      bankId,
    ]);
    return { deleted: changes > 0, blockedBy: [] };
  },
);

export const listQuestions = scoped(
  "listQuestions",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    filter: QuestionFilter = {},
  ): Promise<{ rows: QuestionRow[]; cursor?: string }> => {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const clauses = ["q.workspace_id = ?", "q.bank_id = ?"];
    const params: unknown[] = [workspaceId, bankId];

    if (filter.type) {
      clauses.push("q.type = ?");
      params.push(filter.type);
    }
    if (filter.difficulty) {
      clauses.push("q.difficulty = ?");
      params.push(filter.difficulty);
    }
    if (filter.tag) {
      clauses.push("CAST(q.tags_json AS TEXT) LIKE ?");
      params.push(`%"${filter.tag}"%`);
    }
    if (filter.search) {
      clauses.push("q.prompt_md LIKE ?");
      params.push(`%${filter.search}%`);
    }
    if (filter.unused) {
      clauses.push(
        `NOT EXISTS (SELECT 1 FROM test_version tv WHERE tv.workspace_id = q.workspace_id AND ${TV_REFERENCES_Q_ROW})`,
      );
    }
    if (filter.cursor) {
      const [createdAt, id] = decodeCursor(filter.cursor);
      clauses.push("(q.created_at > ? OR (q.created_at = ? AND q.id > ?))");
      params.push(createdAt, createdAt, id);
    }

    // One extra row fetched, never returned, to know a next page exists
    // without a second COUNT(*) round trip.
    const rows = await db.query<QuestionFullRecord>(
      `${QUESTION_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY q.created_at ASC, q.id ASC LIMIT ?`,
      [...params, limit + 1],
    );

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(Number(last.created_at), last.id) : null;

    return {
      rows: page.map((row) => toQuestionRowView(db, row)),
      ...(nextCursor === null ? {} : { cursor: nextCursor }),
    };
  },
);

export const getQuestion = scoped(
  "getQuestion",
  async (db: DbClient, workspaceId: string, bankId: string, questionId: string): Promise<QuestionRow | null> => {
    const rows = await db.query<QuestionFullRecord>(
      `${QUESTION_SELECT} WHERE q.workspace_id = ? AND q.bank_id = ? AND q.id = ?`,
      [workspaceId, bankId, questionId],
    );
    const row = rows[0];
    return row ? toQuestionRowView(db, row) : null;
  },
);

/**
 * Writes the Markdown document. There is no second representation to keep
 * in step (ADR 0004).
 *
 * Returns the row it just wrote — `document`, `points` and `updatedAt` are
 * built from `doc`/`now` with no extra read, and `usedInTests` costs the one
 * query `testsUsingQuestion` already needs — so a caller (the API route)
 * that wants the fresh row back never has to issue its own follow-up
 * `getQuestion`, which would re-read the exact row this statement just
 * wrote.
 */
export const upsertQuestion = scoped(
  "upsertQuestion",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    doc: Question,
    now: number,
  ): Promise<{ id: string; created: boolean; row: QuestionRow }> => {
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM question WHERE workspace_id = ? AND bank_id = ? AND ref_id = ?",
      [workspaceId, bankId, doc.id],
    );
    const row = toQuestionRow(doc);
    // The column is NOT NULL; the pure mapper's `null` (no `tags` field on
    // the document, finding 9) is coerced to `[]` only here, at the SQL
    // boundary, so the round-trip identity the mapper promises never leaks
    // into a column that cannot hold it.
    const tagsJson = db.jsonParam(row.tags_json ?? []);
    const current = existing[0];
    const id = current?.id ?? newId("qst");

    if (current) {
      await db.run(
        "UPDATE question SET group_ref = ?, type = ?, prompt_md = ?, media_json = ?, options_json = ?, " +
          "key_json = ?, scoring_json = ?, points = ?, difficulty = ?, tags_json = ?, explanation_md = ?, " +
          "extra_json = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [
          row.group_ref,
          row.type,
          row.prompt_md,
          row.media_json == null ? null : db.jsonParam(row.media_json),
          row.options_json == null ? null : db.jsonParam(row.options_json),
          row.key_json == null ? null : db.jsonParam(row.key_json),
          row.scoring_json == null ? null : db.jsonParam(row.scoring_json),
          row.points,
          row.difficulty,
          tagsJson,
          row.explanation_md,
          row.extra_json == null ? null : db.jsonParam(row.extra_json),
          now,
          workspaceId,
          current.id,
        ],
      );
    } else {
      await db.run(
        "INSERT INTO question (id, workspace_id, bank_id, ref_id, group_ref, type, prompt_md, media_json, " +
          "options_json, key_json, scoring_json, points, difficulty, tags_json, explanation_md, extra_json, " +
          "version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          workspaceId,
          bankId,
          row.ref_id,
          row.group_ref,
          row.type,
          row.prompt_md,
          row.media_json == null ? null : db.jsonParam(row.media_json),
          row.options_json == null ? null : db.jsonParam(row.options_json),
          row.key_json == null ? null : db.jsonParam(row.key_json),
          row.scoring_json == null ? null : db.jsonParam(row.scoring_json),
          row.points,
          row.difficulty,
          tagsJson,
          row.explanation_md,
          row.extra_json == null ? null : db.jsonParam(row.extra_json),
          1,
          now,
          now,
        ],
      );
    }

    const usedInTests = (await testsUsingQuestion(db, workspaceId, bankId, id)).length;
    return {
      id,
      created: !current,
      row: {
        id,
        bankId,
        refId: row.ref_id,
        document: toQuestionDocument(row),
        points: row.points,
        usedInTests,
        updatedAt: now,
      },
    };
  },
);

export const upsertQuestions = scoped(
  "upsertQuestions",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    docs: readonly Question[],
    now: number,
  ): Promise<{ ids: string[] }> => {
    // ponytail: sequential single-row writes — each question is its own
    // SELECT-then-INSERT/UPDATE through `upsertQuestion`, so a bank of N
    // questions spends roughly 2N subrequests against the 50-subrequest
    // Workers ceiling. That is fine for the handful of questions this task's
    // screens write at once; Task 7 (bulk import) adds `DbClient.batch()`
    // and rewires this to cost one round trip regardless of N.
    const ids: string[] = [];
    for (const doc of docs) {
      const { id } = await upsertQuestion(db, workspaceId, bankId, doc, now);
      ids.push(id);
    }
    return { ids };
  },
);

export const deleteQuestion = scoped(
  "deleteQuestion",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    questionId: string,
  ): Promise<{ deleted: boolean; blockedBy: string[] }> => {
    const blockedBy = await testsUsingQuestion(db, workspaceId, bankId, questionId);
    if (blockedBy.length > 0) return { deleted: false, blockedBy };

    const { changes } = await db.run("DELETE FROM question WHERE workspace_id = ? AND bank_id = ? AND id = ?", [
      workspaceId,
      bankId,
      questionId,
    ]);
    return { deleted: changes > 0, blockedBy: [] };
  },
);

export const listWorkspaceTags = scoped(
  "listWorkspaceTags",
  async (db: DbClient, workspaceId: string): Promise<string[]> => {
    // ponytail: unions `tags_json` from both tables in memory rather than
    // maintaining a normalised `workspace_tag` table. Fine until a
    // workspace's question-and-bank count makes this scan slow, at which
    // point that table is the upgrade path.
    const rows = await db.query<{ tags_json: unknown }>(
      "SELECT tags_json FROM question WHERE workspace_id = ? " +
        "UNION ALL SELECT tags_json FROM question_bank WHERE workspace_id = ?",
      [workspaceId, workspaceId],
    );
    const tags = new Set<string>();
    for (const row of rows) {
      const list = row.tags_json == null ? [] : db.jsonValue<string[]>(row.tags_json);
      for (const tag of list) tags.add(tag);
    }
    return [...tags].sort();
  },
);

// Passage groups (#50, P4.6): the shared stimulus (a passage, a table, a
// diagram) a handful of questions in a bank hang off. A bank holds a
// handful of them and every read wants all of them, which is why they live
// in `question_bank.groups_json` rather than a table of their own — there
// is no migration here, only reads and writes of that one column.
//
// `rawGroups` is the one read every group function above builds on; keeping
// it unexported (same reason `testsUsingBank` is) is what keeps the "one
// statement per change" rule honest: a caller outside this file reaches
// `listGroups`/`upsertGroup`/`deleteGroup`, never the column directly.
async function rawGroups(db: DbClient, workspaceId: string, bankId: string): Promise<PassageGroup[]> {
  const rows = await db.query<{ groups_json: unknown }>(
    "SELECT groups_json FROM question_bank WHERE workspace_id = ? AND id = ?",
    [workspaceId, bankId],
  );
  const row = rows[0];
  return row?.groups_json == null ? [] : db.jsonValue<PassageGroup[]>(row.groups_json);
}

export const listGroups = scoped(
  "listGroups",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
  ): Promise<(PassageGroup & { questionCount: number })[]> => {
    const groups = await rawGroups(db, workspaceId, bankId);
    if (groups.length === 0) return [];

    const counts = await db.query<{ group_ref: string; n: number }>(
      "SELECT group_ref, COUNT(*) AS n FROM question " +
        "WHERE workspace_id = ? AND bank_id = ? AND group_ref IS NOT NULL GROUP BY group_ref",
      [workspaceId, bankId],
    );
    const countOf = new Map(counts.map((row) => [row.group_ref, Number(row.n)]));
    return groups.map((group) => ({ ...group, questionCount: countOf.get(group.id) ?? 0 }));
  },
);

/**
 * Read-modify-write on `groups_json`: one read of the current array, one
 * `UPDATE` writing it back with `group` added (a fresh `id`) or replaced (an
 * existing one) — never a statement per field, and never more than the one
 * `UPDATE` the brief asks for.
 */
export const upsertGroup = scoped(
  "upsertGroup",
  async (db: DbClient, workspaceId: string, bankId: string, group: PassageGroup, now: number): Promise<void> => {
    const current = await rawGroups(db, workspaceId, bankId);
    const index = current.findIndex((g) => g.id === group.id);
    const next = index === -1 ? [...current, group] : current.map((g, i) => (i === index ? group : g));

    await db.run("UPDATE question_bank SET groups_json = ?, updated_at = ? WHERE workspace_id = ? AND id = ?", [
      db.jsonParam(next),
      now,
      workspaceId,
      bankId,
    ]);
  },
);

/**
 * Refuses when a question in this bank still names the group — the same
 * refuse-rather-than-cascade shape `deleteQuestion`/`deleteBank` use for a
 * published test, here for a question instead: a group's `group_ref` can
 * never dangle, because there is no path that removes the group out from
 * under a question that still names it.
 */
export const deleteGroup = scoped(
  "deleteGroup",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    groupId: string,
  ): Promise<{ deleted: boolean; blockedBy: string[] }> => {
    const referencing = await db.query<{ ref_id: string }>(
      "SELECT ref_id FROM question WHERE workspace_id = ? AND bank_id = ? AND group_ref = ? ORDER BY ref_id",
      [workspaceId, bankId, groupId],
    );
    const blockedBy = referencing.map((row) => row.ref_id);
    if (blockedBy.length > 0) return { deleted: false, blockedBy };

    const current = await rawGroups(db, workspaceId, bankId);
    if (!current.some((g) => g.id === groupId)) return { deleted: false, blockedBy: [] };
    const next = current.filter((g) => g.id !== groupId);

    const { changes } = await db.run(
      "UPDATE question_bank SET groups_json = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
      [db.jsonParam(next), Date.now(), workspaceId, bankId],
    );
    return { deleted: changes > 0, blockedBy: [] };
  },
);
