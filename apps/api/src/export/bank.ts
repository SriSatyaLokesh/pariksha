// Export — the bank side of #53 (P4.9): a `pariksha/bank@1` document built
// from the rows `getBank`/`listGroups`/`listQuestions` already return. Under
// ADR 0004 the stored Markdown is the only representation there is, so this
// is a mapping, not a serialiser: nothing here renders, sanitises or
// transforms a field, it only picks which already-correct values go into the
// document and under which key.
//
// `question.document` (packages/db/src/repo/question-document.ts) is already
// the `pariksha/question@1` shape `toQuestionRow`'s own inverse produces —
// the exact document a save or an import would have written — so every
// question here round-trips field for field by construction, not by this
// file's effort.

import { validateBank, type Bank, type ImportIssue, type PassageGroup, type Question } from "@pariksha/core";
import type { BankRow, QuestionRow } from "@pariksha/db";
import { validateBankDocumentStructure } from "../import/schema.js";
import bankSchema from "../../../../schemas/bank-1.json" with { type: "json" };

/** `schemas/bank-1.json`'s own `$id` — the same string every export carries,
 * regardless of what (if anything) the imported document's own `$schema`
 * said. Nothing stores a bank's `$schema`: there is no column for it, the
 * same way there is none for a question's (question-document.ts's own
 * comment). */
const BANK_SCHEMA_ID = (bankSchema as { $id: string }).$id;

/** A group stripped to exactly the fields `schemas/bank-1.json` declares —
 * `listGroups`' own return type adds `questionCount` for the browser, and
 * `additionalProperties: false` on a group entry means that field would fail
 * the very structural validation this export is meant to survive. */
function toExportedGroup(group: PassageGroup): PassageGroup {
  return {
    id: group.id,
    passage: group.passage,
    ...(group.title !== undefined && { title: group.title }),
  };
}

/**
 * The bank, its groups and its questions, as one `pariksha/bank@1` document.
 * `questions` is whatever subset the caller already resolved (the whole bank,
 * or a `?ids=` selection) — this function does no filtering of its own.
 */
export function toBankDocument(
  bank: BankRow,
  groups: readonly PassageGroup[],
  questions: readonly QuestionRow[],
): Bank {
  return {
    "$schema": BANK_SCHEMA_ID,
    format: "pariksha/bank@1",
    name: bank.name,
    ...(bank.description != null && { description: bank.description }),
    ...(bank.license != null && { license: bank.license }),
    ...(groups.length > 0 && { groups: groups.map(toExportedGroup) }),
    questions: questions.map((q): Question => q.document),
  };
}

/**
 * Fix round 1, finding 2: every issue `doc` would be refused for on its own
 * way back in through `/import` — structural (`schemas/bank-1.json`,
 * including `questions.minItems: 1`, which an empty bank or an `?ids=`
 * selection matching nothing both fail) and cross-field (`validateBank`,
 * which is also where this task's own duplicate-option-text rule lives, and
 * where a question the save-time guard let through — `routes/questions.ts`'s
 * `isSaveTimeIssue` blocks only `group`/`unsafe_regex`, by the ruling made in
 * Task 6 — is finally caught).
 *
 * The property this buys: this system never hands an author a file it will
 * not take back. A route calls this against the document it is *about* to
 * return and refuses rather than downloads when it is non-empty — never
 * against a document already on its way to the response.
 *
 * `doc` is round-tripped through `JSON.stringify`/`parse` first:
 * `toQuestionDocument` (packages/db/src/repo/question-document.ts) builds a
 * question with a literal `undefined` property for every optional field the
 * row does not hold, rather than omitting the key — correct for `c.json()`,
 * which serialises the same way and drops them, but `@cfworker/json-schema`
 * walks the live JS object and throws ("Instances of \"undefined\" type are
 * not supported") the moment it meets one. Validating the same bytes the
 * response will actually carry, rather than the in-memory shape, is also the
 * more honest check: it is what the client receiving this response will see.
 */
export function exportIssues(doc: Bank): ImportIssue[] {
  const json = JSON.parse(JSON.stringify(doc)) as unknown;
  const structural = validateBankDocumentStructure(json);
  const crossField = validateBank(json);
  return [...structural, ...(crossField.ok ? [] : crossField.issues)];
}

/**
 * Wraps one question in the smallest `pariksha/bank@1` document that can
 * check it meaningfully — `groups` must be the question's *real* groups (or
 * `[]` when it names none), never always `[]`, or a question that
 * legitimately references a group would be refused against a document that
 * never declared it. The single-question export route's own `exportIssues`
 * call builds this; it is never returned to a caller as-is.
 */
export function toSingleQuestionDocument(doc: Question, groups: readonly PassageGroup[]): Bank {
  return {
    format: "pariksha/bank@1",
    name: "export",
    ...(groups.length > 0 && { groups: groups.map(toExportedGroup) }),
    questions: [doc],
  };
}
