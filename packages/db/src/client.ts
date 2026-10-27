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
  /** Run one or more statements for their effect. No parameters: migrations only. */
  exec(sql: string): Promise<void>;
  /** Run one statement with no parameters and return its rows. */
  all<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  /**
   * Run one parameterised statement and return its rows. `?` marks a
   * parameter in every dialect; the Postgres client rewrites them to `$n`.
   * Every value a caller supplies goes through here — identifiers are written
   * as text, values are never interpolated.
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run one parameterised statement for its effect, and say how many rows it changed. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /**
   * Task 7 (#51), Review Focus item 3: every statement, in one round trip —
   * `binding.batch()` on D1 (one subrequest against the 50-subrequest
   * ceiling, however many statements it carries), `BEGIN … COMMIT` around
   * them on `better-sqlite3`, `sql.begin` on `postgres` — and the whole
   * group commits or none of it does. `upsertQuestions`
   * (packages/db/src/repo/banks.ts) is the first caller: N single-row writes
   * costs ~2N subrequests, one `batch()` costs one no matter how big N gets.
   *
   * **Returns one `{ changes }` per statement, in order** (Phase 6 Task 10).
   * D1 already answers a `D1Result` per statement and the other two drivers
   * answer a row count per statement; dropping it used to be free because
   * every caller wrote blind. `upsertResponse` is the first that cannot:
   * its upsert is conditional on `excluded.client_seq`, so whether the row
   * moved is the difference between the wire words `accepted` and
   * `superseded` — and `max_index` has to rise in the *same* subrequest or
   * the hot path's pinned budget of 2 becomes 3. Reporting what the batch
   * did is what lets both be true at once.
   */
  batch(
    statements: readonly { sql: string; params?: unknown[] }[],
  ): Promise<{ changes: number }[]>;
  /**
   * Encode a value bound for a JSON column. SQLite stores JSON as text and
   * Postgres as jsonb, so the two drivers want different things — the one
   * place that difference is allowed to live.
   */
  jsonParam(value: unknown): unknown;
  /** Decode a value read from a JSON column. */
  jsonValue<T = unknown>(raw: unknown): T;
  /** Release the underlying connection. A no-op on D1. */
  close(): Promise<void>;
}

/** SQLite and D1 store JSON as text; Postgres hands back a parsed value. */
function parseJsonText<T>(raw: unknown): T {
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
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
    query: <T>(sql: string, params: unknown[] = []) =>
      Promise.resolve(sqlite.prepare(sql).all(...params) as T[]),
    run: (sql, params = []) => {
      const { changes } = sqlite.prepare(sql).run(...params);
      return Promise.resolve({ changes });
    },
    // `sqlite.transaction()` wraps the callback in `BEGIN`/`COMMIT` and
    // rolls back automatically if it throws. Not `async`: better-sqlite3 is
    // synchronous end to end, so a thrown error is caught here and turned
    // into a rejected Promise explicitly rather than by the usual
    // `async`-function mechanism, which an `await`-free async body is not
    // actually using.
    batch: (statements) => {
      try {
        const run = sqlite.transaction((stmts: readonly { sql: string; params?: unknown[] }[]) =>
          stmts.map((s) => ({ changes: sqlite.prepare(s.sql).run(...(s.params ?? [])).changes })),
        );
        return Promise.resolve(run(statements));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
    jsonParam: (value) => JSON.stringify(value),
    jsonValue: parseJsonText,
    close: () => {
      sqlite.close();
      return Promise.resolve();
    },
  };
}

/**
 * What D1 says each statement changed — **surfaced, never defaulted.**
 *
 * Cloudflare documents `changes` on `D1Result` for both `run()` and
 * `batch()` (developers.cloudflare.com/d1/worker-api/return-object), so a
 * `?? 0` here is defensive code that can only ever lie, and it lies in the
 * one direction that loses work: `changes > 0` is how `upsertResponse`
 * decides `accepted` against `superseded` (and Task 8's queue **drops** a
 * `superseded`), how first-writer-wins submission is decided, and how every
 * `deleted:` in `banks.ts` and `tests.ts` is answered. `?? 1` is worse, for
 * the same three reasons pointing the other way. If the field is ever
 * genuinely absent that is a D1 contract change, and it has to arrive as a
 * 500 somebody reads rather than as a silently wrong word on the wire.
 */
function d1Changes(meta: { changes?: number }): number {
  if (typeof meta.changes !== "number") {
    throw new Error("D1 returned a result with no `changes`; refusing to guess what it wrote.");
  }
  return meta.changes;
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
    query: async <T>(sql: string, params: unknown[] = []) => {
      const { results } = await binding
        .prepare(sql)
        .bind(...params)
        .all<T>();
      return results;
    },
    run: async (sql, params = []) => {
      const { meta } = await binding
        .prepare(sql)
        .bind(...params)
        .run();
      return { changes: d1Changes(meta) };
    },
    // One `binding.batch()` call — one subrequest — carrying every prepared
    // statement. D1 runs a batch inside an implicit transaction and rejects
    // the whole thing if any statement fails.
    batch: async (statements) => {
      const results = await binding.batch(
        statements.map((s) => binding.prepare(s.sql).bind(...(s.params ?? []))),
      );
      return results.map((result) => ({ changes: d1Changes(result.meta) }));
    },
    jsonParam: (value) => JSON.stringify(value),
    jsonValue: parseJsonText,
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
    query: async <T>(statement: string, params: unknown[] = []) =>
      (await sql.unsafe(toNumberedPlaceholders(statement), params as never[])) as unknown as T[],
    run: async (statement, params = []) => {
      const result = await sql.unsafe(
        toNumberedPlaceholders(statement),
        params as never[],
      );
      return { changes: result.count };
    },
    // `sql.begin` opens a transaction, commits on a resolved callback and
    // rolls back on a rejected one — the transaction-scoped `tx`, not the
    // outer `sql`, is what every statement in the batch must run through.
    batch: async (statements) => {
      const counts: { changes: number }[] = [];
      await sql.begin(async (tx) => {
        for (const s of statements) {
          const result = await tx.unsafe(toNumberedPlaceholders(s.sql), (s.params ?? []) as never[]);
          counts.push({ changes: result.count });
        }
      });
      return counts;
    },
    jsonParam: (value) => JSON.stringify(value),
    // postgres.js already parses jsonb columns into JS values; don't re-parse.
    jsonValue: <T>(raw: unknown) => raw as T,
    close: () => sql.end(),
  };
}

export function closeClient(db: DbClient): Promise<void> {
  return db.close();
}

/**
 * Repository SQL is written once with `?` placeholders, because SQLite and D1
 * both take them. Postgres numbers its parameters instead, so they are
 * rewritten here — the only dialect difference in the query path, and it is
 * mechanical. A `?` inside a string literal would be rewritten wrongly, which
 * is why no repository function puts one there: values are bound, never
 * written into the SQL.
 */
function toNumberedPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
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
