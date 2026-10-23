// Test analytics (Phase 8c Task 1, `R-06`, #94). `testAnalytics` and
// `testItemAnalysis` (`packages/db/src/repo/analytics.ts`) are the whole of
// the figures; this file adds the existence check and, since Fix round 1
// (Important 2), the question stem each item row needs to be more than a
// bare id.

import { Hono } from "hono";
import { getTest, testAnalytics, testItemAnalysis, workspaceQuestions } from "@pariksha/db";
import type { ItemStat } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";

/** `ItemStat` (`@pariksha/core`) is a pure-function type and stays as it
 *  is — it carries no stem because `itemAnalysis` never reads a question
 *  document. The *route's own* response shape is this file's to widen, the
 *  same way `GradingQueueRow` (`apps/api/src/grade/award.ts`) widens
 *  `PendingAward` with the question itself rather than changing the
 *  pure-function type underneath it. */
export interface ItemStatWithStem extends ItemStat {
  stem: string;
}

/** A question removed from its bank after being used in a test — `K19`'s
 *  own precedent (`paperOrder`, `apps/api/src/run/submit.ts`) is to say so
 *  rather than drop the row or show a blank. */
const STEM_UNAVAILABLE = "(question removed from the bank)";

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
  // One screen, two fetches plus one join: `testAnalytics` (R-06) and
  // `testItemAnalysis` (R-07, Task 2's pure function over Task 1's fetch
  // shape) each page `listAttemptsForTest` to exhaustion on their own —
  // not shared across the two, which would mean one of the two repository
  // functions taking pre-fetched rows instead of `(testId)`, a signature
  // neither interface asks for. `workspaceQuestions` (Fix round 1,
  // Important 2) is the same workspace-wide, one-statement question read
  // `listPendingAwards`/`liveQuestions` already use elsewhere in this
  // codebase for "a question's content by id" — never a query per row.
  // Still nowhere near `SUBREQUEST_LIMIT` (see `ROUTE_BUDGETS`'s own
  // measured number for this route).
  routes.get("/:id/tests/:testId/analytics", requires("results.export"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");

    const test = await getTest(deps.db, workspaceId, testId);
    if (!test) throw new ApiError(404, "not_found", "No such resource.");

    const [analytics, { items, truncated: itemsTruncated }, questions] = await Promise.all([
      testAnalytics(deps.db, workspaceId, testId),
      testItemAnalysis(deps.db, workspaceId, testId),
      workspaceQuestions(deps.db, workspaceId),
    ]);

    const stemById = new Map(questions.map((q) => [q.id, q.document.prompt]));
    const itemsWithStems: ItemStatWithStem[] = items.map((item) => ({
      ...item,
      stem: stemById.get(item.questionId) ?? STEM_UNAVAILABLE,
    }));

    return c.json({ analytics, items: itemsWithStems, itemsTruncated });
  });

  return routes;
}
