// Tests, their published versions and sets.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export interface TestRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  currentVersion: number | null;
  tags: unknown;
  createdAt: number;
}

interface TestRecord {
  id: string;
  slug: string;
  name: string;
  status: string;
  current_version: number | null;
  tags_json: unknown;
  created_at: number;
}

const toTestRow = (db: DbClient, row: TestRecord): TestRow => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  status: row.status,
  currentVersion: row.current_version === null ? null : Number(row.current_version),
  tags: row.tags_json == null ? [] : db.jsonValue(row.tags_json),
  createdAt: Number(row.created_at),
});

const TEST_COLUMNS =
  "id, slug, name, status, current_version, tags_json, created_at";

export const createTest = scoped(
  "createTest",
  async (
    db: DbClient,
    workspaceId: string,
    input: { slug: string; name: string; tags?: unknown[]; now?: number },
  ): Promise<string> => {
    const id = newId("tst");
    await db.run(
      "INSERT INTO test (id, workspace_id, slug, name, status, current_version, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        workspaceId,
        input.slug,
        input.name,
        // T-04: every test starts as a Draft, and only a Draft is freely editable.
        "draft",
        null,
        db.jsonParam(input.tags ?? []),
        input.now ?? Date.now(),
      ],
    );
    return id;
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

export const listTests = scoped(
  "listTests",
  async (db: DbClient, workspaceId: string): Promise<TestRow[]> => {
    const rows = await db.query<TestRecord>(
      `SELECT ${TEST_COLUMNS} FROM test WHERE workspace_id = ? ORDER BY created_at DESC`,
      [workspaceId],
    );
    return rows.map((row) => toTestRow(db, row));
  },
);

export const publishTestVersion = scoped(
  "publishTestVersion",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      testId: string;
      version: number;
      settings: unknown;
      sections: unknown;
      now?: number;
    },
  ): Promise<string> => {
    const id = newId("ver");
    const publishedAt = input.now ?? Date.now();

    await db.run(
      "INSERT INTO test_version (id, workspace_id, test_id, version, settings_json, sections_json, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        workspaceId,
        input.testId,
        input.version,
        db.jsonParam(input.settings),
        db.jsonParam(input.sections),
        publishedAt,
      ],
    );
    // T-04: publishing freezes a numbered version and points the test at it.
    // Attempts already running keep the version they started on, because an
    // attempt stores its own test_version_id.
    await db.run(
      "UPDATE test SET current_version = ?, status = ? WHERE workspace_id = ? AND id = ?",
      [input.version, "open", workspaceId, input.testId],
    );
    return id;
  },
);

export const getTestVersion = scoped(
  "getTestVersion",
  async (
    db: DbClient,
    workspaceId: string,
    testVersionId: string,
  ): Promise<{
    id: string;
    testId: string;
    version: number;
    settings: unknown;
    sections: unknown;
  } | null> => {
    const rows = await db.query<{
      id: string;
      test_id: string;
      version: number;
      settings_json: unknown;
      sections_json: unknown;
    }>(
      "SELECT id, test_id, version, settings_json, sections_json FROM test_version WHERE workspace_id = ? AND id = ?",
      [workspaceId, testVersionId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      testId: row.test_id,
      version: Number(row.version),
      settings: db.jsonValue(row.settings_json),
      sections: db.jsonValue(row.sections_json),
    };
  },
);
