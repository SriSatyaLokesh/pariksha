// Phase 7e Task 2 (`AC-21`): auto-submit at the limit — the first real
// consumer of `violationOutcome`'s `auto_submit` branch (Task 1,
// `proctoring-outcome.ts`). `submitAttempt` (`run/submit.ts`) is not
// re-derived here: the ingest calls the exact function `POST
// /attempt/submit` calls, with `reason: "limit"`.
//
// Mirrors `violation-limit.test.ts`'s own helpers (`start`, `post`,
// `attemptState`) rather than importing them — a one-file duplication, the
// same call this repo's own `D-R4` pattern (`apps/web/test/exam/
// camera-loss.test.tsx`) already makes for its own helpers.

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
const SLUG = { workspace: "zeta", test: "autosubmit" } as const;

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Zeta Inc");
const q = await seedBank(deps, workspaceId);

// `autoSubmit5`: `violation_limit: 5`, `violation_action: "auto_submit"` —
// the one combination this file exists to prove wired end to end.
await seedTest(deps, workspaceId, {
  name: "Auto-submit",
  slug: SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "standard", overrides: { violation_limit: 5, violation_action: "auto_submit" } },
    },
    sections: [
      { id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

// --- helpers (mirrors violation-limit.test.ts) ------------------------------

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

/** `violation-limit.test.ts`'s own helper, widened with `submit_reason` —
 *  the one field that test's `status`-only shape had no need of. */
async function attemptState(
  attemptId: string,
): Promise<{ status: "in_progress" | "submitted"; submitReason: string | null }> {
  const rows = await deps.db.query<{ submitted_at: number | null; submit_reason: string | null }>(
    "SELECT submitted_at, submit_reason FROM attempt WHERE id = ?",
    [attemptId],
  );
  const row = rows[0];
  return {
    status: (row?.submitted_at ?? null) === null ? "in_progress" : "submitted",
    submitReason: row?.submit_reason ?? null,
  };
}

/** `submitAttempt`'s own rule ("only the writer audits") makes this the
 *  cheapest proof that a submission happened exactly once: a second,
 *  losing call writes no second row. */
async function submittedAuditCount(): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'attempt.submitted'",
    [],
  );
  return Number(rows[0]?.n ?? 0);
}

async function reachLimit(cookie: string, n = 5): Promise<Response> {
  return post(
    EVENTS_PATH,
    { events: Array.from({ length: n }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    cookie,
  );
}

let attemptCookie = "";
let attemptId = "";

beforeEach(async () => {
  await deps.db.run("DELETE FROM event", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM audit_log", []);
  await deps.db.run("DELETE FROM auth_token", []);
  const started = await start();
  attemptCookie = started.cookie;
  attemptId = started.attemptId;
});

// --- the brief's own tests ---------------------------------------------------

it("submits the attempt with reason 'limit' at the limit", async () => {
  const res = await reachLimit(attemptCookie, 5);
  expect(await res.json()).toMatchObject({ violations: 5, limit: 5, action: "auto_submit", submitted: true });

  const state = await attemptState(attemptId);
  expect(state.status).toBe("submitted");
  expect(state.submitReason).toBe("limit");
});

// Review Focus 1 — one submission, whatever the flush carried: a single
// request whose own batch pushes the count from 0 straight past the limit
// (5th and 6th violations together) must still only submit once.
it("submits once when the fifth and sixth violations arrive together", async () => {
  const res = await reachLimit(attemptCookie, 6);
  expect(await res.json()).toMatchObject({ violations: 6, submitted: true });
  expect(await submittedAuditCount()).toBe(1);
  expect((await attemptState(attemptId)).status).toBe("submitted");
});

// Review Focus 2 — a late flush after the candidate finished: the ingest's
// own "silent no-op past submission" rule means this never reaches
// `violationOutcome` at all, so it must not submit a second time or
// overwrite the candidate's own reason.
it("does not submit an already-submitted attempt", async () => {
  const submitRes = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: attemptCookie },
  });
  expect(submitRes.status).toBe(200);
  expect(await submittedAuditCount()).toBe(1);

  const res = await reachLimit(attemptCookie, 6);
  expect(res.status).toBeLessThan(500);
  expect(await submittedAuditCount()).toBe(1);
  expect((await attemptState(attemptId)).submitReason).toBe("manual");
});

// --- the budget: the worst case is declared and measured -------------------

// **13** (`ROUTE_BUDGETS[EVENTS_PATH]`, `app.ts`'s own comment has the full
// arithmetic): the limit-reaching 5, plus `submitAttempt`'s own cost, which
// Phase 7e Task 5 (`Q6a`) moved from 5 to 8 by adding its own
// `recomputeIntegrity` call (`run/submit.ts`'s "a submit always recomputes"
// comment). `routes/proctoring.ts`'s own `recomputeIntegrity` call is
// skipped for this batch (`!submitted` is false once `submitAttempt` has
// already fired one) — paying the recompute twice for one answer is exactly
// what that guard exists to refuse.
it("the worst case — the batch that first auto-submits — costs the declared ceiling, measured", async () => {
  const counting = countingDeps(deps);
  const res = await post(
    EVENTS_PATH,
    { events: Array.from({ length: 5 }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    attemptCookie,
    createApp(counting.deps),
  );
  expect((await res.json() as { submitted: boolean }).submitted).toBe(true);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[EVENTS_PATH]);
});
