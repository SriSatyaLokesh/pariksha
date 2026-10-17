// One client type over three dialects. Everything above this file — the
// repository layer, the API — is written against `DbClient` and never against
// a driver, which is the seam ADR 0002 names: an organiser who outgrows the
// Cloudflare free plan moves to Docker and Postgres without a rewrite.

import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import Database from "better-sqlite3";
import postgres from "postgres";
import type { D1Database } from "@cloudflare/workers-types";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type Dialect = "d1" | "sqlite" | "pg";

/**
 * The raw surface every dialect shares. The repository layer uses `drizzle`
 * for typed queries; `exec` and `all` exist for the two things Drizzle's
 * query builder cannot express portably — applying a migration file, and
 * asking the database what it contains.
 */
interface RawOps {
  /** Run one or more statements for their effect. */
  exec(sql: string): Promise<void>;
  /** Run one statement and return its rows. */
  all<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /** Release the underlying connection. A no-op on D1. */
  close(): Promise<void>;
}

export type DbClient =
  | ({ dialect: "sqlite"; drizzle: BetterSQLite3Database } & RawOps)
  | ({ dialect: "d1"; drizzle: DrizzleD1Database } & RawOps)
  | ({ dialect: "pg"; drizzle: PostgresJsDatabase } & RawOps);

/** Node and Docker, and the dev server. `:memory:` is a fresh database. */
export function sqliteClient(path: string): DbClient {
  const sqlite = new Database(path);
  // Without this a crash between the write and the commit can leave a
  // half-written answer; WAL also stops a reader blocking the answer upsert.
  sqlite.pragma("journal_mode = WAL");
  return {
    dialect: "sqlite",
    drizzle: drizzleSqlite(sqlite),
    exec: (sql) => Promise.resolve(void sqlite.exec(sql)),
    all: <T>(sql: string) => Promise.resolve(sqlite.prepare(sql).all() as T[]),
    close: () => {
      sqlite.close();
      return Promise.resolve();
    },
  };
}

/** Cloudflare Workers. The binding comes from the Worker's env. */
export function d1Client(binding: D1Database): DbClient {
  return {
    dialect: "d1",
    drizzle: drizzleD1(binding),
    exec: async (sql) => {
      await binding.exec(stripForD1Exec(sql));
    },
    all: async <T>(sql: string) => {
      const { results } = await binding.prepare(sql).all<T>();
      return results;
    },
    // D1 is a binding, not a connection: there is nothing to release.
    close: () => Promise.resolve(),
  };
}

/** Postgres, for installs too large for SQLite. */
export function pgClient(url: string): DbClient {
  const sql = postgres(url, { max: 4 });
  return {
    dialect: "pg",
    drizzle: drizzlePg(sql),
    exec: async (statement) => {
      await sql.unsafe(statement);
    },
    all: async <T>(statement: string) =>
      (await sql.unsafe(statement)) as unknown as T[],
    close: () => sql.end(),
  };
}

export function closeClient(db: DbClient): Promise<void> {
  return db.close();
}

/**
 * `D1Database.exec` takes statements one per line and rejects comments, so a
 * multi-statement migration file has to be flattened before it is handed over.
 */
function stripForD1Exec(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .join(";\n");
}
