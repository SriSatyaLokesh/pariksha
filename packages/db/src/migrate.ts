// The migration runner. One implementation for all three dialects, because
// drizzle-kit's own runner is a build-time tool and D1 has neither a
// filesystem nor a shell at runtime.

import type { DbClient } from "./client.js";
import {
  sqliteMigrations,
  pgMigrations,
  type Migration,
} from "./migrations.generated.js";

/** Where applied migration names are recorded. Created on first use. */
export const MIGRATIONS_TABLE = "_migrations";

function migrationsFor(db: DbClient): Migration[] {
  // D1 is SQLite: same dialect, same files.
  return db.dialect === "pg" ? pgMigrations : sqliteMigrations;
}

/**
 * Applies every migration the database has not recorded yet, in name order,
 * and returns the ones it applied. Running it twice applies nothing the
 * second time, so it is safe on every boot and in every deployment.
 */
export async function migrate(db: DbClient): Promise<{ applied: string[] }> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (` +
      `name text PRIMARY KEY NOT NULL, ` +
      `applied_at ${db.dialect === "pg" ? "bigint" : "integer"} NOT NULL)`,
  );

  const done = new Set(
    (
      await db.all<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`)
    ).map((row) => row.name),
  );

  const applied: string[] = [];
  for (const migration of migrationsFor(db)) {
    if (done.has(migration.name)) continue;

    for (const statement of migration.statements) {
      await db.exec(statement);
    }
    // Recorded after the statements, so a migration that fails half way is
    // retried rather than silently skipped on the next boot.
    await db.exec(
      `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES (` +
        `'${migration.name.replace(/'/g, "''")}', ${Date.now()})`,
    );
    applied.push(migration.name);
  }

  return { applied };
}
