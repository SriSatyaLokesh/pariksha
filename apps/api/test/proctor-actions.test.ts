import { afterAll, describe, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createBank,
  createUser,
  getAttempt,
  listAudit,
  listResponses,
  newId,
  upsertQuestions,
  upsertResponse,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../src/app.js";
import { issueSession } from "../src/auth/session.js";
import { countingDeps } from "../src/instrument.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./run/fixtures.js";

const T = FIXED_NOW;

const { deps } = await testDeps({ now: () => T });
const app = createApp(deps);
afterAll(() => closeClient(deps.db));

async function cookieFor(
  ws: string,
  role: "owner" | "admin" | "author" | "proctor" | "viewer",
  email: string,
): Promise<string> {
  const userId = await createUser(deps.db, { email, authProvider: "magic_link", now: T });
  await addMembership(deps.db, ws, { userId, role, now: T });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

const workspaceId = await seedWorkspace(deps, "alpha-proctor", "Alpha Proctor Workspace");
const proctorCookie = await cookieFor(workspaceId, "proctor", "proctor@alpha-proctor.test");
const viewerCookie = await cookieFor(workspaceId, "viewer", "viewer@alpha-proctor.test");
const authorCookie = await cookieFor(workspaceId, "author", "author@alpha-proctor.test");

const bankId = await createBank(deps.db, workspaceId, { name: "Proctor Action Bank", now: T });
await upsertQuestions(
  deps.db,
  workspaceId,
  bankId,
  [
    {
      id: "Q-001",
      type: "single",
      prompt: "Question 1?",
      options: [
        { id: "a", text: "Opt A" },
        { id: "b", text: "Opt B" },
      ],
      key: "a",
      scoring: { points: 1 },
    },
  ],
  T,
);

// Test with attempts_allowed: 2
const testId2 = await seedTest(deps, workspaceId, {
  name: "Proctor Action Test 2 Attempts",
  slug: "action-test-2",
  body: {
    settings: {
      timing: { duration_minutes: 60, attempts_allowed: 2, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      proctoring: { profile: "strict" },
    },
    sections: [{ id: "sec1", title: "Sec 1", source: { kind: "bank", bankId, count: 1 } }],
  },
});

// Test with attempts_allowed: 1
const testId1 = await seedTest(deps, workspaceId, {
  name: "Proctor Action Test 1 Attempt",
  slug: "action-test-1",
  body: {
    settings: {
      timing: { duration_minutes: 60, attempts_allowed: 1, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      proctoring: { profile: "strict" },
    },
    sections: [{ id: "sec1", title: "Sec 1", source: { kind: "bank", bankId, count: 1 } }],
  },
});

const CANDIDATE_EMAIL = "candidate@privacy-test.com";

async function createTestAttempt(
  tId: string,
  opts?: {
    email?: string;
    submitted?: boolean;
    locked?: boolean;
    startedAt?: number;
    deadlineAt?: number;
  },
): Promise<{ candidateId: string; attemptId: string; testVersionId: string }> {
  const versionRow = await deps.db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
    [tId],
  );
  const versionId = versionRow[0]!.id;
  const candidateId = newId("cnd");
  const attemptId = newId("att");

  const email = opts?.email ?? `${candidateId}@test.com`;
  await deps.db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, source, form_values_json, consent_version, consent_at, created_at) " +
      "VALUES (?, ?, ?, ?, 'registration', ?, '2026-10-01', ?, ?)",
    [
      candidateId,
      workspaceId,
      tId,
      email,
      JSON.stringify({ name: "Test Candidate", email }),
      T,
      T,
    ],
  );

  const startedAt = opts?.startedAt ?? T;
  const deadlineAt = opts?.deadlineAt ?? T + 3600_000;
  const submittedAt = opts?.submitted ? T - 100 : null;
  const submitReason = opts?.submitted ? "manual" : null;
  const lockedAt = opts?.locked ? T - 200 : null;

  const layoutJson = JSON.stringify({
    sections: [{ sectionId: "sec1", questionIds: ["Q-001"], optionOrder: {} }],
    paper: [{ id: "sec1", title: "Sec 1", questions: [{ id: "Q-001", prompt: "Question 1?", type: "single", options: [{ id: "a", text: "Opt A" }] }] }],
  });

  await deps.db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed, locked_at) " +
      "VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, 'clean', ?, 0, NULL, 'clean', 1, ?)",
    [
      attemptId,
      workspaceId,
      candidateId,
      versionId,
      layoutJson,
      startedAt,
      deadlineAt,
      submittedAt,
      submitReason,
      `hash_${attemptId}`,
      lockedAt,
    ],
  );

  return { candidateId, attemptId, testVersionId: versionId };
}

describe("POST /api/v1/workspaces/:id/attempts/:attemptId/action", () => {
  it("route metadata is registered in app.ts", () => {
    expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/attempts/:attemptId/action"]).toBe("attempts.monitor");
    expect(ROUTE_AUTH["POST /api/v1/workspaces/:id/attempts/:attemptId/action"]).toBe("workspace");
    expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/attempts/:attemptId/action"]).toBeGreaterThan(0);
  });

  it("extends the deadline", async () => {
    const originalDeadline = T + 3600_000;
    const { attemptId } = await createTestAttempt(testId2, { deadlineAt: originalDeadline });

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "extend_time", minutes: 10 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ extended: true, deadlineAt: originalDeadline + 600_000 });

    const updated = await getAttempt(deps.db, workspaceId, attemptId);
    expect(updated?.deadlineAt).toBe(originalDeadline + 600_000);
  });

  it("extending deadline on already-submitted attempt is a no-op", async () => {
    const originalDeadline = T + 3600_000;
    const { attemptId } = await createTestAttempt(testId2, { deadlineAt: originalDeadline, submitted: true });

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "extend_time", minutes: 10 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ extended: false, reason: "already_submitted" });

    const updated = await getAttempt(deps.db, workspaceId, attemptId);
    expect(updated?.deadlineAt).toBe(originalDeadline);
  });

  it("unlock clears locked_at", async () => {
    const { attemptId } = await createTestAttempt(testId2, { locked: true });

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "unlock" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ unlocked: true });

    const updated = await deps.db.query<{ locked_at: number | null }>(
      "SELECT locked_at FROM attempt WHERE id = ?",
      [attemptId],
    );
    expect(updated[0]?.locked_at).toBeNull();
  });

  it("reset mints a new attempt and keeps the old one intact", async () => {
    const { attemptId, candidateId } = await createTestAttempt(testId2);

    // Save an answer for the first attempt
    await upsertResponse(deps.db, workspaceId, {
      attemptId,
      questionId: "Q-001",
      value: "a",
      clientSeq: 1,
      savedAt: T,
    });
    const beforeResponses = await listResponses(deps.db, workspaceId, attemptId);
    expect(beforeResponses).toHaveLength(1);

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "reset" }),
    });

    expect(res.status).toBe(200);
    const { newAttemptId } = await res.json();
    expect(newAttemptId).toBeDefined();
    expect(newAttemptId).not.toBe(attemptId);

    // Old attempt responses are completely intact
    const afterResponses = await listResponses(deps.db, workspaceId, attemptId);
    expect(afterResponses).toHaveLength(1);
    expect(afterResponses[0]?.value).toBe("a");

    // New attempt exists for same candidate
    const newAttempt = await getAttempt(deps.db, workspaceId, newAttemptId);
    expect(newAttempt).not.toBeNull();
    expect(newAttempt?.candidateId).toBe(candidateId);
  });

  it("reset pins the same test version", async () => {
    const { attemptId } = await createTestAttempt(testId2);

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "reset" }),
    });

    expect(res.status).toBe(200);
    const { newAttemptId } = await res.json();

    const oldAttempt = await getAttempt(deps.db, workspaceId, attemptId);
    const newAttempt = await getAttempt(deps.db, workspaceId, newAttemptId);
    expect(newAttempt!.testVersionId).toBe(oldAttempt!.testVersionId);
  });

  it("reset is refused with 409 when at attempts ceiling", async () => {
    // testId1 has attempts_allowed: 1
    const { attemptId } = await createTestAttempt(testId1);

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "reset" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("attempts_exhausted");
  });

  it("force submit on an already-submitted attempt is a no-op, not a second submission", async () => {
    const { attemptId } = await createTestAttempt(testId2);

    const first = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "force_submit" }),
    });
    expect(first.status).toBe(200);

    const afterFirst = await getAttempt(deps.db, workspaceId, attemptId);
    expect(afterFirst?.submittedAt).not.toBeNull();
    const firstSubmittedAt = afterFirst!.submittedAt;

    const second = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "force_submit" }),
    });
    expect(second.status).toBe(200);

    const afterSecond = await getAttempt(deps.db, workspaceId, attemptId);
    expect(afterSecond?.submittedAt).toBe(firstSubmittedAt);
  });

  it("audits every action, including one that changed nothing", async () => {
    const { attemptId } = await createTestAttempt(testId2);

    await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "force_submit" }),
    });

    await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "force_submit" }),
    });

    const auditLogs = await listAudit(deps.db, workspaceId);
    const forceSubmitAudits = auditLogs.filter(
      (r) => r.action === "proctor.force_submit" && r.target === attemptId,
    );
    expect(forceSubmitAudits).toHaveLength(2);
  });

  it("audits with ids and never a candidate's email or name — KG9", async () => {
    const { attemptId } = await createTestAttempt(testId2, { email: CANDIDATE_EMAIL });

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "message", text: "Please fix your camera" }),
    });
    expect(res.status).toBe(200);

    const auditLogs = await listAudit(deps.db, workspaceId);
    const messageAudits = auditLogs.filter(
      (r) => r.action === "proctor.message" && r.target === attemptId,
    );
    expect(messageAudits.length).toBeGreaterThanOrEqual(1);
    const row = messageAudits.at(-1)!;

    expect(JSON.stringify(row.detail)).not.toContain(CANDIDATE_EMAIL);
    expect(JSON.stringify(row.detail)).not.toContain("Test Candidate");
    expect(row.detail).toMatchObject({ text: "Please fix your camera" });
  });

  it("refuses a Viewer (403) and admits a Proctor (200)", async () => {
    const { attemptId } = await createTestAttempt(testId2);

    const actionUrl = `/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`;
    const body = JSON.stringify({ kind: "extend_time", minutes: 5 });

    const viewerRes = await app.request(actionUrl, {
      method: "POST",
      headers: { cookie: viewerCookie, "content-type": "application/json" },
      body,
    });
    expect(viewerRes.status).toBe(403);

    const authorRes = await app.request(actionUrl, {
      method: "POST",
      headers: { cookie: authorCookie, "content-type": "application/json" },
      body,
    });
    expect(authorRes.status).toBe(403);

    const proctorRes = await app.request(actionUrl, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body,
    });
    expect(proctorRes.status).toBe(200);
  });

  it("returns 404 for unknown attempt", async () => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/att_nonexistent/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "unlock" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid action kind", async () => {
    const { attemptId } = await createTestAttempt(testId2);

    const res = await app.request(`/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`, {
      method: "POST",
      headers: { cookie: proctorCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "fly_to_moon" }),
    });
    expect(res.status).toBe(400);
  });

  it("measures the real subrequest cost of the action route", async () => {
    const { attemptId } = await createTestAttempt(testId2);
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(
      `/api/v1/workspaces/${workspaceId}/attempts/${attemptId}/action`,
      {
        method: "POST",
        headers: { cookie: proctorCookie, "content-type": "application/json" },
        body: JSON.stringify({ kind: "extend_time", minutes: 15 }),
      },
    );
    expect(res.status).toBe(200);
    expect(counting.counts().total).toBeLessThanOrEqual(
      ROUTE_BUDGETS["/api/v1/workspaces/:id/attempts/:attemptId/action"],
    );
  });
});
