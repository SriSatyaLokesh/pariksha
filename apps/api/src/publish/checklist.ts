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

import { describeAllowlists, validateTest, type ImportIssue, type Question, type Test } from "@pariksha/core";
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
  /**
   * Task 13 (#64, P5.11): the candidate list's two numbers, from
   * `countCandidates` (`@pariksha/db`) — one query for both, never one per
   * candidate. Advisory wherever they appear: the list is test-level data
   * publish does not pin, and for `invite_only` uploading the roster after
   * publishing is the ordinary order of work.
   */
  candidates: { total: number; withoutSet: number };
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

  // Task 13's two advisory rows. `T-11` says the builder *warns* on both,
  // while `docs/test-format.md` § "Rules checked on import" says "Import
  // is stricter: it refuses the file for either, because an imported file
  // is one an author can still edit" — which is exactly why these are the
  // same `validateTest` issues wearing a different severity rather than a
  // second set of rules: the numbers an organiser reads here and the
  // numbers an import would refuse over are the same numbers.
  "source.count": [{ id: "pool_short", severity: "advisory" }],
  "source.sets": [{ id: "sets_unbalanced", severity: "advisory", message: /unequal total points/ }],
};

/** `scoring.set_points_tolerance` is schema-legal, type-safe and has **no
 * UI control** — Task 4 shipped it as schema, type and `validateTest`
 * only. So the row has to say in its own copy that the knob is in the file,
 * or an organiser meets a permanently red advisory over a legitimate
 * one-point drift with nothing on the screen to change. */
const TOLERANCE_NOTE =
  " — the tolerance is `scoring.set_points_tolerance` in the test file; the builder has no control for it";

/** The row an issue becomes. The fallback is deliberate and deliberately
 * blocking; see `ISSUE_ROWS`. */
function mapIssue(issue: ImportIssue, sections: readonly StoredSection[]): ChecklistRow {
  const candidates = ISSUE_ROWS[issue.field] ?? [];
  const match = candidates.find((row) => row.message === undefined || row.message.test(issue.message));
  const sectionId = sections[issue.index]?.id;
  return {
    id: match?.id ?? "invalid",
    severity: match?.severity ?? "blocking",
    message: match?.id === "sets_unbalanced" ? issue.message + TOLERANCE_NOTE : issue.message,
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
  //
  // #179 asks the row about the duration rather than about the block: a
  // `timing` that is present and says nothing, or says zero, is the same
  // 0-minute test to a candidate (`run.ts` reads `duration_minutes ?? 0`).
  // Those two shapes do not in fact reach here today — `draftSchema()`
  // drops only the *root* `required`, so `$defs/timing`'s own
  // `required: ["duration_minutes"]` and its `minimum: 1` both survive into
  // the save-time validator and the draft route refuses the body outright
  // (`apps/api/test/lifecycle.test.ts` asserts that refusal). The row is
  // written against the duration anyway because this is the gate: it judges
  // a *stored* body and must not depend on which writer produced it, which
  // is the same reason `mapIssue`'s fallback is blocking.
  if ((settings.timing?.duration_minutes ?? 0) < 1) {
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
  } else if (sections.every(drawsNothing)) {
    // The other half of #179: sections exist, so `no_sections` stays quiet,
    // but between them they put nothing in front of a candidate. Each one
    // also gets its own `section_empty` below; this is the test-level
    // statement of the same fact, and the row an organiser needs when the
    // answer is "add a question somewhere", not "fix section 3".
    rows.push({
      id: "no_questions",
      severity: "blocking",
      field: "sections",
      message: "every section is empty, so there is nothing for a candidate to answer",
    });
  }

  // `$defs/consent.text`'s `minLength: 1`, which `draftSchema()` strips
  // with every other emptiness floor. The pin called it "unreachable: only
  // a hand-written PATCH can blank it" — a hand-written PATCH *is* the
  // route the gate guards, and publish had no opinion at all, so publish
  // was laxer than export (which runs the unstripped schema and 422s
  // `not_exportable` over a block the builder has no editor for). S-12
  // wants a consent screen whose text says what is collected, with the
  // version and the time stored per candidate; `candidate.consent_version`
  // is a live column, so a published test with blank consent text records
  // consent to nothing (whole-branch security review, L1).
  if (settings.consent !== undefined && settings.consent.text.trim() === "") {
    rows.push({
      id: "consent_blank",
      severity: "blocking",
      field: "consent.text",
      message: "the consent screen has no text, so a candidate would be agreeing to nothing",
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

  // #59's second half: "on blur **and again at the publish checklist**".
  // The builder's blur nag landed (`TimingPanel.tsx:297-306`) and this did
  // not; the whole-branch spec review found the shortfall recorded nowhere
  // (Minor 1). **Advisory, not blocking** — publishing a test that is
  // already open is ordinary work and a refusal would be wrong; the row
  // exists so an organiser who typed last year's date is told, with the
  // consequence that makes it matter, before candidates arrive.
  const opens = instant(settings.timing?.opens_at);
  if (opens !== null && opens <= now && (closes === null || closes > now)) {
    rows.push({
      id: "window_open_already",
      severity: "advisory",
      field: "timing.opens_at",
      message: `the window opened ${daysAgo(opens, now)} day(s) ago, so this test is open the moment it is published`,
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

  rows.push(...advisoryRows(input));
  return rows;
}

/** The gate itself: publishing is refused when this is non-empty. */
export function blockingRows(rows: readonly ChecklistRow[]): ChecklistRow[] {
  return rows.filter((row) => row.severity === "blocking");
}

/**
 * Task 13 (#64, P5.11): the advisory rows `validateTest` has no opinion
 * about — the registration form's uniqueness, the allowlists and the
 * candidate list. Advisory because nothing here is pinned by publishing:
 * an organiser uploads the roster after publishing, and a form with no
 * unique field is a deliberate choice as often as an oversight.
 */
function advisoryRows(input: ChecklistInput): ChecklistRow[] {
  const { settings, sections } = input.body;
  const rows: ChecklistRow[] = [];

  // UX-17: "the registration form has at least one unique field if repeat
  // registration is to be blocked". Only when there is a form at all — a
  // test with no registration form is not collecting anything to be unique.
  const fields = settings.registration_form?.fields ?? [];
  if (fields.length > 0 && !fields.some((field) => field.unique === true)) {
    rows.push({
      id: "no_unique_field",
      severity: "advisory",
      field: "registration_form.fields",
      message: "no registration field is unique, so a candidate can register twice",
    });
  }

  // An allowlist key that is present and empty. The panel leaves one
  // behind when the last entry is deleted, it renders as a restriction
  // section with nothing in it, and it restricts nobody — which is the
  // opposite of what the organiser who typed the first entry meant.
  const access = settings.access;
  if (access !== undefined) {
    const empty = [
      ["email-domain", access.allow_email_domains],
      ["network-range", access.allow_ip_ranges],
    ].filter(([, list]) => Array.isArray(list) && list.length === 0);
    if (empty.length > 0) {
      rows.push({
        id: "allowlist_empty",
        severity: "advisory",
        field: "access.allow_email_domains",
        message: `${describeAllowlists(access)} The ${empty
          .map(([kind]) => kind as string)
          .join(" and ")} allowlist is set but empty, so it restricts nobody.`,
      });
    }
  }

  // Shown only when something actually depends on the list — otherwise it
  // is a row about a feature this test does not use.
  const needsList =
    access?.mode === "invite_only" ||
    sections.some((s) => s.source.kind === "sets" && s.source.assignment === "from_candidate_list");
  if (needsList && input.candidates.total === 0) {
    rows.push({
      id: "candidate_list_empty",
      severity: "advisory",
      field: "access.candidate_list",
      message: "the candidate list has no rows, so nobody can enter yet",
    });
  }

  // #56's acceptance. Only meaningful where a section actually assigns from
  // the list — a candidate with no set cannot start *that* test.
  const assignsFromList = sections.some(
    (s) => s.source.kind === "sets" && s.source.assignment === "from_candidate_list",
  );
  if (assignsFromList && input.candidates.withoutSet > 0) {
    rows.push({
      id: "candidate_no_set",
      severity: "advisory",
      field: "access.candidate_list",
      message: `${input.candidates.withoutSet} of ${input.candidates.total} candidates have no set, and cannot start`,
    });
  }

  return rows;
}
