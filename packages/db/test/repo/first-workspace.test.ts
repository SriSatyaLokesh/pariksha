import { afterAll, describe, expect, it } from "vitest";
import {
  sqliteClient,
  pgClient,
  closeClient,
  type DbClient,
} from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import { createFirstWorkspace } from "../../src/repo/workspaces.js";
import { anyWorkspaceExists } from "../../src/repo/identity.js";

// `createFirstWorkspace` is the only statement in the repository layer that
// is an `INSERT ... SELECT ... WHERE NOT EXISTS` rather than an
// `INSERT ... VALUES`, and it is the one thing standing between two
// simultaneous first-run completions and two instance owners. Both halves of
// that are dialect-sensitive: SQLite has to accept a `SELECT` with no `FROM`
// carrying a `WHERE`, and Postgres has to take each bare parameter's type
// from the insert's target columns rather than defaulting it to text, which
// would reject `created_at`. So it is exercised on both, like the migrations.
//
// Locally Postgres skips; in CI `migrate.test.ts` already fails the build
// when TEST_POSTGRES_URL is missing, so a skip there cannot pass unnoticed.
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = POSTGRES_URL ? describe : describe.skip;

async function claimTwice(db: DbClient): Promise<boolean[]> {
  await migrate(db);
  // Postgres keeps its database between runs, and the claim is only
  // observable on an instance nobody has claimed yet.
  await db.run("DELETE FROM membership");
  await db.run("DELETE FROM workspace");

  const claim = (slug: string) =>
    createFirstWorkspace(db, newId("wsp"), {
      slug,
      name: slug,
      now: 1_760_000_000_000,
    });
  return [await claim("alpha"), await claim("beta")];
}

async function workspaceCount(db: DbClient): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM workspace",
  );
  return Number(rows[0]?.n);
}

describe("sqlite", () => {
  const db = sqliteClient(":memory:");
  afterAll(() => closeClient(db));

  it("the first claim on the instance wins and the second is refused", async () => {
    expect(await claimTwice(db)).toEqual([true, false]);
    expect(await anyWorkspaceExists(db)).toBe(true);
    expect(await workspaceCount(db)).toBe(1);
  });
});

describePostgres("postgres", () => {
  const db = pgClient(POSTGRES_URL ?? "");
  afterAll(() => closeClient(db));

  it("the first claim on the instance wins and the second is refused", async () => {
    expect(await claimTwice(db)).toEqual([true, false]);
    expect(await anyWorkspaceExists(db)).toBe(true);
    expect(await workspaceCount(db)).toBe(1);
  });
});
