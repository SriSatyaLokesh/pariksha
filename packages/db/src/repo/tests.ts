// Tests, their published versions and sets.

import type { DbClient } from "../client.js";
import type { TestTiming } from "@pariksha/core";
import { newId, newShortCode } from "../ids.js";
import { scoped } from "./guard.js";
import type { TestDocumentBody, TestSettings } from "./test-document.js";

export type TestStatus = "draft" | "published" | "closed" | "archived";

export interface TestRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  shortCode: string;
  status: TestStatus;
  currentVersion: number | null;
  reviewRequested: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TestFilter {
  tag?: string;
  status?: TestStatus;
  search?: string;
  sort?: "name" | "updated" | "created";
}

export interface TestPatch {
  name?: string;
  slug?: string;
  description?: string;
  tags?: string[];
  reviewRequested?: boolean;
}

interface TestRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  short_code: string;
  status: string;
  review_requested: unknown;
  current_version: number | null;
  tags_json: unknown;
  created_at: number;
  updated_at: number | null;
}

const toTestRow = (db: DbClient, row: TestRecord): TestRow => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  shortCode: row.short_code,
  // Cast: the column is a plain text status. The three writers are
  // `createTest` ("draft"), `publishDraftVersion` ("published") and
  // `setTestStatus` ("closed"/"archived"); nothing else writes it, and
  // "open"/"scheduled" never reach it at all — those two are derived from
  // the window at read time (`deriveState`, repo/test-document.ts).
  status: row.status as TestStatus,
  currentVersion: row.current_version === null ? null : Number(row.current_version),
  reviewRequested: Boolean(row.review_requested),
  tags: row.tags_json == null ? [] : db.jsonValue(row.tags_json),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at ?? row.created_at),
});

const TEST_COLUMNS =
  "id, slug, name, description, short_code, status, review_requested, current_version, tags_json, created_at, updated_at";

/**
 * Fix round (fixture review, Phase 4 precedent): `%`/`_` are wildcards to
 * `LIKE` itself, so a tag or search term containing either would otherwise
 * match far more than typed. Escaped here and paired with `ESCAPE '\'` at
 * each call site — the same function `packages/db/src/repo/banks.ts` keeps
 * for its own tag/search filters, duplicated rather than imported: it is one
 * line, and importing it would make this module depend on banks.ts for
 * something that owns no state of its own.
 */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** True when `err`'s message names `short_code` — the one column `createTest`
 * retries on, as opposed to a `(workspace_id, slug)` collision, which must
 * still surface to the caller as the AC-02 duplicate-slug refusal. */
function isShortCodeCollision(err: unknown): boolean {
  return err instanceof Error && /short_code/i.test(err.message);
}

export const createTest = scoped(
  "createTest",
  async (
    db: DbClient,
    workspaceId: string,
    /** `body` (Task 12, #63) seeds version 1 with a whole document instead
     * of the empty one a hand-created test starts from — what whole-test
     * import and clone both write, and the reason neither needed a second
     * function: the row, its draft and the short-code retry are identical,
     * only the two JSON columns differ. */
    input: { name: string; slug: string; now?: number; body?: TestDocumentBody },
  ): Promise<TestRow> => {
    const id = newId("tst");
    const now = input.now ?? Date.now();

    // T-02: a test is never a row with no document — the row and its draft
    // version 1 (published_at NULL, an empty settings object and no
    // sections yet) are written in one batch, so the two can never exist
    // apart. `short_code` is unique bare (Review Focus 5), so a collision —
    // vanishingly unlikely at 30 bits, but not impossible — is retried once
    // with a fresh code rather than surfaced to the caller as a 500.
    const attempt = async (shortCode: string): Promise<void> => {
      await db.batch([
        {
          sql:
            "INSERT INTO test (id, workspace_id, slug, name, description, short_code, status, " +
            "review_requested, current_version, tags_json, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL)",
          params: [id, workspaceId, input.slug, input.name, shortCode, "draft", 0, db.jsonParam([]), now],
        },
        {
          sql:
            "INSERT INTO test_version (id, workspace_id, test_id, version, settings_json, sections_json, " +
            "published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
          params: [
            newId("ver"),
            workspaceId,
            id,
            1,
            db.jsonParam(input.body?.settings ?? {}),
            db.jsonParam(input.body?.sections ?? []),
            now,
          ],
        },
      ]);
    };

    try {
      await attempt(newShortCode());
    } catch (err) {
      if (!isShortCodeCollision(err)) throw err;
      await attempt(newShortCode());
    }

    const row = await getTest(db, workspaceId, id);
    if (!row) throw new Error("createTest: the row it just wrote could not be read back");
    return row;
  },
);

export const getTest = scoped(
  "getTest",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
  ): Promise<TestRow | null> => {
    // S-09: scoped by workspace, so a test in another workspace is simply not
    // found. The caller returns 404, never 403 — existence is not disclosed.
    const rows = await db.query<TestRecord>(
      `SELECT ${TEST_COLUMNS} FROM test WHERE workspace_id = ? AND id = ?`,
      [workspaceId, testId],
    );
    const row = rows[0];
    return row ? toTestRow(db, row) : null;
  },
);

/** T-03: tag, search and sort resolved as WHERE and ORDER BY clauses in one
 * statement — never a query per row. */
export const listTests = scoped(
  "listTests",
  async (db: DbClient, workspaceId: string, filter: TestFilter = {}): Promise<TestRow[]> => {
    const clauses = ["workspace_id = ?"];
    const params: unknown[] = [workspaceId];

    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.tag) {
      clauses.push("CAST(tags_json AS TEXT) LIKE ? ESCAPE '\\'");
      params.push(`%"${likeEscape(filter.tag)}"%`);
    }
    if (filter.search) {
      clauses.push("name LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(filter.search)}%`);
    }

    const orderBy =
      filter.sort === "name"
        ? "name ASC"
        : filter.sort === "updated"
          ? "updated_at IS NULL, updated_at DESC, created_at DESC"
          : "created_at DESC";

    const rows = await db.query<TestRecord>(
      `SELECT ${TEST_COLUMNS} FROM test WHERE ${clauses.join(" AND ")} ORDER BY ${orderBy}`,
      params,
    );
    return rows.map((row) => toTestRow(db, row));
  },
);

/**
 * T-01: every field but `slug` is editable for the test's whole life; `slug`
 * locks the instant `current_version` is set — a published test's public URL
 * (and the `/t/<code>` redirect target, which names the slug, not an ID)
 * must not move under a candidate mid-exam.
 */
export const updateTest = scoped(
  "updateTest",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    patch: TestPatch,
    now: number,
  ): Promise<TestRow | null> => {
    const existing = await getTest(db, workspaceId, testId);
    if (!existing) return null;

    if (patch.slug !== undefined && existing.currentVersion !== null) {
      throw new Error("T-01: the slug cannot change once a test has been published.");
    }

    await db.run(
      "UPDATE test SET slug = COALESCE(?, slug), name = COALESCE(?, name), " +
        "description = COALESCE(?, description), tags_json = COALESCE(?, tags_json), " +
        "review_requested = COALESCE(?, review_requested), updated_at = ? " +
        "WHERE workspace_id = ? AND id = ?",
      [
        patch.slug ?? null,
        patch.name ?? null,
        patch.description ?? null,
        patch.tags === undefined ? null : db.jsonParam(patch.tags),
        patch.reviewRequested === undefined ? null : patch.reviewRequested ? 1 : 0,
        now,
        workspaceId,
        testId,
      ],
    );

    // Built from `existing` plus what the patch named, rather than a second
    // read proving what the `UPDATE` just wrote — the same rule
    // `upsertQuestion` (packages/db/src/repo/banks.ts) follows for its own
    // caller.
    return {
      ...existing,
      ...(patch.slug !== undefined && { slug: patch.slug }),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
      ...(patch.reviewRequested !== undefined && { reviewRequested: patch.reviewRequested }),
      updatedAt: now,
    };
  },
);

/**
 * The two version rows that matter per test in `workspaceId`: the open
 * draft (its number feeds `TestSummary.draftVersion`,
 * `apps/web/src/lib/api.ts`) and the current published one (its
 * `timing` feeds `deriveState`, repo/test-document.ts — a published test
 * is **Scheduled** or **Open** depending on its own window, and the
 * screens cannot tell which without it).
 *
 * One query regardless of how many tests the workspace holds, and at most
 * two rows per test: the join to `test.current_version` is what keeps a
 * test with twenty frozen versions from returning twenty rows. Narrowed to
 * one test with `testId`, so a `GET .../tests/:testId` costs the same one
 * extra statement a list does.
 */
export interface TestVersionHead {
  draftVersion: number | null;
  publishedTiming: TestTiming | undefined;
}

export const headVersionsByTest = scoped(
  "headVersionsByTest",
  async (db: DbClient, workspaceId: string, testId?: string): Promise<Map<string, TestVersionHead>> => {
    const clauses = ["tv.workspace_id = ?", "(tv.published_at IS NULL OR tv.version = t.current_version)"];
    const params: unknown[] = [workspaceId];
    if (testId !== undefined) {
      clauses.push("tv.test_id = ?");
      params.push(testId);
    }
    const rows = await db.query<{
      test_id: string;
      version: number;
      published_at: number | null;
      settings_json: unknown;
    }>(
      "SELECT tv.test_id, tv.version, tv.published_at, tv.settings_json FROM test_version tv " +
        "JOIN test t ON t.workspace_id = tv.workspace_id AND t.id = tv.test_id " +
        `WHERE ${clauses.join(" AND ")}`,
      params,
    );

    const heads = new Map<string, TestVersionHead>();
    for (const row of rows) {
      const head = heads.get(row.test_id) ?? { draftVersion: null, publishedTiming: undefined };
      if (row.published_at === null) {
        head.draftVersion = Number(row.version);
      } else {
        const settings = row.settings_json == null ? {} : db.jsonValue<TestSettings>(row.settings_json);
        head.publishedTiming = settings.timing;
      }
      heads.set(row.test_id, head);
    }
    return heads;
  },
);

// Phase 5 Task 3 (#55, P5.2): the draft itself — "the draft is the whole
// document" (Architecture).
//
// `getTestVersion` used to sit above this, the untyped sibling of
// `TestVersionRow`, kept by a comment saying Task 11 would read a
// published version by id. Task 11 reads `getPublishedVersion`
// (`apps/api/src/export/test.ts:101`), the comment's reason was never
// true, and the function had no caller in src or in tests on this branch
// or on main (whole-branch drift review, L-02). Deleted with it.

export interface TestVersionRow {
  id: string;
  testId: string;
  version: number;
  body: TestDocumentBody;
  publishedAt: number | null;
  createdAt: number;
}

interface TestVersionRecord {
  id: string;
  test_id: string;
  version: number;
  settings_json: unknown;
  sections_json: unknown;
  published_at: number | null;
  created_at: number;
}

function toTestVersionRow(db: DbClient, row: TestVersionRecord): TestVersionRow {
  return {
    id: row.id,
    testId: row.test_id,
    version: Number(row.version),
    body: {
      settings: row.settings_json == null ? {} : db.jsonValue(row.settings_json),
      sections: row.sections_json == null ? [] : db.jsonValue(row.sections_json),
    },
    publishedAt: row.published_at === null ? null : Number(row.published_at),
    createdAt: Number(row.created_at),
  };
}

const TEST_VERSION_COLUMNS = "id, test_id, version, settings_json, sections_json, published_at, created_at";

/** The one `published_at IS NULL` row for `testId` — T-04's draft head, or
 * `null` for a test every version of which has been published and archived
 * with nothing left in progress (not reachable before Task 11's lifecycle
 * exists, but this function does not assume Task 2's invariant holds
 * forever). */
export const getDraftVersion = scoped(
  "getDraftVersion",
  async (db: DbClient, workspaceId: string, testId: string): Promise<TestVersionRow | null> => {
    const rows = await db.query<TestVersionRecord>(
      `SELECT ${TEST_VERSION_COLUMNS} FROM test_version WHERE workspace_id = ? AND test_id = ? AND published_at IS NULL`,
      [workspaceId, testId],
    );
    const row = rows[0];
    return row ? toTestVersionRow(db, row) : null;
  },
);

/**
 * Replaces the draft's whole stored body on the one row `existing` names.
 *
 * Fix round (task 3 review, I7/I8 — "settle the missing-draft contract
 * before Task 11 inherits it"): this never creates a draft. A missing draft
 * is Task 11's lifecycle to produce explicitly — publishing stamps the
 * current draft's `published_at` and starts the next numbered version as
 * its own visible step (`UX-18`: "Version 2 (draft). Attempts in progress
 * stay on version 1.") — not a silent side effect of a PATCH that merely
 * meant to save. `GET …/draft` already refuses the same way (404, no
 * creation); this makes PATCH agree with it rather than disagree.
 *
 * `existing` is the caller's own prior `getDraftVersion` read (the route's
 * merge base) — passed in rather than re-read here, which is also what
 * keeps this to one write instead of a read-then-write: the route already
 * paid for the read it needed anyway. `body` replaces the stored document
 * wholesale; the merge that turns a `DraftPatch` into a whole
 * `TestDocumentBody` (Review Focus item 3) is the route's job, one layer
 * up, same as `updateTest` leaves `TestPatch` assembly to its caller.
 */
export const putDraftVersion = scoped(
  "putDraftVersion",
  async (
    db: DbClient,
    workspaceId: string,
    existing: TestVersionRow,
    body: TestDocumentBody,
    now: number,
  ): Promise<TestVersionRow> => {
    // Fix round (task 3 review, I5): bumps `test.updated_at`, the field
    // `updateTest` does set and `listTests` sorts on — batched with the
    // `test_version` write (one subrequest either way) rather than a second
    // statement. `AND published_at IS NULL` guards against `existing`
    // having been published out from under this call (a race, not the
    // common path) — the WHERE then matches no row, `changes` is 0, and the
    // explicit refusal below fires instead of silently reporting success.
    const { changes } = await db.run(
      "UPDATE test_version SET settings_json = ?, sections_json = ? " +
        "WHERE workspace_id = ? AND id = ? AND published_at IS NULL",
      [db.jsonParam(body.settings), db.jsonParam(body.sections), workspaceId, existing.id],
    );
    if (changes === 0) {
      throw new Error(
        "putDraftVersion: no open draft to update. Starting the next one after a publish is Task 11's " +
          "lifecycle to own explicitly, not a side effect of this function.",
      );
    }
    await db.run("UPDATE test SET updated_at = ? WHERE workspace_id = ? AND id = ?", [now, workspaceId, existing.testId]);
    // Built from `existing` plus the body just written, rather than a
    // second read proving what the `UPDATE` just wrote — `updateTest`'s own
    // precedent, above.
    return { ...existing, body };
  },
);

// --- Task 11 (#62, P5.9): the lifecycle ---------------------------------

export interface TestVersionSummary {
  version: number;
  publishedAt: number | null;
  attemptCount: number;
}

/**
 * Every version of `testId`, newest first, with how many attempts are
 * pinned to each (`UX-18`'s "Attempts in progress stay on version 1" is
 * this number). The count is a correlated subquery, not a query per
 * version — the same shape `QUESTION_SELECT`'s own `used_in_tests` keeps
 * (packages/db/src/repo/banks.ts) — so a test with twenty versions still
 * costs one statement.
 *
 * The open draft is included, with `publishedAt: null`: the version
 * history is what the builder shows beside the banner, and "Version 3
 * (draft), not published yet" is a row an organiser needs to see rather
 * than one to hide.
 */
export const listVersions = scoped(
  "listVersions",
  async (db: DbClient, workspaceId: string, testId: string): Promise<TestVersionSummary[]> => {
    const rows = await db.query<{ version: number; published_at: number | null; attempt_count: number }>(
      "SELECT tv.version, tv.published_at, " +
        "(SELECT COUNT(*) FROM attempt a WHERE a.workspace_id = tv.workspace_id AND a.test_version_id = tv.id) " +
        "AS attempt_count " +
        "FROM test_version tv WHERE tv.workspace_id = ? AND tv.test_id = ? ORDER BY tv.version DESC",
      [workspaceId, testId],
    );
    return rows.map((row) => ({
      version: Number(row.version),
      publishedAt: row.published_at === null ? null : Number(row.published_at),
      attemptCount: Number(row.attempt_count),
    }));
  },
);

/** One frozen version by number, or the latest published one when no
 * number is given — the sibling of `getDraftVersion`, and what `?version=`
 * (Task 12's export) and the banner's "view version 1" link both read. */
export const getPublishedVersion = scoped(
  "getPublishedVersion",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    version?: number,
  ): Promise<TestVersionRow | null> => {
    const clauses = ["workspace_id = ?", "test_id = ?", "published_at IS NOT NULL"];
    const params: unknown[] = [workspaceId, testId];
    if (version !== undefined) {
      clauses.push("version = ?");
      params.push(version);
    }
    const rows = await db.query<TestVersionRecord>(
      `SELECT ${TEST_VERSION_COLUMNS} FROM test_version WHERE ${clauses.join(" AND ")} ORDER BY version DESC`,
      params,
    );
    const row = rows[0];
    return row ? toTestVersionRow(db, row) : null;
  },
);

/**
 * T-04. Replaces Task 2's `publishTestVersion`, which INSERTed a *new*
 * row at a version number the caller chose — and `(test_id, version)` is
 * unique while `createTest` has already seeded the draft as version 1, so
 * the first publish of any test raised a constraint error and every
 * fixture that worked around it numbered the product's first published
 * version 2.
 *
 * The real transition, in one `db.batch` so a half-published test cannot
 * exist:
 *
 * 1. stamp `published_at` on the draft head — the row the organiser has
 *    been editing *becomes* the frozen version, it is not copied;
 * 2. open version N+1 as the next draft, carrying the same body, so the
 *    builder has something to edit the moment publishing finishes and
 *    `UX-18`'s banner ("Version 2 (draft). Attempts in progress stay on
 *    version 1.") has its number;
 * 3. point `test.current_version` at the version just frozen and set
 *    `status = 'published'` — never `'open'` (Review Focus 2): whether a
 *    published test is Scheduled, Open or Closed is `deriveState`'s answer
 *    against `timing` and the clock, not a column.
 */
export const publishDraftVersion = scoped(
  "publishDraftVersion",
  async (db: DbClient, workspaceId: string, testId: string, now: number): Promise<{ version: number }> => {
    const draft = await getDraftVersion(db, workspaceId, testId);
    if (!draft) {
      throw new Error("publishDraftVersion: this test has no open draft to publish.");
    }

    await db.batch([
      {
        sql: "UPDATE test_version SET published_at = ? WHERE workspace_id = ? AND id = ? AND published_at IS NULL",
        params: [now, workspaceId, draft.id],
      },
      {
        sql:
          "INSERT INTO test_version (id, workspace_id, test_id, version, settings_json, sections_json, " +
          "published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
        params: [
          newId("ver"),
          workspaceId,
          testId,
          draft.version + 1,
          db.jsonParam(draft.body.settings),
          db.jsonParam(draft.body.sections),
          now,
        ],
      },
      {
        sql: "UPDATE test SET current_version = ?, status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        params: [draft.version, "published", now, workspaceId, testId],
      },
    ]);

    return { version: draft.version };
  },
);

/** The Close and Archive transitions. `false` when no such test exists in
 * this workspace — the caller's 404. Which transitions are legal is the
 * route's rule (Archived follows Closed), not this function's: this is the
 * one write, nothing more. */
export const setTestStatus = scoped(
  "setTestStatus",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    status: TestStatus,
    now: number,
  ): Promise<boolean> => {
    const { changes } = await db.run(
      "UPDATE test SET status = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
      [status, now, workspaceId, testId],
    );
    return changes > 0;
  },
);


/**
 * AC-04's clone. Copies the test's **editable head** — the open draft if
 * there is one, else the latest published version — into a new Draft with
 * a new `tst_` id, a new short code and a free slug. It does not copy:
 * published versions (the clone starts at draft 1), `review_requested`
 * (ADR 0007: a review was requested of *that* test, by a person, about a
 * version that no longer exists here), or anything candidate-side.
 *
 * `cloneTest` suffixes the slug on a collision where whole-test import
 * 409s instead (`T-05`). That asymmetry is deliberate: a clone is a
 * gesture inside one workspace where the organiser has not named anything
 * yet and `-copy-2` is the obvious answer, while an import carries a slug
 * the *file* named and silently moving it would publish a candidate URL
 * nobody asked for.
 */
export const cloneTest = scoped(
  "cloneTest",
  async (
    db: DbClient,
    workspaceId: string,
    testId: string,
    input: { name: string; slug: string; now: number },
  ): Promise<TestRow | null> => {
    // The editable head, by the invariant Task 11 keeps: at most one
    // unpublished version, and it is always the highest-numbered row.
    const rows = await db.query<TestVersionRecord>(
      `SELECT ${TEST_VERSION_COLUMNS} FROM test_version WHERE workspace_id = ? AND test_id = ? ` +
        "ORDER BY version DESC",
      [workspaceId, testId],
    );
    const head = rows[0];
    if (!head) return null;

    // One query for every slug already taken in the `<slug>-copy` family,
    // rather than inserting and retrying on the unique constraint: a retry
    // loop costs one subrequest per collision and a second clone of the
    // same test always collides.
    const taken = await db.query<{ slug: string }>(
      "SELECT slug FROM test WHERE workspace_id = ? AND (slug = ? OR slug LIKE ?)",
      // No `likeEscape` here, unlike `listTests` above: a slug is
      // `^[a-z0-9][a-z0-9-]{1,62}$` on every write path, so it can never
      // contain a `%` or `_` for `LIKE` to read as a wildcard.
      [workspaceId, input.slug, `${input.slug}-%`],
    );
    const used = new Set(taken.map((row) => row.slug));
    let slug = input.slug;
    for (let n = 2; used.has(slug); n += 1) slug = `${input.slug}-${n}`;

    return createTest(db, workspaceId, {
      name: input.name,
      slug,
      now: input.now,
      body: toTestVersionRow(db, head).body,
    });
  },
);
