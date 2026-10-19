// Tests: CRUD, slugs, short links and the identity half of the builder.
//
// Mounted under `/api/v1/workspaces`, like every other workspace-scoped
// route — `requires()` reads the workspace out of the path's own `:id`
// segment. There is no `tests.view` (`packages/core/src/permissions.ts`), so
// every route here, reads included, is guarded by `tests.edit` — the same
// precedent `apps/api/src/app.ts`'s `ROUTE_ACTIONS` comment states for banks.

import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  appendAudit,
  createTest,
  draftVersionsByTest,
  getTest,
  listTests,
  updateTest,
  type TestFilter,
  type TestPatch,
  type TestRow,
  type TestStatus,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";

// The same shape `apps/api/src/routes/workspaces.ts` validates its own slug
// with — lowercase, digits and hyphens, starting alphanumeric.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SLUG_MESSAGE = "is not a usable slug";

const newTest = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(SLUG_RE, SLUG_MESSAGE),
});

const testPatch = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().regex(SLUG_RE, SLUG_MESSAGE).optional(),
    description: z.string().max(4000).optional(),
    tags: z.array(z.string().min(1)).optional(),
    reviewRequested: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "names nothing to change");

const STATUSES: readonly TestStatus[] = ["draft", "published", "closed", "archived"];
const SORTS = ["name", "updated", "created"] as const;

// Built key-by-key, present only when the query string actually named it —
// `exactOptionalPropertyTypes` holds "absent" and an explicit `undefined`
// apart, the same reason `apps/api/src/routes/questions.ts`'s
// `filterFromQuery` is shaped this way.
function filterFromQuery(c: Context<AppBindings>): TestFilter {
  const tag = c.req.query("tag");
  const status = c.req.query("status");
  const search = c.req.query("search");
  const sort = c.req.query("sort");

  const filter: TestFilter = {};
  if (tag) filter.tag = tag;
  if (status && (STATUSES as readonly string[]).includes(status)) {
    filter.status = status as TestStatus;
  }
  if (search) filter.search = search;
  if (sort && (SORTS as readonly string[]).includes(sort)) {
    filter.sort = sort as (typeof SORTS)[number];
  }
  return filter;
}

/**
 * `TestSummary` (`apps/web/src/lib/api.ts`), the wire shape every route
 * below answers with. `state` is `status` verbatim in this task — Scheduled
 * and Open do not exist until Task 11 adds `deriveState()`, once `timing`
 * gives it something to read — and the field is named `state` here already
 * so no later task renames what the screens read.
 */
function toWire(row: TestRow, draftVersion: number | null): unknown {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    shortCode: row.shortCode,
    state: row.status,
    currentVersion: row.currentVersion,
    draftVersion,
    reviewRequested: row.reviewRequested,
    tags: row.tags,
    updatedAt: row.updatedAt,
  };
}

/** True when `err` is `updateTest`'s own refusal (T-01) rather than the
 * database's unique-constraint error on a colliding slug. */
function isSlugLockError(err: unknown): boolean {
  return err instanceof Error && /published/i.test(err.message);
}

export function testRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/tests", requires("tests.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const rows = await listTests(deps.db, workspaceId, filterFromQuery(c));
    const drafts = await draftVersionsByTest(deps.db, workspaceId);
    return c.json({ tests: rows.map((row) => toWire(row, drafts.get(row.id) ?? null)) });
  });

  routes.post("/:id/tests", requires("tests.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const input = parse(newTest, await json(c.req.raw));
    const now = deps.now();

    let row: TestRow;
    try {
      row = await createTest(deps.db, workspaceId, { name: input.name, slug: input.slug, now });
    } catch {
      // `(workspace_id, slug)` is unique, and the only way this write fails
      // in practice (AC-02).
      throw new ApiError(409, "slug_taken", "A test with that address already exists in this workspace.");
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "test.create",
      target: row.id,
      detail: { name: row.name, slug: row.slug },
      now,
    });

    // `createTest` always mints the row and its draft version 1 together, so
    // there is nothing to re-read: this row's draft is always version 1.
    return c.json(toWire(row, 1), 201);
  });

  routes.get("/:id/tests/:testId", requires("tests.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    const row = await getTest(deps.db, workspaceId, testId);
    if (!row) throw new ApiError(404, "not_found", "No such resource.");

    const drafts = await draftVersionsByTest(deps.db, workspaceId, testId);
    return c.json(toWire(row, drafts.get(testId) ?? null));
  });

  routes.patch("/:id/tests/:testId", requires("tests.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    const patch = parse(testPatch, await json(c.req.raw));
    const now = deps.now();

    const asPatch: TestPatch = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.slug !== undefined && { slug: patch.slug }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
      ...(patch.reviewRequested !== undefined && { reviewRequested: patch.reviewRequested }),
    };

    let updated: TestRow | null;
    try {
      updated = await updateTest(deps.db, workspaceId, testId, asPatch, now);
    } catch (err) {
      if (isSlugLockError(err)) {
        throw new ApiError(
          409,
          "slug_locked",
          "This test's address is locked because it has been published.",
        );
      }
      throw new ApiError(409, "slug_taken", "A test with that address already exists in this workspace.");
    }
    if (!updated) throw new ApiError(404, "not_found", "No such resource.");

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "test.update",
      target: testId,
      detail: { fields: Object.keys(patch).sort() },
      now,
    });

    const drafts = await draftVersionsByTest(deps.db, workspaceId, testId);
    return c.json(toWire(updated, drafts.get(testId) ?? null));
  });

  return routes;
}

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new ApiError(400, "invalid_request", "The request body is not valid.", {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

async function json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
