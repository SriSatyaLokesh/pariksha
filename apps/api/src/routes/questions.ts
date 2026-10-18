// Questions inside one bank.
//
// Mounted under `/api/v1/workspaces` for the same reason banks.ts is — see
// its header. A question is addressed two ways: `ref_id`, the in-document ID
// an Author writes and `pariksha/question@1` validates uniqueness of within
// one bank, and the row's own `qst_` ID, which is what a URL and a
// `test_version.sections_json` entry use. `:qid` below is always the latter.
//
// `questionDoc` only checks a body is *shaped* like a question — `id`,
// `type`, `prompt` and nothing else required. `assertValid`, below, is what
// runs `validateBank` against it — see that function's own comment for which
// of its issues actually block a save (fix round 1, finding 4).

import { Hono, type Context } from "hono";
import { z } from "zod";
import { QUESTION_TYPES, validateBank, type ImportIssue, type Question } from "@pariksha/core";
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
 * Fix round 1, finding 4: an earlier version of this function ran the whole
 * of `validateBank` and rejected anything it found. That was wrong —
 * full-document validation is a finished-document, all-or-nothing check
 * (Task 7's import, and Phase 5 T-11's publish gate), and an author must be
 * able to save a half-built question: a shape-valid `single` whose `key`
 * was deleted along with its option (reachable from the shipped editor,
 * `answer/Choice.tsx`) used to `201` and would have started `422`ing with
 * no field named — the editor's own `onSave` catch surfaces only
 * `cause.message`, discarding `details.issues` — a dead end mid-draft.
 *
 * Only `SAVE_TIME_ISSUE` issues actually block a save; everything else
 * `validateBank` finds is returned by it but never acted on here:
 *   - `group`: a dangling reference breaks the preview and the exam runtime
 *     for every question in the group, not just this one (#50, P4.6, the
 *     rule this function was added for).
 *   - an unsafe regex in a `fill_blank` blank: grading runs it against every
 *     attempt, so a catastrophically backtracking pattern reaching storage
 *     is a stored denial-of-service against the grading path regardless of
 *     whether the rest of the question is finished.
 * Option/key consistency, matching, scoring-mode applicability and the rest
 * wait for import and publish, same as before this route called
 * `validateBank` at all — the *mechanism* (build a one-question "bank" from
 * the real groups and run the real `validateBank`, not a second hand-rolled
 * check) is unchanged.
 */
function isSaveTimeIssue(issue: ImportIssue): boolean {
  return (
    issue.field === "group" ||
    // ponytail: matched by message substring because `ImportIssue` carries
    // no issue code, only `field` (shared with every other `blanks` issue)
    // and a free-text `message` — `validate.ts`'s one `assertSafeRegex` call
    // site is the only place this string is produced today. Upgrade path if
    // that ever drifts: give `ImportIssue` a `code` and match on that
    // instead of a message fragment.
    (issue.field === "blanks" && issue.message.includes("unsafe regex pattern"))
  );
}

async function assertValid(deps: AppDeps, workspaceId: string, bankId: string, doc: Question): Promise<void> {
  const groups = await listGroups(deps.db, workspaceId, bankId);
  const result = validateBank({ groups, questions: [doc] });
  if (result.ok) return;

  const blocking = result.issues.filter(isSaveTimeIssue);
  if (blocking.length > 0) {
    throw new ApiError(422, "invalid_question", "The question is not valid.", { issues: blocking });
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
