// Whole-test import of a `pariksha/test@1` document (#63, P5.10).
//
// Phase 4's three-stage order, exactly: structural
// (`validateTestDocumentStructure` — the *unstripped* schema, so the root
// `required` and every emptiness floor the save gate drops), then the
// cross-field rules (`validateTest`, which is also where the brand-colour
// rule lives, so import is not a third ungated path to an unreadable
// colour), then one `db.batch` writing the test row and its draft
// version 1. Nothing is written unless the report is clean, and `dryRun`
// stops before the write even when it is.
//
// **Questions are resolved by the bank file's own id**, not by `qst_` row
// id — that is what a document names. One that resolves into a bank other
// than the file's own `banks` entry implied still imports and is reported
// in `rebound` (#63: "says plainly when questions resolved to a different
// bank"); one that resolves nowhere is an issue and nothing imports.

import { validateTest, type ImportIssue, type Section, type Test } from "@pariksha/core";
import { createTest, listBanks, toStoredBody, workspaceQuestions, type IdRefs, type TestRow } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { idRefsOf } from "../export/test.js";
import { validateTestDocumentStructure } from "./schema.js";

export interface TestImportReport {
  testId: string | null;
  imported: boolean;
  issues: ImportIssue[];
  /** Question IDs the file named that resolved into a bank other than the
   * one its `banks` entry implied. */
  rebound: { questionId: string; bankName: string }[];
}

/**
 * Not a bound-parameter concern — `createTest`'s one `db.batch` keeps the
 * statement count at two however many sections there are. The real reasons
 * for a ceiling are parsing an unbounded body and the memory an in-flight
 * Worker invocation holds, and this is the same cap the bank import keeps
 * for the same reasons.
 */
export const TEST_IMPORT_MAX_BYTES = 2_000_000;

/** Every question id a section's source names, with the field it was named
 * under — the shape an issue needs to be positioned. */
function namedQuestions(section: Section): { id: string; field: string }[] {
  const source = section.source;
  if (source.kind === "fixed") return source.questions.map((id) => ({ id, field: "source.questions" }));
  if (source.kind === "sets") {
    return source.sets.flatMap((set) => set.questions.map((id) => ({ id, field: "source.sets" })));
  }
  return [];
}

/**
 * Resolves every id the sections name against this workspace, collecting a
 * positioned issue for each that resolves nowhere and a `rebound` entry for
 * each that resolves outside the banks the file declared.
 */
function resolveReferences(
  doc: Test,
  refs: IdRefs,
  bankOfQuestionRef: ReadonlyMap<string, { bankId: string; bankName: string }>,
): { issues: ImportIssue[]; rebound: { questionId: string; bankName: string }[] } {
  const issues: ImportIssue[] = [];
  const rebound: { questionId: string; bankName: string }[] = [];
  const declared = new Set(doc.banks ?? []);

  doc.sections.forEach((section, index) => {
    for (const { id, field } of namedQuestions(section)) {
      const found = bankOfQuestionRef.get(id);
      if (found === undefined) {
        issues.push({
          questionId: id,
          index,
          field,
          message: `question "${id}" is not in any bank in this workspace`,
        });
        continue;
      }
      // Declared nothing at all: there is no implied bank to be rebound
      // *from*, so nothing to report. Declared something else: say so.
      if (declared.size > 0 && !declared.has(found.bankName) && !rebound.some((r) => r.questionId === id)) {
        rebound.push({ questionId: id, bankName: found.bankName });
      }
    }

    if (section.source.kind === "pool" && section.source.bank !== undefined) {
      if (!refs.bankIdByFile.has(section.source.bank)) {
        issues.push({
          questionId: null,
          index,
          field: "source.bank",
          message: `bank "${section.source.bank}" is not a bank in this workspace`,
        });
      }
    }
  });

  return { issues, rebound };
}

export async function importTestDocument(
  deps: AppDeps,
  workspaceId: string,
  body: unknown,
  opts: { dryRun: boolean; now: number },
): Promise<TestImportReport> {
  const none = { testId: null, imported: false, rebound: [] };

  const structural = validateTestDocumentStructure(body);
  if (structural.length > 0) return { ...none, issues: structural };

  // Checked above against the unstripped schema, so every required field
  // is present and every section parses as one of the three source kinds.
  const doc = body as Test;

  const questions = await workspaceQuestions(deps.db, workspaceId);
  const banks = await listBanks(deps.db, workspaceId);
  const refs = idRefsOf(questions, banks);
  const bankNameById = new Map(banks.map((b) => [b.id, b.name]));
  const bankOfQuestionRef = new Map(
    questions.map((q) => [q.refId, { bankId: q.bankId, bankName: bankNameById.get(q.bankId) ?? "" }]),
  );

  const resolved = resolveReferences(doc, refs, bankOfQuestionRef);
  if (resolved.issues.length > 0) return { ...none, issues: resolved.issues, rebound: resolved.rebound };

  // The cross-field pass, against the questions the *document* names —
  // keyed by the bank file's own ids, which is what its sections carry.
  const crossField = validateTest(doc, questions.map((q) => q.document));
  if (!crossField.ok) return { ...none, issues: crossField.issues, rebound: resolved.rebound };

  if (opts.dryRun) {
    return { testId: null, imported: false, issues: [], rebound: resolved.rebound };
  }

  // One batch: the `test` row and its draft version 1, with the whole
  // document already translated into this workspace's row ids.
  const created: TestRow = await createTest(deps.db, workspaceId, {
    name: doc.name,
    slug: doc.slug,
    now: opts.now,
    body: toStoredBody(doc, refs),
  });

  return { testId: created.id, imported: true, issues: [], rebound: resolved.rebound };
}

/** True when `body` parses as JSON at all — the route's 400, kept out of
 * the report shape because a body that is not JSON has no positions to
 * report against. */
export function parseTestJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
