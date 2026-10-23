// `D7c`'s readiness aggregate (Phase 8c Task 5) — the number `tests.tsx`'s
// own docblock said would cost "one `GET …/checklist` per row" and that
// comment is why this exists: a test is never a row with no document
// (`T-02`), so every row in `GET .../tests` has exactly one open draft, and
// this answers all of them from four statements regardless of how many
// tests the workspace holds (`K21`).
//
// `buildChecklist` itself stays untouched and still runs once per test —
// that part is free (twelve tests is not 300 rows); the part `K21` forbids
// is a database read per test, and this file is what keeps there from
// being one.

import { Hono } from "hono";
import {
  candidateCountsByWorkspace,
  draftVersionsByWorkspace,
  listTests,
  workspaceQuestions,
} from "@pariksha/db";
import { buildChecklist } from "./checklist.js";
import type { AppBindings, AppDeps } from "../app.js";
import { requires } from "../middleware/authorize.js";

export interface ReadinessSummary {
  ready: number;
  total: number;
}

/**
 * Four statements, flat in test, section, question and candidate count
 * alike — the workspace's test rows, every open draft in one set read, the
 * workspace's shared questions (one read, not one per test — the same
 * reuse `checklistFor`'s single-test version already makes), and a
 * `GROUP BY test_id` candidate count. `buildChecklist` then runs once per
 * test in memory.
 *
 * `ready`/`total` are `PublishChecklist.tsx`'s own arithmetic
 * (`.checklist-rail__readiness`'s "not blocking, N must fix"): `total` is
 * every row the gate raised and `ready` is how many of those do not stop a
 * publish — the same figure the builder's own rail renders, read off the
 * same rows.
 *
 * A test with no open draft (not reachable before Task 11's lifecycle, but
 * this does not assume that invariant holds forever) is simply absent from
 * the result rather than reported as 0/0, which would read as "nothing to
 * fix" instead of "unreadable".
 */
export async function readinessFor(
  deps: AppDeps,
  workspaceId: string,
): Promise<Record<string, ReadinessSummary>> {
  const tests = await listTests(deps.db, workspaceId);
  const drafts = await draftVersionsByWorkspace(deps.db, workspaceId);
  const rawQuestions = await workspaceQuestions(deps.db, workspaceId);
  const candidateCounts = await candidateCountsByWorkspace(deps.db, workspaceId);
  const questions = rawQuestions.map((q) => ({ ...q.document, id: q.id }));
  const now = deps.now();

  const result: Record<string, ReadinessSummary> = {};
  for (const test of tests) {
    const draft = drafts.get(test.id);
    if (!draft) continue;
    const rows = buildChecklist({
      test,
      body: draft.body,
      now,
      candidates: candidateCounts.get(test.id) ?? { total: 0, withoutSet: 0 },
      questions,
    });
    const blocking = rows.filter((row) => row.severity === "blocking").length;
    result[test.id] = { ready: rows.length - blocking, total: rows.length };
  }
  return result;
}

/**
 * `GET /:id/tests/readiness` — `tests.edit`, the same authority
 * `checklistFor`'s own route reads under: an Author who cannot publish is
 * exactly the person who needs to see what is still wrong.
 *
 * Mounted ahead of `testRoutes` in `app.ts` — load-bearing, not locality:
 * `/:id/tests/:testId` would otherwise answer this path first, with
 * `"readiness"` read as a test id (`run.ts`'s own documented trap).
 */
export function readinessRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/tests/readiness", requires("tests.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    return c.json(await readinessFor(deps, workspaceId));
  });

  return routes;
}
