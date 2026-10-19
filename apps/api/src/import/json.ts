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
 */
export async function importBankJson(
  deps: AppDeps,
  workspaceId: string,
  bankId: string,
  body: unknown,
  opts: { dryRun: boolean; now: number },
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

  const issues: (ImportIssue & { line?: number })[] = [
    ...structural,
    ...(crossField.ok ? [] : crossField.issues),
    ...duplicates,
  ];
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
