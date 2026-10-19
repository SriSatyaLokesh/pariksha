// Mirrors schemas/question-1.json and schemas/bank-1.json exactly: same field
// names, same optionality. See docs/question-format.md for the prose spec.

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
// `sourceFixed`, `sourcePool`, `sourceSets`, `scoring`, `access` and
// `release` exactly. Only what question selection and import validation
// need: `timing`, `consent`, `registration_form`, `proctoring`,
// `retention` and `branding` are required or optional in the schema but no
// rule in this package reads them, so they are not modelled here yet. Add
// each when a phase needs it.

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

export type AccessMode = "link_code" | "invite_only" | "email_code" | "sso";

export interface TestAccess {
  mode: AccessMode;
  access_code?: string;
  candidate_list?: string;
  allow_email_domains?: string[];
  allow_ip_ranges?: string[];
  captcha?: boolean;
}

export interface TestRelease {
  when: "never" | "on_submit" | "on_date";
  /** Required when `when` is `on_date`. */
  at?: string;
  show?: "score_only" | "score_and_sections" | "full_review";
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
  scoring?: TestScoring;
  access?: TestAccess;
  release?: TestRelease;
  sections: Section[];
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
