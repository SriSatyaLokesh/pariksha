// Whole-document import of a `pariksha/bank@1` JSON document: structural
// checks, then `validateBank`'s cross-field rules, then a duplicate-ref_id
// check against what the bank already holds — every issue from all three
// collected into one report, and nothing written unless the report is
// clean. `?dryRun=1` (the route) stops here even when it is clean; a real
// import goes on to write groups and questions.
//
// Positions: every issue — structural, cross-field or duplicate — carries
// the same `{ questionId, index, field, message }` shape `ImportIssue`
// already defines, `index` being this document's own `bank.questions`
// array index. Task 8 (CSV/GIFT converters) will need to translate that
// index into a source row or line; nothing here assumes a JSON document is
// the only shape an issue can be positioned against, which is why `line` is
// already part of `ImportReport`'s issue type and simply unset here.

import { validateBank, type Bank, type ImportIssue } from "@pariksha/core";
import { listQuestionRefIds, writeImportedBank } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { convertCsv } from "./csv.js";
import { convertGift } from "./gift.js";
import { validateBankDocumentStructure } from "./schema.js";

/**
 * Fix round 1, finding 9: this is the *only* shape an import outcome ever
 * takes, success or failure — a clean import or dry run returns it directly
 * with `issues: []`; a validation failure throws `ApiError(422, …, report)`
 * carrying this same shape as `details`, with `imported: 0` and `issues`
 * populated, rather than a bare `{ issues }` of its own. One type, used
 * uniformly on both paths, is what `apps/web/src/lib/api.ts`'s identically-
 * named type (and Task 8's `line` translation, which reads `issues` off
 * whichever of these two outcomes actually happened) needs to be able to
 * rely on.
 */
export interface ImportReport {
  imported: number;
  issues: (ImportIssue & { line?: number })[];
}

/**
 * Not a D1 bound-parameter concern — each question is its own ~19-parameter
 * INSERT, and `writeImportedBank`'s one `db.batch()` call keeps statement
 * *count* flat regardless of how many questions there are, so no single
 * statement grows with this number at all. The real reasons for a ceiling:
 * parsing an unbounded body, the batch's own size, and the memory an
 * in-flight Worker invocation can hold. 500 is a generous size for a
 * hand-authored bank well under any of those.
 */
export const IMPORT_MAX_QUESTIONS = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The bank's own existence is the route's job (`bankOr404`, the same as
 * every other route in banks.ts/questions.ts) — checked once there, not a
 * second time here, which is what keeps this route's budget at "one bank
 * read" rather than two.
 *
 * Shared by every import source. `body` is always a `pariksha/bank@1`
 * document by the time it gets here — for JSON that is the request body
 * itself; for CSV/GIFT (Task 8, `importBankText` below) it is what
 * `convertCsv`/`convertGift` built. `opts.lines`, when given, is that
 * converter's `Converted.lines`: `bank.questions[i]` came from source line
 * `lines[i]`, so every issue `validateBankDocumentStructure`/`validateBank`
 * raises against `bank.questions[index]` is translated through it before
 * the report leaves this function — Review Focus item 4's second half, a
 * CSV/GIFT import reporting the line an author can find, not an index into
 * a document that does not exist on disk. `opts.extraIssues` are errors a
 * converter already found while it was still deciding whether a row/block
 * could become a question at all (an unsupported `type`, a `$CATEGORY`
 * line) — already positioned with their own line, so they pass through
 * untranslated and are merged into the same report JSON issues arrive in.
 */
async function importBankDocument(
  deps: AppDeps,
  workspaceId: string,
  bankId: string,
  body: unknown,
  opts: { dryRun: boolean; now: number; lines?: number[]; extraIssues?: (ImportIssue & { line: number })[] },
): Promise<ImportReport> {
  const rawQuestions = isRecord(body) && Array.isArray(body.questions) ? body.questions : [];

  // Refused before structural or cross-field validation runs at all — the
  // one check cheap enough to do first, and the one that protects every
  // later stage from being handed an unbounded array.
  if (rawQuestions.length > IMPORT_MAX_QUESTIONS) {
    throw new ApiError(
      413,
      "import_too_large",
      `An import is limited to ${IMPORT_MAX_QUESTIONS} questions; this bank has ${rawQuestions.length}.`,
    );
  }

  const structural = validateBankDocumentStructure(body);
  const crossField = validateBank(body);

  // One query, not one per incoming question and not an `IN (...)` list of
  // them (`listQuestionRefIds`'s own comment): every ref_id already in the
  // bank, so re-importing the same document is reported rather than quietly
  // overwriting what is already there.
  const existingRefIds = new Set(await listQuestionRefIds(deps.db, workspaceId, bankId));

  // Fix round (whole-branch review, I5): the check above caps one
  // *request*; nothing capped the *bank*, so repeated imports could grow it
  // past 200 questions (`listQuestions`' own page size) without limit —
  // which is what made `GET .../export`'s declared, `toBe`-pinned budget
  // false at a size this route itself would happily reach. Reusing the
  // ref-id set already fetched for the duplicate check below, at no extra
  // cost.
  if (existingRefIds.size + rawQuestions.length > IMPORT_MAX_QUESTIONS) {
    throw new ApiError(
      413,
      "import_too_large",
      `A bank is limited to ${IMPORT_MAX_QUESTIONS} questions; this bank already has ${existingRefIds.size}, and this import would add ${rawQuestions.length}.`,
    );
  }

  const duplicates: ImportIssue[] = [];
  rawQuestions.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw.id !== "string") return;
    if (existingRefIds.has(raw.id)) {
      duplicates.push({
        questionId: raw.id,
        index,
        field: "id",
        message: `question id "${raw.id}" is already in this bank`,
      });
    }
  });

  const lines = opts.lines;
  const toLine = (issue: ImportIssue): ImportIssue & { line?: number } => {
    const line = lines !== undefined && issue.index >= 0 ? lines[issue.index] : undefined;
    return line !== undefined ? { ...issue, line } : issue;
  };
  const positioned = [...structural, ...(crossField.ok ? [] : crossField.issues), ...duplicates].map(toLine);
  const issues: (ImportIssue & { line?: number })[] = [...(opts.extraIssues ?? []), ...positioned];

  if (issues.length > 0) {
    const report: ImportReport = { imported: 0, issues };
    throw new ApiError(422, "invalid_import", "The import could not be validated.", report);
  }

  // `issues` is empty, which `validateBank` only returns alongside `ok:
  // true` — this is the TypeScript narrowing for that fact, not a reachable
  // branch.
  if (!crossField.ok) throw new Error("unreachable: validateBank reported no issues but ok: false");
  const bank: Bank = crossField.bank;

  if (!opts.dryRun) {
    // One batch, groups and questions together (`writeImportedBank`'s own
    // comment) — fix round 1, findings 1+2: a separate groups loop followed
    // by a separate questions batch left every already-applied group
    // committed if the questions batch failed afterward, which is exactly
    // what a concurrent import racing `listQuestionRefIds`'s pre-check above
    // could trigger.
    await writeImportedBank(deps.db, workspaceId, bankId, bank, opts.now);
  }

  return { imported: bank.questions.length, issues: [] };
}

export async function importBankJson(
  deps: AppDeps,
  workspaceId: string,
  bankId: string,
  body: unknown,
  opts: { dryRun: boolean; now: number },
): Promise<ImportReport> {
  return importBankDocument(deps, workspaceId, bankId, body, opts);
}

export type ImportFormat = "csv" | "gift";

/**
 * Fix round 1, finding 8: the JSON path's size gate (`IMPORT_MAX_QUESTIONS`,
 * above) runs immediately after one native `JSON.parse` call. CSV/GIFT have
 * no equivalent free checkpoint — `readDelimited`'s per-character scan and
 * `convertGift`'s per-line regex matching are both O(text length) and would
 * otherwise run to completion, building a `Question` per row, *before*
 * `importBankDocument` ever gets a question count to gate on. Refused here
 * on the raw text length, before either converter sees it at all. 2 MB is
 * generous against the ~500-question ceiling that gate already enforces — a
 * hand-authored CSV/GIFT row is a few hundred bytes at most.
 */
export const IMPORT_MAX_TEXT_LENGTH = 2 * 1024 * 1024;

/**
 * Task 8 (#52, P4.8): the CSV/GIFT half of import, on the same route and
 * the same budget as `importBankJson` — `convertCsv`/`convertGift` do no
 * I/O, so the DB calls below are the only ones this path ever makes, same
 * as the JSON path.
 */
export async function importBankText(
  deps: AppDeps,
  workspaceId: string,
  bankId: string,
  text: string,
  format: ImportFormat,
  opts: { dryRun: boolean; now: number },
): Promise<ImportReport> {
  if (text.length > IMPORT_MAX_TEXT_LENGTH) {
    throw new ApiError(
      413,
      "import_too_large",
      `A CSV/GIFT import is limited to ${IMPORT_MAX_TEXT_LENGTH / (1024 * 1024)} MB; this file is ${text.length} characters.`,
    );
  }
  const { bank, lines, issues } = format === "csv" ? convertCsv(text) : convertGift(text);
  return importBankDocument(deps, workspaceId, bankId, bank, { ...opts, lines, extraIssues: issues });
}
