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
