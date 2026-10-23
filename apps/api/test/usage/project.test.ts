// Phase 8e Task 3 (`K31`, `K36`, `KG8`, #102): the free-tier meter.
//
// `projectUsage` is tested pure, over fixtures this file builds — it reads
// no clock and touches no database. `KG8` is tested over the real route,
// with its positive control in the same file (Step 2's own rule: a
// missing-field assertion passes for free when the field was never named
// right, so "it's there on `workers`" has to be proved beside "it's gone on
// `node`", not trusted on its own).

import { expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { PROCTORING_DEFAULTS } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS, type AppDeps } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedWorkspace } from "../run/fixtures.js";
import {
  FREE_PLAN_REQUESTS_PER_DAY,
  projectUsage,
  type TestCostInput,
  type UsageCounts,
} from "../../src/usage/project.js";

// --- `projectUsage`: pure, no database -----------------------------------

const ZERO: UsageCounts = { attempts: 0, snapshots: 0, events: 0 };

/** 400 + 11,500 + 500 — three real-looking row counts that sum to a figure
 *  with nothing coincidental about it, so a regression that drops one
 *  field (summing only two of three) produces a visibly wrong total rather
 *  than one that could pass by accident. */
const counts: UsageCounts = { attempts: 400, snapshots: 11_500, events: 500 };

/** A `counts` that spends exactly `fraction` of the daily ceiling, on
 *  `attempts` alone — the simplest fixture that puts the backward half of
 *  the sum at a precise point either side of `WARN_AT`. */
const at = (fraction: number): UsageCounts => ({
  attempts: Math.round(FREE_PLAN_REQUESTS_PER_DAY * fraction),
  snapshots: 0,
  events: 0,
});

/**
 * The scenario `snapshotCost`'s own comment already names
 * (`packages/core/src/proctoring.ts`): a Strict test, 180 minutes, a
 * 15-second snapshot cadence, 300 candidates — "216,000 Worker requests
 * across 300 candidates against a free-plan 100,000/day limit". The exact
 * test this feature exists for: an organiser about to run this sees the
 * projection before they run it.
 */
const strict300: TestCostInput = {
  durationMinutes: 180,
  resolved: { ...PROCTORING_DEFAULTS.strict, snapshotIntervalSeconds: 15 },
  webhookCount: 0,
  candidates: 300,
};

it("projects from attempts, snapshots and events", () => {
  expect(projectUsage({ target: "workers", counts, openTests: [] })!.spentToday).toBe(12_400);
});

it("warns at 70 per cent", () => {
  expect(projectUsage({ target: "workers", counts: at(0.71), openTests: [] })!.warn).toBe(true);
  expect(projectUsage({ target: "workers", counts: at(0.69), openTests: [] })!.warn).toBe(false);
});

it("projects forward for a configured test with no attempts yet", () => {
  const p = projectUsage({ target: "workers", counts: ZERO, openTests: [strict300] })!;
  expect(p.spentToday).toBe(0);
  expect(p.projected).toBeGreaterThan(0);
  expect(p.warn).toBe(true);
});

it("returns null on the node target", () => {
  expect(projectUsage({ target: "node", counts, openTests: [strict300] })).toBeNull();
});

it("always marks itself an estimate", () => {
  expect(projectUsage({ target: "workers", counts, openTests: [] })!.estimated).toBe(true);
});

// --- `KG8`: nothing reaches a `node` deployment, over the real route -----

/** A fresh owner, a member of `workspaceId` from the moment this returns —
 *  `requireMember()` is the whole guard on this route, so this is the one
 *  fixture every route test below needs. */
async function ownerCookie(deps: AppDeps, workspaceId: string): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const userId = await createUser(deps.db, {
    email: `owner-${suffix}@usage.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId, role: "owner", now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

it("omits the usage field entirely under node", async () => {
  const { deps } = await testDeps({ target: "node" });
  const workspaceId = await seedWorkspace(deps);
  const cookie = await ownerCookie(deps, workspaceId);

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/usage`, {
    headers: { cookie },
  });

  expect(res.status).toBe(200);
  expect(await res.json()).not.toHaveProperty("usage");
  await closeClient(deps.db);
});

it("includes it under workers — control for the test above", async () => {
  const { deps } = await testDeps({ target: "workers" });
  const workspaceId = await seedWorkspace(deps);
  const cookie = await ownerCookie(deps, workspaceId);

  const res = await createApp(deps).request(`/api/v1/workspaces/${workspaceId}/usage`, {
    headers: { cookie },
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { usage?: unknown };
  expect(body.usage).toBeDefined();
  expect(body.usage).toMatchObject({ estimated: true, limit: FREE_PLAN_REQUESTS_PER_DAY });
  await closeClient(deps.db);
});

it("measures the real subrequest cost of the usage route", async () => {
  const { deps } = await testDeps();
  const workspaceId = await seedWorkspace(deps);
  const cookie = await ownerCookie(deps, workspaceId);
  const counting = countingDeps(deps);

  const res = await createApp(counting.deps).request(`/api/v1/workspaces/${workspaceId}/usage`, {
    headers: { cookie },
  });

  expect(res.status).toBe(200);
  // Flat regardless of how many tests or candidates the workspace holds —
  // an empty workspace already pays every one of the three bulk reads,
  // because each is issued once per request, not once per row it might
  // return.
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/usage"]);
  await closeClient(deps.db);
});
