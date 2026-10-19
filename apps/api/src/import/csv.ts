// CSV import (#52, P4.8). A converter never validates — it builds
// `pariksha/bank@1` and reports only what it could not parse at all (an
// unsupported `type`, a row with the wrong column count). Everything else —
// a key naming a real option, a `fill_blank` placeholder agreeing with its
// blanks — is `validateBank`'s job, run once by the route against the bank
// this file hands it, the same pass a JSON import goes through. That is the
// point of Review Focus item 4: the same defect reports the same message
// whichever format it arrived in.
//
// One CSV row is one question. The first row is always a header and is
// never read for its contents — only skipped — so `lines[i]` (the source
// line that produced `bank.questions[i]`) is always `i + 2`.
//
// Column grammar (docs/question-format.md has the prose spec):
//   - `options`: option texts, `|`-separated. An option's own text is its
//     id — there is no separate id column, so a `key` names an option by
//     the exact text in `options`.
//   - `key`, by `type`:
//     - single: the correct option's text.
//     - multiple: correct option texts, `+`-separated.
//     - true_false: `true` or `false`.
//     - numeric: `value`, `value:tolerance`, or `value:tolerance:type`
//       (`type` is `absolute` or `percent`).
//     - fill_blank: blanks, `|`-separated, each `id:answer+answer`, where
//       `id` matches a `{{id}}` placeholder in `prompt`.
//   - `tags`: `|`-separated.

import type { Bank, Difficulty, ImportIssue, Question, QuestionOption, ScoringMode } from "@pariksha/core";
import { readDelimited } from "./rows.js";

export const CSV_TYPES = ["single", "multiple", "true_false", "numeric", "fill_blank"] as const;
export type CsvType = (typeof CSV_TYPES)[number];

export const CSV_COLUMNS = [
  "id",
  "type",
  "prompt",
  "options",
  "key",
  "points",
  "mode",
  "difficulty",
  "tags",
  "explanation",
] as const;

export interface Converted {
  bank: Bank;
  /** `lines[i]` is the source line that produced `bank.questions[i]`. */
  lines: number[];
  /** Rows the converter could not turn into a question at all, each
   * already carrying the source line — never run through `lines`, because
   * these never reached `bank.questions`. */
  issues: (ImportIssue & { line: number })[];
}

function splitPipe(cell: string): string[] {
  return cell === "" ? [] : cell.split("|");
}

function splitPlus(cell: string): string[] {
  return cell === "" ? [] : cell.split("+");
}

function buildOptions(cell: string): QuestionOption[] {
  return splitPipe(cell).map((text) => ({ id: text, text }));
}

function buildQuestion(
  row: readonly string[],
  issue: (field: string, message: string) => void,
): Question | null {
  const [id = "", type, prompt = "", options = "", key = "", points, mode, difficulty, tags, explanation] = row;

  const base = {
    id,
    prompt,
    ...(difficulty ? { difficulty: difficulty as Difficulty } : {}),
    ...(tags ? { tags: splitPipe(tags) } : {}),
    ...(explanation ? { explanation } : {}),
    ...(points || mode
      ? {
          scoring: {
            ...(points ? { points: Number(points) } : {}),
            ...(mode ? { mode: mode as ScoringMode } : {}),
          },
        }
      : {}),
  };

  switch (type as CsvType) {
    case "single":
      return { ...base, type: "single", options: buildOptions(options), key };
    case "multiple":
      return { ...base, type: "multiple", options: buildOptions(options), key: splitPlus(key) };
    case "true_false":
      return { ...base, type: "true_false", key: key === "true" };
    case "numeric": {
      const [value, tolerance, toleranceType] = key.split(":");
      return {
        ...base,
        type: "numeric",
        key: {
          value: Number(value),
          ...(tolerance !== undefined && tolerance !== "" ? { tolerance: Number(tolerance) } : {}),
          ...(toleranceType ? { tolerance_type: toleranceType as "absolute" | "percent" } : {}),
        },
      };
    }
    case "fill_blank": {
      const blanks = splitPipe(key).map((entry) => {
        const [blankId, accepted = ""] = entry.split(":");
        return { id: blankId ?? "", accepted: splitPlus(accepted) };
      });
      return { ...base, type: "fill_blank", blanks };
    }
    default:
      issue("type", `CSV import supports ${CSV_TYPES.join(", ")}; got "${type}"`);
      return null;
  }
}

export function convertCsv(text: string): Converted {
  const rows = readDelimited(text).slice(1); // the header row is never read, only skipped
  const bank: Bank = { format: "pariksha/bank@1", name: "Imported bank", questions: [] };
  const lines: number[] = [];
  const issues: (ImportIssue & { line: number })[] = [];

  rows.forEach((row, i) => {
    const line = i + 2; // `+2`: a 1-indexed header row, then this row.
    if (row.length !== CSV_COLUMNS.length) {
      issues.push({
        questionId: null,
        index: -1,
        field: "columns",
        message: `expected ${CSV_COLUMNS.length} columns, got ${row.length}`,
        line,
      });
      return;
    }

    const question = buildQuestion(row, (field, message) => {
      issues.push({ questionId: row[0] || null, index: -1, field, message, line });
    });
    if (question !== null) {
      bank.questions.push(question);
      lines.push(line);
    }
  });

  return { bank, lines, issues };
}
