// Phase 7e Task 4 (`Q5a`): the unlock, and the one read it needs — the
// product's first organiser-side attempt routes, and the only way out of
// Task 3's lock.
//
// Combines `test/run/fixtures.ts`'s own candidate-side helpers (a
// published, `violation_action: "lock"` test, the way `test/run/
// lock.test.ts` builds one) with `test/invites.test.ts`'s own organiser
// cookie pattern (`createUser` + `addMembership` + `issueSession`).

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createCandidate,
  createUser,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { EVENTS_PATH } from "../../src/routes/proctoring.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import type { LockedAttemptRow } from "../../src/routes/attempts.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "../run/fixtures.js";
import { PAPER_FORM, seedBank } from "../run/paper-fixtures.js";

const T = FIXED_NOW;
const SLUG = { workspace: "alpha", test: "lockable" } as const;

const { deps } = await testDeps();
const app = createApp(deps);

const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Alpha Corp");
const otherWorkspaceId = await seedWorkspace(deps, "beta", "Beta Corp");
const q = await seedBank(deps, workspaceId);
// m8: a bank and a published test of beta's own, so a beta attempt id
// exists to try against alpha's own `:id`/`:testId` pair.
const otherQ = await seedBank(deps, otherWorkspaceId);

const testId = await seedTest(deps, workspaceId, {
  name: "Lockable",
  slug: SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "standard", overrides: { violation_limit: 5, violation_action: "lock" } },
    },
    sections: [{ id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } }],
  },
});

const OTHER_SLUG = { workspace: "beta", test: "lockable" } as const;
await seedTest(deps, otherWorkspaceId, {
  name: "Lockable (beta)",
  slug: OTHER_SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "standard", overrides: { violation_limit: 5, violation_action: "lock" } },
    },
    sections: [{ id: "only", title: "Only", source: { kind: "fixed", questions: [otherQ["LOG-001"] as string] } }],
  },
});

afterAll(() => closeClient(deps.db));

// --- organiser cookies --------------------------------------------------

async function cookieFor(ws: string, role: "owner" | "admin" | "author" | "proctor", email: string): Promise<string> {
  const userId = await createUser(deps.db, { email, authProvider: "magic_link", now: T });
  await addMembership(deps.db, ws, { userId, role, now: T });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

// `proctor`: the narrowest role that holds `attempts.monitor` (`owner` and
// `admin` hold it too, but also every other action — a 200 against either
// proves nothing a 403-suite finding would catch). `KG2`.
const proctorCookie = await cookieFor(workspaceId, "proctor", "proctor@alpha.test");
// `author` holds `tests.edit` and not `attempts.monitor` — the narrowest
// role that does NOT hold the action, for the 403 beside the 200 above.
const authorCookie = await cookieFor(workspaceId, "author", "author@alpha.test");
// A member of a *different* workspace — S-09's 404-not-403.
const otherWorkspaceCookie = await cookieFor(otherWorkspaceId, "proctor", "proctor@beta.test");

// --- candidate-side helpers (mirrors test/run/lock.test.ts) -------------

let serial = 1;

async function start(
  slug: { workspace: string; test: string } = SLUG,
): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, slug.workspace, slug.test, T);
  if (!test) throw new Error(`no published test at ${slug.workspace}/${slug.test}`);
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
  const res = await app.request(`/api/v1/run/${slug.workspace}/${slug.test}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start answered ${String(res.status)}`);
  const paper = (await res.json()) as AttemptPaper;
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "", attemptId: paper.attemptId };
}

function post(path: string, body: unknown, cookie: string, on = app): Promise<Response> {
  return on.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(path: string, body: unknown, cookie: string): Promise<Response> {
  return app.request(path, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function reachLimit(cookie: string, n = 5): Promise<Response> {
  return post(
    EVENTS_PATH,
    { events: Array.from({ length: n }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    cookie,
  );
}

/** Starts an attempt and drives it to the lock — the one setup every test
 *  below needs. */
async function lockedAttempt(): Promise<{ attemptId: string; attemptCookie: string }> {
  const { cookie, attemptId } = await start();
  const res = await reachLimit(cookie, 5);
  expect((await res.json() as { locked: boolean }).locked).toBe(true);
  return { attemptId, attemptCookie: cookie };
}

const listPath = `/api/v1/workspaces/${workspaceId}/tests/${testId}/attempts?status=locked`;
const unlockPath = (attemptId: string): string =>
  `/api/v1/workspaces/${workspaceId}/tests/${testId}/attempts/${attemptId}/unlock`;

const listLocked = (cookie: string): Promise<Response> => app.request(listPath, { headers: { cookie } });

const deadlineOf = async (attemptId: string): Promise<number> => {
  const rows = await deps.db.query<{ deadline_at: number }>("SELECT deadline_at FROM attempt WHERE id = ?", [
    attemptId,
  ]);
  return Number(rows[0]?.deadline_at);
};

const eventCount = async (attemptId: string, type: string): Promise<number> => {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM event WHERE attempt_id = ? AND type = ?",
    [attemptId, type],
  );
  return Number(rows[0]?.n ?? 0);
};

const auditFor = (target: string): Promise<{ actor: string; action: string; target: string }[]> =>
  deps.db.query<{ actor: string; action: string; target: string }>(
    "SELECT actor, action, target FROM audit_log WHERE workspace_id = ? AND target = ? ORDER BY at",
    [workspaceId, target],
  );

beforeEach(async () => {
  await deps.db.run("DELETE FROM event", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM candidate", []);
  await deps.db.run("DELETE FROM audit_log", []);
  await deps.db.run("DELETE FROM auth_token", []);
});

// --- the brief's own tests ------------------------------------------------

it("lists locked attempts for a test", async () => {
  const { attemptId } = await lockedAttempt();
  const res = await listLocked(proctorCookie);
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as { attempts: LockedAttemptRow[] };
  expect(body.attempts).toHaveLength(1);
  expect(body.attempts[0]).toMatchObject({ attemptId, violations: 5 });
});

it("unlocks, and the candidate can answer again", async () => {
  const { attemptId, attemptCookie } = await lockedAttempt();
  const res = await post(unlockPath(attemptId), {}, proctorCookie);
  expect(res.status, await res.clone().text()).toBe(200);

  const answer = await put(
    ANSWER_PATH,
    { questionId: q["LOG-001"] as string, value: { kind: "option", option: "a" }, clientSeq: 1 },
    attemptCookie,
  );
  expect(answer.status).toBe(200);

  // And it is gone from the locked list — the row this unlock cleared.
  const after = (await (await listLocked(proctorCookie)).json()) as { attempts: LockedAttemptRow[] };
  expect(after.attempts).toHaveLength(0);
});

// `attempt_unlocked`: `SERVER_SYNTHESIZED_EVENTS`, written only from here —
// Task 3 left this type declared with no emitter; this route is it.
it("emits attempt_unlocked", async () => {
  const { attemptId } = await lockedAttempt();
  await post(unlockPath(attemptId), {}, proctorCookie);
  expect(await eventCount(attemptId, "attempt_unlocked")).toBe(1);
});

it("writes an audit row naming the actor and the attempt", async () => {
  const { attemptId } = await lockedAttempt();
  await post(unlockPath(attemptId), {}, proctorCookie);
  const rows = await auditFor(attemptId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ action: "attempt.unlock", target: attemptId });
});

// Review Focus 4 — AC-23's rule, on the product's first organiser attempt
// route.
it("answers 404 to a member of another workspace", async () => {
  const { attemptId } = await lockedAttempt();
  const res = await post(unlockPath(attemptId), {}, otherWorkspaceCookie);
  expect(res.status).toBe(404);
});

it("answers 403 to a role without the permission", async () => {
  const { attemptId } = await lockedAttempt();
  const res = await post(unlockPath(attemptId), {}, authorCookie);
  expect(res.status).toBe(403);
});

// `Q5c` — no refund: the clock this unlock hands back is the same one the
// lock found, down to the column.
it("does not extend the attempt", async () => {
  const { attemptId } = await lockedAttempt();
  const before = await deadlineOf(attemptId);
  await post(unlockPath(attemptId), {}, proctorCookie);
  expect(await deadlineOf(attemptId)).toBe(before);
});

// --- the edges the brief's own tests imply but do not spell out ----------

it("404s an unlock for an attempt that does not exist", async () => {
  const res = await post(unlockPath("att_nonexistent"), {}, proctorCookie);
  expect(res.status).toBe(404);
});

// `getAttemptLockState`'s own scope: an attempt real in this workspace but
// on a DIFFERENT test must not be reachable through this test's own path —
// a looser `WHERE` here would let a proctor on test A unlock test B's
// candidate.
it("404s an unlock for an attempt that belongs to a different test in the same workspace", async () => {
  const otherTestId = await seedTest(deps, workspaceId, {
    name: "Elsewhere",
    slug: "elsewhere",
    body: {
      settings: {
        timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
        access: { mode: "link_code", access_code: "OPENSESAME" },
        registration_form: PAPER_FORM,
        proctoring: { profile: "standard", overrides: { violation_limit: 5, violation_action: "lock" } },
      },
      sections: [{ id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } }],
    },
  });
  const { attemptId } = await lockedAttempt();
  const res = await post(
    `/api/v1/workspaces/${workspaceId}/tests/${otherTestId}/attempts/${attemptId}/unlock`,
    {},
    proctorCookie,
  );
  expect(res.status).toBe(404);
});

// m8: the one half of `getAttemptLockState`'s scope the suite above never
// exercised — a proctor's own `:id`/`:testId` (both real, both theirs),
// against an attempt id that belongs to a wholly different workspace.
// `getAttemptLockState`'s own `WHERE a.workspace_id = ?` is what refuses
// this; without it, alpha's proctor could probe or unlock beta's attempts
// by id alone.
it("m8: 404s an unlock for an attempt id that belongs to a different workspace entirely", async () => {
  const { cookie, attemptId: betaAttemptId } = await start(OTHER_SLUG);
  const locked = await reachLimit(cookie, 5);
  expect((await locked.json() as { locked: boolean }).locked).toBe(true);

  const res = await post(unlockPath(betaAttemptId), {}, proctorCookie);
  expect(res.status).toBe(404);
});

it("409s a second unlock of the same attempt", async () => {
  const { attemptId } = await lockedAttempt();
  expect((await post(unlockPath(attemptId), {}, proctorCookie)).status).toBe(200);
  expect((await post(unlockPath(attemptId), {}, proctorCookie)).status).toBe(409);
});

it("400s a list request naming anything but status=locked", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/attempts`, {
    headers: { cookie: proctorCookie },
  });
  expect(res.status).toBe(400);
});

it("the routes are in ROUTE_ACTIONS and declared workspace in ROUTE_AUTH", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/attempts"]).toBe("attempts.monitor");
  expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/:testId/attempts/:attemptId/unlock"]).toBe(
    "attempts.monitor",
  );
  expect(ROUTE_AUTH["GET /api/v1/workspaces/:id/tests/:testId/attempts"]).toBe("workspace");
  expect(ROUTE_AUTH["POST /api/v1/workspaces/:id/tests/:testId/attempts/:attemptId/unlock"]).toBe("workspace");
});

it("measures the real subrequest cost of the locked-attempts list", async () => {
  await lockedAttempt();
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(listPath, { headers: { cookie: proctorCookie } });
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/attempts"]);
});

it("measures the real subrequest cost of the unlock", async () => {
  const { attemptId } = await lockedAttempt();
  const counting = countingDeps(deps);
  const res = await post(unlockPath(attemptId), {}, proctorCookie, createApp(counting.deps));
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(
    ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/attempts/:attemptId/unlock"],
  );
});
