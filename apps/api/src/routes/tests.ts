// Tests: CRUD, slugs, short links and the identity half of the builder.
//
// Mounted under `/api/v1/workspaces`, like every other workspace-scoped
// route — `requires()` reads the workspace out of the path's own `:id`
// segment. There is no `tests.view` (`packages/core/src/permissions.ts`), so
// every route here, reads included, is guarded by `tests.edit` — the same
// precedent `apps/api/src/app.ts`'s `ROUTE_ACTIONS` comment states for banks.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { matchesFilter, type Question, type QuestionSource } from "@pariksha/core";
import {
  appendAudit,
  createTest,
  draftVersionsByTest,
  existingRowIds,
  getDraftVersion,
  getTest,
  listTests,
  putDraftVersion,
  updateTest,
  workspaceQuestionSummaries,
  type QuestionSummary,
  type StoredSection,
  type TestDocumentBody,
  type TestFilter,
  type TestPatch,
  type TestRow,
  type TestStatus,
  type TestVersionRow,
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

// Task 3 (#55, P5.2): the draft itself. `settings`/`sections` are each
// checked only as "a plain object" / "an array of plain objects" here —
// Zod's job stops at JSON shape, the same line `questionDoc`
// (apps/api/src/routes/questions.ts) draws with `.passthrough()`. What a
// section's `source` may actually contain is `checkSection`'s job, below:
// hand-written rather than run through `schemas/test-1.json` a second time,
// because that schema's `minItems` on `sourceFixed.questions` and
// `sourceSets.sets` would reject the UX-13 empty section this route must
// accept in Draft — this checks the same "only these fields, for this kind"
// shape `additionalProperties: false` enforces, and nothing it does not.
const draftPatch = z
  .object({
    settings: z.record(z.string(), z.unknown()).optional(),
    sections: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .refine((patch) => patch.settings !== undefined || patch.sections !== undefined, "names nothing to change");

interface SectionIssue {
  field: string;
  message: string;
}

const SECTION_FIELDS = ["id", "title", "instructions", "time_limit_minutes", "shuffle_questions", "source"];
// Mirrors schemas/test-1.json's `$defs/sourceFixed`/`sourcePool`/`sourceSets`
// `properties` lists exactly, minus the `minItems`/`count` floors this
// save-time check deliberately does not enforce (UX-13; those are
// Task 11's publish checklist).
const SOURCE_FIELDS: Record<string, readonly string[]> = {
  fixed: ["kind", "questions"],
  pool: ["kind", "bank", "count", "filter"],
  sets: ["kind", "assignment", "sets"],
};

function unknownField(keys: readonly string[], allowed: readonly string[]): string | undefined {
  return keys.find((key) => !allowed.includes(key));
}

/**
 * Review Focus item 3's own words: "`$defs/sourcePool` and `$defs/sourceSets`
 * carry `additionalProperties: false`, so a merged `sets` key inside a
 * `pool` source fails the schema." This is that check, run at save time
 * against the row-id-named stored shape rather than the document the real
 * schema validates — a `pool` source that still carries a stale `sets` key
 * from whatever source it replaced is exactly what `unknownField` below
 * catches, one section's `source` object at a time.
 */
function checkSection(raw: unknown, index: number): SectionIssue[] {
  const path = (field: string): string => `sections[${index}].${field}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [{ field: path("source"), message: `entry at index ${index} is not a section object` }];
  }
  const section = raw as Record<string, unknown>;
  const issues: SectionIssue[] = [];

  const badField = unknownField(Object.keys(section), SECTION_FIELDS);
  if (badField !== undefined) {
    issues.push({ field: path(badField), message: `a section does not have a "${badField}" field` });
  }

  const source = section.source;
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    issues.push({ field: path("source"), message: "a section needs a source" });
    return issues;
  }
  const kind = (source as Record<string, unknown>).kind;
  if (kind !== "fixed" && kind !== "pool" && kind !== "sets") {
    issues.push({ field: path("source.kind"), message: 'source.kind must be "fixed", "pool" or "sets"' });
    return issues;
  }
  const allowed = SOURCE_FIELDS[kind]!;
  const badSourceField = unknownField(Object.keys(source), allowed);
  if (badSourceField !== undefined) {
    issues.push({
      field: path(`source.${badSourceField}`),
      message: `a ${kind} source does not have a "${badSourceField}" field`,
    });
  }
  return issues;
}

/** Every `qst_`/`bnk_` row id a section's source names, deduplicated — the
 * save-time cross-workspace guard's input, one list regardless of how many
 * sections or how many times a source repeats an id. */
function collectReferencedIds(sections: readonly StoredSection[]): {
  questionIds: string[];
  bankIds: string[];
} {
  const questionIds = new Set<string>();
  const bankIds = new Set<string>();
  for (const section of sections) {
    const source = section.source;
    if (source.kind === "fixed") {
      for (const id of source.questions) questionIds.add(id);
    } else if (source.kind === "pool") {
      if (source.bank !== undefined) bankIds.add(source.bank);
    } else {
      for (const set of source.sets) {
        for (const id of set.questions) questionIds.add(id);
      }
    }
  }
  return { questionIds: [...questionIds], bankIds: [...bankIds] };
}

/**
 * UX-15/UX-16: the numbers the builder cannot compute itself. `draw` is a
 * pool section's live "N drawn from M matching" — `matchesFilter`
 * (`@pariksha/core`) is the same arithmetic `layoutForAttempt` will later
 * draw with, run here over every workspace question once rather than
 * re-queried per section. `setPoints` is a `sets` section's own points
 * balance, summed from the same one list.
 */
/**
 * UX-12's collapsed row wants a points figure for every section, not only
 * `sets` ones — summed here, from the same one `summaries` list `draw` and
 * `setPoints` already read, at zero extra query cost. `fixed` is exact (it
 * names the questions outright); `sets` takes one set's total, since a
 * balanced `sets` section is worth the same either way the sets strip
 * already shows; `pool` is the one estimate — the actual draw is random per
 * attempt (`layoutForAttempt`, `@pariksha/core`), so this sums whichever
 * `count` matching questions sort first by id, a stand-in for "about how
 * much this section is worth" rather than a promise of exactly these
 * questions.
 */
function sectionPoints(
  source: QuestionSource,
  pointsById: ReadonlyMap<string, number>,
  pool: readonly QuestionSummary[],
): number {
  if (source.kind === "fixed") {
    return source.questions.reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0);
  }
  if (source.kind === "sets") {
    const first = source.sets[0];
    return first === undefined ? 0 : first.questions.reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0);
  }
  const matching = pool.filter((q) => matchesFilter(q as unknown as Question, source.filter));
  return matching
    .map((q) => q.id)
    .sort()
    .slice(0, source.count)
    .reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0);
}

function draftDerived(
  sections: readonly StoredSection[],
  summaries: readonly QuestionSummary[],
): {
  draw: Record<string, { matching: number; wanted: number }>;
  setPoints: Record<string, { set: string; points: number }[]>;
  points: Record<string, number>;
} {
  const pointsById = new Map(summaries.map((q) => [q.id, q.points]));
  const draw: Record<string, { matching: number; wanted: number }> = {};
  const setPoints: Record<string, { set: string; points: number }[]> = {};
  const points: Record<string, number> = {};

  for (const section of sections) {
    const source: QuestionSource = section.source;
    const pool = source.kind === "pool" && source.bank !== undefined ? summaries.filter((q) => q.bankId === source.bank) : summaries;
    if (source.kind === "pool") {
      const matching = pool.filter((q) => matchesFilter(q as unknown as Question, source.filter)).length;
      draw[section.id] = { matching, wanted: source.count };
    } else if (source.kind === "sets") {
      setPoints[section.id] = source.sets.map((set) => ({
        set: set.set,
        points: set.questions.reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0),
      }));
    }
    points[section.id] = sectionPoints(source, pointsById, pool);
  }
  return { draw, setPoints, points };
}

function toDraftWire(version: TestVersionRow, summaries: readonly QuestionSummary[]) {
  return { ...version, ...draftDerived(version.body.sections, summaries) };
}

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
 * Mirrors `TestSummary` (`apps/web/src/lib/api.ts`) — not imported, the same
 * boundary every other route in this app keeps from the web package.
 * `state` is `status` verbatim in this task — Scheduled and Open do not
 * exist until Task 11 adds `deriveState()`, once `timing` gives it something
 * to read — and the field is named `state` here already so no later task
 * renames what the screens read.
 */
interface TestWire {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortCode: string;
  state: TestStatus;
  currentVersion: number | null;
  draftVersion: number | null;
  reviewRequested: boolean;
  tags: string[];
  updatedAt: number;
}

function toWire(row: TestRow, draftVersion: number | null): TestWire {
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

/** True when `err` is the `(workspace_id, slug)` unique-constraint failure
 * (AC-02) — SQLite names the columns (`test.workspace_id, test.slug`),
 * Postgres names the index (`test_workspace_slug_uq`), both contain "slug".
 * Anything else — a transient data-layer failure, a vanished workspace row,
 * a short-code retry that collided twice — is not this, and must surface as
 * a 500 rather than be reported to the operator as a duplicate address. */
function isSlugCollision(err: unknown): boolean {
  return err instanceof Error && /slug/i.test(err.message);
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
    } catch (err) {
      // `(workspace_id, slug)` is unique, and the expected way this write
      // fails (AC-02). Anything else — a transient data-layer failure, a
      // short-code retry that collided twice — is not a duplicate address
      // and must not be reported as one.
      if (!isSlugCollision(err)) throw err;
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
      if (!isSlugCollision(err)) throw err;
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

  // Task 3 (#55, P5.2): the one GET/PATCH pair Tasks 4 through 9 all write
  // through — each widens this payload rather than adding a route of its
  // own.
  routes.get("/:id/tests/:testId/draft", requires("tests.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    // No separate `getTest` existence check: a test that does not exist in
    // this workspace and a test that (not reachable before Task 11's
    // lifecycle exists) currently has no draft both answer the identical
    // 404 below, so there is nothing a second read would tell the caller.
    const draft = await getDraftVersion(deps.db, workspaceId, testId);
    if (!draft) throw new ApiError(404, "not_found", "No such resource.");

    const summaries = await workspaceQuestionSummaries(deps.db, workspaceId);
    return c.json(toDraftWire(draft, summaries));
  });

  routes.patch("/:id/tests/:testId/draft", requires("tests.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    const patch = parse(draftPatch, await json(c.req.raw));
    const existing = await getDraftVersion(deps.db, workspaceId, testId);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    let sections: StoredSection[] | undefined;
    if (patch.sections !== undefined) {
      const issues = patch.sections.flatMap((section, index) => checkSection(section, index));
      if (issues.length > 0) {
        throw new ApiError(422, "invalid_section", "A section is not shaped correctly.", { issues });
      }
      // Checked above: every entry names only fields its own source kind
      // uses, so this is safe to treat as the stored shape from here on.
      sections = patch.sections as unknown as StoredSection[];

      const wanted = collectReferencedIds(sections);
      const found = await existingRowIds(deps.db, workspaceId, wanted);
      const missing = [
        ...wanted.questionIds
          .filter((id) => !found.questionIds.has(id))
          .map((id) => ({ field: "source.questions", message: `question "${id}" is not in this workspace` })),
        ...wanted.bankIds
          .filter((id) => !found.bankIds.has(id))
          .map((id) => ({ field: "source.bank", message: `bank "${id}" is not in this workspace` })),
      ];
      if (missing.length > 0) {
        throw new ApiError(422, "unknown_reference", "A section names a question or bank not in this workspace.", {
          issues: missing,
        });
      }
    }

    // Review Focus item 3: each named top-level block replaces whole and
    // merges nothing below it — `settings` is one level of `Object.assign`
    // (a key the patch names replaces that key's entire value; a key it
    // does not name is untouched) and `sections`, when the patch names it
    // at all, replaces the whole array. Never a merge keyed by section id or
    // by a field inside `source`, which is exactly what would let a stale
    // `access_code`, or a stale `sets`/`assignment` left over from a
    // section's previous source kind, survive underneath a patch that meant
    // to replace it.
    const body: TestDocumentBody = {
      settings: patch.settings !== undefined ? { ...existing.body.settings, ...patch.settings } : existing.body.settings,
      sections: sections ?? existing.body.sections,
    };
    const now = deps.now();
    const updated = await putDraftVersion(deps.db, workspaceId, testId, body, now);

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "test.draft.update",
      target: testId,
      detail: { fields: Object.keys(patch).sort() },
      now,
    });

    // No `draw`/`setPoints` here (unlike GET, below): nothing reads them off
    // a PATCH response, and computing them is `workspaceQuestionSummaries`'s
    // own extra statement — a screen that wants fresh numbers right after a
    // save already re-fetches `GET .../draft` for the rest of the payload.
    return c.json(updated);
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
