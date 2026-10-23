// Test analytics (Phase 8c Task 1, `R-06`, #94). `testAnalytics` itself is
// unit-tested in `packages/db/test/repo/analytics.test.ts`; this file is
// the route's own concerns — authority, the 404 for a test that does not
// exist, and the measured subrequest cost — the same split every other
// route test in this directory keeps.

import { expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createApiKey,
  createBank,
  createUser,
  upsertQuestion,
  type TestDocumentBody,
} from "@pariksha/db";
import type { Question } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS, type AppDeps } from "../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";
import { seedTest, seedWorkspace } from "./run/fixtures.js";

const body: TestDocumentBody = {
  settings: { timing: { duration_minutes: 45 } },
  sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: ["qst_1"] } }],
};

async function cookieFor(deps: AppDeps, workspaceId: string, role: "viewer" | "author" | "owner"): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const userId = await createUser(deps.db, {
    email: `${role}-${suffix}@analytics.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

it("answers an organiser's figures for a published test", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testId = await seedTest(deps, workspaceId, { name: "Aptitude", slug: "aptitude", body });
  const cookie = await cookieFor(deps, workspaceId, "viewer");

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`, {
    headers: { cookie },
  });

  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    analytics: { counts: { registered: number }; distribution: number[] };
    items: unknown[];
  };
  expect(json.analytics.distribution).toHaveLength(10);
  expect(json.analytics.counts.registered).toBe(0);
  // No attempts on this test — R-07's item table is empty, not missing.
  expect(json.items).toEqual([]);
  await closeClient(deps.db);
});

it("404s a test id that does not exist in this workspace", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const cookie = await cookieFor(deps, workspaceId, "viewer");

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/tst_nope/analytics`, {
    headers: { cookie },
  });

  expect(res.status).toBe(404);
  await closeClient(deps.db);
});

it("refuses a Viewer no 403, admits one 200 — the matrix's own split", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testId = await seedTest(deps, workspaceId, { name: "Aptitude", slug: "aptitude-2", body });
  const viewerCookie = await cookieFor(deps, workspaceId, "viewer");

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`, {
    headers: { cookie: viewerCookie },
  });
  expect(res.status).toBe(200);
  await closeClient(deps.db);
});

it("refuses an Author, who holds tests.edit and not results.export", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testId = await seedTest(deps, workspaceId, { name: "Aptitude", slug: "aptitude-3", body });
  const authorCookie = await cookieFor(deps, workspaceId, "author");

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`, {
    headers: { cookie: authorCookie },
  });
  expect(res.status).toBe(403);
  await closeClient(deps.db);
});

it("admits a scoped API key that holds results.export", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testId = await seedTest(deps, workspaceId, { name: "Aptitude", slug: "aptitude-4", body });
  const { secret } = await createApiKey(deps.db, workspaceId, {
    name: "ATS",
    scopes: ["results.export"],
    now: FIXED_NOW,
  });

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(res.status).toBe(200);
  await closeClient(deps.db);
});

it("refuses a scoped API key that does not hold results.export", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testId = await seedTest(deps, workspaceId, { name: "Aptitude", slug: "aptitude-5", body });
  const { secret } = await createApiKey(deps.db, workspaceId, {
    name: "tests-only",
    scopes: ["tests.edit"],
    now: FIXED_NOW,
  });

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(res.status).toBe(403);
  await closeClient(deps.db);
});

it("measures the real subrequest cost of the analytics route against a 300-candidate fixture", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testId = await seedTest(deps, workspaceId, { name: "Big cohort", slug: "big-cohort", body });
  // 300 candidates, none attempted — `testAnalytics`'s own
  // `packages/db` suite already proves the figures stay correct and the
  // statement count stays flat at this size; this route-level measurement
  // is only for the number written into `ROUTE_BUDGETS`.
  for (let i = 0; i < 300; i += 1) {
    await deps.db.run(
      "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
        "VALUES (?, ?, ?, NULL, NULL, 'registration', '{}', NULL, ?, ?)",
      [`cnd_big_${i}`, workspaceId, testId, FIXED_NOW, FIXED_NOW],
    );
  }
  const cookie = await cookieFor(deps, workspaceId, "viewer");
  const counting = countingDeps(deps);

  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`,
    { headers: { cookie } },
  );

  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(
    ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/analytics"],
  );
  await closeClient(deps.db);
});

// --- Fix round 1, Important 2: the item table's own stem join -------------

/** Writes one scored attempt with one response, directly — the same
 *  "drop to raw SQL for fixture setup" convention `results.test.ts`'s own
 *  `seedAttempt` keeps, since no production path creates a scored attempt
 *  out of thin air. */
async function seedScoredAttempt(
  deps: AppDeps,
  workspaceId: string,
  testVersionId: string,
  candidateId: string,
  questionId: string,
): Promise<void> {
  const attemptId = "att_" + Math.random().toString(36).slice(2, 10);
  await deps.db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed, locked_at) VALUES (?, ?, ?, ?, 1, '{}', ?, ?, ?, 'manual', ?, 'clean', ?, 0, NULL, 'clean', 1, NULL)",
    [
      attemptId,
      workspaceId,
      candidateId,
      testVersionId,
      FIXED_NOW,
      FIXED_NOW + 60_000,
      FIXED_NOW,
      JSON.stringify({
        percent: 100,
        total: 1,
        max: 1,
        passed: null,
        pending: [],
        perQuestion: { [questionId]: { points: 1, max: 1, correct: true } },
        sections: [],
      }),
      `hash-${attemptId}`,
    ],
  );
  await deps.db.run(
    "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL)",
    [`rsp_${attemptId}`, workspaceId, attemptId, questionId, JSON.stringify({ kind: "option", option: "a" }), FIXED_NOW],
  );
}

async function testVersionIdOf(deps: AppDeps, workspaceId: string, testId: string): Promise<string> {
  const rows = await deps.db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE workspace_id = ? AND test_id = ? AND published_at IS NOT NULL",
    [workspaceId, testId],
  );
  return rows[0]!.id;
}

it("joins the question's own stem into each item row — Important 2", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const bankId = await createBank(deps.db, workspaceId, { name: "Stems", now: FIXED_NOW });
  const question: Question = {
    id: "q1",
    type: "single",
    prompt: "A train 180 m long crosses a platform in 24 s. Find the platform length.",
    options: [
      { id: "a", text: "60 m" },
      { id: "b", text: "120 m" },
    ],
    key: "a",
    scoring: { points: 1 },
  };
  const { id: questionId } = await upsertQuestion(deps.db, workspaceId, bankId, question, FIXED_NOW);
  const testBody: TestDocumentBody = {
    settings: { timing: { duration_minutes: 45 } },
    sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: [questionId] } }],
  };
  const testId = await seedTest(deps, workspaceId, { name: "Stems test", slug: "stems-test", body: testBody });
  const testVersionId = await testVersionIdOf(deps, workspaceId, testId);
  await seedScoredAttempt(deps, workspaceId, testVersionId, "cnd_1", questionId);
  const cookie = await cookieFor(deps, workspaceId, "viewer");

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { items: { questionId: string; stem: string }[] };
  expect(json.items).toHaveLength(1);
  expect(json.items[0]!.stem).toBe(question.prompt);
  await closeClient(deps.db);
});

it("states a removed question rather than an empty stem", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testBody: TestDocumentBody = {
    settings: { timing: { duration_minutes: 45 } },
    // Names a question that was never created in any bank — the shape of
    // a question deleted after the test last referenced it.
    sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: ["qst_gone"] } }],
  };
  const testId = await seedTest(deps, workspaceId, { name: "Gone", slug: "gone-question", body: testBody });
  const testVersionId = await testVersionIdOf(deps, workspaceId, testId);
  await seedScoredAttempt(deps, workspaceId, testVersionId, "cnd_1", "qst_gone");
  const cookie = await cookieFor(deps, workspaceId, "viewer");

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { items: { stem: string }[] };
  expect(json.items[0]!.stem).toBe("(question removed from the bank)");
  await closeClient(deps.db);
});

// --- Fix round 2: the hard page cap, not just the common one-page case ----

it("stays under the subrequest ceiling at the hard page cap, the real worst case — not just the common one-page case", async () => {
  // Fix round 1's budget (8) was measured against the common case: a
  // 300-candidate, one-page cohort. The re-review confirmed the worst-case
  // arithmetic by hand (both `testAnalytics` and `testItemAnalysis` paging
  // independently to `MAX_ATTEMPT_PAGES`) but asked for an executed test —
  // a hardcoded `limit: 500` shipped once already and nothing executed
  // against its bound is exactly how it survived. This one drives the real
  // route, with no test-only override, past the real cap.
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const testId = await seedTest(deps, workspaceId, { name: "Huge cohort", slug: "huge-cohort", body });
  const testVersionId = await testVersionIdOf(deps, workspaceId, testId);
  const candidateId = "cnd_huge";
  await deps.db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
      "VALUES (?, ?, ?, NULL, NULL, 'registration', '{}', NULL, ?, ?)",
    [candidateId, workspaceId, testId, FIXED_NOW, FIXED_NOW],
  );

  // One past `MAX_ATTEMPT_PAGES` (10) * the 500-row page size — the
  // smallest cohort that forces both `testAnalytics` and `testItemAnalysis`
  // to exhaust the cap rather than the cursor, so `truncated` reads `true`
  // on both halves of the response below. `db.batch`, chunked, rather than
  // 5,001 individually-awaited inserts: one subrequest per chunk against
  // this in-memory client, and the whole fixture seeds in well under a
  // second rather than minutes.
  const ATTEMPTS = 5001;
  const CHUNK = 500;
  for (let start = 0; start < ATTEMPTS; start += CHUNK) {
    const end = Math.min(start + CHUNK, ATTEMPTS);
    await deps.db.batch(
      Array.from({ length: end - start }, (_, j) => {
        const i = start + j;
        return {
          sql:
            "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, " +
            "started_at, deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, " +
            "section_started_at, integrity_flag, observed, locked_at) " +
            "VALUES (?, ?, ?, ?, 1, '{}', ?, ?, NULL, NULL, NULL, 'clean', ?, 0, NULL, 'clean', 1, NULL)",
          params: [
            `att_huge_${i}`,
            workspaceId,
            candidateId,
            testVersionId,
            FIXED_NOW + i,
            FIXED_NOW + i + 60_000,
            `hash_huge_${i}`,
          ],
        };
      }),
    );
  }

  const cookie = await cookieFor(deps, workspaceId, "viewer");
  const counting = countingDeps(deps);

  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/analytics`,
    { headers: { cookie } },
  );

  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    analytics: { truncated: boolean };
    itemsTruncated: boolean;
  };
  // Proves this test actually reached the cap, not the one-page case under
  // a new name — if either read false, the cost measured below would be
  // the wrong case's number.
  expect(json.analytics.truncated).toBe(true);
  expect(json.itemsTruncated).toBe(true);
  // Measured at 26 (auth 2 + getTest 1 + workspaceQuestions 1 +
  // testAnalytics's 11 [10 pages + the registered-candidate COUNT] +
  // testItemAnalysis's 11 [10 pages + the response join]) against a
  // ceiling of 50 — comfortably under even at the real worst case, not
  // merely by the hand arithmetic in `analytics.ts`'s own comment.
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
  await closeClient(deps.db);
}, 60_000);
