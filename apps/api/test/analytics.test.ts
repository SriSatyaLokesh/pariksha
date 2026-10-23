// Test analytics (Phase 8c Task 1, `R-06`, #94). `testAnalytics` itself is
// unit-tested in `packages/db/test/repo/analytics.test.ts`; this file is
// the route's own concerns — authority, the 404 for a test that does not
// exist, and the measured subrequest cost — the same split every other
// route test in this directory keeps.

import { afterAll, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createApiKey,
  createUser,
  type TestDocumentBody,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS, type AppDeps } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
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
