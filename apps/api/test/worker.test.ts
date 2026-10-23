// The only test in the repository that runs against a real D1 engine.
// Everything else exercises the schema through better-sqlite3, which accepts
// SQL D1 rejects — notably `PRAGMA foreign_keys`, which D1 refuses mid
// migration because every statement already runs in an implicit transaction
// (#160). Miniflare embeds D1's own implementation, so this is where the two
// table-rebuild migrations are first proved rather than reasoned about.

import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { claimViolationLimit, createApiKey, d1Client, migrate, newId, sqliteMigrations } from "@pariksha/db";
import type { D1Database } from "@cloudflare/workers-types";
import worker from "../src/index";
import { SCHEDULED_JOBS } from "../src/scheduled.js";
import { RETENTION_BATCH } from "../src/retention/sweep.js";
import { MAX_IDS_PER_CHUNK } from "../src/retention/candidate.js";

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
    "0010_violation_limit_claim.sql",
    "0011_attempt_locked_at.sql",
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
  // 0010 (F2, Major, code review of #213): the partial unique index D1
  // could in principle reject the `WHERE` clause of — proved here rather
  // than trusted from the bundle, the same reason every statement above is.
  expect(await sql("event_violation_limit_uq")).toContain("violation_limit_reached");
  // 0011 (`E-R1`): a nullable `ADD COLUMN`, same family as 0008's two above
  // but never itself proved against the real engine until now.
  expect(await sql("attempt")).toContain("`locked_at` integer");
});

// Branch-review m7: `worker.test.ts`'s own opening comment is that
// better-sqlite3 "accepts SQL D1 rejects" — `violation-limit.test.ts` only
// ever exercises `claimViolationLimit`'s `INSERT … ON CONFLICT (attempt_id)
// WHERE type = '…' DO NOTHING RETURNING id` under better-sqlite3, and that
// statement is on the candidate hot path, outside either of the handler's
// two AG1 `try` blocks (`routes/proctoring.ts`) — a rejection there would be
// a 500 on every at-limit event POST, on live data. Partial-index conflict
// targets have been in SQLite since 3.24 and are "almost certainly" fine,
// which is exactly what this file exists to replace with proof.
it("claimViolationLimit's own ON CONFLICT (attempt_id) WHERE … DO NOTHING RETURNING id works against the real D1 engine", async () => {
  const db = binding();
  await migrate(db);

  const workspaceId = newId("wsp");
  const attemptId = newId("att");
  const first = await claimViolationLimit(db, workspaceId, { attemptId, now: 0 });
  expect(first.claimed).toBe(true);
  const second = await claimViolationLimit(db, workspaceId, { attemptId, now: 1 });
  expect(second.claimed).toBe(false);
});

it("a second run applies nothing", async () => {
  await migrate(binding());

  expect((await migrate(binding())).applied).toEqual([]);
});

// Branch-review `C1`, and the re-review's one non-blocking ask: the dedupe in
// `0010` was proved once by a disposable probe and then had no standing test.
// It runs **once, against live candidate data, irreversibly**, and the thing
// it guards against is real — #227 left `violation_limit_reached`
// candidate-submittable on `main` from Phase 7a until this branch narrowed the
// ingest, so production may hold duplicates. Without the `DELETE`, `CREATE
// UNIQUE INDEX` aborts: the ledger stops at 9, `0011` never runs, and the
// auto-deploy ships code declaring `locked_at` against a table without it.
// That is the `0008` scar, which cost this project four days.
//
// The statements come from the committed bundle rather than being retyped, so
// this cannot pass while the migration drifts away from it. Dropping the index
// puts the database back in its pre-`0010` shape, which is the only way to get
// duplicate markers past the index that forbids them.
it("0010's dedupe survives duplicate markers, keeps the earliest, and touches nothing else", async () => {
  const db = binding();
  await migrate(db);

  const [zeroTen] = sqliteMigrations.filter((m) => m.name === "0010_violation_limit_claim.sql");
  expect(zeroTen?.statements).toHaveLength(2);

  await db.exec("DROP INDEX event_violation_limit_uq");

  const workspaceId = newId("wsp");
  const duplicated = newId("att");
  const lone = newId("att");
  const row = async (attemptId: string, type: string, serverTs: number) =>
    db.exec(
      `INSERT INTO event (id, workspace_id, attempt_id, type, client_ts, server_ts) ` +
        `VALUES ('${newId("evt")}', '${workspaceId}', '${attemptId}', '${type}', 0, ${serverTs})`,
    );

  // Three markers for one attempt, inserted out of order so "the earliest"
  // cannot be satisfied by insertion order alone.
  await row(duplicated, "violation_limit_reached", 300);
  await row(duplicated, "violation_limit_reached", 100);
  await row(duplicated, "violation_limit_reached", 200);
  // The single-marker case: an attempt the dedupe must leave completely alone.
  await row(lone, "violation_limit_reached", 500);
  // And a type the partial index does not cover, which an over-broad DELETE
  // would take with it.
  await row(duplicated, "window_blur", 50);

  for (const statement of zeroTen!.statements) await db.exec(statement);

  // Scoped to this test's own workspace: the D1 instance is shared across the
  // file, and an earlier test leaves a marker of its own behind.
  const markers = await db.query<{ attempt_id: string; server_ts: number }>(
    "SELECT attempt_id, server_ts FROM event WHERE type = 'violation_limit_reached' " +
      "AND workspace_id = ? ORDER BY server_ts",
    [workspaceId],
  );
  expect(markers).toEqual([
    { attempt_id: duplicated, server_ts: 100 },
    { attempt_id: lone, server_ts: 500 },
  ]);

  const others = await db.query<{ type: string }>(
    "SELECT type FROM event WHERE type <> 'violation_limit_reached' AND workspace_id = ?",
    [workspaceId],
  );
  expect(others).toEqual([{ type: "window_blur" }]);

  // The index is back, and still refuses a second marker — the dedupe has to
  // leave the database in the state the migration promises, not merely survive.
  expect(await sql("event_violation_limit_uq")).toContain("violation_limit_reached");
  await expect(row(duplicated, "violation_limit_reached", 400)).rejects.toThrow();
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
    migrations: 12,
  });
});

// Fix round 1 (Important): the results CSV's review link has to be
// absolute — a CSV is opened away from the app, so a relative URL resolves
// against nothing. The risk this closes is specific to the real Worker:
// `deploy/cloudflare/wrangler.toml` configures no `APP_URL`, so production
// takes the exact fallback branch this test pins — `new URL(c.req.url)
// .origin`, proved here against the real Worker entry rather than Hono's
// in-memory `app.request()` (which `apps/api/test/export/results.test.ts`
// already covers, but that is not this deploy target).
it("the results CSV's review link is absolute against the real Worker's own origin", async () => {
  const db = d1Client(env.DB as unknown as D1Database);
  await migrate(db);

  const workspaceId = newId("wsp");
  const testId = "tst_d1review01";
  const versionId = "ver_d1review01";
  const candidateId = "cnd_d1review01";
  const attemptId = "att_d1review01";
  const now = Date.now();

  await db.run("INSERT INTO workspace (id, slug, name, created_at) VALUES (?, ?, ?, ?)", [
    workspaceId,
    "d1review",
    "D1 Review",
    now,
  ]);
  await db.run(
    "INSERT INTO test (id, workspace_id, slug, name, description, short_code, status, review_requested, " +
      "current_version, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)",
    [testId, workspaceId, "d1review", "D1 Review", "d1review1", "published", 0, 1, "[]", now],
  );
  await db.run(
    "INSERT INTO test_version (id, workspace_id, test_id, version, settings_json, sections_json, published_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [versionId, workspaceId, testId, 1, "{}", "[]", now, now],
  );
  await db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, " +
      "consent_version, consent_at, created_at) VALUES (?, ?, ?, NULL, NULL, 'registration', '{}', NULL, NULL, ?)",
    [candidateId, workspaceId, testId, now],
  );
  await db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed) VALUES (?, ?, ?, ?, 1, '{}', ?, ?, NULL, NULL, NULL, 'clean', ?, 0, NULL, 'clean', 0)",
    [attemptId, workspaceId, candidateId, versionId, now, now + 3_600_000, "hash-d1review"],
  );

  const { secret } = await createApiKey(db, workspaceId, { name: "review-link", scopes: ["results.export"], now });

  const res = await SELF.fetch(
    `https://example.com/api/v1/workspaces/${workspaceId}/tests/${testId}/export/results.csv`,
    { headers: { authorization: `Bearer ${secret}` } },
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as { csv: string };
  expect(body.csv).toContain(`https://example.com/?view=grading&test=${testId}`);
  // The old, relative form must not also be present — the fix replaces the
  // branch, it does not merely add an alternative.
  expect(body.csv).not.toContain(`"/?view=grading&test=${testId}"`);
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

// The control for the two assertions in the failing-job test below: a clean
// run must neither reject nor call `noRetry()`. Without it, "rejects and
// suppresses the retry" is indistinguishable from a handler that rejects and
// suppresses unconditionally — which would turn every healthy night into a
// failed invocation on the dashboard.
it("a scheduled run with no failing job neither rejects nor suppresses the retry", async () => {
  await migrate(d1Client(env.DB as unknown as D1Database));

  const ctx = createExecutionContext();
  const noRetry = vi.fn();
  worker.scheduled(
    { cron: "17 3 * * *", scheduledTime: Date.now(), noRetry },
    env as unknown as Parameters<typeof worker.scheduled>[1],
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(noRetry).not.toHaveBeenCalled();
});

// The `scheduled` export, against the real Workers runtime.
//
// Every other test here drives `SELF.fetch`, which exercises the `fetch`
// export and nothing else. `scheduled` is a SEPARATE entry point, and
// `deploy/cloudflare/wrangler.toml` already declares `crons = ["17 3 * * *"]`
// — so an export that fails to bind is invisible to every suite in this repo
// until a production night, which is the one failure a cron cannot report.
//
// `SELF.scheduled(...)` is NOT the way in: the controller has to cross the
// loopback boundary and fails with `DataCloneError: Could not serialize
// object of type "LoopbackServiceStub"`. The handler is called directly
// instead, with `createExecutionContext`/`waitOnExecutionContext` — which is
// also the only way to await the `ctx.waitUntil` the handler defers its work
// into, and therefore the only way a job's failure could ever surface here.
//
// `M-4`: reaching the end of this test without throwing used to be the
// whole claim, and it would have held just as well with `ctx.waitUntil`
// never called, `runScheduled` never invoked, or `scheduled`'s body
// emptied outright. With `M-3` done, a job's failure crosses `ctx.waitUntil`
// as a rejection, which is an outcome this test can actually assert on —
// so it registers one throwing job (matching the nightly cron, removed in
// `finally` so the registry really does ship empty for every other test),
// and the proof the whole real path ran — registry lookup, `deps(env)`,
// `ctx.waitUntil`, this file's own D1 binding threaded all the way through
// — is that rejection reaching here, naming the job that threw.
it("the worker entry accepts a scheduled invocation over the same bindings", async () => {
  await migrate(d1Client(env.DB as unknown as D1Database));

  const probe = {
    name: "m4-probe",
    cron: "17 3 * * *",
    run: () => Promise.reject(new Error("m4-probe blew up")),
  };
  SCHEDULED_JOBS.push(probe);
  try {
    const ctx = createExecutionContext();
    // Spied, not a no-op: a rejecting `waitUntil` marks the invocation
    // failed AND retriable, so Cloudflare would re-run the whole event and
    // every job that already succeeded tonight would run twice. Calling
    // `noRetry()` is what stops that, and an unasserted no-op here would
    // let it be deleted silently.
    const noRetry = vi.fn();
    worker.scheduled(
      { cron: "17 3 * * *", scheduledTime: Date.now(), noRetry },
      env as unknown as Parameters<typeof worker.scheduled>[1],
      ctx,
    );
    // Without this the test passes on a handler that defers everything and
    // never settles — `waitUntil`'s promise is exactly what would be missed.
    await expect(waitOnExecutionContext(ctx)).rejects.toThrow(/m4-probe/);
    expect(noRetry).toHaveBeenCalledTimes(1);
  } finally {
    // Remove THIS probe, never truncate the registry. Emptying it would be
    // B-2's own defect — a hook quietly clearing the array other tests
    // assert against — rebuilt inside the code written to close M-4. Once
    // 8b, 8d and 8e register real jobs, a truncate here would silently
    // hollow out every test declared after this one in the file.
    SCHEDULED_JOBS.splice(SCHEDULED_JOBS.indexOf(probe), 1);
  }
});

// Fix round 2, F3: `retentionJob`'s delete is `DELETE … WHERE id IN (…)`
// with one bound parameter per id, and a full `RETENTION_BATCH` (500)
// overflows D1's documented 100-bound-parameter ceiling — a fact
// `better-sqlite3` (every other test in this phase) has no equivalent
// limit for and so cannot catch. This is the one database that can, run
// through the real `scheduled` export like the tests above it, with
// `retentionJob` reached exactly as it is already registered in
// `SCHEDULED_JOBS` rather than invoked directly — so a break in the
// registry or the Worker's wiring would fail this too, not just a unit
// call.
it("the nightly sweep clears a full RETENTION_BATCH of expired snapshots against real D1", async () => {
  const db = d1Client(env.DB as unknown as D1Database);
  await migrate(db);

  const workspaceId = "wsp_d1sweep00001";
  const versionId = "ver_d1sweep00001";
  const attemptId = "att_d1sweep00001";
  const now = Date.now();
  const DAY = 86_400_000;

  await db.run("INSERT INTO workspace (id, slug, name, created_at) VALUES (?, ?, ?, ?)", [
    workspaceId,
    "d1sweep",
    "D1 Sweep",
    now,
  ]);
  // No `retention` key: S-13's defaults (snapshots 90 days) apply.
  await db.run(
    "INSERT INTO test_version (id, workspace_id, test_id, version, settings_json, sections_json, published_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [versionId, workspaceId, "tst_d1sweep0001", 1, "{}", "[]", now, now],
  );
  await db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?)",
    [attemptId, workspaceId, "cnd_d1sweep0001", versionId, 1, "{}", now, now + DAY, "clean", "hash-d1sweep", 0, "clean", 0],
  );

  const takenAt = now - 100 * DAY; // past the 90-day default
  await db.batch(
    Array.from({ length: RETENTION_BATCH }, (_, i) => ({
      sql:
        "INSERT INTO snapshot (id, workspace_id, attempt_id, storage_key, taken_at, reason, face_count) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [`snp_d1sweep${String(i).padStart(7, "0")}`, workspaceId, attemptId, `snap/d1sweep/${i}`, takenAt, "interval", null],
    })),
  );

  const ctx = createExecutionContext();
  const noRetry = vi.fn();
  worker.scheduled(
    { cron: "17 3 * * *", scheduledTime: now, noRetry },
    env as unknown as Parameters<typeof worker.scheduled>[1],
    ctx,
  );
  // F3's bug does not throw here: `runScheduled`'s per-job try/catch
  // (K27's isolation) turns a rejected `retentionJob.run` into a name in
  // `failed`, which `index.ts` reports by calling `noRetry()` and then
  // throwing — so the proof an unchunked delete would fail is `noRetry()`
  // never being called, not a rejection from this call.
  await waitOnExecutionContext(ctx);
  expect(noRetry).not.toHaveBeenCalled();

  const remaining = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM snapshot WHERE workspace_id = ?",
    [workspaceId],
  );
  expect(Number(remaining[0]?.n ?? -1)).toBe(0);
}, 30_000);

// AC-24, Task 4: `dueCandidates`'s cutoff and "already erased" checks are
// built from `json_extract` (sqlite/d1) — a real function call, not
// something `better-sqlite3`'s own JSON1 build is guaranteed to agree with
// D1's on, the same gap the test above exists to close for `DELETE_CHUNK`.
// Fix round 1, F1 added two window functions (`ROW_NUMBER`, `DENSE_RANK`)
// to the same query — supported identically by sqlite/d1/pg per the ANSI
// standard, per `sweep.ts`'s own comment, but "identically" is exactly the
// kind of claim this file exists to hold to a real engine rather than
// trust.
//
// Real D1, through the real `scheduled` export: a full `MAX_IDS_PER_CHUNK`
// worth of due candidates in one workspace (each with a past-deadline,
// scored attempt — AC-24's anchor) plus five *more* due candidates in that
// same workspace, deliberately less overdue — proving the per-workspace
// `rn <= MAX_IDS_PER_CHUNK` cap (fix round 1, F1) actually holds on real
// D1's window-function implementation, not just better-sqlite3's. Also:
// one live candidate whose only attempt's deadline is in the future (the
// COALESCE probe, repeated here because the thing that could silently
// diverge between better-sqlite3 and D1 is the SQL itself, not the
// TypeScript around it), and one already-blanked row seeded by hand to
// prove the exclusion really keeps a tick from reprocessing it.
it("the nightly sweep expires MAX_IDS_PER_CHUNK due candidates against real D1, capping the overflow and sparing a live one", async () => {
  const db = d1Client(env.DB as unknown as D1Database);
  await migrate(db);

  // `workspaceId` must satisfy `isId` (`packages/db/src/ids.ts`): `wsp_` plus
  // exactly 12 characters from its Crockford alphabet (no `i`, `l`, `o`,
  // `u`) — `appendAudit`'s `scoped()` guard rejects anything shorter, which
  // a hand-picked id can silently violate (this one did, on the first run).
  const workspaceId = "wsp_d1cand000001";
  const versionId = "ver_d1cand00001";
  const testId = "tst_d1cand00001";
  const now = Date.now();
  const DAY = 86_400_000;

  await db.run("INSERT INTO workspace (id, slug, name, created_at) VALUES (?, ?, ?, ?)", [
    workspaceId,
    "d1cand",
    "D1 Candidates",
    now,
  ]);
  await db.run(
    "INSERT INTO test (id, workspace_id, slug, name, description, short_code, status, review_requested, " +
      "current_version, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)",
    [testId, workspaceId, "d1cand", "D1 Candidates", "d1cand1", "published", 0, 1, "[]", now],
  );
  // No `retention` key: S-13's 365-day default applies.
  await db.run(
    "INSERT INTO test_version (id, workspace_id, test_id, version, settings_json, sections_json, published_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [versionId, workspaceId, testId, 1, "{}", "[]", now, now],
  );

  const longAgo = now - 400 * DAY; // past the 365-day default
  const dueCandidateId = (i: number): string => `cnd_d1due${String(i).padStart(7, "0")}`;
  const overflowCandidateId = (i: number): string => `cnd_d1over${String(i).padStart(6, "0")}`;

  const candidateStatement = (
    candidateId: string,
    createdAt: number,
  ): { sql: string; params: unknown[] } => ({
    sql:
      "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, " +
      "consent_version, consent_at, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?)",
    params: [candidateId, workspaceId, testId, "registration", JSON.stringify({ full_name: candidateId }), "v1", createdAt],
  });
  const attemptStatement = (
    candidateId: string,
    attemptId: string,
    deadlineAt: number,
    submittedAt: number | null,
  ): { sql: string; params: unknown[] } => ({
    sql:
      "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    params: [
      attemptId,
      workspaceId,
      candidateId,
      versionId,
      1,
      "{}",
      longAgo,
      deadlineAt,
      submittedAt,
      submittedAt === null ? null : "clean",
      submittedAt === null ? null : JSON.stringify({ total: 1 }),
      "clean",
      `hash-${attemptId}`,
      0,
      null, // section_started_at
      "clean",
      0,
    ],
  });

  const statements: { sql: string; params: unknown[] }[] = [];
  for (let i = 0; i < MAX_IDS_PER_CHUNK; i++) {
    const candidateId = dueCandidateId(i);
    statements.push(
      candidateStatement(candidateId, longAgo),
      attemptStatement(candidateId, `att_d1due${String(i).padStart(7, "0")}`, longAgo, longAgo - 1),
    );
  }
  // Five more, genuinely due (still past the 365-day default) but strictly
  // *less* overdue (`longAgo + 1`, not tied) than the `MAX_IDS_PER_CHUNK`
  // above — `ROW_NUMBER() OVER (... ORDER BY at ASC)` must rank these
  // after all of them, so they are the ones `rn <= MAX_IDS_PER_CHUNK`
  // excludes. No attempt needed: "due on created_at alone" is already
  // proved in the better-sqlite3 suite, and the fewer moving parts here
  // the more this failing actually means the window-function cap broke.
  const overflowCount = 5;
  for (let i = 0; i < overflowCount; i++) {
    statements.push(candidateStatement(overflowCandidateId(i), longAgo + 1));
  }
  // The COALESCE probe, against real D1: created long ago, but its one
  // attempt's deadline is in the future and already submitted (so
  // `deleteCandidates`'s own separate "in progress" guard cannot be the
  // reason it survives — only the anchor can be).
  const liveCandidateId = "cnd_d1live0001";
  statements.push(
    candidateStatement(liveCandidateId, longAgo),
    attemptStatement(liveCandidateId, "att_d1live0001", now + 10 * DAY, now - DAY),
  );
  // An already-blanked row, strictly older than every genuinely-due one
  // (`longAgo - DAY`, not tied with them) — on purpose: a tie with the
  // real due rows would let this get silently dropped by whichever order
  // the window functions happen to break ties in, proving nothing either
  // way. Strictly oldest, it is guaranteed rank 1 — a seat in the batch —
  // if the "already erased" exclusion ever fails to filter it, so its
  // *absence* from `audit_log` below is a real proof the exclusion held
  // on real D1, not a coincidence of row order.
  const blankedCandidateId = "cnd_d1blank001";
  statements.push({
    sql:
      "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, " +
      "consent_version, consent_at, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?)",
    params: [blankedCandidateId, workspaceId, testId, "registration", "{}", "v1", longAgo - DAY],
  });
  await db.batch(statements);

  const ctx = createExecutionContext();
  const noRetry = vi.fn();
  worker.scheduled(
    { cron: "17 3 * * *", scheduledTime: now, noRetry },
    env as unknown as Parameters<typeof worker.scheduled>[1],
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(noRetry).not.toHaveBeenCalled();

  const rows = await db.query<{ id: string; form_values_json: string; external_id: string | null }>(
    "SELECT id, form_values_json, external_id FROM candidate WHERE workspace_id = ? ORDER BY id",
    [workspaceId],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (let i = 0; i < MAX_IDS_PER_CHUNK; i++) {
    const row = byId.get(dueCandidateId(i));
    expect(row?.form_values_json).toBe("{}");
    expect(row?.external_id).toBeNull();
  }
  // The per-workspace cap (fix round 1, F1) held on real D1's window
  // functions: these five are genuinely due, but less overdue than the
  // `MAX_IDS_PER_CHUNK` above, and this tick's `rn <= MAX_IDS_PER_CHUNK`
  // left them for the next one.
  for (let i = 0; i < overflowCount; i++) {
    expect(byId.get(overflowCandidateId(i))?.form_values_json).not.toBe("{}");
  }
  const live = byId.get(liveCandidateId);
  expect(live?.form_values_json).not.toBe("{}");
  expect(byId.get(blankedCandidateId)?.form_values_json).toBe("{}");

  // The blanked-row check above cannot fail on its own — blanking an
  // already-blanked row is invisible (`{}` stays `{}`). What actually
  // proves the exclusion held: `deleteCandidates` never wrote a
  // `candidate.delete` audit row naming the already-blanked id — and
  // (strictly oldest, see above) it would have been guaranteed rank 1 if
  // the exclusion let it through.
  const blankedAudit = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM audit_log WHERE workspace_id = ? AND action = 'candidate.delete' AND target = ?",
    [workspaceId, blankedCandidateId],
  );
  expect(Number(blankedAudit[0]?.n ?? -1)).toBe(0);

  // Exactly MAX_IDS_PER_CHUNK erasures this tick — not MAX_IDS_PER_CHUNK + 5
  // (the overflow let through) and not fewer (the cap over-excluding).
  const erasures = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM audit_log WHERE workspace_id = ? AND action = 'candidate.delete'",
    [workspaceId],
  );
  expect(Number(erasures[0]?.n ?? -1)).toBe(MAX_IDS_PER_CHUNK);
}, 30_000);
