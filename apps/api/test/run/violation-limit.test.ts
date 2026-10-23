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
import { createApp } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { EVENTS_PATH } from "../../src/routes/proctoring.js";
import type { AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./fixtures.js";
import { PAPER_FORM, seedBank } from "./paper-fixtures.js";

const T = FIXED_NOW;
const SLUG = { workspace: "epsilon", test: "proctored", warnOnly: "warn-only" } as const;

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

// m4: `warn_only`, the one action `violationOutcome` promises keeps warning
// forever rather than ever claiming the marker.
await seedTest(deps, workspaceId, {
  name: "Warn only",
  slug: SLUG.warnOnly,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "standard", overrides: { violation_action: "warn_only" } },
    },
    sections: [
      { id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

// --- helpers (mirrors events.test.ts) -------------------------------------

let serial = 1;

async function start(slug: string = SLUG.test): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, SLUG.workspace, slug, T);
  if (!test) throw new Error(`no published test at ${SLUG.workspace}/${slug}`);
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
  const res = await app.request(`/api/v1/run/${SLUG.workspace}/${slug}/start`, {
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

// --- F1 (Critical, code review of #213): the candidate cannot forge the
// server's own "limit already fired" marker --------------------------------

it.each(["violation_limit_reached", "attempt_locked", "attempt_unlocked"] as const)(
  "refuses %s from a candidate's own POST, before anything is written",
  async (type) => {
    const res = await post(EVENTS_PATH, { events: [{ type, clientTs: 1 }] }, attemptCookie);
    expect(res.status).toBe(400);
    expect(await limitReachedCount()).toBe(0);
  },
);

// KG2: every refusal test needs a 200 beside it in the same file, so the
// trio above cannot pass for free (a typo'd route, say, 400ing everything).
it("accepts a legitimate candidate-observable event in the same request shape", async () => {
  const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 1 }] }, attemptCookie);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ violations: 1 });
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

// --- F2 (Major, code review of #213): the claim is atomic, not a race ------

// `Promise.all` over two posts against the *same* attempt: even though
// Node's event loop is single-threaded, each `await` inside the handler is
// a yield point, so two in-flight requests still interleave statement by
// statement — which is exactly the shape that broke the old `SELECT`-then-
// `INSERT` (both could read "not yet claimed" before either wrote). The
// fix removes the yield point between "check" and "claim": one `INSERT …
// ON CONFLICT … DO NOTHING` is the whole operation, so there is nothing
// left for two concurrent calls to interleave around.
it("two concurrent batches that both cross the limit still mark it exactly once", async () => {
  await post(EVENTS_PATH, { events: Array.from({ length: 4 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  expect(await limitReachedCount()).toBe(0);

  const [a, b] = await Promise.all([
    post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 10 }] }, attemptCookie),
    post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 11 }] }, attemptCookie),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  // Exactly one marker row — exactly one outcome fired — whichever of the
  // two requests the database serialised first.
  expect(await limitReachedCount()).toBe(1);
});

// --- the budget: this outcome's own cost is measured ------------------------

// Phase 7e Task 2: the route's declared ceiling (`ROUTE_BUDGETS[EVENTS_PATH]`)
// moved once `auto_submit` became a real consumer of `submitAttempt`
// (`test/run/auto-submit.test.ts` measures and pins that worst case) — this
// `warn_then_flag` batch is no longer the most expensive thing the route can
// do, so it is pinned to its own literal rather than to the shared constant,
// the same reason `submit.test.ts`'s own common-case test gives for doing the
// same thing: a literal still catches a redundant read landing here even as
// the declared ceiling moves for an unrelated outcome. The base is **5**,
// not 6: Task 1's own fix round (F2) replaced the old
// `violationLimitAlreadyReached` read plus a separate `appendEvents` marker
// write with one atomic `claimViolationLimit` call (`events.test.ts`'s own
// comment has the detail), which is one subrequest cheaper at the limit
// too. Phase 7e Task 5 (`Q6a`) adds its own +3 on top — a limit-reaching
// batch always carries a violation, so `recomputeIntegrity` always runs —
// **8**.
it("the batch that first reaches the limit under warn_then_flag costs 8, measured", async () => {
  const counting = countingDeps(deps);
  const res = await post(
    EVENTS_PATH,
    { events: Array.from({ length: 5 }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    attemptCookie,
    createApp(counting.deps),
  );
  await res.json();
  expect(counting.counts().total).toBe(8);
});

// --- m4: `warn_only` never claims, so it never stops warning ---------------

it("m4: a warn_only test keeps warning past the limit instead of going silent after the first batch", async () => {
  const { cookie } = await start(SLUG.warnOnly);

  const first = await post(
    EVENTS_PATH,
    { events: Array.from({ length: 5 }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    cookie,
  );
  expect(await first.json()).toMatchObject({ violations: 5, limit: 5, action: "warn_only" });
  // Never claimed — `claimViolationLimit` is never even attempted for
  // `warn_only` — so the finish page's own warning stays live rather than
  // reading `{kind:"none"}` on every batch after the first.
  expect(await limitReachedCount()).toBe(0);

  const second = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 9 }] }, cookie);
  expect(await second.json()).toMatchObject({ violations: 6, limit: 5, action: "warn_only" });
  expect(await limitReachedCount()).toBe(0);
});
