/**
 * Plugin interfaces for Pariksha extensibility (PRD O-06).
 * Enables custom question types, proctoring signals, and export targets.
 */

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface QuestionScoreResult {
  points: number;
  earned: number;
  state: "correct" | "partially_correct" | "wrong" | "unanswered";
}

/**
 * Custom Question Type Plugin.
 * Defines renderer schema, option validation, and scoring logic.
 */
export interface QuestionPlugin<TConfig = unknown, TResponse = unknown> {
  type: string;
  validateConfig(config: unknown): ValidationResult;
  validateResponse(response: unknown, config: TConfig): ValidationResult;
  score(
    question: { config: TConfig },
    response: TResponse | null | undefined,
  ): QuestionScoreResult;
}

/**
 * Custom Proctoring Signal Plugin.
 * Evaluates custom client events into severity and penalty points.
 */
export interface ProctoringSignalPlugin {
  name: string;
  evaluate(event: {
    type: string;
    payload: unknown;
  }): {
    severity: "info" | "warning" | "violation";
    penalty: number;
  };
}

/**
 * Custom Export Target Plugin.
 * Converts tests, banks, or attempt results into external LMS/assessment formats.
 */
export interface ExportTargetPlugin {
  format: string;
  mimeType: string;
  fileExtension: string;
  transform(document: unknown): Promise<string | Uint8Array> | string | Uint8Array;
}
