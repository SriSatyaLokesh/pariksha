// Mirrors schemas/question-1.json and schemas/bank-1.json exactly: same field
// names, same optionality. See docs/question-format.md for the prose spec.

import type { ProctoringOverrides, ProctoringProfile } from "./proctoring.js";

export const QUESTION_TYPES = [
  "single",
  "multiple",
  "select_k",
  "true_false",
  "assertion_reason",
  "matching",
  "multi_matching",
  "ordering",
  "fill_blank",
  "numeric",
  "short_answer",
  "long_answer",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const SCORING_MODES = ["all_or_nothing", "partial", "negative", "position", "rubric"] as const;

export type ScoringMode = (typeof SCORING_MODES)[number];

export type Difficulty = "easy" | "medium" | "hard";

export interface ScoringConfig {
  mode?: ScoringMode;
  points?: number;
  negative_fraction?: number;
}

export interface QuestionOption {
  id: string;
  text: string;
  pinned?: boolean;
}

export interface Blank {
  id: string;
  accepted: string[];
  match?: "exact" | "case_insensitive" | "regex";
}

export interface NumericKey {
  value: number;
  tolerance?: number;
  tolerance_type?: "absolute" | "percent";
}

export interface RubricLevel {
  level: string;
  points: number;
  description?: string;
}

export interface Media {
  kind: "image";
  src: string;
  alt: string;
}

export interface PassageGroup {
  id: string;
  title?: string;
  passage: string;
}

/** Fields shared by every question type. */
export interface QuestionBase {
  "$schema"?: string;
  id: string;
  prompt: string;
  media?: Media[];
  group?: string;
  difficulty?: Difficulty;
  tags?: string[];
  scoring?: ScoringConfig;
  explanation?: string;
  shuffle_options?: boolean;
}

export type AssertionReasonKey =
  | "both_true_explains"
  | "both_true_not_explains"
  | "a_true_r_false"
  | "a_false_r_true";

export interface SingleQuestion extends QuestionBase {
  type: "single";
  options: QuestionOption[];
  key: string;
}

export interface MultipleQuestion extends QuestionBase {
  type: "multiple";
  options: QuestionOption[];
  key: string[];
}

export interface SelectKQuestion extends QuestionBase {
  type: "select_k";
  options: QuestionOption[];
  k: number;
  key: string[];
}

export interface TrueFalseQuestion extends QuestionBase {
  type: "true_false";
  key: boolean;
}

export interface AssertionReasonQuestion extends QuestionBase {
  type: "assertion_reason";
  assertion: string;
  reason: string;
  key: AssertionReasonKey;
}

export interface MatchingQuestion extends QuestionBase {
  type: "matching";
  left: string[];
  right: string[];
  key: Record<string, string>;
}

export interface MultiMatchingQuestion extends QuestionBase {
  type: "multi_matching";
  left: string[];
  right: string[];
  key: Record<string, string[]>;
}

export interface OrderingQuestion extends QuestionBase {
  type: "ordering";
  items: string[];
}

export interface FillBlankQuestion extends QuestionBase {
  type: "fill_blank";
  blanks: Blank[];
}

export interface NumericQuestion extends QuestionBase {
  type: "numeric";
  unit?: string;
  key: NumericKey;
}

export interface ShortAnswerQuestion extends QuestionBase {
  type: "short_answer";
  max_length?: number;
  model_answer?: string;
  rubric?: RubricLevel[];
}

export interface LongAnswerQuestion extends QuestionBase {
  type: "long_answer";
  max_length?: number;
  rubric?: RubricLevel[];
}

export type Question =
  | SingleQuestion
  | MultipleQuestion
  | SelectKQuestion
  | TrueFalseQuestion
  | AssertionReasonQuestion
  | MatchingQuestion
  | MultiMatchingQuestion
  | OrderingQuestion
  | FillBlankQuestion
  | NumericQuestion
  | ShortAnswerQuestion
  | LongAnswerQuestion;

export interface Bank {
  "$schema"?: string;
  format: "pariksha/bank@1";
  name: string;
  description?: string;
  license?: string;
  groups?: PassageGroup[];
  questions: Question[];
}

// Test-format types, mirroring schemas/test-1.json's `$defs/section`,
// `sourceFixed`, `sourcePool`, `sourceSets`, `scoring`, `access`,
// `release`, `form`, `formField` and `validation` exactly.
// `registration_form` was the first to be claimed, by Task 5 (#57, P5.4);
// `timing` by Task 7 (#59, P5.6), `branding` by Task 10 (#61, P5.8),
// `proctoring` by Phase 7a Task 4 — `resolveProctoring` (`@pariksha/core`)
// is the one reader every Phase 7 screen resolves it through (`Q1`) — and
// `retention` by Phase 8a Task 5 (`K28`): `resolveRetention` (`cost.ts`)
// applies S-13's defaults the same way.

export interface SourceFixed {
  kind: "fixed";
  questions: string[];
}

export interface PoolFilter {
  tags?: string[];
  difficulty?: Difficulty[];
  types?: string[];
}

export interface SourcePool {
  kind: "pool";
  bank?: string;
  count: number;
  filter?: PoolFilter;
}

export interface SetDefinition {
  set: string;
  questions: string[];
}

export type SetAssignment = "round_robin" | "random" | "hash" | "from_candidate_list";

export interface SourceSets {
  kind: "sets";
  assignment?: SetAssignment;
  sets: SetDefinition[];
}

export type QuestionSource = SourceFixed | SourcePool | SourceSets;

export interface Section {
  id: string;
  title: string;
  instructions?: string;
  time_limit_minutes?: number;
  shuffle_questions?: boolean;
  source: QuestionSource;
}

/** The test's `scoring` block: the defaults a question may override. */
export interface TestScoring {
  default_mode?: ScoringMode;
  negative_fraction?: number;
  pass_mark_percent?: number;
  /**
   * Task 4 (#56, P5.3). How far two sets of one `sets` source may differ in
   * total points before T-11 reports it, in points. Default 0 — any
   * difference at all is reported. It lives in the document, not only in
   * `validateTest`'s options, so an organiser who accepted some drift still
   * has it accepted after the test is exported and imported elsewhere.
   */
  set_points_tolerance?: number;
}

/**
 * T-16 - T-18's registration form (Task 5, #57, P5.4). Mirrors
 * `schemas/test-1.json`'s `$defs/form`, `$defs/formField` and
 * `$defs/validation` exactly, with one correction to the plan's own
 * `Interfaces` block: `link_text` and `link_target` are properties of the
 * *field* in the schema (`$defs/formField`), not of `validation` — and
 * `$defs/validation` carries `additionalProperties: false`, so modelling
 * them there would have made every consent field a 422 on save.
 */
export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "date",
  "dropdown",
  "radio",
  "checkbox",
  "url",
  "consent",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Only the keys that suit the field's type are used; the rest are ignored
 * (the schema says the same, in its own `description`). */
export interface FieldValidation {
  min_length?: number;
  max_length?: number;
  /** RE2-safe regular expression, checked on the server. */
  pattern?: string;
  /** Shown when the pattern fails. Say what the right format looks like. */
  pattern_message?: string;
  /** A number for `number`, an ISO date string for `date`. */
  min?: number | string;
  max?: number | string;
  integer?: boolean;
  decimals?: number;
  /** Glob patterns, for `email` and `url` fields. */
  allowed_domains?: string[];
  /** `phone` only: ISO 3166-1 alpha-2, e.g. IN. */
  default_country?: string;
  /** `url` only: flag the value if the link does not return HTTP 200
   * (T-19). The check itself is Task 6; the candidate half is Phase 6. */
  check_reachable?: boolean;
}

export interface FormField {
  /** Column name in the results CSV (`^[a-z0-9_]{1,40}$`). */
  id: string;
  type: FormFieldType;
  label: string;
  help?: string;
  required?: boolean;
  /** A second registration with the same value is refused. */
  unique?: boolean;
  /** Required for `dropdown`, `radio` and `checkbox`. */
  options?: string[];
  /** `consent` only: the words that open the consent text. */
  link_text?: string;
  /** `consent` only: `"consent"` for the test's own consent text, or a URL. */
  link_target?: string;
  validation?: FieldValidation;
}

/** Named `...Spec`, not `...Form`, so this type and the React component of
 * the same job (`apps/web/src/components/testbuilder/RegistrationForm.tsx`)
 * do not share a name across two packages. */
export interface RegistrationFormSpec {
  title?: string;
  description?: string;
  fields: FormField[];
}

export type NavigationMode = "free" | "linear" | "per_section";
export type CountedAttempt = "highest" | "latest" | "average";

/**
 * T-12 - T-15's `timing` block (Task 7, #59, P5.6). Mirrors
 * `schemas/test-1.json`'s `$defs/timing` exactly: `duration_minutes` is the
 * only member the schema requires, and every other field has a documented
 * default in `docs/test-format.md` § `timing` and is omitted until set.
 *
 * Timestamps are RFC 3339 strings with an offset, as the schema's
 * `format: date-time` says. `timezone` is the IANA zone every time shown to
 * a *candidate* is rendered in; it is not redundant with the offsets,
 * because an offset cannot say which zone it came from or what happens
 * across a DST boundary.
 */
export interface TestTiming {
  timezone?: string;
  opens_at?: string;
  closes_at?: string;
  latest_start_at?: string;
  duration_minutes: number;
  navigation?: NavigationMode;
  attempts_allowed?: number;
  cooldown_minutes?: number;
  counted_attempt?: CountedAttempt;
  warn_at_minutes?: number[];
  late_sync_grace_seconds?: number;
}

/** What each navigation mode means for the candidate, in one sentence
 * (#59 asks for this copy by name). Lives here, not in the panel, because
 * Task 13's publish checklist states the same consequence as the builder
 * does rather than wording it a second way. */
export const NAVIGATION_CONSEQUENCE: Readonly<Record<NavigationMode, string>> = {
  free: "A candidate can jump to any question at any time.",
  linear: "A candidate cannot go back to an earlier question.",
  per_section: "Free inside a section; a section is locked once the candidate leaves it.",
};

/**
 * What the server refuses a locked question with, and what the browser
 * tells a candidate a locked square means. One sentence per mode,
 * **here**, because the two had been written out by hand on both sides
 * and had already drifted on `per_section` — the browser's copy had
 * grown a "This section is closed." the server's never had, so the same
 * rule had two wordings depending on which half of the product said it.
 * That is the drift `CONSENT_REQUIRED_MESSAGE` was moved here to stop.
 *
 * `free` has no entry because nothing is ever locked under it, and an
 * entry would be a sentence no code path can reach.
 */
export const NAVIGATION_LOCKED_MESSAGE: Readonly<
  Record<Exclude<NavigationMode, "free">, string>
> = {
  linear: "This test does not allow going back to an earlier question.",
  per_section: "This test does not allow going back to a section you have already left.",
};

export type AccessMode = "link_code" | "invite_only" | "email_code" | "sso";

export interface TestAccess {
  mode: AccessMode;
  access_code?: string;
  candidate_list?: string;
  allow_email_domains?: string[];
  allow_ip_ranges?: string[];
  captcha?: boolean;
}

export type ReleaseWhen = "never" | "on_submit" | "on_date";
export type ReleaseShow = "score_only" | "score_and_sections" | "full_review";

export interface TestRelease {
  when: ReleaseWhen;
  /** Required when `when` is `on_date`. */
  at?: string;
  show?: ReleaseShow;
}

/**
 * T-23's `branding` (Task 10, #61, P5.8). Mirrors
 * `schemas/test-1.json`'s root `branding` object exactly.
 *
 * One type, two homes, which is the PRD's own split (T-23) and is what
 * keeps an Author out of workspace settings: `logo`, `primary_colour` and
 * `footer_text` are **per workspace** and live in `workspace.branding_json`
 * behind `workspace.settings`; `start_message` and `finish_message` are
 * **per test** and live in the draft's `settings.branding` behind
 * `tests.edit`.
 */
export interface TestBranding {
  /** A media key from `POST .../banks/:bankId/media`, not a URL. */
  logo?: string;
  /** What a screen reader says in place of `logo`. Collected beside the
   * file and stored with it: an unlabelled institution logo is how a
   * candidate using a screen reader meets the test, and nothing later in
   * the product asks for this again. */
  logo_alt?: string;
  /** `#rrggbb`. Refused at the write below 4.5:1 against `CREAM`. */
  primary_colour?: string;
  footer_text?: string;
  start_message?: string;
  finish_message?: string;
}

/** What each release timing means for the candidate, in one sentence.
 * Beside `NAVIGATION_CONSEQUENCE` and for the same reason: the builder and
 * Task 13's checklist state the consequence once, not twice. */
export const RELEASE_CONSEQUENCE: Readonly<Record<ReleaseWhen, string>> = {
  never: "Candidates never see a score.",
  on_submit: "Candidates see their result on the finish page, as soon as they submit.",
  on_date: "Candidates see nothing until the date you choose, then their result appears.",
};

export const SHOW_CONSEQUENCE: Readonly<Record<ReleaseShow, string>> = {
  score_only: "The total and whether they passed.",
  score_and_sections: "The total, whether they passed, and each section's score.",
  full_review: "All of that, plus the correct answers and the explanations — use it only once the test has closed for everyone.",
};

/** `K28`: S-13's deletion schedule. Both fields are days, both optional —
 *  `resolveRetention` (`cost.ts`) is the one reader that applies the
 *  defaults (snapshots 90 days, personal data and answers 12 months) when
 *  either, or both, are unset. Mirrors `schemas/test-1.json`'s `retention`
 *  exactly. */
export interface TestRetention {
  personal_data_days?: number;
  snapshots_days?: number;
}

export interface Test {
  "$schema"?: string;
  format: "pariksha/test@1";
  name: string;
  slug: string;
  description?: string;
  tags?: string[];
  license?: string;
  /** Bank files this test draws from, relative to the test file. */
  banks?: string[];
  /**
   * Task 7 (#59, P5.6) deliberately left this **optional**, against the
   * plan's own `Interfaces` block and against `schemas/test-1.json`'s root
   * `required`, which names it.
   *
   * A `Test` value is not only a finished document: `TestSettings`
   * (`packages/db/src/repo/test-document.ts`) is `Omit<Test, …>` and is
   * what a *draft* stores, and `createTest` seeds a draft with `{}`. The
   * save-time gate (`draftSchema`, `apps/api/src/routes/tests.ts`) already
   * drops the root `required` for exactly that reason, so a required
   * `timing` here would be a type that storage can and does violate — and
   * would have forced an invented duration into `toTestVersionRow`,
   * `toTestDocument`'s spread, `createTest`'s seed and every fixture in
   * `packages/core/test/validate.test.ts`.
   *
   * Presence is enforced where the document really is whole: the schema's
   * root `required` on import, and the publish checklist (Task 13).
   */
  timing?: TestTiming;
  scoring?: TestScoring;
  access?: TestAccess;
  registration_form?: RegistrationFormSpec;
  release?: TestRelease;
  branding?: TestBranding;
  /** `K28`: S-13's deletion schedule. See `resolveRetention` (`cost.ts`)
   *  for the defaults applied when either field is unset. */
  retention?: TestRetention;
  consent?: TestConsent;
  /** `Q1`: `profile` supplies defaults for `overrides`'s fifteen keys and
   *  has no independent effect of its own — `resolveProctoring` is the one
   *  reader every candidate-facing screen resolves this through. */
  proctoring?: { profile?: ProctoringProfile; overrides?: ProctoringOverrides };
  sections: Section[];
}

/**
 * S-12's consent screen. Phase 5 builds no editor for it and the block
 * round-trips untouched, so it is modelled here only because the publish
 * checklist now has a row for it: `draftSchema()` strips `text`'s
 * `minLength: 1` with every other emptiness floor, and a published test
 * with blank consent text records consent to nothing against a live
 * `candidate.consent_version` column (whole-branch security review, L1).
 */
export interface TestConsent {
  /** Stored per candidate, so a later edit is distinguishable. */
  version: string;
  /** Markdown shown before registration. */
  text: string;
}

export type ResponseValue =
  | { kind: "option"; option: string }
  | { kind: "options"; options: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "map"; pairs: Record<string, string> }
  | { kind: "multimap"; pairs: Record<string, string[]> }
  | { kind: "order"; items: string[] }
  | { kind: "blanks"; values: Record<string, string> }
  | { kind: "number"; value: number }
  | { kind: "text"; text: string };
