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

// `response.points` is fractional in the normal case, not the exceptional one:
// `partial` scoring is points × (correct parts − wrong parts) ÷ total parts and
// `position` is points × items in place ÷ items, neither of which lands on an
// integer except by coincidence. packages/core rounds every question, section
// and attempt total to 2dp, so this column's whole job is to hand back exactly
// what core computed — including a negative, which `negative` scoring produces.
//
// SQLite will not fail this on the value alone: it has type *affinity*, not
// types, and a column with INTEGER affinity handed 2.33 cannot convert it
// losslessly, so it quietly stores a REAL. Only Postgres rejects or rounds.
// The declared type is asserted next to the value so that a wrong column class
// is red on a laptop too, and not only in the job that has a Postgres.
const FRACTIONAL = [2.33, 0.125, -0.75];

async function roundTripPoints(db: DbClient): Promise<number[]> {
  const read: number[] = [];
  for (const [i, points] of FRACTIONAL.entries()) {
    const id = `rsp_frac_${i}`;
    await db.run(
      "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      // A literal rather than `db.jsonParam`, which is not what is under test
      // here: `value_json` only has to be non-null so the insert reaches the
      // column that is.
      [id, "ws_frac", "att_frac", `q_${i}`, "{}", 0, 1, points],
    );
    const rows = await db.query<{ points: number | string }>(
      "SELECT points FROM response WHERE id = ?",
      [id],
    );
    // Postgres hands `numeric` back as a string, exactly as the repository
    // layer already assumes where it reads this column with `Number(…)`.
    read.push(Number(rows[0]?.points));
  }
  return read;
}

// The `(bank_id, ref_id)` unique index, exercised rather than read off the
// schema: `parity.test.ts` can only say the index is declared, and a declared
// index that the migration never created would still pass there. `tags_json`
// is written as a JSON literal — jsonb in Postgres, text in SQLite — so this
// is also a real JSON write on both dialects and not a SQLite-only path.
async function insertQuestion(
  db: DbClient,
  id: string,
  refId: string,
): Promise<void> {
  await db.run(
    "INSERT INTO question (id, workspace_id, bank_id, ref_id, type, prompt_md, points, tags_json, version, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, "ws_ref", "bnk_ref", refId, "single", "Prompt", 1, "[]", 1, 0, 0],
  );
}

async function pointsColumnType(db: DbClient): Promise<string> {
  const rows =
    db.dialect === "pg"
      ? await db.all<{ type: string }>(
          "select data_type as type from information_schema.columns " +
            "where table_name = 'response' and column_name = 'points'",
        )
      : await db.all<{ type: string }>(
          "select type from pragma_table_info('response') where name = 'points'",
        );
  return (rows[0]?.type ?? "").toLowerCase();
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

  it("stores a fractional points value and gives it back unchanged", async () => {
    expect(await roundTripPoints(db)).toEqual(FRACTIONAL);
    expect(await pointsColumnType(db)).toBe("real");
  });

  it("refuses two questions with the same ref_id in one bank", async () => {
    await insertQuestion(db, "qst_ref_a", "SQL-09");
    await expect(insertQuestion(db, "qst_ref_b", "SQL-09")).rejects.toThrow(
      /unique|constraint/i,
    );
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

  it("stores a fractional points value and gives it back unchanged", async () => {
    expect(await roundTripPoints(db)).toEqual(FRACTIONAL);
    expect(await pointsColumnType(db)).toBe("numeric");
  });

  it("refuses two questions with the same ref_id in one bank", async () => {
    await insertQuestion(db, "qst_ref_a", "SQL-09");
    await expect(insertQuestion(db, "qst_ref_b", "SQL-09")).rejects.toThrow(
      /unique|constraint/i,
    );
  });
});
