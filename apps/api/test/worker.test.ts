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
    "0004_cold_blob.sql",
    "0005_cold_list.sql",
    "0006_candid_registration.sql",
    "0007_attempt_progress.sql",
    "0008_attempt_integrity.sql",
    "0009_results_and_delivery.sql",
  ]);

  // The four table rebuilds are the statements D1 could reject, so the test
  // asserts their result rather than trusting the runner's own bookkeeping:
  // `points real` only exists if 0002 ran, `ref_id` only if 0003 did,
  // `short_code` only if 0004's `test` rebuild did, and a nullable
  // `consent_version` only if 0005's `candidate` rebuild did.
  expect(await sql("question")).toContain("`points` real");
  expect(await sql("question")).toContain("`ref_id` text");
  expect(await sql("question_bank")).toContain("`description` text");
  expect(await sql("auth_token")).toContain("`token_hash` text");
  expect(await sql("question_bank_ref_uq")).toContain("`bank_id`,`ref_id`");
  expect(await sql("test")).toContain("`short_code` text");
  expect(await sql("test_short_code_uq")).toContain("`short_code`");
  // 0005: SQLite cannot drop a NOT NULL with ALTER TABLE, so this only
  // reads back without one if the rebuild actually ran on D1.
  expect(await sql("candidate")).toContain("`external_id` text");
  expect(await sql("candidate")).toContain("`consent_version` text,");
  expect(await sql("candidate")).not.toContain("`consent_version` text NOT NULL");
  expect(await sql("candidate_test_external_uq")).toContain("`test_id`,`external_id`");
  // 0008: an ADD COLUMN is also a statement D1 could reject — it accepts
  // only one per ALTER TABLE, which is why the migration is two statements
  // and not one — so this proves both columns actually exist against the
  // real engine rather than trusting the runner's bookkeeping.
  expect(await sql("attempt")).toContain("`integrity_flag` text");
  expect(await sql("attempt")).toContain("`observed` integer");
  // 0009 (K10, K42, K43): a CREATE TABLE and two CREATE INDEXes, proved
  // against the real engine rather than trusted from the bundle.
  expect(await sql("webhook_delivery")).toContain("`webhook_id` text");
  expect(await sql("response_workspace_question_idx")).toContain(
    "`workspace_id`,`question_id`",
  );
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

  // Phase 6 Task 10: and it says what each statement changed, in order.
  // `upsertResponse` decides `accepted` against `superseded` out of this
  // number — and `d1Client` now throws rather than defaulting an absent
  // `meta.changes` to 0, so this is where the claim that D1 really reports
  // it is proved against the engine instead of against the documentation.
  const changes = await db.batch([
    insert("qst_d1_c", "bnk_d1changes", "D1-C1"),
    { sql: "UPDATE question SET ref_id = ? WHERE bank_id = ?", params: ["D1-C2", "bnk_d1nobody"] },
    { sql: "UPDATE question SET ref_id = ? WHERE bank_id = ?", params: ["D1-C3", "bnk_d1changes"] },
  ]);
  expect(changes.map((one) => one.changes)).toEqual([1, 0, 1]);
  // And the single-statement path, which `upsertResponse` takes whenever
  // the candidate re-edits an answer in place.
  expect((await db.run("UPDATE question SET ref_id = ? WHERE bank_id = ?", ["D1-C4", "bnk_d1nobody"])).changes).toBe(0);

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
    migrations: 10,
  });
});

// One Worker serves the API and the static site, so the entry point has to
// split the two. These assert the split in the runtime that enforces it:
// `errors.test.ts` calls the app directly and would pass either way, which
// is exactly how a production-only regression gets shipped.

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

// Phase 5 Task 2 (#54): `/t/:code` is outside `/api/` too, so it needs the
// same `run_worker_first` entry — and the entry point has to send it to
// Hono rather than to the binding, which is the half asserted here. The
// config entry itself is not exercised by this pool; see the note below.
it("an unknown short code answers with the JSON error envelope, not the static 404 page", async () => {
  await migrate(binding());

  const res = await SELF.fetch("https://example.com/t/zzzzzz");

  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.text()).not.toContain("fixture-404");
});

// Phase 6 (T-02), the candidate URL `/<workspace-slug>/<test-slug>`. The
// first attempt put these rules in `_redirects` and tested the FILE'S
// CONTENT; the rules were inert, production served `/assets/<hashed>.css` as
// a 307 to `/exam`, and every test stayed green (fb42d41). These exercise
// the entry point's own routing instead — every path shape it has to tell
// apart, through the binding, against the real asset fixtures.
//
// WHAT THESE CANNOT COVER, measured rather than assumed: `SELF.fetch` in
// this pool invokes the script for EVERY path, under any `run_worker_first`
// — probed with a script that echoed its own pathname, under the old
// `["/api/*", "/t/*"]` and the new list alike, and it answered
// `/assets/style-k5IQwTyP.css` and `/` in both. The asset router does not
// sit in front of the script here; only the `ASSETS` binding is real, which
// is why `not_found_handling` IS observable (flip it to
// `single-page-application` and three tests below fail) and
// `run_worker_first` is not. So no test here can prove the config line that
// routes a candidate URL to the script in production — `hosting.test.ts`
// pins the string and says the same thing out loud. What these prove is the
// half that broke: given the request, the script answers it correctly.

it("a candidate URL answers 200 with the exam shell, at the URL the candidate opened", async () => {
  const res = await SELF.fetch("https://example.com/pariksha/test1", {
    redirect: "manual",
  });

  // 200 and not 307: `exam-main.tsx` reads the slug pair out of
  // `window.location`, so a redirect that drops it — which is what
  // `html_handling` made of `_redirects`' rewrite to `/exam.html` — loses
  // the one thing the rule exists to carry.
  expect(res.status).toBe(200);
  expect(res.url).toBe("https://example.com/pariksha/test1");
  expect(res.headers.get("location")).toBeNull();
  expect(await res.text()).toContain("fixture-exam");
});

it("serves the shell for a trailing slash too, which `slugPairFromPath` also accepts", async () => {
  const res = await SELF.fetch("https://example.com/pariksha/test1/", {
    redirect: "manual",
  });

  expect(res.status).toBe(200);
  expect(await res.text()).toContain("fixture-exam");
});

// The whole of the outage in two assertions. `/assets/*` is two segments,
// which is the shape the candidate URL claims, so this is the exact
// collision that took the site down. `wrangler.toml` excludes `/assets/*`
// from `run_worker_first`, but this asserts the second line of defence —
// the dot in every hashed filename, which no slug may contain — because the
// first line is a config entry no test here can exercise.
it("never serves the exam shell for an asset path", async () => {
  const hit = await SELF.fetch(
    "https://example.com/assets/style-k5IQwTyP.css",
    { redirect: "manual" },
  );

  expect(hit.status).toBe(200);
  expect(hit.headers.get("location")).toBeNull();
  const css = await hit.text();
  expect(css).toContain(".fixture");
  expect(css).not.toContain("fixture-exam");

  // And an asset that does not exist is still a 404, not a soft-200 shell.
  const miss = await SELF.fetch("https://example.com/assets/nope.css", {
    redirect: "manual",
  });

  expect(miss.status).toBe(404);
  expect(await miss.text()).not.toContain("fixture-exam");
});

it("never serves the exam shell for a font", async () => {
  const res = await SELF.fetch("https://example.com/fonts/anek-latin.woff2", {
    redirect: "manual",
  });

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("font");
});

it("still serves the landing page and the organiser app as their own documents", async () => {
  const home = await SELF.fetch("https://example.com/");
  expect(home.status).toBe(200);
  expect(await home.text()).toContain("fixture-index");

  const admin = await SELF.fetch("https://example.com/admin");
  expect(admin.status).toBe(200);
  expect(await admin.text()).toContain("fixture-admin");
});

// `/*/*` is a DEEP match, so in production three segments reach the script
// too. `CANDIDATE_URL` is anchored at two, so they land where they did
// before: `not_found_handling`.
it("a deeper miss still answers with the static 404 page, not the shell", async () => {
  const res = await SELF.fetch("https://example.com/pariksha/test1/extra");

  expect(res.status).toBe(404);
  expect(await res.text()).toContain("fixture-404");
});
