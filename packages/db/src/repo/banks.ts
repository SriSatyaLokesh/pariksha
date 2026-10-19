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
 * True when a *published* `test_version` row (correlated as `tv`) references
 * the outer `question` row `q` — directly, by `q.id` (a `fixed`/`sets`
 * source), or indirectly, by `q.bank_id` (a `pool` source, which names only
 * a bank). Both arms are substring scans over the same `CAST(...AS TEXT)`
 * blob, so this is still the one correlated subquery `QUESTION_SELECT`'s
 * header describes, not a second round trip.
 *
 * Phase 5 Task 2, Review Focus 1: every Phase 4 fixture inserted only
 * published rows, so `tv.published_at IS NOT NULL` was never exercised and
 * its absence was invisible — Task 2 is the first to write a
 * `published_at IS NULL` draft, and without this filter an Author who adds a
 * question to a *draft* test could no longer delete it from its bank, the
 * refusal would name a test nobody published, and the bank browser's
 * "not used in any test" filter would hide it.
 */
const TV_REFERENCES_Q_ROW =
  "(tv.published_at IS NOT NULL AND " +
  "(CAST(tv.sections_json AS TEXT) LIKE '%' || q.id || '%' " +
  "OR CAST(tv.sections_json AS TEXT) LIKE '%' || q.bank_id || '%'))";

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

/** The decoded document half of a question row. Shared by
 * `toQuestionRowView` and `workspaceQuestions` rather than written twice —
 * the two differ only in what they wrap it in. */
function toQuestionRecord(db: DbClient, row: QuestionRecord): QuestionRecord {
  // `tags_json` is NOT NULL, so a tagless question is stored as `'[]'`, not
  // SQL NULL — there is no way for the column itself to tell "no tags" apart
  // from "explicitly an empty array". Collapsing a decoded empty array back
  // to `null` here (fixture-review finding 9, round 2) is what lets
  // `toQuestionDocument`'s existing `tags_json ?? undefined` restore the
  // absence, the same shape `upsertQuestion`'s freshly-built response
  // already returns on POST/PATCH — so a question reads the same way on a
  // GET as it did on the write that just created it.
  const decodedTags = row.tags_json == null ? null : db.jsonValue<string[]>(row.tags_json);
  return {
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
}

function toQuestionRowView(db: DbClient, row: QuestionFullRecord): QuestionRow {
  const record = toQuestionRecord(db, row);
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
 * A draft test is freely editable (T-04), so only a *published*
 * `test_version` row ever blocks a delete — Review Focus 1, the same fix
 * `TV_REFERENCES_Q_ROW`'s header above explains. */
async function testsUsingQuestion(
  db: DbClient,
  workspaceId: string,
  bankId: string,
  questionId: string,
): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "SELECT DISTINCT t.name AS name FROM test_version tv " +
      "JOIN test t ON t.id = tv.test_id AND t.workspace_id = tv.workspace_id " +
      "WHERE tv.workspace_id = ? AND tv.published_at IS NOT NULL " +
      "AND (CAST(tv.sections_json AS TEXT) LIKE ? OR CAST(tv.sections_json AS TEXT) LIKE ?)",
    [workspaceId, `%${questionId}%`, `%${bankId}%`],
  );
  return rows.map((row) => row.name);
}

/** The tests (by name) whose *published* version references `bankId` —
 * either a `pool` source naming the bank directly, or a `fixed`/`sets`
 * source naming one of its questions (Review Focus 1: a draft never
 * blocks). One join plus one direct substring check, never one
 * `testsUsingQuestion` call per question. */
async function testsUsingBank(
  db: DbClient,
  workspaceId: string,
  bankId: string,
): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "SELECT DISTINCT t.name AS name FROM test_version tv " +
      "JOIN test t ON t.id = tv.test_id AND t.workspace_id = tv.workspace_id " +
      "WHERE tv.workspace_id = ? AND tv.published_at IS NOT NULL AND (" +
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

/**
 * Fix round (whole-branch review, M7): `filter.tag` and `filter.search`
 * (below) interpolate user text straight into a `LIKE` pattern — still
 * parameterised, so not injection, but `%`/`_` are wildcards to `LIKE`
 * itself. A tag literally named `50%` or a search for `a_b` would otherwise
 * match far more than the author typed and silently return the unfiltered
 * list. Escapes both characters (and the escape character itself) and pairs
 * with `ESCAPE '\'` at each call site — standard SQL, portable across
 * SQLite/D1 and Postgres, the same "one query, no dialect branch" rule
 * `BANK_SELECT`'s own comment already follows for JSON.
 */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
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
    patch: { name?: string; description?: string; license?: string; tags?: string[]; now?: number },
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
        // Fix round (whole-branch review, M6): every sibling write takes an
        // injected clock (`createBank`'s own `input.now`, same fallback,
        // same precedent) — this one called `Date.now()` directly, so the
        // audit row for the same PATCH request (routes/banks.ts, `deps.now()`)
        // and this column could disagree under a fixed test clock.
        patch.now ?? Date.now(),
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
      clauses.push("CAST(q.tags_json AS TEXT) LIKE ? ESCAPE '\\'");
      params.push(`%"${likeEscape(filter.tag)}"%`);
    }
    if (filter.search) {
      clauses.push("q.prompt_md LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(filter.search)}%`);
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

/**
 * One INSERT per `doc`, with a fresh id — the statement-building half of
 * `upsertQuestions`, pulled out so `writeImportedBank` (below) can fold
 * these statements into the *same* `db.batch()` call as a `groups_json`
 * update, rather than being forced through a second, separate batch of its
 * own. Never calls `batch()` itself.
 */
function questionInsertStatements(
  db: DbClient,
  workspaceId: string,
  bankId: string,
  docs: readonly Question[],
  now: number,
): { ids: string[]; statements: { sql: string; params: unknown[] }[] } {
  const ids: string[] = [];
  const statements = docs.map((doc) => {
    const id = newId("qst");
    ids.push(id);
    const row = toQuestionRow(doc);
    return {
      sql:
        "INSERT INTO question (id, workspace_id, bank_id, ref_id, group_ref, type, prompt_md, media_json, " +
        "options_json, key_json, scoring_json, points, difficulty, tags_json, explanation_md, extra_json, " +
        "version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
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
        db.jsonParam(row.tags_json ?? []),
        row.explanation_md,
        row.extra_json == null ? null : db.jsonParam(row.extra_json),
        1,
        now,
        now,
      ],
    };
  });
  return { ids, statements };
}

/**
 * Task 7 (#51), Review Focus item 3: one `db.batch()` regardless of how many
 * `docs` there are, replacing the sequential SELECT-then-INSERT/UPDATE per
 * question this function used to spend through `upsertQuestion` — ~2N
 * subrequests against the 50-subrequest Workers ceiling, correct at ten
 * questions and over budget at sixty.
 *
 * `writeImportedBank` (below) is import's real entry point — it needs this
 * function's statements folded into its own single batch alongside a
 * `groups_json` update, which is why the statement-building half lives in
 * `questionInsertStatements` and this function is a thin wrapper over it.
 *
 * ponytail: real upsert semantics (an existing `ref_id` updates in place
 * instead of erroring) would cost one more SELECT up front to resolve which
 * ids already exist — still a single extra round trip, not one per
 * question. Add it if a caller other than import ever needs bulk-upsert
 * rather than bulk-insert; today nothing does.
 */
export const upsertQuestions = scoped(
  "upsertQuestions",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    docs: readonly Question[],
    now: number,
  ): Promise<{ ids: string[] }> => {
    if (docs.length === 0) return { ids: [] };
    const { ids, statements } = questionInsertStatements(db, workspaceId, bankId, docs, now);
    await db.batch(statements);
    return { ids };
  },
);

/**
 * Every `ref_id` already in a bank, for import's own duplicate check
 * (apps/api/src/import/json.ts) — one query regardless of the bank's size,
 * and never filtered by an `IN (...)` list of the *incoming* ids: D1 caps
 * bound parameters per statement, and a 500-question import would need 500
 * of them in that clause alone.
 */
export const listQuestionRefIds = scoped(
  "listQuestionRefIds",
  async (db: DbClient, workspaceId: string, bankId: string): Promise<string[]> => {
    const rows = await db.query<{ ref_id: string }>(
      "SELECT ref_id FROM question WHERE workspace_id = ? AND bank_id = ?",
      [workspaceId, bankId],
    );
    return rows.map((row) => row.ref_id);
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
 * `group` added (a fresh `id`) or replaced (an existing one) within
 * `current` — the one merge rule `upsertGroup` and `writeImportedBank` both
 * apply, so an import's bulk merge and a single `POST .../groups` agree on
 * what "already exists" means.
 */
function mergeGroup(current: readonly PassageGroup[], group: PassageGroup): PassageGroup[] {
  const index = current.findIndex((g) => g.id === group.id);
  return index === -1 ? [...current, group] : current.map((g, i) => (i === index ? group : g));
}

/**
 * Read-modify-write on `groups_json`: one read of the current array, one
 * `UPDATE` writing it back with `group` merged in via `mergeGroup` — never a
 * statement per field, and never more than the one `UPDATE` the brief asks
 * for.
 *
 * ponytail: no optimistic concurrency — two concurrent calls for the same
 * bank both read the same `current`, and whichever `UPDATE` lands last wins,
 * silently dropping the other's group. Inherent to the JSON-column design
 * the brief chose over a `passage_group` table (a bank holds a handful of
 * groups and every read wants all of them); a Workspace's banks are edited
 * by its handful of Authors, not a crowd, so two Authors creating a group in
 * the same bank in the same instant is rare enough to accept today. Upgrade
 * path if it ever bites: a `version` column on `question_bank` checked by
 * the `UPDATE`'s `WHERE` clause (compare-and-swap), retrying `upsertGroup`
 * on a mismatch — the same shape a real `passage_group` table would get for
 * free from row-level locking, without yet paying for the table and the
 * migration it needs.
 */
export const upsertGroup = scoped(
  "upsertGroup",
  async (db: DbClient, workspaceId: string, bankId: string, group: PassageGroup, now: number): Promise<void> => {
    const current = await rawGroups(db, workspaceId, bankId);
    const next = mergeGroup(current, group);

    await db.run("UPDATE question_bank SET groups_json = ?, updated_at = ? WHERE workspace_id = ? AND id = ?", [
      db.jsonParam(next),
      now,
      workspaceId,
      bankId,
    ]);
  },
);

/**
 * Import's real write path (Fix round 1, findings 1+2): everything a
 * whole-document import writes — every declared group merged into the
 * bank's existing `groups_json`, and every question — goes through **one**
 * `db.batch()` call, so the import is genuinely all-or-nothing rather than
 * conditional on nothing failing between two separate writes. The previous
 * shape (a loop of `upsertGroup` calls, each its own read-modify-write,
 * followed by a *separate* `upsertQuestions` batch) left every already-
 * applied group committed if the questions batch failed afterward — exactly
 * the failure a concurrent import racing the same bank's duplicate-`ref_id`
 * pre-check could trigger. `question_bank_ref_uq` (the `(bank_id, ref_id)`
 * unique index) is still the backstop for that race, but now a collision
 * rolls back the groups update too, not just the questions.
 *
 * One read of the bank's current groups (skipped entirely when the
 * imported document declares none — the common case `bankOf(200)`-shaped
 * fixtures exercise), one merge of every imported group into it with
 * `mergeGroup`, one `UPDATE` statement prepended to the same array
 * `questionInsertStatements` builds — so the cost is flat in both question
 * count *and* group count, not just the former: Review Focus item 3's
 * complaint applies equally to "a write per group" as to "a write per
 * question", and this closes both the same way.
 */
export const writeImportedBank = scoped(
  "writeImportedBank",
  async (
    db: DbClient,
    workspaceId: string,
    bankId: string,
    bank: { groups?: readonly PassageGroup[]; questions: readonly Question[] },
    now: number,
  ): Promise<{ ids: string[] }> => {
    const statements: { sql: string; params: unknown[] }[] = [];
    const importedGroups = bank.groups ?? [];

    if (importedGroups.length > 0) {
      let merged = await rawGroups(db, workspaceId, bankId);
      for (const group of importedGroups) merged = mergeGroup(merged, group);
      statements.push({
        sql: "UPDATE question_bank SET groups_json = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        params: [db.jsonParam(merged), now, workspaceId, bankId],
      });
    }

    const { ids, statements: questionStatements } = questionInsertStatements(
      db,
      workspaceId,
      bankId,
      bank.questions,
      now,
    );
    statements.push(...questionStatements);

    if (statements.length > 0) await db.batch(statements);
    return { ids };
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
    // Fix round (whole-branch review, M6): `upsertGroup` (this file's own
    // sibling write to the same `groups_json` column) takes an injected
    // clock; this one called `Date.now()` directly.
    now = Date.now(),
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
      [db.jsonParam(next), now, workspaceId, bankId],
    );
    return { deleted: changes > 0, blockedBy: [] };
  },
);

// Phase 5 Task 3 (#55, P5.2): the test builder's own two reads of this
// table, neither shaped like `listQuestions` (which pages one bank at a
// time) — both need every question *this workspace* holds, regardless of
// bank, in one statement so the draft route's budget stays flat whether a
// test's sections name one bank or ten.

/** The columns a pool's live draw (UX-15) and a set's points balance
 * (UX-16) need, and nothing else — never the full `QuestionRow` mapping
 * (`toQuestionDocument`, Markdown and all), which this is deliberately
 * cheaper than.
 *
 * Fix round (task 3 review, I6): `difficulty` is optional, matching
 * `@pariksha/core`'s own `QuestionBase.difficulty?: Difficulty` exactly
 * (not `| null`, and — `exactOptionalPropertyTypes` — not present with an
 * explicit `undefined` either) so this shape satisfies `Pick<Question,
 * "tags" | "difficulty" | "type">` with no cast at the one place
 * `matchesFilter` (`@pariksha/core`) is called with a summary rather than a
 * full document. */
export interface QuestionSummary {
  id: string;
  bankId: string;
  points: number;
  difficulty?: Difficulty;
  tags: string[];
  type: QuestionType;
}

/**
 * Every question row in the workspace, lightly shaped. The draft route
 * builds `draw` (matching each pool section's filter with `matchesFilter`,
 * `@pariksha/core`) and `setPoints` (summing a `sets` source's own named
 * ids) from this one list in memory, so a test with ten pool sections still
 * costs one statement, not ten.
 */
export const workspaceQuestionSummaries = scoped(
  "workspaceQuestionSummaries",
  async (db: DbClient, workspaceId: string): Promise<QuestionSummary[]> => {
    const rows = await db.query<{
      id: string;
      bank_id: string;
      points: number;
      difficulty: string | null;
      tags_json: unknown;
      type: string;
    }>("SELECT id, bank_id, points, difficulty, tags_json, type FROM question WHERE workspace_id = ?", [
      workspaceId,
    ]);
    return rows.map((row) => ({
      id: row.id,
      bankId: row.bank_id,
      points: Number(row.points),
      ...(row.difficulty !== null && { difficulty: row.difficulty as Difficulty }),
      tags: row.tags_json == null ? [] : db.jsonValue<string[]>(row.tags_json),
      type: row.type as QuestionType,
    }));
  },
);

/**
 * Phase 5 Tasks 11-13: every question in the workspace as the document it
 * round-trips as, with the two ids that identify it on each side of the
 * boundary — the `qst_` row id a *stored* section names, and the bank
 * file's own `ref_id` an exported or imported *document* names.
 *
 * Why not `workspaceQuestionSummaries` (above): `validateTest`
 * (`@pariksha/core`) sums `scoring.points` and reads `scoring.mode`, and a
 * summary carries neither — a `sets` section would look balanced whatever
 * its sets held. Why not `listQuestions`: that one is per bank, paginated,
 * and pays `QUESTION_SELECT`'s correlated `used_in_tests` subquery per row,
 * which none of the three callers here reads. One statement, whole
 * workspace, no subquery.
 */
export interface WorkspaceQuestion {
  id: string;
  bankId: string;
  refId: string;
  document: Question;
}

export const workspaceQuestions = scoped(
  "workspaceQuestions",
  async (db: DbClient, workspaceId: string): Promise<WorkspaceQuestion[]> => {
    const rows = await db.query<QuestionRecord & { id: string; bank_id: string }>(
      "SELECT q.id, q.bank_id, q.ref_id, q.group_ref, q.type, q.prompt_md, q.media_json, q.options_json, " +
        "q.key_json, q.scoring_json, q.points, q.difficulty, q.tags_json, q.explanation_md, q.extra_json " +
        "FROM question q WHERE q.workspace_id = ? ORDER BY q.ref_id",
      [workspaceId],
    );
    return rows.map((row) => ({
      id: row.id,
      bankId: row.bank_id,
      refId: row.ref_id,
      document: toQuestionDocument(toQuestionRecord(db, row)),
    }));
  },
);

/**
 * Which of `questionIds`/`bankIds` actually name a row in this workspace —
 * the draft route's save-time guard against a `fixed`/`sets` source naming
 * another tenant's question, or a `pool` source naming another tenant's
 * bank (the plan's own "Save-time versus publish-time" rule: a
 * cross-workspace reference is a read waiting to happen, not a half-built
 * draft). One statement regardless of how many ids either list holds —
 * `UNION ALL` over the two tables, not one `IN (...)` query per table and
 * never one per id. Both lists empty is the common PATCH (a settings-only
 * patch names no row at all) and costs nothing.
 */
export const existingRowIds = scoped(
  "existingRowIds",
  async (
    db: DbClient,
    workspaceId: string,
    ids: { questionIds: readonly string[]; bankIds: readonly string[] },
  ): Promise<{ questionIds: Set<string>; bankIds: Set<string> }> => {
    if (ids.questionIds.length === 0 && ids.bankIds.length === 0) {
      return { questionIds: new Set(), bankIds: new Set() };
    }

    const clauses: string[] = [];
    const params: unknown[] = [];
    if (ids.questionIds.length > 0) {
      clauses.push(
        `SELECT id, 'question' AS kind FROM question WHERE workspace_id = ? AND id IN (${ids.questionIds.map(() => "?").join(", ")})`,
      );
      params.push(workspaceId, ...ids.questionIds);
    }
    if (ids.bankIds.length > 0) {
      clauses.push(
        `SELECT id, 'bank' AS kind FROM question_bank WHERE workspace_id = ? AND id IN (${ids.bankIds.map(() => "?").join(", ")})`,
      );
      params.push(workspaceId, ...ids.bankIds);
    }

    const rows = await db.query<{ id: string; kind: "question" | "bank" }>(clauses.join(" UNION ALL "), params);
    const questionIds = new Set(rows.filter((row) => row.kind === "question").map((row) => row.id));
    const bankIds = new Set(rows.filter((row) => row.kind === "bank").map((row) => row.id));
    return { questionIds, bankIds };
  },
);
