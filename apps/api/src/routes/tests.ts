// Tests: CRUD, slugs, short links and the identity half of the builder.
//
// Mounted under `/api/v1/workspaces`, like every other workspace-scoped
// route — `requires()` reads the workspace out of the path's own `:id`
// segment. There is no `tests.view` (`packages/core/src/permissions.ts`), so
// every route here, reads included, is guarded by `tests.edit` — the same
// precedent `apps/api/src/app.ts`'s `ROUTE_ACTIONS` comment states for banks.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { Validator, type OutputUnit } from "@cfworker/json-schema";
import { matchesFilter, type QuestionSource } from "@pariksha/core";
import testSchema from "../../../../schemas/test-1.json" with { type: "json" };
import { WRAPPER_KEYWORDS, pathOf } from "../import/schema.js";
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
import { checkReachable } from "../net/reachable.js";

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
// (apps/api/src/routes/questions.ts) draws with `.passthrough()`. The real
// shape check — every type, every `required`, every `additionalProperties:
// false` schemas/test-1.json declares — is `schemaIssues`, below: this is
// the one place a settings block's save-time validation lives, so Tasks 5,
// 7, 8 and 10 each inherit it the moment they add a key to `settings`
// without writing a check of their own.
const draftPatch = z
  .object({
    settings: z.record(z.string(), z.unknown()).optional(),
    sections: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .refine((patch) => patch.settings !== undefined || patch.sections !== undefined, "names nothing to change");

// Task 6 (#58, P5.5): T-19's reachability check. Zod's job stops at "a
// string that is at most this long" — every refusal that matters (scheme,
// userinfo, port, address literal, internal suffix) is `checkReachable`'s,
// because a URL this route *refuses* is still a 200 carrying `refused`, not
// a 400. Telling the two apart in the response body is what lets the
// builder say "that link cannot be checked" rather than "your request was
// malformed".
const checkUrlBody = z.object({ url: z.string().min(1).max(2048) });

interface DraftIssue {
  field: string;
  message: string;
}

/** Keys that hold a map of *named* schemas rather than a schema — their
 * own keys are property names, not keywords, so a property legitimately
 * called `minItems` must not be mistaken for the floor below. */
const SCHEMA_MAPS = new Set(["properties", "$defs", "definitions", "patternProperties"]);

/**
 * Every emptiness floor, wherever it sits: `minItems` on an array,
 * `minLength` on a string. Both say the same thing — "this is not filled in
 * yet" — which is the one thing a Draft is allowed to be.
 */
function stripEmptinessFloors(node: unknown): void {
  if (Array.isArray(node)) {
    for (const entry of node) stripEmptinessFloors(entry);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const schema = node as Record<string, unknown>;
  delete schema.minItems;
  delete schema.minLength;
  for (const [key, value] of Object.entries(schema)) {
    if (SCHEMA_MAPS.has(key) && typeof value === "object" && value !== null) {
      for (const child of Object.values(value)) stripEmptinessFloors(child);
    } else {
      stripEmptinessFloors(value);
    }
  }
}

/**
 * Fix round (task 3 review, C1/C2/I1): the save-time gate is
 * `schemas/test-1.json` itself, run through the `@cfworker/json-schema`
 * `Validator` the repo already owns (`apps/api/src/import/schema.ts`) — not
 * a hand-written field-name check, and not a second validator. Built once,
 * at module scope, from the real document schema minus two things.
 *
 * **The root `required`** — dropped because `settings` is validated as a
 * plain object missing `format`/`name`/`slug`/`sections` (they live on the
 * `test` row or in their own column, never in `settings`), not as a whole
 * `pariksha/test@1` document.
 *
 * **Every emptiness floor** (`minItems`, `minLength`), wherever it sits.
 * Task 3 removed four of them by name — `sourceFixed.questions`,
 * `sourceSets.sets` and the root `sections` (`minItems`), each an instance
 * of UX-13's "a section may be empty in Draft … the publish checklist is
 * where emptiness becomes an error rather than a nag". Task 5 (#57, P5.4)
 * found four more of exactly the same class within one block
 * (`$defs/form.fields`'s `minItems`, `$defs/formField.label`'s
 * `minLength`, `$defs/formField.options`'s `minItems` and its items'
 * `minLength`) and one already live on the branch: **`$defs/section.title`
 * has `minLength: 1` and `SectionList.addSection()` creates a section with
 * `title: ""`, so "Add section" answered 422 on the very next debounced
 * save.** Naming the ninth floor after the eighth is how that bug got
 * shipped; the rule is stated once instead, and Tasks 7-10 inherit it
 * rather than rediscovering it per block.
 *
 * This is the whole relaxation. An emptiness floor only ever says "not
 * filled in yet", which is the definition of a draft and is the publish
 * checklist's business (Tasks 11 and 13) — and for the registration form
 * `validateTest` (@pariksha/core) now carries the publish-time replacement
 * ("a choice field needs at least two options"), so no row goes
 * unenforced. Nothing that bounds a *value* is touched: every `type`,
 * `enum`, `pattern` (a form field's id and a section's id still have to
 * parse), `minimum`, `required` below the root and
 * `additionalProperties: false` (`$defs/timing`, `$defs/access`,
 * `$defs/form`, `$defs/formField`, `$defs/validation`, `$defs/scoring`,
 * `$defs/release` included) runs exactly as import will one day run it.
 */
function draftSchema(): object {
  const schema = structuredClone(testSchema) as { required?: unknown };
  delete schema.required;
  stripEmptinessFloors(schema);
  return schema;
}

const draftValidator = new Validator(draftSchema(), "2020-12", false);

/** The field a leaf schema error is about — `sections[0].source.questions`,
 * or a bare property name for a `required`/`additionalProperties` failure —
 * the same `{ field, message }` shape the 422 below already emits. */
function fieldOfDraftError(err: OutputUnit): string {
  const segments = pathOf(err.instanceLocation);
  let field =
    segments.length === 0
      ? "document"
      : segments.reduce((acc, seg, i) => (i === 0 ? seg : /^\d+$/.test(seg) ? `${acc}[${seg}]` : `${acc}.${seg}`), "");
  if (err.keyword === "required") {
    const prop = /required property "([^"]+)"/.exec(err.error)?.[1];
    if (prop !== undefined) field = field === "document" ? prop : `${field}.${prop}`;
  } else if (err.keyword === "additionalProperties") {
    const prop = /Property "([^"]+)"/.exec(err.error)?.[1];
    if (prop !== undefined) field = field === "document" ? prop : `${field}.${prop}`;
  }
  return field;
}

function schemaIssues(instance: unknown): DraftIssue[] {
  const { errors } = draftValidator.validate(instance);
  return errors
    .filter((err) => !WRAPPER_KEYWORDS.has(err.keyword))
    .map((err) => ({ field: fieldOfDraftError(err), message: err.error }));
}

/** I1: a section id is the key of `draw`/`setPoints`/`points`, the React
 * key and the `?section=` URL value — the schema proves the shape
 * (`^[a-z0-9_-]{1,40}$`, required) but has no way to compare *across*
 * array entries, so uniqueness is this one extra pass. */
function duplicateSectionIds(sections: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) dupes.add(section.id);
    seen.add(section.id);
  }
  return [...dupes];
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
 * `sets` ones — computed here, from the same one `summaries` list `draw`
 * and `setPoints` already read, at zero extra query cost. `fixed` is exact
 * (it names the questions outright) and `sets` takes one set's total
 * (a balanced `sets` section is worth the same either way the sets strip
 * already shows), so both come back as `{ min, max }` with `min === max`.
 *
 * `pool` is the one real estimate — the actual draw is random per attempt
 * (`layoutForAttempt`, `@pariksha/core`) and a real pool's questions
 * usually differ in points. Fix round (task 3 review, I3): presenting one
 * number (whichever `count` matching questions happened to sort first by
 * id) as "Section A is 20 marks" states a fact the engine does not honour.
 * A range — the cheapest possible draw and the dearest — is the honest
 * version of the same sentence, and collapses to one figure (`min ===
 * max`) whenever every matching question is worth the same.
 */
function sectionPoints(
  source: QuestionSource,
  pointsById: ReadonlyMap<string, number>,
  pool: readonly QuestionSummary[],
): { min: number; max: number } {
  if (source.kind === "fixed") {
    const total = source.questions.reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0);
    return { min: total, max: total };
  }
  if (source.kind === "sets") {
    const first = source.sets[0];
    const total = first === undefined ? 0 : first.questions.reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0);
    return { min: total, max: total };
  }
  const matchingPoints = pool
    .filter((q) => matchesFilter(q, source.filter))
    .map((q) => pointsById.get(q.id) ?? 0)
    .sort((a, b) => a - b);
  const count = source.count;
  if (matchingPoints.length === 0 || count <= 0) return { min: 0, max: 0 };
  const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);
  return {
    min: sum(matchingPoints.slice(0, count)),
    max: sum(matchingPoints.slice(-count)),
  };
}

function draftDerived(
  sections: readonly StoredSection[],
  summaries: readonly QuestionSummary[],
): {
  draw: Record<string, { matching: number; wanted: number }>;
  setPoints: Record<string, { set: string; points: number }[]>;
  points: Record<string, { min: number; max: number }>;
} {
  const pointsById = new Map(summaries.map((q) => [q.id, q.points]));
  const draw: Record<string, { matching: number; wanted: number }> = {};
  const setPoints: Record<string, { set: string; points: number }[]> = {};
  const points: Record<string, { min: number; max: number }> = {};

  for (const section of sections) {
    const source: QuestionSource = section.source;
    const pool = source.kind === "pool" && source.bank !== undefined ? summaries.filter((q) => q.bankId === source.bank) : summaries;
    if (source.kind === "pool") {
      const matching = pool.filter((q) => matchesFilter(q, source.filter)).length;
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
    // this workspace and a test that currently has no draft (reachable once
    // Task 11 publishes) both answer the identical 404 below, so there is
    // nothing a second read would tell the caller. Fix round (task 3
    // review, I7/I8): this must never start the next draft itself — a GET
    // with that side effect would be wrong on its own terms, and UX-18
    // makes creating draft N+1 a user-visible lifecycle event with its own
    // message, which is Task 11's territory. PATCH (below) agrees: the same
    // 404, never a silent create.
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
    // Fix round (task 3 review, I7/I8): PATCH now agrees with GET — a
    // missing draft is a 404 on both, never a silent create. Starting the
    // next draft after a publish is Task 11's lifecycle to own explicitly
    // (`UX-18`), not a side effect of a PATCH that meant to save; see
    // `putDraftVersion`'s own comment (packages/db/src/repo/tests.ts).
    const existing = await getDraftVersion(deps.db, workspaceId, testId);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    // Review Focus item 3: each named top-level block replaces whole and
    // merges nothing below it — `settings` is one level of `Object.assign`
    // (a key the patch names replaces that key's entire value; a key it
    // does not name is untouched) and `sections`, when the patch names it
    // at all, replaces the whole array. Never a merge keyed by section id or
    // by a field inside `source`, which is exactly what would let a stale
    // `access_code`, or a stale `sets`/`assignment` left over from a
    // section's previous source kind, survive underneath a patch that meant
    // to replace it.
    let settings = existing.body.settings;
    if (patch.settings !== undefined) {
      const merged = { ...existing.body.settings, ...patch.settings };
      const issues = schemaIssues(merged);
      if (issues.length > 0) {
        throw new ApiError(422, "invalid_settings", "A settings block is not shaped correctly.", { issues });
      }
      // Checked above: `merged` parses against schemas/test-1.json minus the
      // root `required` (settings carries no format/name/slug/sections), so
      // it is safe to treat as `TestSettings` from here on — which is also
      // what it already infers as, hence no assertion (task 3 re-review:
      // both assertions this file carried were flagged by
      // `@typescript-eslint/no-unnecessary-type-assertion`, leaving
      // `pnpm lint` red on the branch).
      settings = merged;
    }

    let sections = existing.body.sections;
    if (patch.sections !== undefined) {
      const issues = schemaIssues({ sections: patch.sections });
      if (issues.length > 0) {
        throw new ApiError(422, "invalid_section", "A section is not shaped correctly.", { issues });
      }
      // Checked above: every entry parses against $defs/section (id
      // pattern, required fields, and its own source kind's shape), so this
      // is safe to treat as the stored shape from here on. The schema
      // cannot compare *across* entries, so id uniqueness (I1) is its own
      // pass, next.
      sections = patch.sections as unknown as StoredSection[];

      const dupes = duplicateSectionIds(sections);
      if (dupes.length > 0) {
        throw new ApiError(422, "duplicate_section_id", "Two sections share the same id.", {
          issues: dupes.map((id) => ({ field: "sections", message: `section id "${id}" is used more than once` })),
        });
      }

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

    const body: TestDocumentBody = { settings, sections };
    const now = deps.now();
    const updated = await putDraftVersion(deps.db, workspaceId, existing, body, now);

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

  // Task 6 (#58, P5.5): the one route this phase adds outside Task 3's
  // GET/PATCH pair, because it is the only one that is not a read or a
  // write of the draft — it makes an outbound request and stores nothing.
  // Advisory throughout: a refused URL is a 200 carrying `refused`, the
  // result never touches the field, and no rule from it reaches the publish
  // checklist.
  routes.post("/:id/tests/:testId/check-url", requires("tests.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    const input = parse(checkUrlBody, await json(c.req.raw));

    // The existence check is the point of mounting this under a test at all:
    // without it, `tests.edit` on *any* test in the workspace would turn the
    // route into a general-purpose fetcher reachable by test id guesswork.
    // No audit row — nothing is changed, and an audit entry per keystroke on
    // a "Check" button is noise, not a record.
    const test = await getTest(deps.db, workspaceId, testId);
    if (!test) throw new ApiError(404, "not_found", "No such resource.");

    return c.json(await checkReachable(deps.http ?? globalThis.fetch, input.url, deps.now));
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
