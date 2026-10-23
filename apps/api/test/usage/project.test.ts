// Phase 8e Task 3 (`K31`, `K36`, `KG8`, #102): the free-tier meter.
//
// `projectUsage` is tested pure, over fixtures this file builds — it reads
// no clock and touches no database. `KG8` is tested over the real route,
// with its positive control in the same file (Step 2's own rule: a
// missing-field assertion passes for free when the field was never named
// right, so "it's there on `workers`" has to be proved beside "it's gone on
// `node`", not trusted on its own).
//
// Branch review fix wave: `C2` (CRITICAL) deleted `spentToday`/
// `countsToday`/`UsageCounts` outright (see `usage/project.ts`'s own
// header) — every test here that exercised that half is gone with it, not
// adapted to a shape that no longer exists. `M1` (MAJOR) added
// `BASELINE_REQUESTS_PER_CANDIDATE`, asserted below by name. `m2` (MINOR):
// the exact numbers are asserted with `toBe`, never `toBeGreaterThan` —
// a regression that returns `candidates` instead of `totalRequests`, or
// drops the baseline term, passed the old assertion and fails this one.

import { expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { PROCTORING_DEFAULTS } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS, type AppDeps } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedWorkspace } from "../run/fixtures.js";
import {
  BASELINE_REQUESTS_PER_CANDIDATE,
  FREE_PLAN_REQUESTS_PER_DAY,
  projectUsage,
  type TestCostInput,
} from "../../src/usage/project.js";

// --- `projectUsage`: pure, no database -----------------------------------

/**
 * The scenario `snapshotCost`'s own comment already names
 * (`packages/core/src/proctoring.ts`): a Strict test, 180 minutes, a
 * 15-second snapshot cadence, 300 candidates — "216,000 Worker requests
 * across 300 candidates against a free-plan 100,000/day limit" is the
 * snapshot half alone; `strict` also defaults `identityPhoto: true`, so
 * `estimateCost`'s own total is 300 × (720 snapshots + 1 identity photo) =
 * 216,300, and `BASELINE_REQUESTS_PER_CANDIDATE` (`M1`) adds
 * 300 × 50 = 15,000 on top — **231,300** exactly, asserted below.
 */
const strict300: TestCostInput = {
  durationMinutes: 180,
  resolved: { ...PROCTORING_DEFAULTS.strict, snapshotIntervalSeconds: 15 },
  webhookCount: 0,
  candidates: 300,
};

/** `off` — the product's own default proctoring profile (`M1`'s subject):
 *  no camera, no identity photo, no webhooks, so `estimateCost` returns
 *  `null` and every request `projectUsage` reports for this test comes
 *  from the baseline alone. `durationMinutes: 0`, not `null` — a `null`
 *  duration makes `estimateCost` return `null` for an unrelated reason
 *  (#179's "no duration set yet"), which this fixture is not testing. */
const unproctored = (candidates: number): TestCostInput => ({
  durationMinutes: 0,
  resolved: PROCTORING_DEFAULTS.off,
  webhookCount: 0,
  candidates,
});

it("projects the exact figure for a configured test (M1: estimateCost plus the per-candidate baseline)", () => {
  const p = projectUsage({ target: "workers", openTests: [strict300] })!;
  expect(p.projected).toBe(231_300);
});

it("never projects zero for the product's default (unproctored) test shape — M1", () => {
  const p = projectUsage({ target: "workers", openTests: [unproctored(300)] })!;
  expect(p.projected).toBe(300 * BASELINE_REQUESTS_PER_CANDIDATE);
  expect(p.projected).toBeGreaterThan(0);
});

it("warns at 70 per cent", () => {
  // 1,420 × 50 = 71,000 (71%); 1,380 × 50 = 69,000 (69%) — the baseline
  // alone, isolating the boundary from estimateCost's own arithmetic.
  expect(projectUsage({ target: "workers", openTests: [unproctored(1_420)] })!.warn).toBe(true);
  expect(projectUsage({ target: "workers", openTests: [unproctored(1_380)] })!.warn).toBe(false);
});

it("projects zero, and does not warn, for a workspace with no open tests", () => {
  const p = projectUsage({ target: "workers", openTests: [] })!;
  expect(p.projected).toBe(0);
  expect(p.warn).toBe(false);
});

it("returns null on the node target", () => {
  expect(projectUsage({ target: "node", openTests: [strict300] })).toBeNull();
});

it("always marks itself an estimate", () => {
  expect(projectUsage({ target: "workers", openTests: [] })!.estimated).toBe(true);
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
  // An empty workspace (no open tests) projects exactly zero — this is
  // the control's own exact assertion, not merely "present".
  expect(body.usage).toEqual({
    projected: 0,
    limit: FREE_PLAN_REQUESTS_PER_DAY,
    warn: false,
    estimated: true,
  });
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
