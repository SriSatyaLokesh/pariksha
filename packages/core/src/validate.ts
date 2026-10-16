// Cross-field import validation: the rules a JSON Schema cannot express.
// Structural checks ("is `prompt` a string", "is `type` one of the twelve")
// are Ajv's job against schemas/bank-1.json and schemas/question-1.json.
// This file assumes the document already passed that and checks only
// relationships *between* fields — option IDs a key names, option counts a
// `select_k` promises, placeholders a `fill_blank` prompt and its blanks
// must agree on, IDs and group references unique and resolvable within the
// bank, regex safety, and scoring-mode applicability.
//
// Import is all-or-nothing: every issue found is collected and returned,
// never only the first, so an author fixes their file once.
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

import type {
  Bank,
  Blank,
  PassageGroup,
  Question,
  QuestionOption,
} from "./types.js";
import { assertSafeRegex } from "./grade/text.js";
import { APPLICABLE_MODES } from "./grade/result.js";

export interface ImportIssue {
  /** The question's `id`, or null for an issue not about one specific question. */
  questionId: string | null;
  /**
   * The entry's position (0-based) in the array the issue is about —
   * `bank.questions` for every rule above, `bank.groups` for a malformed
   * group entry — or -1 when no question or group applies.
   */
  index: number;
  field: string;
  message: string;
}

type ValidationResult =
  { ok: true; bank: Bank } | { ok: false; issues: ImportIssue[] };

// An object, and not an array: `typeof [] === "object"`, so without this
// exclusion an array slips past as if it were a valid record with no
// fields — reporting success on input that is not a question/group at all,
// which is worse than throwing on it.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `{{id}}` placeholders in a fill_blank prompt. */
function placeholdersIn(prompt: string): Set<string> {
  const ids = new Set<string>();
  for (const m of prompt.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const id = m[1];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * Usable option IDs from an `options` array: a non-object element (one that
 * fails `isRecord`) is reported and skipped rather than dereferenced.
 */
function optionIds(
  options: readonly QuestionOption[],
  issue: (field: string, message: string) => void,
): Set<string> {
  const ids = new Set<string>();
  options.forEach((o, i) => {
    if (!isRecord(o)) {
      issue("options", `option at position ${i} is not an object`);
      return;
    }
    ids.add(o.id);
  });
  return ids;
}

/**
 * The usable (object-shaped) blanks from a `blanks` array: a non-object
 * element is reported and skipped rather than dereferenced.
 */
function usableBlanks(
  blanks: readonly Blank[],
  issue: (field: string, message: string) => void,
): Blank[] {
  const good: Blank[] = [];
  blanks.forEach((b, i) => {
    if (!isRecord(b)) {
      issue("blanks", `blank at position ${i} is not an object`);
      return;
    }
    good.push(b);
  });
  return good;
}

/**
 * Checks only cross-field relationships a JSON Schema cannot express.
 * Assumes `bank` already passed Ajv validation against the question/bank
 * schemas — the two checks below (that it's an object with a `questions`
 * array) exist only so this function degrades safely on malformed input
 * rather than reimplementing the schema's own structural checks.
 */
export function validateBank(bank: unknown): ValidationResult {
  if (!isRecord(bank) || !Array.isArray(bank.questions)) {
    return {
      ok: false,
      issues: [
        {
          questionId: null,
          index: -1,
          field: "questions",
          message: "bank.questions must be an array",
        },
      ],
    };
  }

  const rawQuestions = bank.questions as unknown[];
  const issues: ImportIssue[] = [];

  // `isRecord(bank)` and `Array.isArray(bank.questions/groups)` only tell us
  // the *containers* are shaped right — nothing about their elements. An
  // element that fails `isRecord` (null, a string, a number, a nested array)
  // is reported as its own issue rather than dereferenced and crashed on;
  // this is still not schema duplication, because a well-formed element's
  // *field types* are never checked here, only whether it is an object at
  // all.
  const groupIds = new Set<string>();
  if (Array.isArray(bank.groups)) {
    bank.groups.forEach((raw: unknown, index) => {
      if (!isRecord(raw)) {
        issues.push({
          questionId: null,
          index,
          field: "groups",
          message: `entry at index ${index} in groups is not a group object`,
        });
        return;
      }
      groupIds.add((raw as unknown as PassageGroup).id);
    });
  }

  const seenIds = new Set<string>();

  rawQuestions.forEach((raw: unknown, index) => {
    if (!isRecord(raw)) {
      issues.push({
        questionId: null,
        index,
        field: "questions",
        message: `entry at index ${index} is not a question object`,
      });
      return;
    }
    const q = raw as unknown as Question;

    const issue = (field: string, message: string): void => {
      issues.push({ questionId: q.id, index, field, message });
    };

    // Layer 1 (above, and `optionIds`/`usableBlanks` below) guards the two
    // arrays the rules actually dereference, with a message that names the
    // exact bad entry. Layer 2 (this try/catch) is the backstop: whatever
    // shape a future rule reaches into next, an error escaping this
    // question's rules becomes one issue at this question's index rather
    // than an uncaught throw that aborts the scan — `validateBank`'s
    // contract is that it never throws, only reports.
    try {
      if (seenIds.has(q.id)) {
        issue("id", `duplicate question ID "${q.id}"`);
      } else {
        seenIds.add(q.id);
      }

      if (q.group !== undefined && !groupIds.has(q.group)) {
        issue("group", `group "${q.group}" does not exist in the bank`);
      }

      const mode = q.scoring?.mode;
      if (mode !== undefined) {
        const allowed = APPLICABLE_MODES[q.type];
        if (!allowed.includes(mode)) {
          issue(
            "scoring.mode",
            `scoring mode "${mode}" does not apply to question type "${q.type}" (allowed: ${allowed.join(", ")})`,
          );
        }
      }

      switch (q.type) {
        case "single": {
          const ids = optionIds(q.options, issue);
          if (!ids.has(q.key)) {
            issue("key", `key "${q.key}" is not among the options`);
          }
          break;
        }
        case "multiple": {
          const ids = optionIds(q.options, issue);
          for (const k of q.key) {
            if (!ids.has(k))
              issue("key", `key "${k}" is not among the options`);
          }
          break;
        }
        case "select_k": {
          const ids = optionIds(q.options, issue);
          for (const k of q.key) {
            if (!ids.has(k))
              issue("key", `key "${k}" is not among the options`);
          }
          if (q.key.length !== q.k) {
            issue(
              "key",
              `select_k key has ${q.key.length} entries, but k is ${q.k}`,
            );
          }
          if (q.k >= q.options.length) {
            issue(
              "k",
              `k (${q.k}) must be less than the number of options (${q.options.length})`,
            );
          }
          break;
        }
        case "matching": {
          const leftSet = new Set(q.left);
          const rightSet = new Set(q.right);
          const rightUsage = new Map<string, number>();
          for (const [left, right] of Object.entries(q.key)) {
            if (!leftSet.has(left))
              issue("key", `key uses "${left}", which is not in left`);
            if (!rightSet.has(right))
              issue("key", `key uses "${right}", which is not in right`);
            rightUsage.set(right, (rightUsage.get(right) ?? 0) + 1);
          }
          for (const [right, count] of rightUsage) {
            if (count > 1) {
              issue(
                "key",
                `right item "${right}" is used ${count} times; matching allows at most once`,
              );
            }
          }
          break;
        }
        case "multi_matching": {
          const leftSet = new Set(q.left);
          const rightSet = new Set(q.right);
          for (const [left, rights] of Object.entries(q.key)) {
            if (!leftSet.has(left))
              issue("key", `key uses "${left}", which is not in left`);
            for (const right of rights) {
              if (!rightSet.has(right))
                issue("key", `key uses "${right}", which is not in right`);
            }
          }
          break;
        }
        case "fill_blank": {
          const placeholders = placeholdersIn(q.prompt);
          const blanks = usableBlanks(q.blanks, issue);
          const blankIds = new Set(blanks.map((b) => b.id));
          for (const blank of blanks) {
            if (!placeholders.has(blank.id)) {
              issue(
                "blanks",
                `blank "${blank.id}" has no matching {{${blank.id}}} placeholder in the prompt`,
              );
            }
            if (blank.match === "regex") {
              for (const pattern of blank.accepted) {
                try {
                  assertSafeRegex(pattern);
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : String(err);
                  issue(
                    "blanks",
                    `blank "${blank.id}" has an unsafe regex pattern "${pattern}": ${message}`,
                  );
                }
              }
            }
          }
          for (const placeholder of placeholders) {
            if (!blankIds.has(placeholder)) {
              issue(
                "prompt",
                `placeholder "{{${placeholder}}}" has no matching blank`,
              );
            }
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      issue(
        "question",
        `question at index ${index} is structurally malformed: ${message}`,
      );
    }
  });

  if (issues.length > 0) return { ok: false, issues };
  // Assumed structurally valid (Ajv's job); the two checks above are only
  // enough to let this function degrade safely on arbitrary `unknown`.
  return { ok: true, bank: bank as unknown as Bank };
}
