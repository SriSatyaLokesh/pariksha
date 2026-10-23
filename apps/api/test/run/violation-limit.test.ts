// Phase 7e Task 1 (`P-09`, issue #213): the count has a limit.
//
// `violationOutcome` (`@pariksha/core`) is the pure decision; this file is
// the one place it is proven wired into the ingest. `Review Focus 3` /
// `Q6b`: `FAILURE_EVENTS` never advance the count — the ingest already
// classifies via `countViolations`'s own `VIOLATION_EVENTS` filter, and
// this task must not re-derive that a second way.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { EVENTS_PATH } from "../../src/routes/proctoring.js";
import type { AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./fixtures.js";
import { PAPER_FORM, seedBank } from "./paper-fixtures.js";

const T = FIXED_NOW;
const SLUG = { workspace: "epsilon", test: "proctored" } as const;

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Epsilon Inc");
const q = await seedBank(deps, workspaceId);

// Standard profile — `limit: 5, action: "warn_then_flag"` (Phase 7e Task 1
// restored this default; it was `warn_only` between #214 and this task).
await seedTest(deps, workspaceId, {
  name: "Proctored",
  slug: SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "standard" },
    },
    sections: [
      { id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

// --- helpers (mirrors events.test.ts) -------------------------------------

let serial = 1;

async function start(): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, SLUG.workspace, SLUG.test, T);
  if (!test) throw new Error(`no published test at ${SLUG.workspace}/${SLUG.test}`);
  const candidateId = await createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: T,
  });
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: T,
    expiresAt: T + REGISTRATION_TTL_MS,
  });
  const res = await app.request(`/api/v1/run/${SLUG.workspace}/${SLUG.test}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start answered ${String(res.status)}`);
  const paper = (await res.json()) as AttemptPaper;
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    attemptId: paper.attemptId,
  };
}

function post(path: string, body: unknown, cookie: string, on = app): Promise<Response> {
  return on.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The one attempt-row read every test below needs — `status` is derived,
 *  not stored: there is no `status` column on `attempt` yet (a nullable
 *  `locked_at` is Task 3's migration, not this task's), so "submitted" is
 *  the only non-`in_progress` state this file can observe. */
async function attemptState(attemptId: string): Promise<{ status: "in_progress" | "submitted" }> {
  const rows = await deps.db.query<{ submitted_at: number | null }>(
    "SELECT submitted_at FROM attempt WHERE id = ?",
    [attemptId],
  );
  const submittedAt = rows[0]?.submitted_at ?? null;
  return { status: submittedAt === null ? "in_progress" : "submitted" };
}

async function limitReachedCount(): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM event WHERE type = 'violation_limit_reached'",
    [],
  );
  return Number(rows[0]?.n ?? 0);
}

let attemptCookie = "";
let attemptId = "";

beforeEach(async () => {
  await deps.db.run("DELETE FROM event", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM auth_token", []);
  const started = await start();
  attemptCookie = started.cookie;
  attemptId = started.attemptId;
});

// --- the brief's own test ---------------------------------------------------

// Review Focus 3 — a failure is not a violation, at the route.
it("does not advance the count on snapshot_failed", async () => {
  await post(EVENTS_PATH, { events: Array.from({ length: 4 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  const res = await post(EVENTS_PATH, { events: [{ type: "snapshot_failed", clientTs: 9 }] }, attemptCookie);
  expect(await res.json()).toMatchObject({ violations: 4 });
  expect(await attemptState(attemptId)).toMatchObject({ status: "in_progress" });
});

// --- the limit fires once, not every batch past it --------------------------

it("marks the limit reached once, under the restored warn_then_flag default", async () => {
  const res = await post(EVENTS_PATH, { events: Array.from({ length: 5 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  expect(await res.json()).toMatchObject({ violations: 5, limit: 5, action: "warn_then_flag" });
  expect(await limitReachedCount()).toBe(1);
});

it("does not mark a second time once a later batch is still past the limit", async () => {
  await post(EVENTS_PATH, { events: Array.from({ length: 5 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  expect(await limitReachedCount()).toBe(1);

  const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 9 }] }, attemptCookie);
  expect(await res.json()).toMatchObject({ violations: 6, limit: 5, action: "warn_then_flag" });
  // `violationOutcome`'s own "once, not twice" (Review Focus 1): still one
  // marker row, not two.
  expect(await limitReachedCount()).toBe(1);
});

it("does not mark anything when the limit fires on an already-submitted attempt's stale flush", async () => {
  await post(EVENTS_PATH, { events: Array.from({ length: 4 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  const submitRes = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: attemptCookie },
  });
  expect(submitRes.status).toBe(200);

  // A sixth window_blur, past the limit, after submission: the ingest's own
  // "silent no-op past submission" rule (whole-branch review finding 9)
  // means this never reaches `violationOutcome` at all.
  const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 9 }] }, attemptCookie);
  expect(res.status).toBe(200);
  expect(await limitReachedCount()).toBe(0);
  expect((await attemptState(attemptId)).status).toBe("submitted");
});

// --- the budget: the worst case is declared and measured -------------------

it("the worst case — the batch that first reaches the limit — costs the declared ceiling", async () => {
  const counting = countingDeps(deps);
  const res = await post(
    EVENTS_PATH,
    { events: Array.from({ length: 5 }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    attemptCookie,
    createApp(counting.deps),
  );
  await res.json();
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[EVENTS_PATH]);
  expect(counting.counts().total).toBe(6);
});
