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

import type { Bank, PassageGroup, Question } from "@pariksha/core";
import type { BankRow, QuestionRow } from "@pariksha/db";
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
