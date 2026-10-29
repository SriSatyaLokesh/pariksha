import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createAttempt,
  createBank,
  createCandidate,
  createTest,
  createUser,
  finishAttempt,
  getDraftVersion,
  lockAttempt,
  newId,
  publishDraftVersion,
  putDraftVersion,
  setIntegrity,
  upsertQuestions,
  type Question,
  type TestDocumentBody,
} from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import type { AppDeps } from "../../src/app.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedWorkspace } from "../run/fixtures.js";

const NOW = FIXED_NOW;

async function cookieFor(
  deps: AppDeps,
  workspaceId: string,
  role: "viewer" | "reviewer" | "author" | "owner",
): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const userId = await createUser(deps.db, {
    email: `${role}-${suffix}@results-test.pariksha`,
    authProvider: "magic_link",
    now: NOW,
  });
  await addMembership(deps.db, workspaceId, { userId, role, now: NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

describe("Results API Routes", () => {
  let deps: AppDeps;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let test1Id: string;
  let test2Id: string;
  let zeroAttemptTestId: string;
  let q1Id: string;
  let q2Id: string;

  let viewerCookie: string;
  let reviewerCookie: string;
  let authorCookie: string;

  beforeAll(async () => {
    ({ deps } = await testDeps());
    workspaceId = await seedWorkspace(deps, "alpha-results", "Alpha Results Workspace");
    otherWorkspaceId = await seedWorkspace(deps, "beta-results", "Beta Results Workspace");

    viewerCookie = await cookieFor(deps, workspaceId, "viewer");
    reviewerCookie = await cookieFor(deps, workspaceId, "reviewer");
    authorCookie = await cookieFor(deps, workspaceId, "author");

    // Setup question bank
    const bankId = await createBank(deps.db, workspaceId, {
      name: "Results Bank",
      now: NOW,
    });

    const questions: Question[] = [
      {
        id: "q1",
        type: "single",
        prompt: "What is the capital of France? Paris or Berlin or London or Madrid?",
        options: [
          { id: "a", text: "Paris" },
          { id: "b", text: "Berlin" },
        ],
        key: "a",
        scoring: { points: 2 },
      },
      {
        id: "q2",
        type: "single",
        prompt: "What is 10 + 10?",
        options: [
          { id: "a", text: "20" },
          { id: "b", text: "30" },
        ],
        key: "a",
        scoring: { points: 3 },
      },
    ];

    const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, questions, NOW);
    [q1Id, q2Id] = ids as [string, string];

    const testBody: TestDocumentBody = {
      settings: {
        scoring: { pass_mark_percent: 60 },
        timing: { duration_minutes: 60 },
      },
      sections: [
        {
          id: "sec-1",
          title: "Section 1",
          source: { kind: "fixed", questions: [q1Id, q2Id] },
        },
      ],
    };

    // Test 1: Published with attempts
    const t1 = await createTest(deps.db, workspaceId, {
      name: "Midterm Exam",
      slug: "midterm-exam",
      now: NOW,
    });
    test1Id = t1.id;
    const draft1 = await getDraftVersion(deps.db, workspaceId, test1Id);
    if (!draft1) throw new Error("Missing draft 1");
    await putDraftVersion(deps.db, workspaceId, draft1, testBody, NOW);
    await publishDraftVersion(deps.db, workspaceId, test1Id, NOW);

    // Test 2: Another test with 1 attempt
    const t2 = await createTest(deps.db, workspaceId, {
      name: "Quiz 1",
      slug: "quiz-1",
      now: NOW,
    });
    test2Id = t2.id;
    const draft2 = await getDraftVersion(deps.db, workspaceId, test2Id);
    if (!draft2) throw new Error("Missing draft 2");
    await putDraftVersion(deps.db, workspaceId, draft2, testBody, NOW);
    await publishDraftVersion(deps.db, workspaceId, test2Id, NOW);

    // Test 3: Zero attempts test
    const t3 = await createTest(deps.db, workspaceId, {
      name: "Empty Test",
      slug: "empty-test",
      now: NOW,
    });
    zeroAttemptTestId = t3.id;
    const draft3 = await getDraftVersion(deps.db, workspaceId, zeroAttemptTestId);
    if (!draft3) throw new Error("Missing draft 3");
    await putDraftVersion(deps.db, workspaceId, draft3, testBody, NOW);
    await publishDraftVersion(deps.db, workspaceId, zeroAttemptTestId, NOW);

    // Seed Candidates for Test 1
    // Candidate 1: Alice Doe - submitted clean passed
    const c1Id = await createCandidate(deps.db, workspaceId, {
      testId: test1Id,
      formValues: { name: "Alice Doe", email: "alice@example.com" },
      consentVersion: "1",
      now: NOW,
    });
    await deps.db.run("UPDATE candidate SET external_id = ? WHERE id = ?", ["STU-001", c1Id]);

    // Candidate 2: Bob Smith - auto_submitted review failed
    const c2Id = await createCandidate(deps.db, workspaceId, {
      testId: test1Id,
      formValues: { fullName: "Bob Smith", emailAddress: "bob@example.com" },
      consentVersion: "1",
      now: NOW,
    });
    await deps.db.run("UPDATE candidate SET external_id = ? WHERE id = ?", ["STU-002", c2Id]);

    // Candidate 3: Charlie Brown - in progress (unscored)
    const c3Id = await createCandidate(deps.db, workspaceId, {
      testId: test1Id,
      formValues: { candidateName: "Charlie Brown", candidateEmail: "charlie@example.com" },
      consentVersion: "1",
      now: NOW,
    });
    await deps.db.run("UPDATE candidate SET external_id = ? WHERE id = ?", ["STU-003", c3Id]);

    // Candidate 4: Dave Miller - locked
    const c4Id = await createCandidate(deps.db, workspaceId, {
      testId: test1Id,
      formValues: { name: "Dave Miller", email: "dave@example.com" },
      consentVersion: "1",
      now: NOW,
    });
    await deps.db.run("UPDATE candidate SET external_id = ? WHERE id = ?", ["STU-004", c4Id]);

    // Candidate 5: Anonymous candidate (no name in formValues, externalId only)
    const c5Id = await createCandidate(deps.db, workspaceId, {
      testId: test1Id,
      formValues: {},
      consentVersion: "1",
      now: NOW,
    });
    await deps.db.run("UPDATE candidate SET external_id = ? WHERE id = ?", ["STU-005", c5Id]);

    // Seed Attempts for Test 1
    const layout = {
      sections: [{ sectionId: "sec-1", questionIds: [q1Id, q2Id], optionOrder: {} }],
      media: [],
      paper: [],
    };

    // Attempt 1: Alice (submitted, 100%, passed, rank 1, clean)
    const att1Id = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: att1Id,
      candidateId: c1Id,
      testVersionId: draft1.id,
      setNo: 1,
      layout,
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash: newId("tok"),
    });
    await finishAttempt(deps.db, workspaceId, {
      attemptId: att1Id,
      submittedAt: NOW + 1_800_000,
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

    // Attempt 2: Bob (auto_submitted, 40%, failed, rank 2, review flag)
    const att2Id = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: att2Id,
      candidateId: c2Id,
      testVersionId: draft1.id,
      setNo: 1,
      layout,
      startedAt: NOW + 100_000,
      deadlineAt: NOW + 3_700_000,
      tokenHash: newId("tok"),
    });
    await finishAttempt(deps.db, workspaceId, {
      attemptId: att2Id,
      submittedAt: NOW + 2_500_000,
      reason: "timeout",
      score: {
        perQuestion: {
          [q1Id]: { points: 2, max: 2, correct: true },
          [q2Id]: { points: 0, max: 3, correct: false },
        },
        sections: [{ sectionId: "sec-1", points: 2, max: 5 }],
        total: 2,
        max: 5,
        percent: 40,
        passed: false,
        pending: [],
      },
    });
    await setIntegrity(deps.db, workspaceId, {
      attemptId: att2Id,
      integrityFlag: "review",
      observed: true,
    });

    // Attempt 3: Charlie (in progress, not submitted, not locked)
    const att3Id = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: att3Id,
      candidateId: c3Id,
      testVersionId: draft1.id,
      setNo: 1,
      layout,
      startedAt: NOW + 200_000,
      deadlineAt: NOW + 3_800_000,
      tokenHash: newId("tok"),
    });

    // Attempt 4: Dave (locked)
    const att4Id = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: att4Id,
      candidateId: c4Id,
      testVersionId: draft1.id,
      setNo: 1,
      layout,
      startedAt: NOW + 300_000,
      deadlineAt: NOW + 3_900_000,
      tokenHash: newId("tok"),
    });
    await lockAttempt(deps.db, workspaceId, {
      attemptId: att4Id,
      now: NOW + 350_000,
    });

    // Attempt 5: Anonymous candidate (scoring_blocked)
    const att5Id = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: att5Id,
      candidateId: c5Id,
      testVersionId: draft1.id,
      setNo: 1,
      layout,
      startedAt: NOW + 400_000,
      deadlineAt: NOW + 4_000_000,
      tokenHash: newId("tok"),
    });
    await finishAttempt(deps.db, workspaceId, {
      attemptId: att5Id,
      submittedAt: NOW + 2_000_000,
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
    // Mark as scoring_blocked in db
    await deps.db.run("UPDATE attempt SET flag = 'scoring_blocked' WHERE id = ?", [att5Id]);

    // Seed Attempt for Test 2
    const cQuiz = await createCandidate(deps.db, workspaceId, {
      testId: test2Id,
      externalId: "QUIZ-001",
      formValues: { name: "Quiz Taker", email: "quiz@example.com" },
      consentVersion: "1",
      now: NOW,
    });
    const attQuizId = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: attQuizId,
      candidateId: cQuiz,
      testVersionId: draft2.id,
      setNo: 1,
      layout,
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash: newId("tok"),
    });
    await finishAttempt(deps.db, workspaceId, {
      attemptId: attQuizId,
      submittedAt: NOW + 600_000,
      reason: "candidate",
      score: {
        perQuestion: {},
        sections: [],
        total: 5,
        max: 5,
        percent: 100,
        passed: true,
        pending: [],
      },
    });
  });

  afterAll(async () => {
    await closeClient(deps.db);
  });

  describe("GET /api/v1/workspaces/:id/results/overview", () => {
    it("returns tests list with aggregate stats for the workspace", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/results/overview`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { tests: Array<{
        id: string;
        name: string;
        slug: string;
        state: string;
        candidateCount: number;
        attemptCount: number;
        submittedCount: number;
        averageScore: number | null;
        passRate: number | null;
      }> };

      expect(Array.isArray(data.tests)).toBe(true);
      expect(data.tests.length).toBe(3);

      const t1Overview = data.tests.find((t) => t.id === test1Id);
      expect(t1Overview).toBeDefined();
      expect(t1Overview?.name).toBe("Midterm Exam");
      expect(t1Overview?.slug).toBe("midterm-exam");
      expect(t1Overview?.candidateCount).toBe(5);
      expect(t1Overview?.attemptCount).toBe(5);
      expect(t1Overview?.submittedCount).toBe(3);
      // Average score of 3 submitted attempts: (100 + 40 + 100) / 3 = 80.0
      expect(t1Overview?.averageScore).toBe(80);
      // Pass rate: 2 passed out of 3 submitted = 0.67
      expect(t1Overview?.passRate).toBe(0.67);

      const emptyOverview = data.tests.find((t) => t.id === zeroAttemptTestId);
      expect(emptyOverview).toBeDefined();
      expect(emptyOverview?.candidateCount).toBe(0);
      expect(emptyOverview?.attemptCount).toBe(0);
      expect(emptyOverview?.submittedCount).toBe(0);
      expect(emptyOverview?.averageScore).toBeNull();
      expect(emptyOverview?.passRate).toBeNull();
    });

    it("allows reviewer role", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/results/overview`, {
        headers: { cookie: reviewerCookie },
      });
      expect(res.status).toBe(200);
    });

    it("forbids author role lacking results.export", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/results/overview`, {
        headers: { cookie: authorCookie },
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/workspaces/:id/tests/:testId/results", () => {
    it("returns test info, summary metrics, and candidate attempt items", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        test: { id: string; title: string; totalPoints: number; passMark: number };
        summary: {
          totalRegistered: number;
          submittedCount: number;
          inProgressCount: number;
          lockedCount: number;
          averageScore: number | null;
          passRate: number | null;
        };
        results: Array<{
          attemptId: string;
          candidateId: string;
          candidateName: string | null;
          candidateEmail: string | null;
          externalId: string | null;
          status: string;
          startedAt: number;
          submittedAt: number | null;
          durationSeconds: number | null;
          score: number | null;
          maxScore: number | null;
          percentage: number | null;
          passed: boolean | null;
          rank: number | null;
          integrityFlag: string;
          violations: number;
          questionBreakdown: Array<{
            questionId: string;
            promptExcerpt: string;
            pointsEarned: number;
            maxPoints: number;
            correct: boolean | null;
          }>;
        }>;
        nextCursor: string | null;
      };

      expect(data.test.id).toBe(test1Id);
      expect(data.test.title).toBe("Midterm Exam");
      expect(data.test.totalPoints).toBe(5);
      expect(data.test.passMark).toBe(60);

      // Summary
      expect(data.summary.totalRegistered).toBe(5);
      expect(data.summary.submittedCount).toBe(3);
      expect(data.summary.inProgressCount).toBe(1);
      expect(data.summary.lockedCount).toBe(1);
      expect(data.summary.averageScore).toBe(80);
      expect(data.summary.passRate).toBe(0.67);

      // Results items
      expect(data.results.length).toBe(5);

      // Alice (submitted)
      const alice = data.results.find((r) => r.candidateName === "Alice Doe");
      expect(alice).toBeDefined();
      expect(alice?.candidateEmail).toBe("alice@example.com");
      expect(alice?.externalId).toBe("STU-001");
      expect(alice?.status).toBe("submitted");
      expect(alice?.durationSeconds).toBe(1800);
      expect(alice?.score).toBe(5);
      expect(alice?.maxScore).toBe(5);
      expect(alice?.percentage).toBe(100);
      expect(alice?.passed).toBe(true);
      expect(alice?.rank).toBe(1);
      expect(alice?.integrityFlag).toBe("clean");
      expect(alice?.questionBreakdown.length).toBe(2);
      expect(alice?.questionBreakdown[0]?.promptExcerpt).toContain("Paris or Berlin");
      expect(alice?.questionBreakdown[0]?.pointsEarned).toBe(2);

      // Bob (auto_submitted due to timeout)
      const bob = data.results.find((r) => r.candidateName === "Bob Smith");
      expect(bob).toBeDefined();
      expect(bob?.candidateEmail).toBe("bob@example.com");
      expect(bob?.status).toBe("auto_submitted");
      expect(bob?.score).toBe(2);
      expect(bob?.passed).toBe(false);
      expect(bob?.rank).toBe(3);
      expect(bob?.integrityFlag).toBe("review");

      // Charlie (in_progress)
      const charlie = data.results.find((r) => r.candidateName === "Charlie Brown");
      expect(charlie).toBeDefined();
      expect(charlie?.status).toBe("in_progress");
      expect(charlie?.submittedAt).toBeNull();
      expect(charlie?.durationSeconds).toBeNull();
      expect(charlie?.score).toBeNull();
      expect(charlie?.percentage).toBeNull();
      expect(charlie?.passed).toBeNull();
      expect(charlie?.rank).toBeNull();
      expect(charlie?.questionBreakdown).toEqual([]);

      // Dave (locked)
      const dave = data.results.find((r) => r.candidateName === "Dave Miller");
      expect(dave).toBeDefined();
      expect(dave?.status).toBe("locked");
      expect(dave?.submittedAt).toBeNull();

      // Anonymous candidate (scoring_blocked)
      const anon = data.results.find((r) => r.externalId === "STU-005");
      expect(anon).toBeDefined();
      expect(anon?.candidateName).toBe("STU-005");
      expect(anon?.integrityFlag).toBe("scoring_blocked");
    });

    it("filters results by status=submitted", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?status=submitted`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ status: string }> };
      expect(data.results.length).toBe(3);
      for (const r of data.results) {
        expect(["submitted", "auto_submitted"]).toContain(r.status);
      }
    });

    it("filters results by status=in_progress", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?status=in_progress`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ status: string }> };
      expect(data.results.length).toBe(1);
      expect(data.results[0]?.status).toBe("in_progress");
    });

    it("filters results by status=locked", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?status=locked`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ status: string }> };
      expect(data.results.length).toBe(1);
      expect(data.results[0]?.status).toBe("locked");
    });

    it("filters results by integrity=clean", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?integrity=clean`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ integrityFlag: string }> };
      for (const r of data.results) {
        expect(r.integrityFlag).toBe("clean");
      }
    });

    it("filters results by integrity=review", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?integrity=review`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ integrityFlag: string }> };
      expect(data.results.length).toBe(1);
      expect(data.results[0]?.integrityFlag).toBe("review");
    });

    it("filters results by integrity=scoring_blocked", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?integrity=scoring_blocked`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ integrityFlag: string }> };
      expect(data.results.length).toBe(1);
      expect(data.results[0]?.integrityFlag).toBe("scoring_blocked");
    });

    it("filters results by search term (candidate name)", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?search=alice`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ candidateName: string }> };
      expect(data.results.length).toBe(1);
      expect(data.results[0]?.candidateName).toBe("Alice Doe");
    });

    it("filters results by search term (candidate email)", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?search=bob@example.com`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ candidateName: string }> };
      expect(data.results.length).toBe(1);
      expect(data.results[0]?.candidateName).toBe("Bob Smith");
    });

    it("filters results by search term (external ID)", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results?search=STU-004`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { results: Array<{ candidateName: string }> };
      expect(data.results.length).toBe(1);
      expect(data.results[0]?.candidateName).toBe("Dave Miller");
    });

    it("handles test with zero attempts gracefully", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${zeroAttemptTestId}/results`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        summary: {
          totalRegistered: number;
          submittedCount: number;
          inProgressCount: number;
          lockedCount: number;
          averageScore: number | null;
          passRate: number | null;
        };
        results: unknown[];
      };

      expect(data.summary.totalRegistered).toBe(0);
      expect(data.summary.submittedCount).toBe(0);
      expect(data.summary.inProgressCount).toBe(0);
      expect(data.summary.lockedCount).toBe(0);
      expect(data.summary.averageScore).toBeNull();
      expect(data.summary.passRate).toBeNull();
      expect(data.results).toEqual([]);
    });

    it("returns 404 for non-existent test", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/tst_nonexistent/results`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when querying another workspace's test (tenant isolation)", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${otherWorkspaceId}/tests/${test1Id}/results`, {
        headers: { cookie: viewerCookie },
      });

      expect(res.status).toBe(404);
    });

    it("forbids author role lacking results.export", async () => {
      const app = createApp(deps);
      const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${test1Id}/results`, {
        headers: { cookie: authorCookie },
      });

      expect(res.status).toBe(403);
    });
  });
});
