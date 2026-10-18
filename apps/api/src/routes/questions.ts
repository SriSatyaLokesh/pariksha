// Questions inside one bank.
//
// Mounted under `/api/v1/workspaces` for the same reason banks.ts is — see
// its header. A question is addressed two ways: `ref_id`, the in-document ID
// an Author writes and `pariksha/question@1` validates uniqueness of within
// one bank, and the row's own `qst_` ID, which is what a URL and a
// `test_version.sections_json` entry use. `:qid` below is always the latter.
//
// `questionDoc` only checks a body is *shaped* like a question — `id`,
// `type`, `prompt` and nothing else required. Everything cross-field
// (`validateBank`, @pariksha/core) is the twelve editors' job too, but one
// of its rules needs data only this route has: whether `group` names a
// `PassageGroup` that actually exists in the bank (#50, P4.6). `assertValid`
// below runs the whole of `validateBank` against a one-question "bank" built
// from the real groups and the document being written, rather than
// reimplementing the group-exists check by hand — a write with every other
// field valid gets exactly the one issue a bad `group` deserves.

import { Hono, type Context } from "hono";
import { z } from "zod";
import { QUESTION_TYPES, validateBank, type Question } from "@pariksha/core";
import {
  appendAudit,
  deleteQuestion,
  getBank,
  getQuestion,
  listGroups,
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

/**
 * The group-exists rule (and every other cross-field rule `validateBank`
 * covers) is reached by validating the one-question "bank" this builds —
 * the bank's real groups plus only the document being written — not by a
 * second, hand-rolled check here. A 422 names every issue `validateBank`
 * finds, not only a group one: if the document is otherwise valid (the
 * common case), the group issue is the only one there.
 */
async function assertValid(deps: AppDeps, workspaceId: string, bankId: string, doc: Question): Promise<void> {
  const groups = await listGroups(deps.db, workspaceId, bankId);
  const result = validateBank({ groups, questions: [doc] });
  if (!result.ok) {
    throw new ApiError(422, "invalid_question", "The question is not valid.", { issues: result.issues });
  }
}

// `limit` and `cursor` cross a trust boundary that `type`/`difficulty`'s
// simple allowlist check doesn't need to: `Number("abc")` is `NaN`, and
// `NaN ?? 50` is `NaN` too (`??` is nullish-only), so an unchecked `?limit=`
// would reach `listQuestions`' `LIMIT ?` as `NaN` — and an unchecked cursor
// with no `:` would silently decode to `[NaN, "<whole string>"]` and return
// an empty page instead of failing loudly. Both 400 here instead.
const limitSchema = z.coerce.number().int().positive().max(200);
const cursorSchema = z.string().regex(/^\d+:.+$/, "is not a valid cursor");

function invalidQuery(field: string, message: string): never {
  throw new ApiError(400, "invalid_request", "The query string is not valid.", {
    issues: [{ path: field, message }],
  });
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
  const rawCursor = c.req.query("cursor");
  const rawLimit = c.req.query("limit");

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

  if (rawCursor !== undefined) {
    const parsed = cursorSchema.safeParse(rawCursor);
    if (!parsed.success) invalidQuery("cursor", "cursor is not valid.");
    else filter.cursor = parsed.data;
  }
  if (rawLimit !== undefined) {
    const parsed = limitSchema.safeParse(rawLimit);
    if (!parsed.success) invalidQuery("limit", "limit must be a whole number from 1 to 200.");
    else filter.limit = parsed.data;
  }
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
    await assertValid(deps, workspaceId, bankId, doc);
    const now = deps.now();
    const { id, created, row } = await upsertQuestion(deps.db, workspaceId, bankId, doc, now);

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: created ? "question.create" : "question.update",
      target: id,
      detail: { refId: doc.id },
      now,
    });

    // `row` is what `upsertQuestion` just wrote — a re-read through
    // `getQuestion` here would spend a second statement proving what the
    // first one already returned.
    return c.json(row, created ? 201 : 200);
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
    await assertValid(deps, workspaceId, bankId, doc);

    const now = deps.now();
    const { row } = await upsertQuestion(deps.db, workspaceId, bankId, doc, now);
    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "question.update",
      target: qid,
      detail: { refId: doc.id },
      now,
    });

    return c.json(row);
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
