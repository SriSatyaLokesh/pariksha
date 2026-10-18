// The only test in the repository that runs against a real D1 engine.
// Everything else exercises the schema through better-sqlite3, which accepts
// SQL D1 rejects — notably `PRAGMA foreign_keys`, which D1 refuses mid
// migration because every statement already runs in an implicit transaction
// (#160). Miniflare embeds D1's own implementation, so this is where the two
// table-rebuild migrations are first proved rather than reasoned about.

import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import { d1Client, migrate } from "@pariksha/db";
import type { D1Database } from "@cloudflare/workers-types";

const binding = () => d1Client((env as { DB: D1Database }).DB);

/** `sqlite_master` is the only portable way to ask SQLite what it built. */
async function sql(table: string): Promise<string> {
  const [row] = await binding().query<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE name = ?",
    [table],
  );
  return row?.sql ?? "";
}

it("every migration applies against the Miniflare D1 binding", async () => {
  const { applied } = await migrate(binding());

  // Named, not counted: a run that silently applied three of four would
  // still satisfy a count taken from the same bundle it is checking.
  expect(applied).toEqual([
    "0000_calm_blizzard.sql",
    "0001_last_vengeance.sql",
    "0002_dapper_wilson_fisk.sql",
    "0003_absent_hemingway.sql",
  ]);

  // The two table rebuilds are the statements D1 could reject, so the test
  // asserts their result rather than trusting the runner's own bookkeeping:
  // `points real` only exists if 0002 ran, `ref_id` only if 0003 did.
  expect(await sql("question")).toContain("`points` real");
  expect(await sql("question")).toContain("`ref_id` text");
  expect(await sql("question_bank")).toContain("`description` text");
  expect(await sql("auth_token")).toContain("`token_hash` text");
  expect(await sql("question_bank_ref_uq")).toContain("`bank_id`,`ref_id`");
});

it("a second run applies nothing", async () => {
  await migrate(binding());

  expect((await migrate(binding())).applied).toEqual([]);
});

// Task 7 (#51), Review Focus item 3: `d1Client`'s `batch()` is
// `binding.batch()` — one D1 subrequest carrying every statement. Miniflare
// embeds the real D1 engine, so this is where that claim is proved against
// an actual implicit-transaction batch, not just reasoned about.
it("db.batch() against the real D1 binding commits as one unit and rolls back whole on a conflict", async () => {
  const db = binding();
  await migrate(db);

  const insert = (id: string, bankId: string, refId: string) => ({
    sql:
      "INSERT INTO question (id, workspace_id, bank_id, ref_id, type, prompt_md, points, tags_json, version, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    params: [id, "ws_d1batch", bankId, refId, "single", "Prompt", 1, "[]", 1, 0, 0],
  });

  await db.batch([
    insert("qst_d1_a", "bnk_d1batch", "D1-01"),
    insert("qst_d1_b", "bnk_d1batch", "D1-02"),
  ]);
  const committed = await db.query<{ ref_id: string }>(
    "SELECT ref_id FROM question WHERE bank_id = ? ORDER BY ref_id",
    ["bnk_d1batch"],
  );
  expect(committed.map((r) => r.ref_id)).toEqual(["D1-01", "D1-02"]);

  await expect(
    db.batch([
      insert("qst_d1_rb_a", "bnk_d1rollback", "D1-RB"),
      insert("qst_d1_rb_b", "bnk_d1rollback", "D1-RB"),
    ]),
  ).rejects.toThrow();
  const rolledBack = await db.query(
    "SELECT ref_id FROM question WHERE bank_id = ?",
    ["bnk_d1rollback"],
  );
  expect(rolledBack).toEqual([]);
});

it("the worker entry serves health over the D1 and R2 bindings", async () => {
  await migrate(binding());

  const res = await SELF.fetch("https://example.com/api/v1/health");

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    status: "ok",
    dialect: "d1",
    migrations: 4,
  });
});

// One Worker serves the API and the static site, so the asset router sits in
// front of the Hono app. These two assert the split holds in the runtime that
// enforces it: `errors.test.ts` calls the app directly and would pass either
// way, which is exactly how a production-only regression gets shipped.

it("an unknown /api path answers with the JSON error envelope, not the 404 page", async () => {
  const res = await SELF.fetch("https://example.com/api/v1/nope");

  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
});

it("an unknown non-API path answers with the static 404 page", async () => {
  const res = await SELF.fetch("https://example.com/nope");

  expect(res.status).toBe(404);
  expect(await res.text()).toContain("fixture-404");
});
