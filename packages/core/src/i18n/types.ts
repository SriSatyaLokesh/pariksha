export const SUPPORTED_LOCALES = ["en", "hi", "es", "ar"] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: LocaleCode = "en";

export interface TranslationDictionary {
  "exam.start": string;
  "exam.next": string;
  "exam.prev": string;
  "exam.clear": string;
  "exam.review": string;
  "exam.submit": string;
  "exam.submitting": string;
  "exam.confirm_submit": string;
  "exam.time_remaining": string;
  "exam.reconnecting": string;
  "exam.question_counter": string;
  "exam.section": string;
  "exam.points": string;
  "exam.saved": string;
  "exam.saving": string;
  "exam.offline": string;
  "exam.all_questions": string;
  "exam.unanswered": string;
  "exam.answered": string;
  "exam.flagged": string;
  "exam.finished_title": string;
  "exam.finished_message": string;
  "exam.result_code": string;
}

export type TranslationKey = keyof TranslationDictionary;

export type Translator = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;
