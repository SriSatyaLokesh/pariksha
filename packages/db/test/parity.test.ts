import { afterAll, describe, expect, it } from "vitest";
import { getTableConfig as sqliteConfig } from "drizzle-orm/sqlite-core";
import { getTableConfig as pgConfig } from "drizzle-orm/pg-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { PgTable } from "drizzle-orm/pg-core";
import * as sqliteSchema from "../src/schema/sqlite.js";
import * as pgSchema from "../src/schema/pg.js";
import {
  TABLE_MANIFEST,
  TABLE_NAMES,
  tableSpec,
  timestampColumns,
} from "../src/schema/columns.js";
import { sqliteClient, closeClient, type DbClient } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { newId } from "../src/ids.js";
import { createTest, createWorkspace, replaceCandidateList } from "../src/repo/index.js";

/** One uploaded list row, reused by the two candidate tests below. */
const LISTED = { externalId: "21CS0147", setLabel: "A", formValues: {} };

// Drizzle's two `getTableConfig`s return the same shape for the parts this
// test compares, but they are different functions over different table types,
// so each dialect gets its own reader and the comparison happens on plain data.

interface ReadColumn {
  name: string;
  notNull: boolean;
  primaryKey: boolean;
  sqlType: string;
}

interface ReadTable {
  name: string;
  columns: ReadColumn[];
  indexes: string[][];
  uniques: string[][];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

const sorted = (groups: string[][]) =>
  groups.map((g) => [...g].sort()).sort((a, b) => a.join().localeCompare(b.join()));

function readSqlite(table: SQLiteTable): ReadTable {
  const config = sqliteConfig(table);
  return {
    name: config.name,
    columns: config.columns
      .map((c) => ({
        name: c.name,
        notNull: c.notNull,
        primaryKey: c.primary,
        sqlType: c.getSQLType(),
      }))
      .sort(byName),
    indexes: sorted(
      config.indexes
        .filter((i) => !i.config.unique)
        .map((i) => i.config.columns.map((c) => (c as { name: string }).name)),
    ),
    uniques: sorted([
      ...config.indexes
        .filter((i) => i.config.unique)
        .map((i) => i.config.columns.map((c) => (c as { name: string }).name)),
      ...config.uniqueConstraints.map((u) => u.columns.map((c) => c.name)),
    ]),
  };
}

function readPg(table: PgTable): ReadTable {
  const config = pgConfig(table);
  return {
    name: config.name,
    columns: config.columns
      .map((c) => ({
        name: c.name,
        notNull: c.notNull,
        primaryKey: c.primary,
        sqlType: c.getSQLType(),
      }))
      .sort(byName),
    indexes: sorted(
      config.indexes
        .filter((i) => !i.config.unique)
        .map((i) =>
          i.config.columns.map((c) => (c as unknown as { name: string }).name),
        ),
    ),
    uniques: sorted([
      ...config.indexes
        .filter((i) => i.config.unique)
        .map((i) =>
          i.config.columns.map((c) => (c as unknown as { name: string }).name),
        ),
      ...config.uniqueConstraints.map((u) => u.columns.map((c) => c.name)),
    ]),
  };
}

const sqliteTables = Object.values(
  sqliteSchema as unknown as Record<string, SQLiteTable>,
).map(readSqlite);
const pgTables = Object.values(
  pgSchema as unknown as Record<string, PgTable>,
).map(readPg);

const sqliteByName = new Map(sqliteTables.map((t) => [t.name, t]));
const pgByName = new Map(pgTables.map((t) => [t.name, t]));

// The one permitted divergence, declared rather than discovered.
const SQL_TYPES = {
  text: { sqlite: "text", pg: "text" },
  json: { sqlite: "text", pg: "jsonb" },
  int: { sqlite: "integer", pg: "integer" },
  bool: { sqlite: "integer", pg: "boolean" },
  timestamp: { sqlite: "integer", pg: "bigint" },
  decimal: { sqlite: "real", pg: "numeric" },
} as const;

describe("the two dialects agree", () => {
  it("define the same tables, and exactly the ones the manifest names", () => {
    expect([...sqliteByName.keys()].sort()).toEqual([...TABLE_NAMES].sort());
    expect([...pgByName.keys()].sort()).toEqual([...TABLE_NAMES].sort());
  });

  it("give every table the same columns, with the same nullability", () => {
    for (const name of TABLE_NAMES) {
      const sqlite = sqliteByName.get(name);
      const pg = pgByName.get(name);
      expect(sqlite?.columns.map((c) => [c.name, c.notNull, c.primaryKey])).toEqual(
        pg?.columns.map((c) => [c.name, c.notNull, c.primaryKey]),
      );
    }
  });

  it("give every table the same indexes and unique constraints", () => {
    for (const name of TABLE_NAMES) {
      expect(sqliteByName.get(name)?.indexes).toEqual(pgByName.get(name)?.indexes);
      expect(sqliteByName.get(name)?.uniques).toEqual(pgByName.get(name)?.uniques);
    }
  });
});

describe("both dialects match the manifest", () => {
  it("declares every column the manifest declares, and no other", () => {
    for (const spec of TABLE_MANIFEST) {
      const expected = spec.columns.map((c) => c.name).sort();
      expect(sqliteByName.get(spec.name)?.columns.map((c) => c.name)).toEqual(
        expected,
      );
      expect(pgByName.get(spec.name)?.columns.map((c) => c.name)).toEqual(expected);
    }
  });

  it("uses the SQL type each column class maps to, in each dialect", () => {
    for (const spec of TABLE_MANIFEST) {
      for (const column of spec.columns) {
        const types = SQL_TYPES[column.class];
        const sqlite = sqliteByName
          .get(spec.name)
          ?.columns.find((c) => c.name === column.name);
        const pg = pgByName
          .get(spec.name)
          ?.columns.find((c) => c.name === column.name);

        expect(`${spec.name}.${column.name}=${sqlite?.sqlType}`).toBe(
          `${spec.name}.${column.name}=${types.sqlite}`,
        );
        expect(`${spec.name}.${column.name}=${pg?.sqlType}`).toBe(
          `${spec.name}.${column.name}=${types.pg}`,
        );
      }
    }
  });

  it("declares the manifest's indexes and uniques in both dialects", () => {
    for (const spec of TABLE_MANIFEST) {
      expect(sqliteByName.get(spec.name)?.indexes).toEqual(sorted(spec.indexes));
      expect(sqliteByName.get(spec.name)?.uniques).toEqual(sorted(spec.uniques));
    }
  });
});

describe("the Phase 4 authoring columns", () => {
  // Named one by one rather than inferred from the manifest: every later
  // Phase 4 task reads these, so a column silently dropped from the manifest
  // has to be red here and not only in whichever task notices it missing.
  const EXPECTED: Record<string, string[]> = {
    question_bank: ["description", "license", "groups_json", "updated_at"],
    question: ["ref_id", "group_ref", "extra_json", "updated_at"],
  };

  for (const [table, columns] of Object.entries(EXPECTED)) {
    it(`${table} has ${columns.join(", ")} in both dialects`, () => {
      expect(sqliteByName.get(table)?.columns.map((c) => c.name)).toEqual(
        expect.arrayContaining(columns),
      );
      expect(pgByName.get(table)?.columns.map((c) => c.name)).toEqual(
        expect.arrayContaining(columns),
      );
    });
  }
});

describe("the Phase 5 columns (Task 2, #54)", () => {
  const EXPECTED: Record<string, string[]> = {
    test: ["description", "short_code", "review_requested", "updated_at"],
    test_version: ["created_at"],
  };

  for (const [table, columns] of Object.entries(EXPECTED)) {
    it(`${table} has ${columns.join(", ")} in both dialects`, () => {
      expect(sqliteByName.get(table)?.columns.map((c) => c.name)).toEqual(
        expect.arrayContaining(columns),
      );
      expect(pgByName.get(table)?.columns.map((c) => c.name)).toEqual(
        expect.arrayContaining(columns),
      );
    });
  }

  // Review Focus 5: every other tenant-table unique in the manifest is
  // composite with `workspace_id` ("test" itself already has
  // `[workspace_id, slug]`) — `short_code` is bare, because `/t/<code>`
  // names no workspace at all.
  it("short_code is unique bare, not composite with workspace_id", () => {
    expect(tableSpec("test").uniques).toContainEqual(["short_code"]);
    expect(sqliteByName.get("test")?.uniques).toContainEqual(["short_code"]);
    expect(pgByName.get("test")?.uniques).toContainEqual(["short_code"]);
  });

  describe("enforced against real data, not just declared", () => {
    let db: DbClient;

    afterAll(() => closeClient(db));

    it("short_code is unique across the whole instance, not per workspace", async () => {
      db = sqliteClient(":memory:");
      await migrate(db);

      const wsA = newId("wsp");
      const wsB = newId("wsp");
      await createWorkspace(db, wsA, { slug: "short-code-a", name: "A" });
      await createWorkspace(db, wsB, { slug: "short-code-b", name: "B" });
      const { shortCode } = await createTest(db, wsA, { name: "A", slug: "a" });

      // The code `createTest` just minted in workspace A, inserted again
      // directly for workspace B — the unique index is what has to refuse
      // this, not application code that happens to call `createTest` once
      // per short code.
      //
      // Wrapped in an `async` function rather than awaited inline:
      // better-sqlite3's `run()` throws synchronously on a constraint
      // violation, which `expect(db.run(...)).rejects` cannot catch — the
      // throw happens while the argument is still being evaluated, before
      // there is a promise for `.rejects` to attach to.
      const insertCollidingRow = async (): Promise<void> => {
        await db.run(
          "INSERT INTO test (id, workspace_id, slug, name, description, short_code, status, " +
            "review_requested, current_version, tags_json, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, NULL, ?, 'draft', 0, NULL, ?, 0, NULL)",
          [newId("tst"), wsB, "b", "B", shortCode, db.jsonParam([])],
        );
      };
      await expect(insertCollidingRow()).rejects.toThrow(/unique|constraint/i);
    });

    // Task 9 (#60 / #56, P5.7b): the candidate list's own columns.
    it("the candidate list columns exist in both dialects and consent_version is nullable", () => {
      for (const read of [sqliteByName, pgByName]) {
        const columns = read.get("candidate")?.columns ?? [];
        expect(columns.map((c) => c.name)).toEqual(
          expect.arrayContaining(["external_id", "set_label", "source"]),
        );
        // A listed candidate has not consented yet, and null is exactly
        // that — Phase 2 declared the column NOT NULL, which this task's
        // migration drops in both dialects.
        expect(columns.find((c) => c.name === "consent_version")?.notNull).toBe(false);
        expect(columns.find((c) => c.name === "source")?.notNull).toBe(true);
      }
      expect(tableSpec("candidate").uniques).toContainEqual(["test_id", "external_id"]);
    });

    it("two list rows cannot share an external_id within one test, but two tests may", async () => {
      const client = sqliteClient(":memory:");
      try {
        await migrate(client);
        const ws = newId("wsp");
        await createWorkspace(client, ws, { slug: "candidates", name: "C" });
        const one = await createTest(client, ws, { name: "One", slug: "one" });
        const two = await createTest(client, ws, { name: "Two", slug: "two" });

        await replaceCandidateList(client, ws, one.id, [LISTED], 0);
        // The same identity in a different test is an ordinary thing: a
        // college runs two tests for one cohort.
        await expect(replaceCandidateList(client, ws, two.id, [LISTED], 0)).resolves.toEqual({
          imported: 1,
        });

        // Two rows with the same identity in *one* file. Phase 6 Task 3
        // made the insert `ON CONFLICT DO NOTHING` so a re-upload cannot
        // destroy a registered candidate, which means the index no longer
        // *refuses* an in-file duplicate — it absorbs it. The organiser is
        // still told: `convertCandidateCsv` reports a duplicate identity
        // with the line number of its first occurrence and the route
        // writes nothing when it does. What the storage floor guarantees
        // now is that the identity exists exactly once however many times
        // the file named it.
        await replaceCandidateList(client, ws, one.id, [LISTED, LISTED], 0);
        expect(
          await client.all("SELECT id FROM candidate WHERE test_id = '" + one.id + "'"),
        ).toHaveLength(1);
      } finally {
        closeClient(client);
      }
    });
  });
});

describe("the constraints the PRD names", () => {
  it("every tenant table carries workspace_id and indexes it", () => {
    for (const spec of TABLE_MANIFEST.filter((t) => t.tenant)) {
      const columns = sqliteByName.get(spec.name)?.columns.map((c) => c.name);
      expect(columns).toContain("workspace_id");
      expect(sqliteByName.get(spec.name)?.indexes.flat()).toContain("workspace_id");
      expect(pgByName.get(spec.name)?.indexes.flat()).toContain("workspace_id");
    }
  });

  it("every timestamp column is an integer of epoch milliseconds in both dialects", () => {
    for (const { table, column } of timestampColumns()) {
      const sqlite = sqliteByName
        .get(table)
        ?.columns.find((c) => c.name === column);
      const pg = pgByName.get(table)?.columns.find((c) => c.name === column);
      // bigint in Postgres, because a millisecond epoch overflows int4 in 1970.
      expect(`${table}.${column}=${sqlite?.sqlType}`).toBe(
        `${table}.${column}=integer`,
      );
      expect(`${table}.${column}=${pg?.sqlType}`).toBe(`${table}.${column}=bigint`);
    }
  });

  it("response is unique on (attempt_id, question_id) — the upsert target", () => {
    expect(tableSpec("response").uniques).toContainEqual([
      "attempt_id",
      "question_id",
    ]);
    expect(sqliteByName.get("response")?.uniques).toContainEqual([
      "attempt_id",
      "question_id",
    ]);
    expect(pgByName.get("response")?.uniques).toContainEqual([
      "attempt_id",
      "question_id",
    ]);
  });

  // Phase 8a Task 1 (K10, K42, K43).
  it("0009 adds webhook_delivery and the by-question index", () => {
    const names = TABLE_MANIFEST.map((t) => t.name);
    expect(names).toContain("webhook_delivery");

    const response = TABLE_MANIFEST.find((t) => t.name === "response");
    expect(response?.indexes).toContainEqual(["workspace_id", "question_id"]);
  });

  it("Phase 8g Task 3: adds the broadcast columns (C-10, K12, K13)", () => {
    const cols = TABLE_MANIFEST.find((t) => t.name === "attempt")!.columns.map(
      (c) => c.name,
    );
    expect(cols).toContain("proctor_message");
    expect(cols).toContain("proctor_message_at");
    // Control: the assertion above is only meaningful if this lookup resolves.
    expect(cols).toContain("integrity_flag");
  });

  it("a bank's questions carry their in-file id, unique within the bank", () => {
    // `ref_id` is the `id` a `pariksha/bank@1` file carries, not the row's
    // `qst_…`. Export has to hand back what import read, and two questions
    // in one bank answering to the same name would make that ambiguous.
    expect(tableSpec("question").uniques).toContainEqual(["bank_id", "ref_id"]);
    expect(sqliteByName.get("question")?.uniques).toContainEqual([
      "bank_id",
      "ref_id",
    ]);
    expect(pgByName.get("question")?.uniques).toContainEqual(["bank_id", "ref_id"]);
  });

  it("stores no rendered HTML, in either dialect (ADR 0004)", () => {
    // Markdown is the only stored representation, so there is no cache to
    // keep in step with the source and no stored-HTML XSS surface. A column
    // appearing here would reintroduce both without any other test noticing.
    for (const column of ["prompt_html", "explanation_html", "render_version"]) {
      expect(sqliteByName.get("question")?.columns.map((c) => c.name)).not.toContain(
        column,
      );
      expect(pgByName.get("question")?.columns.map((c) => c.name)).not.toContain(
        column,
      );
    }
  });

  it("stores only a hash for anything that authenticates a request", () => {
    // S-03 and the API-key rule: a database dump must not yield a live
    // session, a live attempt token or a usable API key.
    expect(tableSpec("session").columns.map((c) => c.name)).toContain("token_hash");
    expect(tableSpec("attempt").columns.map((c) => c.name)).toContain("token_hash");
    expect(tableSpec("api_key").columns.map((c) => c.name)).toContain("secret_hash");
    for (const table of ["session", "attempt", "api_key"]) {
      for (const column of tableSpec(table).columns) {
        expect(column.name).not.toMatch(/^(token|secret)$/);
      }
    }
  });
});
