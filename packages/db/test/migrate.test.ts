import { afterAll, describe, expect, it } from "vitest";
import { sqliteClient, pgClient, closeClient, type DbClient } from "../src/client.js";
import { migrate, MIGRATIONS_TABLE } from "../src/migrate.js";
import { TABLE_NAMES } from "../src/schema/columns.js";

// Locally the Postgres cases skip rather than fail, so a contributor without
// a database can still run the suite. In CI they are mandatory: a skip there
// means the dual-dialect gate has quietly stopped gating, which is exactly
// what happened once already — Turborepo runs tasks in a filtered environment
// and did not pass TEST_POSTGRES_URL through, so the job went green with the
// Postgres cases never running. Silence must not look like success.
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const IN_CI = process.env.CI === "true";
const describePostgres = POSTGRES_URL ? describe : describe.skip;

describe("the Postgres gate", () => {
  it("is not allowed to skip in CI", () => {
    expect(IN_CI && !POSTGRES_URL).toBe(false);
  });
});

async function tableNamesIn(db: DbClient): Promise<string[]> {
  const rows =
    db.dialect === "pg"
      ? await db.all<{ name: string }>(
          "select table_name as name from information_schema.tables where table_schema = 'public'",
        )
      : await db.all<{ name: string }>(
          "select name from sqlite_master where type = 'table'",
        );
  return rows.map((r) => r.name);
}

describe("sqlite", () => {
  const db = sqliteClient(":memory:");
  afterAll(() => closeClient(db));

  it("applies every migration to an empty database and creates every table", async () => {
    const { applied } = await migrate(db);

    expect(applied.length).toBeGreaterThan(0);
    expect(await tableNamesIn(db)).toEqual(expect.arrayContaining([...TABLE_NAMES]));
  });

  it("is idempotent: running twice applies nothing the second time", async () => {
    expect((await migrate(db)).applied).toEqual([]);
  });

  it("records what it applied, so a later migration is the only thing that runs", async () => {
    const rows = await db.all<{ name: string }>(
      `select name from ${MIGRATIONS_TABLE} order by name`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.name.endsWith(".sql"))).toBe(true);
  });
});

describePostgres("postgres", () => {
  const db = pgClient(POSTGRES_URL ?? "");
  afterAll(() => closeClient(db));

  it("applies the same migrations and creates the same tables", async () => {
    await migrate(db);
    expect(await tableNamesIn(db)).toEqual(expect.arrayContaining([...TABLE_NAMES]));
  });

  it("is idempotent on Postgres too", async () => {
    expect((await migrate(db)).applied).toEqual([]);
  });
});
