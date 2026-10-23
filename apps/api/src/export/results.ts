// Phase 8c Task 3 (`R-08`, `R-09`, `R-10`, `K38`, `KG1`, `#97`) — the
// organiser's results CSV and the per-answer CSV.
//
// **`K38`: paging, never truncation.** Both exports page over
// `listAttemptsForTest`'s own keyset cursor, and that function's own
// contract is the one this file leans on whole: a page that reached its
// `limit` always carries a `nextCursor`, so there is no shape in which a
// full-looking page is secretly a partial file. The phase's own anti-goal —
// "an export that quietly drops rows is a lost-answers bug wearing a
// results hat" — is why the row-count test in `results.test.ts` compares
// against the database directly rather than trusting a single page to look
// complete.
//
// **Rank is one page-independent ordering (Review Focus 2).** A page's own
// row position is not a rank — it would restart at 1 on page two, which is
// the subtle version of truncation: the file is complete and the numbers in
// it are wrong. `rankedScoresForTest` (`packages/db/src/repo/results.ts`)
// computes it once, over the whole test, with a SQL `RANK()` window
// function, so a row's rank never depends on which page it happened to land
// on.
//
// **`KG1`: no key, no explanation, no rubric, ever.** The per-answer CSV's
// `Correct` column is read from `attempt.score_json.perQuestion[q].correct`
// — a boolean the grader already computed — and its `Response` column is
// the candidate's own stored answer. Neither read ever touches a question's
// `key`, `explanation` or rubric, so there is no answer key for this file
// to leak even by accident; `scrub-scan.test.ts` (Task 3's own `KG1` scan)
// proves it by scanning the live response bytes for the sentinel anyway.
//
// **The review table is read once per page, not once per row (`K9`-style).**
// `latestVerdicts` scans the workspace's whole `review` table in one
// statement; calling it per attempt would turn a 300-row page into 300 full
// scans. The same restraint applies to `listCandidates` (one call for the
// whole test's registration rows) and `rankedScoresForTest` — each is
// called exactly once per page request, never once per row.
//
// **Duplicate registration-field labels (the duplicate-header ruling).**
// `FormField.label` is organiser-supplied free text with no uniqueness
// constraint (two fields can share one), and `R-08` names labels as the
// CSV's column names. Two identical headers make the file ambiguous to
// Excel and to every parser. `disambiguate()` below is the one ruling:
// when two or more fields (or sections — the same free-text, no-uniqueness
// risk) share a label, every one of that group's headers gets its own
// `(id)` suffix, not just the second one onward — so a reader sees
// `Phone (phone_personal)` beside `Phone (phone_work)` rather than a bare
// `Phone` next to a suffixed one, which would read as if the first were the
// "real" field and the second an afterthought. Recorded in
// `.superpowers/sdd/2026-10-23-phase-8c-the-numbers/progress.md`.

import { Hono } from "hono";
import type { Context } from "hono";
import {
  countedScore,
  csvFilename,
  toCsv,
  type AttemptScore,
  type CountedAttempt,
  type CsvColumn,
  type CsvPage,
  type FormField,
  type Section,
} from "@pariksha/core";
import {
  countedFiguresForTest,
  getDraftVersion,
  getPublishedVersion,
  getTest,
  latestVerdicts,
  listAttemptsForTest,
  listCandidates,
  rankedScoresForTest,
  responsesForAttempts,
  type AttemptSummary,
  type CandidateRow,
  type TestRow,
  type Verdict,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";

export interface ExportPageOptions {
  cursor?: string;
  limit?: number;
}

/** `CsvPage` plus the one thing it deliberately does not carry: `R-10`'s
 *  filename, built once per page from `csvFilename` (`K8`) rather than left
 *  for a caller to reconstruct. Every page of one export answers the same
 *  filename — it names the file the pages assemble into, not the page. */
export type ExportPage = CsvPage & { filename: string };

async function requireTest(deps: AppDeps, workspaceId: string, testId: string): Promise<TestRow> {
  const test = await getTest(deps.db, workspaceId, testId);
  if (!test) throw new ApiError(404, "not_found", "No such resource.");
  return test;
}

/** Groups `items` by `labelOf`, and hands back the header each one's `id`
 *  should render as: the bare label when it names nothing else in the set,
 *  or `label (id)` for every member of a group that shares one — see the
 *  header comment's ruling. */
function disambiguate<T>(
  items: readonly T[],
  labelOf: (item: T) => string,
  idOf: (item: T) => string,
): Map<string, string> {
  const byLabel = new Map<string, T[]>();
  for (const item of items) {
    const label = labelOf(item);
    const group = byLabel.get(label);
    if (group) group.push(item);
    else byLabel.set(label, [item]);
  }
  const headers = new Map<string, string>();
  for (const group of byLabel.values()) {
    const collides = group.length > 1;
    for (const item of group) {
      headers.set(idOf(item), collides ? `${labelOf(item)} (${idOf(item)})` : labelOf(item));
    }
  }
  return headers;
}

interface TestShape {
  slug: string;
  fields: FormField[];
  sections: Section[];
  countedMode: CountedAttempt;
}

/** The registration fields, sections and `counted_attempt` mode the columns
 *  are built from — the **published** version when there is one (what
 *  candidates are actually sitting), falling back to the open draft so a
 *  not-yet-published test is still exportable (`export/test.ts`'s own
 *  `versionToExport` draws the same fallback, for the same reason). */
async function resolveTestShape(deps: AppDeps, workspaceId: string, testId: string): Promise<TestShape> {
  const test = await requireTest(deps, workspaceId, testId);
  const version =
    (await getPublishedVersion(deps.db, workspaceId, testId)) ?? (await getDraftVersion(deps.db, workspaceId, testId));
  return {
    slug: test.slug,
    fields: version?.body.settings.registration_form?.fields ?? [],
    sections: version?.body.sections ?? [],
    // `counted_attempt` lives on `timing`, schemas/test-1.json's own
    // default — not re-guessed here.
    countedMode: version?.body.settings.timing?.counted_attempt ?? "highest",
  };
}

const iso = (ms: number | null): string => (ms === null ? "" : new Date(ms).toISOString());
const scoreOf = (row: AttemptSummary): AttemptScore | null => row.scoreJson as AttemptScore | null;

interface ResultsColumnContext {
  fields: FormField[];
  fieldHeaders: Map<string, string>;
  sections: Section[];
  sectionHeaders: Map<string, string>;
  candidates: Map<string, CandidateRow>;
  verdicts: Map<string, { verdict: Verdict; note: string | null; reviewer: string; at: number }>;
  figures: Map<string, { attemptId: string; percent: number; submittedAt: number }[]>;
  ranks: Map<string, number>;
  countedMode: CountedAttempt;
  testId: string;
}

/** A free-text cell value, serialised the one way every cell in this file
 *  is: `null`/`undefined` become a blank cell (`toCsv` already does this,
 *  but a registration value or a response can itself be an object or array
 *  — a `checkbox` field's selections, a `matching` response — and those are
 *  stringified here rather than becoming `"[object Object]"`). */
function cellOf(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : (value as string | number | boolean);
}

/**
 * `R-08`'s column order, built once per page (the maps above are page-wide,
 * computed once — see this file's header comment): every registration
 * field by its (disambiguated) label, set, start/submit times, time taken,
 * submit reason, total/max/percent/counted-percent/rank, pass/fail, one
 * column per (disambiguated) section, integrity counts and flag, the 7e
 * pair (`Locked at`, `Integrity flag`), verdict and note, and a review
 * link.
 *
 * **The review link is relative, not absolute.** `AppEnv`'s `publicUrl`
 * exists only on the `node` target — the production Workers target carries
 * no configured origin for the web app at all (`env.ts`) — so there is
 * nothing to prefix an absolute URL with that would be correct on both
 * targets. It points at the organiser web app's own `?view=grading&test=`
 * (`apps/web/src/lib/view-url.ts`), the grading queue for this test: that
 * query-string scheme carries no per-attempt parameter today (deliberately
 * — `organiser.tsx`'s own comment on `QuestionScreen` draws the same line),
 * so a queue-level link is the closest real destination rather than a
 * fabricated one.
 */
function resultsColumns(ctx: ResultsColumnContext): CsvColumn<AttemptSummary>[] {
  const fieldColumns: CsvColumn<AttemptSummary>[] = ctx.fields.map((field) => ({
    header: ctx.fieldHeaders.get(field.id) ?? field.label,
    value: (row) => cellOf(ctx.candidates.get(row.candidateId)?.formValues[field.id]),
  }));

  const sectionColumns: CsvColumn<AttemptSummary>[] = ctx.sections.map((section) => ({
    header: ctx.sectionHeaders.get(section.id) ?? section.title,
    value: (row) => scoreOf(row)?.sections.find((s) => s.sectionId === section.id)?.points ?? "",
  }));

  return [
    ...fieldColumns,
    { header: "Set", value: (row) => ctx.candidates.get(row.candidateId)?.setLabel ?? "" },
    { header: "Start time", value: (row) => iso(row.startedAt) },
    { header: "Submit time", value: (row) => iso(row.submittedAt) },
    {
      header: "Time taken (s)",
      value: (row) => (row.submittedAt === null ? "" : Math.round((row.submittedAt - row.startedAt) / 1000)),
    },
    { header: "Submit reason", value: (row) => row.submitReason ?? "" },
    { header: "Total", value: (row) => scoreOf(row)?.total ?? "" },
    { header: "Max", value: (row) => scoreOf(row)?.max ?? "" },
    { header: "Percent", value: (row) => scoreOf(row)?.percent ?? "" },
    {
      // `K7`: this attempt's own percent, above, and the test's
      // `counted_attempt` figure, here — two columns, never one conflated
      // reading (`release.ts`'s own ruling 2, applied to the organiser's
      // file instead of the candidate's receipt).
      header: "Counted percent",
      value: (row) => {
        const figures = ctx.figures.get(row.candidateId);
        if (!figures) return "";
        const counted = countedScore(figures, ctx.countedMode);
        return counted === null ? "" : counted.percent;
      },
    },
    { header: "Rank", value: (row) => ctx.ranks.get(row.attemptId) ?? "" },
    {
      header: "Pass/fail",
      value: (row) => {
        const passed = scoreOf(row)?.passed;
        return passed === true ? "pass" : passed === false ? "fail" : "";
      },
    },
    ...sectionColumns,
    { header: "Violations", value: (row) => row.violations },
    { header: "Observed", value: (row) => row.observed },
    { header: "Flag", value: (row) => row.flag },
    { header: "Locked at", value: (row) => iso(row.lockedAt) },
    { header: "Integrity flag", value: (row) => row.integrityFlag },
    { header: "Verdict", value: (row) => ctx.verdicts.get(row.attemptId)?.verdict ?? "" },
    { header: "Note", value: (row) => ctx.verdicts.get(row.attemptId)?.note ?? "" },
    { header: "Review link", value: () => `/?view=grading&test=${ctx.testId}` },
  ];
}

/**
 * One page of `R-08`'s results CSV. `toCsv`'s `header`/`bom` are both tied
 * to whether this is the *first* page (`opts.cursor === undefined`): a
 * later page carries neither, so a client that concatenates pages in
 * cursor order gets one well-formed file rather than a repeated header and
 * a stray BOM mid-document (`csv.ts`'s own doc comment on `bom: false`).
 */
export async function exportResultsPage(
  deps: AppDeps,
  workspaceId: string,
  testId: string,
  opts: ExportPageOptions = {},
): Promise<ExportPage> {
  const shape = await resolveTestShape(deps, workspaceId, testId);
  const fieldHeaders = disambiguate(shape.fields, (f) => f.label, (f) => f.id);
  const sectionHeaders = disambiguate(shape.sections, (s) => s.title, (s) => s.id);

  const { rows, nextCursor } = await listAttemptsForTest(deps.db, workspaceId, testId, {
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.cursor !== undefined && { cursor: opts.cursor }),
  });

  // Each read once per page (this call), never once per row — `K9`/`K38`'s
  // shared discipline, and the reason `latestVerdicts` in particular names
  // it in its own doc comment.
  const attemptIds = rows.map((row) => row.attemptId);
  const verdicts = await latestVerdicts(deps.db, workspaceId, attemptIds);
  const candidateRows = await listCandidates(deps.db, workspaceId, testId);
  const figures = await countedFiguresForTest(deps.db, workspaceId, testId);
  const ranks = await rankedScoresForTest(deps.db, workspaceId, testId);

  const columns = resultsColumns({
    fields: shape.fields,
    fieldHeaders,
    sections: shape.sections,
    sectionHeaders,
    candidates: new Map(candidateRows.map((candidate) => [candidate.id, candidate])),
    verdicts,
    figures,
    ranks,
    countedMode: shape.countedMode,
    testId,
  });

  const firstPage = opts.cursor === undefined;
  return {
    csv: toCsv(rows, columns, { bom: firstPage, header: firstPage }),
    nextCursor,
    filename: csvFilename(shape.slug, "results", deps.now()),
  };
}

interface AnswerRow {
  attemptId: string;
  questionId: string;
  value: unknown;
  correct: boolean | null;
  points: number | null;
}

const ANSWER_COLUMNS: CsvColumn<AnswerRow>[] = [
  { header: "Attempt", value: (row) => row.attemptId },
  { header: "Question ID", value: (row) => row.questionId },
  { header: "Response", value: (row) => cellOf(row.value) },
  // `KG1`: a boolean, never the key — read straight off the grader's own
  // `GradeResult.correct`, never off the question's `key`/`explanation`.
  { header: "Correct", value: (row) => row.correct },
  { header: "Points", value: (row) => row.points ?? "" },
];

/**
 * **Clamped well under D1's 100-bound-parameter cap** — this route's one
 * departure from `listAttemptsForTest`'s own 500-row clamp. The per-answer
 * CSV joins in one `attempt_id IN (...)` read per page
 * (`responsesForAttempts`), one placeholder per attempt in the page; 90
 * leaves headroom for `workspaceId` and is nowhere near the cap, while
 * still keeping a page's response-row count (90 attempts × up to ~60
 * questions, `R-09`'s own arithmetic) well inside what one JSON response
 * should carry.
 */
const ANSWERS_PAGE_LIMIT_MAX = 90;

/** One page of `R-09`'s per-answer CSV — paged over *attempts* (the same
 *  cursor `listAttemptsForTest` already returns), flattened to one row per
 *  response within that page. An attempt with no response for a question
 *  yet (mid-test, `R-10`) simply contributes no row for it, rather than a
 *  blank one — there is nothing to report until a candidate answers. */
export async function exportAnswersPage(
  deps: AppDeps,
  workspaceId: string,
  testId: string,
  opts: ExportPageOptions = {},
): Promise<ExportPage> {
  const test = await requireTest(deps, workspaceId, testId);
  const limit = Math.min(opts.limit ?? 50, ANSWERS_PAGE_LIMIT_MAX);

  const { rows, nextCursor } = await listAttemptsForTest(deps.db, workspaceId, testId, {
    limit,
    ...(opts.cursor !== undefined && { cursor: opts.cursor }),
  });

  const attemptIds = rows.map((row) => row.attemptId);
  const responsesByAttempt = await responsesForAttempts(deps.db, workspaceId, attemptIds);

  const flat: AnswerRow[] = [];
  for (const attempt of rows) {
    const perQuestion = scoreOf(attempt)?.perQuestion;
    for (const response of responsesByAttempt.get(attempt.attemptId) ?? []) {
      const graded = perQuestion?.[response.questionId];
      flat.push({
        attemptId: attempt.attemptId,
        questionId: response.questionId,
        value: response.value,
        correct: graded?.correct ?? null,
        points: graded?.points ?? null,
      });
    }
  }

  const firstPage = opts.cursor === undefined;
  return {
    csv: toCsv(flat, ANSWER_COLUMNS, { bom: firstPage, header: firstPage }),
    nextCursor,
    filename: csvFilename(test.slug, "answers", deps.now()),
  };
}

function pageOptions(c: Context<AppBindings>): ExportPageOptions {
  const cursor = c.req.query("cursor");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new ApiError(400, "invalid_request", "The request body is not valid.", {
      issues: [{ path: "limit", message: "must be a positive integer" }],
    });
  }
  return { ...(cursor !== undefined && { cursor }), ...(limit !== undefined && { limit }) };
}

/**
 * `GET …/export/results.csv` and `GET …/export/answers.csv` — `results.export`,
 * available to a viewer and to a scoped API key alike (`K25`), and reachable
 * whether or not the test has closed yet (`R-10`).
 */
export function resultsExportRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/tests/:testId/export/results.csv", requires("results.export"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    return c.json(await exportResultsPage(deps, workspaceId, testId, pageOptions(c)));
  });

  routes.get("/:id/tests/:testId/export/answers.csv", requires("results.export"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    return c.json(await exportAnswersPage(deps, workspaceId, testId, pageOptions(c)));
  });

  return routes;
}
