// Test analytics (Phase 8c Task 1, `R-06`, #94). One route, one read —
// `testAnalytics` (`packages/db/src/repo/analytics.ts`) is the whole of
// what this handler does; the existence check is the one thing it adds.

import { Hono } from "hono";
import { getTest, testAnalytics, testItemAnalysis } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";

export function analyticsRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  // `results.export`, not `tests.edit` — the same action the results and
  // per-answer CSVs (Task 3) are guarded by, and the first production
  // caller that action has had (8d-2 shipped the scope; nothing mounted it
  // until this phase). A Viewer, who holds `results.export` and nothing
  // wider, can read this screen; an Author, who holds `tests.edit` and not
  // this, cannot — the matrix's own split between "builds the test" and
  // "may see how it did".
  //
  // One screen, two fetches: `testAnalytics` (R-06) and `testItemAnalysis`
  // (R-07, Task 2's pure function over Task 1's fetch shape) each call
  // `listAttemptsForTest` once on their own — not shared across the two,
  // which would mean one of the two repository functions taking
  // pre-fetched rows instead of `(testId)`, a signature neither interface
  // asks for. Still nowhere near `SUBREQUEST_LIMIT` (see `ROUTE_BUDGETS`'s
  // own measured number for this route).
  routes.get("/:id/tests/:testId/analytics", requires("results.export"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");

    const test = await getTest(deps.db, workspaceId, testId);
    if (!test) throw new ApiError(404, "not_found", "No such resource.");

    const [analytics, items] = await Promise.all([
      testAnalytics(deps.db, workspaceId, testId),
      testItemAnalysis(deps.db, workspaceId, testId),
    ]);
    return c.json({ analytics, items });
  });

  return routes;
}
