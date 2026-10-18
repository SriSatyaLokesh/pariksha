import { describe, expect, it } from "vitest";
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
