// The 50-subrequest ceiling ADR 0002 names is a production limit that no
// local test reaches by accident: a route issuing one query per question
// passes at ten questions and fails at sixty. These tests turn the ceiling
// into a build failure, and the table test is what carries the guard into
// later phases — a route mounted without a budget line fails the suite.

import { afterAll, expect, it } from "vitest";
import { closeClient } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../src/app.js";
import {
  countingDeps,
  mountedRoutes,
  SUBREQUEST_LIMIT,
} from "../src/instrument.js";
import { testDeps } from "./deps.js";

const { deps } = await testDeps();

afterAll(() => closeClient(deps.db));

/**
 * A fresh counter over the already-migrated database, so what is measured is
 * the cost of one request and not of the schema behind it.
 */
async function expectBudget(route: string, max: number): Promise<void> {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(route);

  // A route that 404s or 500s spends nothing, which would pass any budget.
  expect(res.status, `${route} did not answer`).toBeLessThan(400);
  expect(counting.counts().total, route).toBeLessThanOrEqual(max);
}

it("the health route stays within its budget", async () => {
  await expectBudget("/api/v1/health", 1);
});

it("the budget table lists every mounted route, so a new route cannot skip the check", () => {
  expect(new Set(Object.keys(ROUTE_BUDGETS))).toEqual(
    new Set(mountedRoutes(createApp(deps))),
  );
});

it("no route's declared budget reaches the platform ceiling", () => {
  for (const [route, max] of Object.entries(ROUTE_BUDGETS))
    expect(max, route).toBeLessThan(SUBREQUEST_LIMIT);
});
