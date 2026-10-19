// CSV import (#52, P4.8). A converter never validates — it builds
// `pariksha/bank@1` and reports only what it could not parse at all (an
// unsupported `type`, a row with the wrong column count, a cell that is not
// legal in its own grammar). Everything else — a key naming a real option, a
// `fill_blank` placeholder agreeing with its blanks — is `validateBank`'s
// job, run once by the route against the bank this file hands it, the same
// pass a JSON import goes through. That is the point of Review Focus item
// 4: the same defect reports the same message whichever format it arrived
// in.
//
// One CSV row is one question. The first row must be the exact header below
// (fix round 1, finding 11) and is never read for its own content, only
// checked and skipped. `lines[i]` (the source line that produced
// `bank.questions[i]`) comes from `readDelimitedRows`, not `rowIndex + 2`
// (fix round 1, finding 3) — a quoted field with an embedded newline makes
// one CSV row span more than one physical line, which arithmetic on the row
// index alone cannot see.
//
// Column grammar (docs/question-format.md has the prose spec):
//   - `options`: option texts, `|`-separated. An option's own text is its
//     id — there is no separate id column, so a `key` names an option by
//     the exact text in `options`.
//   - `key`, by `type`:
//     - single: the correct option's text.
//     - multiple: correct option texts, `+`-separated.
//     - true_false: exactly `true` or `false`.
//     - numeric: `value`, `value:tolerance`, or `value:tolerance:type`
//       (`type` is `absolute` or `percent`), `value`/`tolerance` each a
//       number this grammar can parse.
//     - fill_blank: blanks, `|`-separated, each `id:answer+answer`, where
//       `id` matches a `{{id}}` placeholder in `prompt`.
//   - `tags`: `|`-separated.
//   - `points`: a number, when given at all.
//
// Fix round 1, finding 1: a cell that does not fit its own grammar (`TRUE`
// for a `true_false` key — Excel's own autoformat of `true` — a blank or
// non-numeric `numeric` key, a non-numeric `points`) used to fall through to
// a *plausible wrong answer* (`key === "true"` failing silently to `false`;
// `Number("")` succeeding as `0`; `Number("abc")` becoming `NaN`, which
// `JSON.stringify` turns into `null` with no issue reported anywhere
// downstream — neither `@cfworker/json-schema` nor `validateBank` rejects a
// NaN). Each is now exactly what this converter's own charter already
// covers — "reports only what it could not parse at all" — so each is an
// issue, and the row is dropped rather than imported with that one field
// wrong.

import type { Bank, Difficulty, ImportIssue, ImportIssueCode, Question, QuestionOption, ScoringMode } from "@pariksha/core";
import { parseFiniteNumber, readDelimitedRows, type Converted } from "./rows.js";

export type { Converted };

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

type Issue = (field: string, message: string, code: ImportIssueCode) => void;

function splitPipe(cell: string): string[] {
  return cell === "" ? [] : cell.split("|");
}

function splitPlus(cell: string): string[] {
  return cell === "" ? [] : cell.split("+");
}

function buildOptions(cell: string): QuestionOption[] {
  return splitPipe(cell).map((text) => ({ id: text, text }));
}

function buildQuestion(row: readonly string[], issue: Issue): Question | null {
  const [id = "", type, prompt = "", options = "", key = "", points, mode, difficulty, tags, explanation] = row;

  let scoringPoints: number | undefined;
  if (points !== undefined && points !== "") {
    const parsed = parseFiniteNumber(points);
    if (parsed === null) {
      issue("points", `could not parse "${points}" as a number`, "csv_unparseable_value");
      return null;
    }
    scoringPoints = parsed;
  }

  const base = {
    id,
    prompt,
    ...(difficulty ? { difficulty: difficulty as Difficulty } : {}),
    ...(tags ? { tags: splitPipe(tags) } : {}),
    ...(explanation ? { explanation } : {}),
    ...(scoringPoints !== undefined || mode
      ? {
          scoring: {
            ...(scoringPoints !== undefined ? { points: scoringPoints } : {}),
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
    case "true_false": {
      if (key !== "true" && key !== "false") {
        issue("key", `could not parse "${key}" as a true_false key (expected exactly "true" or "false")`, "csv_unparseable_value");
        return null;
      }
      return { ...base, type: "true_false", key: key === "true" };
    }
    case "numeric": {
      const [valueRaw = "", toleranceRaw, toleranceType] = key.split(":");
      const value = parseFiniteNumber(valueRaw);
      if (value === null) {
        issue("key", `could not parse "${valueRaw}" as a numeric value`, "csv_unparseable_value");
        return null;
      }
      let tolerance: number | undefined;
      if (toleranceRaw !== undefined && toleranceRaw !== "") {
        const parsed = parseFiniteNumber(toleranceRaw);
        if (parsed === null) {
          issue("key", `could not parse "${toleranceRaw}" as a numeric tolerance`, "csv_unparseable_value");
          return null;
        }
        tolerance = parsed;
      }
      return {
        ...base,
        type: "numeric",
        key: {
          value,
          ...(tolerance !== undefined ? { tolerance } : {}),
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
      issue("type", `CSV import supports ${CSV_TYPES.join(", ")}; got "${type}"`, "csv_unsupported_type");
      return null;
  }
}

function matchesHeader(fields: readonly string[]): boolean {
  return fields.length === CSV_COLUMNS.length && fields.every((f, i) => f === CSV_COLUMNS[i]);
}

export function convertCsv(text: string): Converted {
  const rows = readDelimitedRows(text);
  const bank: Bank = { format: "pariksha/bank@1", name: "Imported bank", questions: [] };
  const lines: number[] = [];
  const issues: (ImportIssue & { line: number })[] = [];

  // Fix round 1, finding 11: the header was previously never read, only
  // skipped — a file whose columns are reordered (or simply missing a
  // header) then has every value silently bound to the wrong field, with
  // only a coincidental `type` mismatch ever surfacing it. Checked once,
  // loudly, against the exact column list this converter actually reads.
  const header = rows[0];
  if (header === undefined || !matchesHeader(header.fields)) {
    issues.push({
      questionId: null,
      index: -1,
      field: "header",
      message:
        header === undefined
          ? "the file has no header row"
          : `expected the header "${CSV_COLUMNS.join(",")}"; got "${header.fields.join(",")}"`,
      line: header?.line ?? 1,
      code: "csv_header_mismatch",
    });
    return { bank, lines, issues };
  }

  for (const { fields, line } of rows.slice(1)) {
    if (fields.length !== CSV_COLUMNS.length) {
      issues.push({
        questionId: null,
        index: -1,
        field: "columns",
        message: `expected ${CSV_COLUMNS.length} columns, got ${fields.length}`,
        line,
        code: "csv_column_count",
      });
      continue;
    }

    const question = buildQuestion(fields, (field, message, code) => {
      issues.push({ questionId: fields[0] || null, index: -1, field, message, line, code });
    });
    if (question !== null) {
      bank.questions.push(question);
      lines.push(line);
    }
  }

  return { bank, lines, issues };
}
