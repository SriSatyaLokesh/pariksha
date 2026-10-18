// Questions inside one bank.
//
// Mounted under `/api/v1/workspaces` for the same reason banks.ts is — see
// its header. A question is addressed two ways: `ref_id`, the in-document ID
// an Author writes and `pariksha/question@1` validates uniqueness of within
// one bank, and the row's own `qst_` ID, which is what a URL and a
// `test_version.sections_json` entry use. `:qid` below is always the latter.
//
// Deep, type-specific validation (does a `single` have `key` among its
// `options`?) is `validateBank` (@pariksha/core) and the twelve editors'
// job (Tasks 3-6), not this route's: it checks a body is *shaped* like a
// question and nothing more.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { QUESTION_TYPES, type Question } from "@pariksha/core";
import {
  appendAudit,
  deleteQuestion,
  getBank,
  getQuestion,
  listQuestions,
  upsertQuestion,
  type QuestionFilter,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";

// No runtime array of `Difficulty` is exported from @pariksha/core (only the
// type), so the query-string allowlist is spelled out here, next to the one
// route that reads it.
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

const questionDoc = z
  .object({
    id: z.string().min(1),
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().min(1),
  })
  .passthrough();

async function bankOr404(deps: AppDeps, workspaceId: string, bankId: string) {
  const bank = await getBank(deps.db, workspaceId, bankId);
  if (!bank) throw new ApiError(404, "not_found", "No such resource.");
  return bank;
}

// Built key-by-key, present only when the query string actually named it:
// `QuestionFilter`'s fields are `T | undefined`-free (brief's own
// signature), and `exactOptionalPropertyTypes` holds a query string's
// "absent" and an explicit `undefined` apart even though a URL can never
// produce the latter.
function filterFromQuery(c: Context<AppBindings>): QuestionFilter {
  const type = c.req.query("type");
  const difficulty = c.req.query("difficulty");
  const tag = c.req.query("tag");
  const search = c.req.query("search");
  const cursor = c.req.query("cursor");
  const limit = c.req.query("limit");

  const filter: QuestionFilter = {};
  if (type && (QUESTION_TYPES as readonly string[]).includes(type)) {
    filter.type = type as (typeof QUESTION_TYPES)[number];
  }
  if (difficulty && (DIFFICULTIES as readonly string[]).includes(difficulty)) {
    filter.difficulty = difficulty as (typeof DIFFICULTIES)[number];
  }
  if (tag) filter.tag = tag;
  if (c.req.query("unused") === "true") filter.unused = true;
  if (search) filter.search = search;
  if (cursor) filter.cursor = cursor;
  if (limit) filter.limit = Number(limit);
  return filter;
}

export function questionRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/banks/:bankId/questions", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    await bankOr404(deps, workspaceId, bankId);

    const { rows, cursor } = await listQuestions(deps.db, workspaceId, bankId, filterFromQuery(c));
    return c.json({ questions: rows, cursor });
  });

  routes.post("/:id/banks/:bankId/questions", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    await bankOr404(deps, workspaceId, bankId);

    const doc = parse(questionDoc, await json(c.req.raw)) as Question;
    const now = deps.now();
    const { id, created } = await upsertQuestion(deps.db, workspaceId, bankId, doc, now);

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: created ? "question.create" : "question.update",
      target: id,
      detail: { refId: doc.id },
      now,
    });

    return c.json(await getQuestion(deps.db, workspaceId, bankId, id), created ? 201 : 200);
  });

  routes.get("/:id/banks/:bankId/questions/:qid", requires("banks.edit"), async (c) => {
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    await bankOr404(deps, workspaceId, bankId);

    const question = await getQuestion(deps.db, workspaceId, bankId, c.req.param("qid"));
    if (!question) throw new ApiError(404, "not_found", "No such resource.");
    return c.json(question);
  });

  // The body replaces the whole document (the same "no second
  // representation" rule `upsertQuestion` itself follows) — it must keep the
  // same `ref_id` this row already has, because `upsertQuestion` matches on
  // `(bankId, ref_id)`, not on `:qid`, and a changed `ref_id` would create a
  // second row rather than update this one.
  routes.patch("/:id/banks/:bankId/questions/:qid", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const qid = c.req.param("qid");
    await bankOr404(deps, workspaceId, bankId);

    const existing = await getQuestion(deps.db, workspaceId, bankId, qid);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    const doc = parse(questionDoc, await json(c.req.raw)) as Question;
    if (doc.id !== existing.refId) {
      throw new ApiError(400, "invalid_request", "A question's ID cannot change.");
    }

    const now = deps.now();
    await upsertQuestion(deps.db, workspaceId, bankId, doc, now);
    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "question.update",
      target: qid,
      detail: { refId: doc.id },
      now,
    });

    return c.json(await getQuestion(deps.db, workspaceId, bankId, qid));
  });

  routes.delete("/:id/banks/:bankId/questions/:qid", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const qid = c.req.param("qid");
    await bankOr404(deps, workspaceId, bankId);

    const existing = await getQuestion(deps.db, workspaceId, bankId, qid);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    const result = await deleteQuestion(deps.db, workspaceId, bankId, qid);
    if (!result.deleted) {
      // UX-05: refused, naming the published tests that hold it.
      throw new ApiError(
        409,
        "question_in_use",
        `This question is used by: ${result.blockedBy.join(", ")}.`,
        { blockedBy: result.blockedBy },
      );
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "question.delete",
      target: qid,
      now: deps.now(),
    });

    return c.body(null, 204);
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
