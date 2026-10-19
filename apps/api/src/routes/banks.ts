// Banks, and the workspace's tag vocabulary.
//
// Mounted under `/api/v1/workspaces` — like every other workspace-scoped
// route in this app — rather than flat at `/api/v1/banks`, because
// `requires()`/`requireMember()` (middleware/authorize.ts) read the
// workspace out of the path's own `:id` segment and have no other way to
// learn it; S-09 (a cross-workspace resource is 404, not 403) depends on
// that segment naming the actor's own membership.
//
// `banks.edit` is the one bank-shaped action (docs/design.md, the
// permission matrix) — there is no `banks.view` — so every route here,
// reads included, is guarded by it. A Viewer is 403 on all of them, which
// is intended, not an oversight.

import { Hono } from "hono";
import { z } from "zod";
import type { PassageGroup } from "@pariksha/core";
import {
  appendAudit,
  createBank,
  deleteBank,
  deleteGroup,
  getBank,
  getQuestion,
  listBanks,
  listGroups,
  listQuestions,
  listWorkspaceTags,
  updateBank,
  upsertGroup,
  type QuestionRow,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { toBankDocument } from "../export/bank.js";
import { importBankJson, importBankText } from "../import/json.js";
import { actorOr401, requires } from "../middleware/authorize.js";

const newBank = z.object({ name: z.string().min(1).max(200) });

const bankPatch = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    license: z.string().max(200).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "names nothing to change");

// Fix round 1, finding 2: self-review dropped the `id` pattern as
// "unrequested strictness" on the grounds that no schema or sibling route
// enforces one — true, but beside the point once a group's `id` became a
// URL path segment (`:groupId`, below). An id containing `/` creates fine
// and is then permanently unreachable by PATCH/DELETE (`:groupId` stops at
// the first `/`), and `..` resolves against the path entirely, reaching the
// bank route instead of a group. Restored, and the client
// (`apps/web/src/lib/api.ts`) also `encodeURIComponent`s it — both, not
// either, because this check only stops a *new* bad id.
//
// Fix round 1, finding 7: `passage` had no ceiling while every sibling
// field does (`description` 4000, `title` 200) — and `groups_json` is
// parsed by `listGroups` on every question write (`assertValid`,
// questions.ts), the one path with the tightest CPU budget. 20000 matches
// `prompt_md`'s own practical ceiling (nothing in the schema bounds a
// question's prompt either, but a passage is reachable the same way a
// prompt is, through the same editor toolbar).
const newGroup = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, "must be letters, numbers, underscore, dot or hyphen"),
  title: z.string().min(1).max(200).optional(),
  passage: z.string().min(1).max(20_000),
});

// Fix round 1, finding 6: `title` has no `.min(1)` here, unlike `newGroup`'s
// — on a PATCH, an empty string is how an author clears a title that was
// set at creation, distinct from the field being absent at all (which means
// "leave it alone", the PATCH route's existing `?? existing.title`
// fallback). `newGroup` needs no such sentinel: a group that never had a
// title just never sends the field.
const groupPatch = z
  .object({
    title: z.string().max(200).optional(),
    passage: z.string().min(1).max(20_000).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "names nothing to change");

// Fix round 1, finding 8: the four group routes below each repeated
// `getBank` + a 404 check inline — `questions.ts` already names this exact
// pattern `bankOr404`.
async function bankOr404(deps: AppDeps, workspaceId: string, bankId: string) {
  const bank = await getBank(deps.db, workspaceId, bankId);
  if (!bank) throw new ApiError(404, "not_found", "No such resource.");
  return bank;
}

/**
 * Every question in a bank, for export — `listQuestions` caps a page at 200
 * (right for the browser, which only ever shows one page at a time), so a
 * bank at `IMPORT_MAX_QUESTIONS` (500, apps/api/src/import/json.ts) needs
 * more than one call to come back whole. One call for any bank at or under
 * 200 questions (every fixture this task measures a budget against), and one
 * more per additional 200 beyond that — still a handful of subrequests
 * against the 50-subrequest ceiling, never a loss of the tail of a large
 * bank the way a single capped call would be.
 */
async function allQuestions(deps: AppDeps, workspaceId: string, bankId: string): Promise<QuestionRow[]> {
  const out: QuestionRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listQuestions(deps.db, workspaceId, bankId, {
      limit: 200,
      ...(cursor !== undefined && { cursor }),
    });
    out.push(...page.rows);
    if (page.cursor === undefined) return out;
    cursor = page.cursor;
  }
}

export function bankRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/banks", requires("banks.edit"), async (c) =>
    c.json({ banks: await listBanks(deps.db, c.req.param("id")) }),
  );

  // UX-02: a name and nothing else is required.
  routes.post("/:id/banks", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const input = parse(newBank, await json(c.req.raw));
    const now = deps.now();

    const id = await createBank(deps.db, workspaceId, { name: input.name, now });
    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "bank.create",
      target: id,
      detail: { name: input.name },
      now,
    });

    return c.json(await getBank(deps.db, workspaceId, id), 201);
  });

  routes.get("/:id/banks/:bankId", requires("banks.edit"), async (c) => {
    const bank = await getBank(deps.db, c.req.param("id"), c.req.param("bankId"));
    if (!bank) throw new ApiError(404, "not_found", "No such resource.");
    return c.json(bank);
  });

  routes.patch("/:id/banks/:bankId", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const patch = parse(bankPatch, await json(c.req.raw));

    // zod's `.optional()` types each field `T | undefined`, which
    // `exactOptionalPropertyTypes` treats as a stricter type than
    // `updateBank`'s `name?: string` — spreading only the keys the request
    // actually named closes that gap rather than widening `updateBank`'s
    // signature to match a JSON body that can never truly hold `undefined`.
    const updated = await updateBank(deps.db, workspaceId, bankId, {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.license !== undefined && { license: patch.license }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
    });
    if (!updated) throw new ApiError(404, "not_found", "No such resource.");

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "bank.update",
      target: bankId,
      detail: { fields: Object.keys(patch).sort() },
      now: deps.now(),
    });

    return c.json(await getBank(deps.db, workspaceId, bankId));
  });

  routes.delete("/:id/banks/:bankId", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");

    const bank = await getBank(deps.db, workspaceId, bankId);
    if (!bank) throw new ApiError(404, "not_found", "No such resource.");

    const result = await deleteBank(deps.db, workspaceId, bankId);
    if (!result.deleted) {
      // UX-05's bank-level sibling: a bank holding a question a published
      // version references cannot be gutted out from under it either.
      throw new ApiError(
        409,
        "bank_in_use",
        `This bank has questions used by: ${result.blockedBy.join(", ")}.`,
        { blockedBy: result.blockedBy },
      );
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "bank.delete",
      target: bankId,
      now: deps.now(),
    });

    return c.body(null, 204);
  });

  routes.get("/:id/tags", requires("banks.edit"), async (c) =>
    c.json({ tags: await listWorkspaceTags(deps.db, c.req.param("id")) }),
  );

  routes.get("/:id/banks/:bankId/groups", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    await bankOr404(deps, workspaceId, bankId);

    return c.json({ groups: await listGroups(deps.db, workspaceId, bankId) });
  });

  routes.post("/:id/banks/:bankId/groups", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    await bankOr404(deps, workspaceId, bankId);

    const input = parse(newGroup, await json(c.req.raw));
    const groups = await listGroups(deps.db, workspaceId, bankId);
    if (groups.some((g) => g.id === input.id)) {
      throw new ApiError(409, "duplicate_group", `A group with id "${input.id}" already exists.`, {
        field: "id",
      });
    }

    const now = deps.now();
    const group: PassageGroup = {
      id: input.id,
      passage: input.passage,
      ...(input.title !== undefined && { title: input.title }),
    };
    await upsertGroup(deps.db, workspaceId, bankId, group, now);
    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "group.create",
      target: input.id,
      now,
    });

    return c.json({ ...group, questionCount: 0 }, 201);
  });

  routes.patch("/:id/banks/:bankId/groups/:groupId", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const groupId = c.req.param("groupId");
    await bankOr404(deps, workspaceId, bankId);

    const groups = await listGroups(deps.db, workspaceId, bankId);
    const existing = groups.find((g) => g.id === groupId);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    const patch = parse(groupPatch, await json(c.req.raw));
    const title = patch.title !== undefined ? patch.title : existing.title;
    // An empty string (only reachable by an explicit `title: ""` in the
    // patch — `existing.title` is never `""`, `upsertGroup` never persists
    // one) collapses to "no title" rather than being stored verbatim.
    const group: PassageGroup = {
      id: groupId,
      passage: patch.passage ?? existing.passage,
      ...(title !== undefined && title !== "" && { title }),
    };

    const now = deps.now();
    await upsertGroup(deps.db, workspaceId, bankId, group, now);
    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "group.update",
      target: groupId,
      now,
    });

    return c.json({ ...group, questionCount: existing.questionCount });
  });

  routes.delete("/:id/banks/:bankId/groups/:groupId", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const groupId = c.req.param("groupId");
    await bankOr404(deps, workspaceId, bankId);

    // Fix round 1, finding 8: this used to re-fetch `listGroups` only to
    // check the group exists before calling `deleteGroup`, which now
    // performs exactly that check itself (the self-review fix that made
    // `deleteGroup` answer `deleted: false, blockedBy: []` for an unknown
    // group, rather than falsely reporting it deleted) — a 404 and a 409
    // read apart on `blockedBy`, not on a second query for the same fact.
    const result = await deleteGroup(deps.db, workspaceId, bankId, groupId);
    if (result.blockedBy.length > 0) {
      // Same shape as UX-05's question/bank refusals, named differently: a
      // group is blocked by the questions that still reference it, not by a
      // published test.
      throw new ApiError(
        409,
        "group_in_use",
        `This group is used by: ${result.blockedBy.join(", ")}.`,
        { questions: result.blockedBy },
      );
    }
    if (!result.deleted) throw new ApiError(404, "not_found", "No such resource.");

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "group.delete",
      target: groupId,
      now: deps.now(),
    });

    return c.body(null, 204);
  });

  // Task 7 (#51, P4.7): whole-bank import, all-or-nothing. `?dryRun=1`
  // validates and reports without writing — the one call the web dialog
  // makes first, before an author ever clicks "Import". Task 8 (#52, P4.8):
  // `?format=csv|gift` reads the same body as text instead of JSON and
  // hands it to the matching converter first — same handler, same budget
  // (apps/api/src/import/json.ts's `importBankText`).
  routes.post("/:id/banks/:bankId/import", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    await bankOr404(deps, workspaceId, bankId);

    const dryRun = c.req.query("dryRun") === "1";
    const format = c.req.query("format");
    const now = deps.now();
    const report =
      format === "csv" || format === "gift"
        ? await importBankText(deps, workspaceId, bankId, await c.req.raw.text(), format, { dryRun, now })
        : await importBankJson(deps, workspaceId, bankId, await json(c.req.raw), { dryRun, now });

    if (!dryRun) {
      await appendAudit(deps.db, workspaceId, {
        actor: actor.userId,
        action: "bank.import",
        target: bankId,
        detail: { imported: report.imported },
        now,
      });
    }

    return c.json(report);
  });

  // Task 9 (#53, P4.9): export, the other half of AC-05's round trip.
  // `toBankDocument` (apps/api/src/export/bank.ts) is a pure mapping; this
  // route's own job is fetching what it maps, in as few subrequests as the
  // existing repository functions allow — `?ids=` filters the already-
  // fetched set in memory, so the cost never grows with how many ids are
  // named.
  routes.get("/:id/banks/:bankId/export", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const bank = await bankOr404(deps, workspaceId, bankId);
    const groups = await listGroups(deps.db, workspaceId, bankId);
    const questions = await allQuestions(deps, workspaceId, bankId);

    const idsParam = c.req.query("ids");
    const selected =
      idsParam === undefined
        ? questions
        : idsParam
            .split(",")
            .map((id) => questions.find((q) => q.document.id === id))
            .filter((q): q is QuestionRow => q !== undefined);

    return c.json(toBankDocument(bank, groups, selected));
  });

  // The single-question sibling: no `bankOr404` of its own — `getQuestion`
  // is already scoped by workspace *and* bank, so a bank that does not exist
  // and a question that does not exist in a bank that does both answer the
  // same 404 either way, and checking twice would only spend a second
  // subrequest proving what the first call's `null` already said.
  routes.get("/:id/banks/:bankId/questions/:qid/export", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const question = await getQuestion(deps.db, workspaceId, bankId, c.req.param("qid"));
    if (!question) throw new ApiError(404, "not_found", "No such resource.");
    return c.json(question.document);
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
