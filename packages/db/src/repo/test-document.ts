// The mapping between a `pariksha/test@1` document (packages/core/src/
// types.ts) and the `test_version` table's `settings_json`/`sections_json`
// columns.
//
// Kept out of `repo/index.ts`'s barrel for the same reason
// `question-document.ts` is: this is not a workspace-scoped repository
// function, it is a pure data mapping, and folding it in would force
// `scoping.test.ts` to carve an exception for it. Pure and synchronous —
// takes `IdRefs` rather than a `DbClient` — so a caller builds the maps
// itself from whatever single query suits its own budget (the export route,
// Task 12, from one `listQuestions`-per-bank and one `listBanks` call) and
// this file never touches the database at all.
//
// Architecture (the Phase 5 plan's own words): "`sections_json` names
// `qst_`/`bnk_` row IDs; export translates." A document's `fixed`/`sets`
// sources name questions by the bank file's own IDs (`"LOG-001"`) and a
// `pool` source names a bank by its file path (`"questions.json"`) — neither
// means anything inside this workspace on its own, so the stored shape
// replaces both with this workspace's row IDs, and these two functions are
// the only place that translation happens in either direction.

import type { QuestionSource, Section, Test } from "@pariksha/core";
import type { TestRow } from "./tests.js";

/**
 * Everything a `pariksha/test@1` document carries except what lives on the
 * `test` row itself (`name`, `slug` — editable independently of a draft,
 * T-01) or is never stored (`$schema`, a document-authoring convenience)
 * or lives in its own column (`sections`). Built by plain object-rest
 * destructuring in `toStoredBody`, below, which is also why a block Phase 5
 * builds no editor for — `consent`, `proctoring`, `retention` — round-trips
 * untouched: it is just another key this type does not name and the rest
 * pattern carries along regardless.
 */
export type TestSettings = Omit<Test, "$schema" | "format" | "name" | "slug" | "sections">;

/** A `Section` whose `source` names `qst_`/`bnk_` row IDs rather than the
 * bank file's own. Same shape as `Section` — only what the IDs *mean*
 * differs, which no type can say — so this is a named alias, not a new
 * interface. */
export type StoredSection = Section;

export interface TestDocumentBody {
  settings: TestSettings;
  sections: StoredSection[];
}

/** Both directions of both translations, built once per request by
 * whichever caller needs them (the draft route needs neither — it already
 * stores and serves row IDs — so only Task 12's export/import ever
 * constructs one of these). */
export interface IdRefs {
  questionIdByRef: Map<string, string>;
  refByQuestionId: Map<string, string>;
  bankIdByFile: Map<string, string>;
  fileByBankId: Map<string, string>;
}

function lookup(map: ReadonlyMap<string, string>, key: string, what: "question" | "bank"): string {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`test-document: no ${what} is known by "${key}"`);
  }
  return value;
}

/** Rewrites one section's `source`, translating every question/bank ID
 * through the two maps given — `refs.questionIdByRef`/`refs.bankIdByFile`
 * storing a document, `refs.refByQuestionId`/`refs.fileByBankId`
 * reconstructing one, the only two ways this is ever called. */
function mapSection(
  section: Section,
  questions: ReadonlyMap<string, string>,
  banks: ReadonlyMap<string, string>,
): StoredSection {
  const source = section.source;
  let mapped: QuestionSource;
  switch (source.kind) {
    case "fixed":
      mapped = { ...source, questions: source.questions.map((id) => lookup(questions, id, "question")) };
      break;
    case "pool":
      mapped =
        source.bank === undefined ? { ...source } : { ...source, bank: lookup(banks, source.bank, "bank") };
      break;
    case "sets":
      mapped = {
        ...source,
        sets: source.sets.map((set) => ({
          ...set,
          questions: set.questions.map((id) => lookup(questions, id, "question")),
        })),
      };
      break;
  }
  return { ...section, source: mapped };
}

/**
 * A `pariksha/test@1` document's sections, with every ID it names
 * translated to this workspace's row IDs — what `test_version.sections_json`
 * stores. `doc`'s `name`/`slug`/`format`/`$schema` are dropped: the first
 * two live on the `test` row, the last two are never stored at all.
 */
export function toStoredBody(doc: Test, refs: IdRefs): TestDocumentBody {
  const { $schema: _schema, format: _format, name: _name, slug: _slug, sections, ...settings } = doc;
  return {
    settings,
    sections: sections.map((section) => mapSection(section, refs.questionIdByRef, refs.bankIdByFile)),
  };
}

/**
 * The inverse: a stored body's row IDs translated back to the bank file's
 * own identity, assembled with `test`'s own `name`/`slug` into a whole
 * `pariksha/test@1` document — what export (Task 12) hands out and what
 * `validateTest` (`@pariksha/core`) checks on import.
 */
export function toTestDocument(test: TestRow, body: TestDocumentBody, refs: IdRefs): Test {
  return {
    format: "pariksha/test@1",
    name: test.name,
    slug: test.slug,
    ...body.settings,
    sections: body.sections.map((section) => mapSection(section, refs.refByQuestionId, refs.fileByBankId)),
  };
}
