// The one publish gate (Review Focus 4).
//
// `GET …/checklist` renders what this returns and `POST …/publish` re-runs
// it and refuses on any `blocking` row, so the screen and the gate cannot
// disagree: there is one function and two callers, never a copy of the
// arithmetic in the browser.
//
// Pure — it takes the body, the drawable questions and `now`, touches no
// database and reads no clock. Every rule it can get from `validateTest`
// (`@pariksha/core`) it gets from `validateTest`, including the *wording*:
// the numbers an organiser reads in the checklist are then literally the
// numbers an import of the same document would report (Task 12), rather
// than a second rendering of the same fact that can drift from it. What is
// left over is the handful of rules `validateTest` structurally cannot
// carry — the ones that need `now` (that package is pure and takes no
// clock) and the emptiness floors the draft gate strips, which are
// publish-time by UX-13's own words ("a section may be empty in Draft …
// the publish checklist is where emptiness becomes an error rather than a
// nag").

import { validateTest, type ImportIssue, type Question, type Test } from "@pariksha/core";
import type { StoredSection, TestDocumentBody, TestRow } from "@pariksha/db";

export type ChecklistSeverity = "blocking" | "advisory";

export interface ChecklistRow {
  id: string;
  severity: ChecklistSeverity;
  message: string;
  /** The document field a screen navigates to — never empty. */
  field: string;
  /** Present when the row is about one section, so the screen can open it. */
  sectionId?: string;
}

export interface ChecklistInput {
  test: TestRow;
  body: TestDocumentBody;
  /**
   * The questions the sections can draw, **keyed the way the stored
   * sections name them** — that is, each document's `id` is its `qst_` row
   * id, not the bank file's own `ref_id`. `workspaceQuestions`
   * (`@pariksha/db`) returns both halves; the route composes them. The
   * same shape `apps/api/test/selection.test.ts` already hands
   * `layoutForAttempt`, and for the same reason: a stored section names
   * row ids.
   */
  questions: readonly Question[];
  now: number;
}

const DAY_MS = 86_400_000;

/**
 * How `validateTest`'s issues become rows. Matched in order on `field`,
 * plus `message` where one field carries two different rules
 * (`source.sets` is both "unequal total points" and "question X is not in
 * the banks this test draws from"; `sections` is both the duplicate-id
 * rule and the "entry at index N is not a section object" backstop).
 *
 * **Anything that matches nothing here is still a blocking row** — see
 * `mapIssue`. A rule added to `validateTest` by a later phase therefore
 * refuses a publish by default rather than disappearing out of the gate,
 * which is the failure mode worth being safe against: a checklist that
 * silently drops a rule teaches organisers the list is complete when it
 * is not.
 */
interface IssueRow {
  id: string;
  severity: ChecklistSeverity;
  message?: RegExp;
}

const ISSUE_ROWS: Readonly<Record<string, readonly IssueRow[]>> = {
  "timing.closes_at": [{ id: "window_backwards", severity: "blocking" }],
  "timing.duration_minutes": [{ id: "section_durations", severity: "blocking" }],
  "timing.opens_at": [{ id: "window_unparseable", severity: "blocking" }],
  "timing.latest_start_at": [{ id: "latest_start_outside_window", severity: "blocking" }],
  "access.access_code": [{ id: "access_code_missing", severity: "blocking" }],
  "release.at": [{ id: "release_at_missing", severity: "blocking" }],
  sections: [{ id: "duplicate_ids", severity: "blocking", message: /used more than once/ }],
};

/** The row an issue becomes. The fallback is deliberate and deliberately
 * blocking; see `ISSUE_ROWS`. */
function mapIssue(issue: ImportIssue, sections: readonly StoredSection[]): ChecklistRow {
  const candidates = ISSUE_ROWS[issue.field] ?? [];
  const match = candidates.find((row) => row.message === undefined || row.message.test(issue.message));
  const sectionId = sections[issue.index]?.id;
  return {
    id: match?.id ?? "invalid",
    severity: match?.severity ?? "blocking",
    message: issue.message,
    field: issue.field,
    ...(sectionId !== undefined && { sectionId }),
  };
}

/** True when the section's source draws no question at all — UX-13's
 * emptiness, in each of the three source shapes. A `pool` cannot be empty
 * this way: `schemas/test-1.json` puts `minimum: 1` on `count` and
 * `draftSchema()` strips only `minItems`/`minLength`, so the save gate
 * still enforces it. */
function drawsNothing(section: StoredSection): boolean {
  const source = section.source;
  if (source.kind === "fixed") return source.questions.length === 0;
  if (source.kind === "sets") {
    return source.sets.length === 0 || source.sets.some((set) => set.questions.length === 0);
  }
  return false;
}

/** How long ago, in whole days, rounded up so "closed 3 hours ago" reads as
 * 1 day rather than 0. */
function daysAgo(then: number, now: number): number {
  return Math.max(1, Math.ceil((now - then) / DAY_MS));
}

function instant(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function buildChecklist(input: ChecklistInput): ChecklistRow[] {
  const { body, now } = input;
  const { settings, sections } = body;
  const rows: ChecklistRow[] = [];

  // The root `required` floors, which `draftSchema()` drops wholesale
  // because `settings` is not a whole document. Import runs the unstripped
  // schema and so still refuses both; publish had nothing at all.
  if (settings.timing === undefined) {
    rows.push({
      id: "timing_missing",
      severity: "blocking",
      field: "timing.duration_minutes",
      message: "this test has no duration — a candidate would have unlimited time",
    });
  }
  if (sections.length === 0) {
    rows.push({
      id: "no_sections",
      severity: "blocking",
      field: "sections",
      message: "this test has no sections, so there is nothing for a candidate to answer",
    });
  }

  for (const section of sections) {
    if (section.title.trim() === "") {
      rows.push({
        id: "section_untitled",
        severity: "blocking",
        field: "section.title",
        sectionId: section.id,
        message: `section "${section.id}" has no title, so it has no name on the candidate's screen`,
      });
    }
    if (drawsNothing(section)) {
      rows.push({
        id: "section_empty",
        severity: "blocking",
        field: "section.source",
        sectionId: section.id,
        message: `section "${section.title.trim() || section.id}" has no questions`,
      });
    }
    // The `SourcePool.bank` ruling: optional in the schema (making it
    // required is a `@2` break), forbidden at publish instead. A bankless
    // pool draws from the whole workspace, which is never what an
    // organiser meant and is why the builder's pool editor has no empty
    // option either.
    if (section.source.kind === "pool" && section.source.bank === undefined) {
      rows.push({
        id: "pool_no_bank",
        severity: "blocking",
        field: "section.source.bank",
        sectionId: section.id,
        message: `pool section "${section.title.trim() || section.id}" names no bank`,
      });
    }
  }

  // UX-17's "the availability window is in the future". Not a
  // `validateTest` rule, and cannot be: that package is pure and takes no
  // clock, which is exactly why `now` is a parameter here.
  const closes = instant(settings.timing?.closes_at);
  if (closes !== null && closes <= now) {
    rows.push({
      id: "window_past",
      severity: "blocking",
      field: "timing.closes_at",
      message: `the window closed ${daysAgo(closes, now)} day(s) ago — nobody could start this test`,
    });
  }

  // The document `validateTest` checks. Built here rather than through
  // `toTestDocument` (packages/db/src/repo/test-document.ts) precisely
  // because no id is translated: `input.questions` are keyed by row id, so
  // the stored sections go in as they are.
  //
  // **No `setPointsTolerance` option** (Task 13's recorded trap). The
  // precedence in `validate.ts` is
  // `options.setPointsTolerance ?? doc.scoring.set_points_tolerance ?? 0`,
  // and it overrides in *either* direction — so passing the
  // apparently-harmless `{ setPointsTolerance: 0 }` would silently discard
  // a tolerance the test file set. Pass nothing unless this gate is
  // deliberately stricter than the file, which it is not.
  const doc = {
    format: "pariksha/test@1",
    name: input.test.name,
    slug: input.test.slug,
    ...settings,
    sections,
  } as unknown as Test;

  const result = validateTest(doc, input.questions);
  if (!result.ok) {
    for (const issue of result.issues) rows.push(mapIssue(issue, sections));
  }

  return rows;
}

/** The gate itself: publishing is refused when this is non-empty. */
export function blockingRows(rows: readonly ChecklistRow[]): ChecklistRow[] {
  return rows.filter((row) => row.severity === "blocking");
}
