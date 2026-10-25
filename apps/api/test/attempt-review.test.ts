// Phase 8g Task 4: The Per-Attempt Review Page (R-03, K1, K3, K4)
// Route: GET /api/v1/workspaces/:id/attempts/:attemptId/review
// Gated on `attempts.read_evidence`

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  appendEvents,
  closeClient,
  createAttempt,
  createBank,
  createCandidate,
  createTest,
  createUser,
  finishAttempt,
  getAttempt,
  getDraftVersion,
  newId,
  recordSnapshot,
  upsertQuestions,
  upsertResponse,
} from "@pariksha/db";
import type { Question } from "@pariksha/core";
import type { AttemptReviewPayload } from "../src/routes/attempt-review.js";
import {
  createApp,
  ROUTE_ACTIONS,
  ROUTE_AUTH,
  ROUTE_BUDGETS,
  type AppDeps,
} from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import type { PinnedLayout } from "../src/run/attempt.js";
import { recomputeIntegrity } from "../src/run/submit.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";
import { seedWorkspace } from "./run/fixtures.js";

const NOW = FIXED_NOW;

let deps: AppDeps;
let workspaceId: string;
let otherWorkspaceId: string;
let testId: string;
let testVersionId: string;
let q1Id: string;
let q2Id: string;
let layout: PinnedLayout;

let cleanAttemptId: string;
let candidateId: string;

let asReviewer = "";
let asProctor = "";
let asViewer = "";
let asAuthor = "";
let asOutsider = "";

beforeAll(async () => {
  ({ deps } = await testDeps());
  workspaceId = await seedWorkspace(deps);
  otherWorkspaceId = await seedWorkspace(deps, "other", "Other Corp");

  const bankId = await createBank(deps.db, workspaceId, {
    name: "Review fixtures bank",
    now: NOW,
  });

  const questions: Question[] = [
    {
      id: "q1",
      type: "single",
      prompt: "What is 2 + 2?",
      options: [
        { id: "a", text: "3" },
        { id: "b", text: "4" },
      ],
      key: "b",
      scoring: { points: 2 },
    },
    {
      id: "q2",
      type: "single",
      prompt: "What is the capital of France?",
      options: [
        { id: "a", text: "Paris" },
        { id: "b", text: "London" },
      ],
      key: "a",
      scoring: { points: 3 },
    },
  ];

  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, questions, NOW);
  [q1Id, q2Id] = ids as [string, string];

  const test = await createTest(deps.db, workspaceId, {
    name: "Review Test",
    slug: "review-test",
    now: NOW,
    body: {
      settings: {
        proctoring: { profile: "standard", require_camera: true, snapshot_interval_seconds: 60 },
      },
      sections: [
        {
          id: "sec-1",
          title: "Math & Geography",
          source: { kind: "fixed", questions: [q1Id, q2Id] },
        },
      ],
    },
  });
  testId = test.id;

  const draft = await getDraftVersion(deps.db, workspaceId, testId);
  if (!draft) throw new Error("createTest did not seed draft");
  testVersionId = draft.id;

  layout = {
    sections: [{ sectionId: "sec-1", questionIds: [q1Id, q2Id], optionOrder: {} }],
    media: [],
    paper: [],
  };

  candidateId = await createCandidate(deps.db, workspaceId, {
    testId,
    formValues: { name: "Alice Doe", email: "alice@example.com" },
    consentVersion: "1",
    now: NOW,
  });

  cleanAttemptId = newId("att");
  await createAttempt(deps.db, workspaceId, {
    id: cleanAttemptId,
    candidateId,
    testVersionId,
    setNo: 1,
    layout,
    startedAt: NOW,
    deadlineAt: NOW + 3_600_000,
    tokenHash: newId("tok"),
  });

  // Save answers
  await upsertResponse(deps.db, workspaceId, {
    attemptId: cleanAttemptId,
    questionId: q1Id,
    value: "b",
    clientSeq: 1,
    savedAt: NOW + 10_000,
  });
  await upsertResponse(deps.db, workspaceId, {
    attemptId: cleanAttemptId,
    questionId: q2Id,
    value: "a",
    clientSeq: 1,
    savedAt: NOW + 20_000,
  });

  // Finish attempt with scores
  await finishAttempt(deps.db, workspaceId, {
    attemptId: cleanAttemptId,
    submittedAt: NOW + 60_000,
    reason: "candidate",
    score: {
      perQuestion: {
        [q1Id]: { points: 2, max: 2, correct: true },
        [q2Id]: { points: 3, max: 3, correct: true },
      },
      sections: [{ sectionId: "sec-1", points: 5, max: 5 }],
      total: 5,
      max: 5,
      percent: 100,
      passed: true,
      pending: [],
    },
  });

  // Add identity snapshot and interval snapshot
  await recordSnapshot(deps.db, workspaceId, {
    attemptId: cleanAttemptId,
    storageKey: `snapshot/${cleanAttemptId}/identity.jpg`,
    takenAt: NOW + 1_000,
    reason: "identity",
  });
  await deps.storage.put(`snapshot/${cleanAttemptId}/identity.jpg`, new Uint8Array([1, 2, 3]), {
    contentType: "image/jpeg",
  });

  await recordSnapshot(deps.db, workspaceId, {
    attemptId: cleanAttemptId,
    storageKey: `snapshot/${cleanAttemptId}/interval-1.jpg`,
    takenAt: NOW + 60_000,
    reason: "interval",
  });
  await deps.storage.put(`snapshot/${cleanAttemptId}/interval-1.jpg`, new Uint8Array([4, 5, 6]), {
    contentType: "image/jpeg",
  });

  // Add event
  await appendEvents(deps.db, workspaceId, {
    attemptId: cleanAttemptId,
    events: [{ type: "fullscreen_enter", clientTs: NOW + 2_000 }],
    serverTs: NOW + 2_000,
  });

  // Create users & memberships
  const reviewerId = await createUser(deps.db, {
    email: "reviewer@review.test",
    authProvider: "magic_link",
    now: NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: reviewerId, role: "reviewer", now: NOW });
  asReviewer = await sessionCookie(deps, (await issueSession(deps, reviewerId)).token);

  const proctorId = await createUser(deps.db, {
    email: "proctor@review.test",
    authProvider: "magic_link",
    now: NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: proctorId, role: "proctor", now: NOW });
  asProctor = await sessionCookie(deps, (await issueSession(deps, proctorId)).token);

  const viewerId = await createUser(deps.db, {
    email: "viewer@review.test",
    authProvider: "magic_link",
    now: NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: viewerId, role: "viewer", now: NOW });
  asViewer = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

  const authorId = await createUser(deps.db, {
    email: "author@review.test",
    authProvider: "magic_link",
    now: NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: NOW });
  asAuthor = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const outsiderId = await createUser(deps.db, {
    email: "outsider@other.test",
    authProvider: "magic_link",
    now: NOW,
  });
  await addMembership(deps.db, otherWorkspaceId, { userId: outsiderId, role: "owner", now: NOW });
  asOutsider = await sessionCookie(deps, (await issueSession(deps, outsiderId)).token);
});

afterAll(() => closeClient(deps.db));

const reviewPath = (wsp: string, att: string) => `/api/v1/workspaces/${wsp}/attempts/${att}/review`;

describe("GET /api/v1/workspaces/:id/attempts/:attemptId/review", () => {
  it("declares its action as attempts.read_evidence and authority as workspace", () => {
    expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/attempts/:attemptId/review"]).toBe(
      "attempts.read_evidence",
    );
    expect(ROUTE_AUTH["GET /api/v1/workspaces/:id/attempts/:attemptId/review"]).toBe("workspace");
    expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/attempts/:attemptId/review"]).toBeDefined();
  });

  it("refuses unauthenticated caller with 401", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, cleanAttemptId));
    expect(res.status).toBe(401);
  });

  it("refuses a Viewer, who holds results.export and not attempts.read_evidence (403)", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, cleanAttemptId), {
      headers: { cookie: asViewer },
    });
    expect(res.status).toBe(403);
  });

  it("refuses an Author, who holds tests.edit and not attempts.read_evidence (403)", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, cleanAttemptId), {
      headers: { cookie: asAuthor },
    });
    expect(res.status).toBe(403);
  });

  it("refuses a member of another workspace with 404", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, cleanAttemptId), {
      headers: { cookie: asOutsider },
    });
    expect(res.status).toBe(404);
  });

  it("answers 404 for a nonexistent attempt", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, "att_nonexistent"), {
      headers: { cookie: asReviewer },
    });
    expect(res.status).toBe(404);
  });

  it("admits a Reviewer (200) and returns full review payload", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, cleanAttemptId), {
      headers: { cookie: asReviewer },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttemptReviewPayload;

    // attempt
    expect(body.attempt).toMatchObject({
      id: cleanAttemptId,
      candidateId,
      status: "submitted",
      startedAt: NOW,
      submittedAt: NOW + 60_000,
      totalScore: 5,
      maxScore: 5,
      integrityFlag: "clean",
      observed: true,
    });

    // registration
    expect(body.registration).toEqual({
      name: "Alice Doe",
      email: "alice@example.com",
    });

    // identityPhotoUrl
    expect(body.identityPhotoUrl).toBeTruthy();
    expect(body.identityPhotoUrl).toContain("snapshot/");

    // answers with keys for authorised reviewers
    expect(body.answers).toHaveLength(2);
    expect(body.answers[0]).toMatchObject({
      questionId: q1Id,
      sectionId: "sec-1",
      answer: "b",
      key: "b",
      pointsAwarded: 2,
      maxPoints: 2,
      correct: true,
    });

    // sectionScores
    expect(body.sectionScores).toHaveLength(1);
    expect(body.sectionScores[0]).toMatchObject({
      sectionId: "sec-1",
      title: "Math & Geography",
      score: 5,
      maxScore: 5,
    });

    // events
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events[0]).toMatchObject({
      kind: "fullscreen_enter",
      serverTs: NOW + 2_000,
    });

    // timeline
    expect(body.timeline.length).toBeGreaterThan(0);
  });

  it("admits a Proctor (200)", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, cleanAttemptId), {
      headers: { cookie: asProctor },
    });
    expect(res.status).toBe(200);
  });

  it("renders face count as not counted (null), never 0", async () => {
    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, cleanAttemptId), {
      headers: { cookie: asReviewer },
    });
    const body = (await res.json()) as AttemptReviewPayload;
    const snapshotItem = body.timeline.find((t) => t.kind === "snapshot");
    expect(snapshotItem).toBeDefined();
    expect(snapshotItem?.faceCount).toBeNull();
  });

  it("serves snapshots by presigned URL and spends no storage subrequests (K3/K4)", async () => {
    // Seed attempt with many snapshots
    const heavyAttemptId = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: heavyAttemptId,
      candidateId,
      testVersionId,
      setNo: 1,
      layout,
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash: newId("tok"),
    });

    for (let i = 0; i < 60; i++) {
      const key = `snapshot/${heavyAttemptId}/${i}.jpg`;
      await recordSnapshot(deps.db, workspaceId, {
        attemptId: heavyAttemptId,
        storageKey: key,
        takenAt: NOW + i * 60_000,
        reason: "interval",
      });
    }

    const counting = countingDeps(deps);
    const countedApp = createApp(counting.deps);

    const res = await countedApp.request(reviewPath(workspaceId, heavyAttemptId), {
      headers: { cookie: asReviewer },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttemptReviewPayload;
    expect(body.timeline.filter((t) => t.kind === "snapshot")).toHaveLength(60);

    // K3/K4 check: 0 storage subrequests spent
    expect(counting.counts().storage).toBe(0);
    // Subrequests must stay within declared budget
    expect(counting.counts().total).toBeLessThanOrEqual(
      ROUTE_BUDGETS["/api/v1/workspaces/:id/attempts/:attemptId/review"]!,
    );
  });

  it("marks the periods proctoring was not watching rather than filling them (unobserved gap)", async () => {
    const gapAttemptId = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: gapAttemptId,
      candidateId,
      testVersionId,
      setNo: 1,
      layout,
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash: newId("tok"),
    });

    // Add camera_lost event (creates an unobserved gap)
    await appendEvents(deps.db, workspaceId, {
      attemptId: gapAttemptId,
      events: [
        {
          type: "camera_lost",
          detail: { outageMs: 120_000 },
          clientTs: NOW + 10_000,
        },
      ],
      serverTs: NOW + 10_000,
    });

    const app = createApp(deps);
    const res = await app.request(reviewPath(workspaceId, gapAttemptId), {
      headers: { cookie: asReviewer },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AttemptReviewPayload;
    const unobserved = body.timeline.find((t) => t.kind === "unobserved");
    expect(unobserved).toBeDefined();
  });

  it("an integrity recompute never clears scoring_blocked", async () => {
    const blockedAttemptId = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: blockedAttemptId,
      candidateId,
      testVersionId,
      setNo: 1,
      layout,
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash: newId("tok"),
    });

    // Mark attempt flag as scoring_blocked
    await deps.db.run("UPDATE attempt SET flag = ? WHERE workspace_id = ? AND id = ?", [
      "scoring_blocked",
      workspaceId,
      blockedAttemptId,
    ]);

    await recomputeIntegrity(deps, blockedAttemptId);

    const row = await getAttempt(deps.db, workspaceId, blockedAttemptId);
    expect(row?.flag).toBe("scoring_blocked");
  });

  it("fires attempt.flagged when a recompute raises the flag to review", async () => {
    const flagAttemptId = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: flagAttemptId,
      candidateId,
      testVersionId,
      setNo: 1,
      layout,
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash: newId("tok"),
    });

    await deps.db.run(
      "INSERT INTO webhook (id, workspace_id, url, signing_secret, events_json, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
      [newId("whk"), workspaceId, "https://example.test/flagged-hook", "whsec_test", JSON.stringify(["attempt.flagged"]), NOW],
    );

    // Post enough violations to trigger review in integrity recompute
    await appendEvents(deps.db, workspaceId, {
      attemptId: flagAttemptId,
      events: [
        { type: "window_blur", clientTs: NOW + 1_000 },
        { type: "window_blur", clientTs: NOW + 2_000 },
      ],
      serverTs: NOW + 2_000,
    });

    await recomputeIntegrity(deps, flagAttemptId);

    // Check delivery was queued for attempt.flagged
    const rows = await deps.db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM webhook_delivery WHERE workspace_id = ? AND event = ?",
      [workspaceId, "attempt.flagged"],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
