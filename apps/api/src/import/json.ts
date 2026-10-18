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
import { listQuestionRefIds, upsertGroup, upsertQuestions } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { validateBankDocumentStructure } from "./schema.js";

export interface ImportReport {
  imported: number;
  issues: (ImportIssue & { line?: number })[];
}

/**
 * D1 caps bound parameters per statement, so a bank with no ceiling could
 * still overflow a single INSERT even with `batch()` keeping statement
 * *count* flat. 500 is comfortably under that per-statement limit for one
 * question's own columns and a generous size for a hand-authored bank.
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
    throw new ApiError(422, "invalid_import", "The import could not be validated.", { issues });
  }

  // `issues` is empty, which `validateBank` only returns alongside `ok:
  // true` — this is the TypeScript narrowing for that fact, not a reachable
  // branch.
  if (!crossField.ok) throw new Error("unreachable: validateBank reported no issues but ok: false");
  const bank: Bank = crossField.bank;

  if (!opts.dryRun) {
    // Groups before questions: a question's `group_ref` must never point at
    // a group this import did not also write.
    for (const group of bank.groups ?? []) {
      await upsertGroup(deps.db, workspaceId, bankId, group, opts.now);
    }
    await upsertQuestions(deps.db, workspaceId, bankId, bank.questions, opts.now);
  }

  return { imported: bank.questions.length, issues: [] };
}
