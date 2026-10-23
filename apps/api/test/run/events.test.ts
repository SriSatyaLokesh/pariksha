// `POST /api/v1/run/attempt/events` (Phase 7c Task 1, `Q7`) — the one
// write every later gate in this plan posts to.
//
// `Q7a`: the response and `GET /api/v1/run/attempt` must never disagree,
// because the response is the candidate's "Warning 2 of 5" and the second
// is what a reload falls back to. Both are asserted here against the same
// attempt.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import type { ViolationAction } from "@pariksha/core";
import { createApp, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { EVENTS_PATH } from "../../src/routes/proctoring.js";
import type { AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./fixtures.js";
import { PAPER_FORM, seedBank } from "./paper-fixtures.js";

const T = FIXED_NOW;
const SLUG = { workspace: "gamma", test: "proctored" } as const;

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Gamma Inc");
const q = await seedBank(deps, workspaceId);

// Standard profile — `limit: 5, action: "warn_then_flag"` and
// `requireFullscreen: true, faceCheck: false` are what `PROCTORING_DEFAULTS.
// standard` resolves to, and what every assertion below is pinned against.
//
// `action` resolved `warn_only` between #214 and Phase 7e Task 1 (#213):
// `resolveProctoring` refused every other action because nothing consumed
// one. `violationOutcome` is that consumer now, so Standard's real default
// (`warn_then_flag`) is what this route answers with again.
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

// --- helpers -------------------------------------------------------------

let serial = 1;

async function start(): Promise<{ cookie: string; paper: AttemptPaper }> {
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
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    paper: (await res.json()) as AttemptPaper,
  };
}

function post(path: string, body: unknown, cookie?: string, on = app): Promise<Response> {
  return on.request(path, {
    method: "POST",
    headers: cookie === undefined ? { "content-type": "application/json" } : { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie: string, on = app): Promise<Response> {
  return on.request(path, { headers: { cookie } });
}

interface EventsResponse {
  violations: number;
  limit: number;
  action: ViolationAction;
}

let attemptCookie = "";

beforeEach(async () => {
  await deps.db.run("DELETE FROM event", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM auth_token", []);
  attemptCookie = (await start()).cookie;
});

// --- the brief's own tests ------------------------------------------------

it("writes events and answers with the authoritative count", async () => {
  const res = await post(
    EVENTS_PATH,
    { events: [{ type: "window_blur", detail: { durationMs: 4200 }, clientTs: 1 }] },
    attemptCookie,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ violations: 1, limit: 5, action: "warn_then_flag" });
});

it("counts only violation types toward the figure", async () => {
  await post(
    EVENTS_PATH,
    {
      events: [
        { type: "fullscreen_exit", clientTs: 1 },
        { type: "fullscreen_restore", clientTs: 2 },
        { type: "snapshot_failed", clientTs: 3 },
      ],
    },
    attemptCookie,
  );
  const res = await get("/api/v1/run/attempt", attemptCookie);
  expect(((await res.json()) as AttemptPaper).violations).toBe(1);
});

// Review Focus 2 — the cap is real, not advisory.
it("refuses more than ten events in one request", async () => {
  const events = Array.from({ length: 11 }, (_, i) => ({ type: "window_blur" as const, clientTs: i }));
  const res = await post(EVENTS_PATH, { events }, attemptCookie);
  expect(res.status).toBe(400);
});

it("rejects an event type outside the closed set", async () => {
  const res = await post(EVENTS_PATH, { events: [{ type: "keylogger", clientTs: 1 }] }, attemptCookie);
  expect(res.status).toBe(400);
});

it("answers 401 without an attempt cookie", async () => {
  expect((await post(EVENTS_PATH, { events: [] })).status).toBe(401);
});

it("ships the resolved proctoring object on the attempt", async () => {
  const body = (await (await get("/api/v1/run/attempt", attemptCookie)).json()) as AttemptPaper;
  expect(body.proctoring).toMatchObject({ requireFullscreen: true, faceCheck: false });
});

// --- `Q7c`: measured, not estimated ---------------------------------------

it("the ingest's common-path cost is measured at 4, under the declared ceiling, and the route's authority is the attempt", async () => {
  const counting = countingDeps(deps);
  const res = await post(
    EVENTS_PATH,
    { events: [{ type: "window_blur", clientTs: 1 }] },
    attemptCookie,
    createApp(counting.deps),
  );
  await res.json();
  // The attempt join, the `attempt_events` rate token, `appendEvents`'s one
  // batched insert and `countViolations`'s one read — **4**. Phase 7e Task
  // 1's fix round (F2) made `claimViolationLimit` conditional on `atLimit`
  // — below the limit, no read or write of its own is paid at all, so one
  // `window_blur` (nowhere near Standard's limit of 5) costs one less than
  // this route used to (5, when `violationLimitAlreadyReached` ran on every
  // request regardless). The fifth, worst-case subrequest — the atomic
  // claim's own insert — is not paid here; `violation-limit.test.ts`
  // measures that path.
  //
  // Branch-review M1: `recomputeIntegrity` used to fire on every batch
  // carrying a violation or failure event, regardless of whether the batch
  // was anywhere near the limit — quadratic rows read across a session on
  // `warn_then_flag`, the default action. It now fires only on the one
  // batch that first reaches the limit (`"the integrity recompute pays for
  // itself only at the limit-crossing batch"`, below) — one `window_blur`,
  // nowhere near Standard's limit of 5, pays none of it, so this stays at
  // the base 4 rather than the 7 it used to be.
  expect(counting.counts().total).toBe(4);
  expect(counting.counts().total).toBeLessThan(ROUTE_BUDGETS[EVENTS_PATH] as number);
  expect(ROUTE_AUTH[`POST ${EVENTS_PATH}`]).toBe("attempt");
});

// Branch-review M1, the fix proved: the quadratic shape was every
// violation-carrying batch re-reading the attempt's whole event/snapshot
// history. These two tests are the before/after of that — four below-limit
// batches cost nothing extra each, and the one batch that crosses the limit
// pays the recompute exactly once.
it("M1: below-limit violation batches never pay the integrity recompute", async () => {
  const counting = countingDeps(deps);
  const countingApp = createApp(counting.deps);
  // Four separate requests, one `window_blur` each — violations 1..4,
  // Standard's limit is 5. None of these crosses it.
  for (let i = 0; i < 4; i += 1) {
    const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: i }] }, attemptCookie, countingApp);
    await res.json();
  }
  // Each of the four pays the same base 4 as the single-event test above —
  // 16 total, not 16 plus four lots of the +3 recompute the old,
  // unconditional gate would have charged every one of them.
  expect(counting.counts().total).toBe(16);
});

it("M1: the batch that first crosses the limit pays the recompute; the next one, already actioned, does not", async () => {
  // Four below-limit batches first, uncounted — violations 1..4.
  for (let i = 0; i < 4; i += 1) {
    await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: i }] }, attemptCookie);
  }
  const counting = countingDeps(deps);
  const countingApp = createApp(counting.deps);
  // Violation 5: crosses Standard's limit of 5. Base 4 + the atomic claim
  // (+1, it is attempted at or past the limit) + the recompute's own +3
  // (`listIntegrityEvents`, `listSnapshotFaceCounts`, `setIntegrity`) = 8.
  const crossing = await post(
    EVENTS_PATH,
    { events: [{ type: "window_blur", clientTs: 10 }] },
    attemptCookie,
    countingApp,
  );
  await crossing.json();
  expect(counting.counts().total).toBe(8);

  // Violation 6: still past the limit, but `alreadyActioned` is now true —
  // the claim is attempted (and loses) but the recompute does not fire
  // again. Base 4 + the lost claim attempt (+1) = 5.
  const after = countingDeps(deps);
  const afterApp = createApp(after.deps);
  const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 11 }] }, attemptCookie, afterApp);
  await res.json();
  expect(after.counts().total).toBe(5);
});

it("the ten events a request carries are written as one batched insert, not ten", async () => {
  // `fullscreen_restore`, not `window_blur`: ten violations would cross
  // Standard's limit of 5 and pay the marker-write subrequest this test
  // does not mean to measure (`violation-limit.test.ts` does). The batching
  // claim this test makes — one statement, not ten — holds for any type.
  const events = Array.from({ length: 10 }, (_, i) => ({ type: "fullscreen_restore" as const, clientTs: i }));
  const counting = countingDeps(deps);
  const res = await post(EVENTS_PATH, { events }, attemptCookie, createApp(counting.deps));
  await res.json();
  expect(counting.counts().total).toBe(4);
  const rows = await deps.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM event", []);
  expect(Number(rows[0]?.n)).toBe(10);
});

it("ids are minted server-side: the same type posted twice makes two rows, neither named by the client", async () => {
  await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 1 }] }, attemptCookie);
  await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 2 }] }, attemptCookie);
  const rows = await deps.db.query<{ id: string }>("SELECT id FROM event ORDER BY id", []);
  expect(rows).toHaveLength(2);
  expect(rows[0]?.id).not.toBe(rows[1]?.id);
  for (const row of rows) expect(row.id).toMatch(/^evt_/);
});

it("the response and a later resume report the same authoritative count", async () => {
  const ingest = (await (
    await post(EVENTS_PATH, { events: [{ type: "copy_blocked", clientTs: 1 }] }, attemptCookie)
  ).json()) as EventsResponse;
  const resumed = (await (await get("/api/v1/run/attempt", attemptCookie)).json()) as AttemptPaper;
  expect(resumed.violations).toBe(ingest.violations);
});

// Whole-branch review, finding 6: `detail` was unvalidated and unbounded at
// this trust boundary.
it("refuses a detail payload past the serialised bound", async () => {
  const res = await post(
    EVENTS_PATH,
    { events: [{ type: "window_blur", detail: { awayMs: "x".repeat(600) }, clientTs: 1 }] },
    attemptCookie,
  );
  expect(res.status).toBe(400);
});

// Re-review of that fix: the bound was measured with `String.length`, which
// counts UTF-16 code units, while D1 stores TEXT as UTF-8. A payload of
// non-ASCII characters measured as under the cap and landed at up to three
// times it. 300 `e`-acutes are 300 code units (under 512) and 600 bytes
// (over it), so this test fails against the `.length` version and passes
// against the `TextEncoder` one.
it("measures the bound in UTF-8 bytes, not UTF-16 code units", async () => {
  const detail = { awayMs: "é".repeat(300) };
  expect(JSON.stringify(detail).length).toBeLessThan(512);
  expect(new TextEncoder().encode(JSON.stringify(detail)).length).toBeGreaterThan(512);

  const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", detail, clientTs: 1 }] }, attemptCookie);
  expect(res.status).toBe(400);
});

it("accepts the real shapes this phase emits, well under the bound", async () => {
  const res = await post(
    EVENTS_PATH,
    { events: [{ type: "window_blur", detail: { awayMs: 4200 }, clientTs: 1 }] },
    attemptCookie,
  );
  expect(res.status).toBe(200);
});

// Whole-branch review, finding 9: unlike `/attempt/answer`, a submitted
// attempt is a silent no-op here, not a 409 — a stale tab's flush must
// never surface anything to the candidate (`AG1`), and must not grow the
// figure Phase 8's review page will read.
it("writes nothing and still answers the current count once the attempt is submitted", async () => {
  await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 1 }] }, attemptCookie);
  const submitRes = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: attemptCookie },
  });
  expect(submitRes.status).toBe(200);

  const res = await post(
    EVENTS_PATH,
    { events: [{ type: "window_blur", clientTs: 2 }] },
    attemptCookie,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ violations: 1, limit: 5, action: "warn_then_flag" });

  const rows = await deps.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM event", []);
  // The one pre-submission event, and nothing from the post-submission
  // request.
  expect(Number(rows[0]?.n)).toBe(1);
});
