// Cross-field import validation: the rules a JSON Schema cannot express.
// Structural checks ("is `prompt` a string", "is `type` one of the twelve")
// are Ajv's job against schemas/bank-1.json, schemas/question-1.json and
// schemas/test-1.json. This file assumes the document already passed that
// and checks only relationships *between* fields.
//
// `validateBank` covers one bank: option IDs a key names, option counts a
// `select_k` promises, placeholders a `fill_blank` prompt and its blanks
// must agree on, IDs and group references unique and resolvable within the
// bank, regex safety, and scoring-mode applicability.
//
// `validateTest` covers one test against the questions its banks hold —
// the rules that need both documents at once, which is why no schema can
// reach them: a `scoring.default_mode` that does not apply to a type a
// section draws, a pool smaller than its `count`, sets of unequal total
// points, and the question IDs a section names.
//
// Import is all-or-nothing: every issue found is collected and returned,
// never only the first, so an author fixes their file once.
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

import type {
  Bank,
  Blank,
  FormField,
  PassageGroup,
  Question,
  QuestionOption,
  Section,
  Test,
} from "./types.js";
import { assertSafeRegex } from "./grade/text.js";
import type { ScoringDefaults } from "./grade/result.js";
import { APPLICABLE_MODES, resolveScoring, round2 } from "./grade/result.js";
import { matchesFilter } from "./select.js";

/**
 * Every value `ImportIssue.code` can hold. Not a plain `string` — fix round
 * 1, finding 10: a plain string coupled the producer (this file) to the
 * consumer (`apps/api/src/routes/questions.ts`'s `isSaveTimeIssue`) only by
 * both sides typing the same literal correctly, with nothing to catch a
 * typo on either end. Extend this union, not the type of `code` itself,
 * when another issue needs one.
 *
 * Task 8 fix round 1, finding 14: `apps/api/src/import/csv.ts` and
 * `gift.ts` carry their own converter-detected issues (a type outside the
 * five, a header that doesn't match, a cell that cannot be parsed at all,
 * a GIFT construct this format cannot express) — these codes let a test
 * (or `ImportDialog`, later) match on *which* defect fired without parsing
 * `message` prose, the same reason `unsafe_regex` exists.
 */
export type ImportIssueCode =
  | "unsafe_regex"
  | "duplicate_option_text"
  | "csv_unsupported_type"
  | "csv_column_count"
  | "csv_header_mismatch"
  | "csv_unparseable_value"
  | "gift_unsupported_construct"
  | "gift_unparseable_value"
  | "gift_no_correct_answer";

export interface ImportIssue {
  /** The question's `id`, or null for an issue not about one specific question. */
  questionId: string | null;
  /**
   * The entry's position (0-based) in the array the issue is about —
   * `bank.questions` for every bank rule, `bank.groups` for a malformed
   * group entry, `test.sections` for every section rule — or -1 when the
   * issue is about the document as a whole (`access`, `release`, or a
   * `sections` that is not an array at all).
   */
  index: number;
  field: string;
  message: string;
  /**
   * A stable, machine-matchable identifier for *which* rule fired — set only
   * where a caller actually needs to act on one specific rule rather than
   * read `message` to a person. Task 7 (#51): `apps/api/src/routes/
   * questions.ts`'s `isSaveTimeIssue` used to match the unsafe-regex issue by
   * `field === "blanks"` plus a message substring, because this field did
   * not exist; it is added here, narrowly, rather than given to every issue
   * this file raises, which would be a speculative rename nothing asks for.
   */
  code?: ImportIssueCode;
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

/**
 * `{{id}}` placeholders in a fill_blank prompt, in prompt order,
 * deduplicated.
 *
 * Fix round (whole-branch review, M8): exported — `apps/web/src/components/
 * authoring/answer/Written.tsx` used to copy this same regex rather than
 * import it (its own comment named the two return shapes it needed: an
 * ordered array for the editor's blank list, an unordered `Set` for this
 * file's cross-check below). One scan, two views: `placeholdersIn` below
 * wraps this in a `Set` for its own unordered membership checks.
 */
export function placeholderIds(prompt: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of prompt.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const id = m[1];
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function placeholdersIn(prompt: string): Set<string> {
  return new Set(placeholderIds(prompt));
}

/**
 * Usable option IDs from an `options` array: a non-object element (one that
 * fails `isRecord`) is reported and skipped rather than dereferenced.
 *
 * Also catches two options sharing the same `text` within one question.
 * `schemas/question-1.json` does not require option `id`s to be distinct
 * either (no rule here does, and none is added by this change — a bank with
 * two identical `id`s is a separate, pre-existing gap this task's brief did
 * not raise), but CSV and GIFT have no `id` column at all — an option's own
 * text *is* its identity there (apps/api/src/import/csv.ts's own header
 * comment). A bank that passes
 * this check can always be re-expressed in either format with its answer
 * key intact; one that does not would round-trip through CSV/GIFT with the
 * key silently rebound to whichever option that text's first occurrence
 * lands on — a defect found in Task 8's review, fixed here rather than in a
 * CSV/GIFT *export* mapper so it is caught at the one gate every import
 * format (JSON included) already passes through, closing the hole for every
 * current and future export path at once.
 */
function optionIds(
  options: readonly QuestionOption[],
  issue: (field: string, message: string, code?: ImportIssueCode) => void,
): Set<string> {
  const ids = new Set<string>();
  const textOwners = new Map<string, string>();
  options.forEach((o, i) => {
    if (!isRecord(o)) {
      issue("options", `option at position ${i} is not an object`);
      return;
    }
    ids.add(o.id);
    const owner = textOwners.get(o.text);
    if (owner !== undefined) {
      issue(
        "options",
        `options "${owner}" and "${o.id}" share the text "${o.text}" — CSV and GIFT use an option's text as its identity, so this would silently rebind the answer key on export`,
        "duplicate_option_text",
      );
    } else {
      textOwners.set(o.text, o.id);
    }
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

    const issue = (field: string, message: string, code?: ImportIssueCode): void => {
      issues.push({ questionId: q.id, index, field, message, ...(code !== undefined && { code }) });
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
                    "unsafe_regex",
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

export interface TestValidationOptions {
  /**
   * How far two sets' total points may differ before it is reported, in
   * points. PRD T-11 and docs/test-format.md both state the rule only as
   * sets differing "by more than a set amount" / drifting apart, and name
   * no amount — so the default is the strict reading, 0: any difference at
   * all is reported. Raise it where an organiser accepts some drift.
   *
   * Task 4 (#56, P5.3): the document now carries the same amount as
   * `scoring.set_points_tolerance`, and this option overrides it where a
   * caller gives one — a gate may be stricter than the file asks for, but a
   * file alone cannot loosen a gate that named its own number.
   */
  setPointsTolerance?: number;
}

type TestValidationResult =
  | { ok: true; test: Test }
  | { ok: false; issues: ImportIssue[] };

/** The three field types an `options` list belongs to (schemas/test-1.json's
 * `$defs/formField` says the same, in its own `if`/`then`). */
const CHOICE_FIELD_TYPES: readonly string[] = ["dropdown", "radio", "checkbox"];

/**
 * Task 5 (#57, P5.4). The one rule in this file whose breach is **not** a
 * half-built form: a `validation` block no value can ever satisfy silently
 * refuses every candidate at registration, and nothing before Phase 6 would
 * surface it. Exported so the builder
 * (`apps/web/src/components/testbuilder/FormBuilder.tsx`) shows the author
 * the same sentence the publish gate would, rather than carrying a second
 * copy of the arithmetic — which is the defect this phase keeps finding.
 *
 * Returns the sentence, or `null` when the field is satisfiable. `min`/`max`
 * are compared only when both are the same JSON type: the schema allows a
 * number (a `number` field) or a string (a `date` field's ISO bound), and
 * comparing one against the other says nothing.
 */
export function unsatisfiableValidation(field: FormField): string | null {
  const v = field.validation;
  if (v === undefined) return null;

  const { min_length: minLength, max_length: maxLength, min, max } = v;
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    return `minimum length ${minLength} is above maximum length ${maxLength} — lower the minimum, or raise the maximum`;
  }
  if (min !== undefined && max !== undefined && typeof min === typeof max && min > max) {
    return `minimum ${min} is above maximum ${max} — lower the minimum, or raise the maximum`;
  }
  return null;
}

/** The ids that appear more than once in `ids`, each reported once, in the
 * order they first repeat. Both halves of docs/test-format.md's own
 * "ids are unique within the test" line — section ids and form field ids —
 * are this one function. */
function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      if (!repeated.includes(id)) repeated.push(id);
      continue;
    }
    seen.add(id);
  }
  return repeated;
}

/**
 * Only `.points` of what `resolveScoring` returns is read below, and
 * `points` falls back to the engine's own per-question default rather than
 * to anything passed in here — so these two fields are inert placeholders
 * satisfying the parameter's shape, not a claim about what a test with no
 * `scoring` block grades under.
 */
const POINTS_ONLY_DEFAULTS: ScoringDefaults = {
  mode: "all_or_nothing",
  negativeFraction: 0,
};

function totalPoints(questions: readonly Question[]): number {
  return round2(
    questions.reduce(
      (sum, q) => sum + resolveScoring(q, POINTS_ONLY_DEFAULTS).points,
      0,
    ),
  );
}

/**
 * Checks one `pariksha/test@1` document against the questions its `banks`
 * hold — the caller merges every bank into `bank`, because this package
 * does no I/O and cannot resolve a bank path itself.
 *
 * Assumes `test` already passed Ajv validation against schemas/test-1.json
 * (the `sections` check below exists only so this degrades safely on
 * arbitrary `unknown`, as `validateBank`'s does). The rules enforced:
 *
 * - `scoring.default_mode` applies to every type a section can draw, for
 *   the questions that do not set their own `scoring.mode` — the mode most
 *   questions actually grade under, since `resolveScoring` falls back to
 *   it. docs/question-format.md's "Scoring modes" table is the source of
 *   applicability, via APPLICABLE_MODES.
 * - a `pool` filter matches at least `count` questions
 *   (docs/test-format.md, "Rules checked on import").
 * - the sets of a `sets` source hold equal total points, within
 *   `setPointsTolerance` (PRD T-11).
 * - `at` is present when `release.when` is `on_date`, and `access_code`
 *   when `access.mode` is `link_code` (docs/test-format.md, "Rules checked
 *   on import"). The schema's `if`/`then` says the same; it is repeated
 *   here so a document reaching this function by another route still gets
 *   the rule, and so the whole report arrives in one shape.
 * - every question ID a `fixed` or `sets` source names exists in `bank`.
 */
export function validateTest(
  test: unknown,
  bank: readonly Question[],
  options: TestValidationOptions = {},
): TestValidationResult {
  if (!isRecord(test) || !Array.isArray(test.sections)) {
    return {
      ok: false,
      issues: [
        {
          questionId: null,
          index: -1,
          field: "sections",
          message: "test.sections must be an array",
        },
      ],
    };
  }

  const doc = test as unknown as Test;
  const issues: ImportIssue[] = [];
  const tolerance = options.setPointsTolerance ?? doc.scoring?.set_points_tolerance ?? 0;
  const defaultMode = doc.scoring?.default_mode;
  const byId = new Map(bank.map((q) => [q.id, q]));

  if (doc.access?.mode === "link_code" && doc.access.access_code === undefined) {
    issues.push({
      questionId: null,
      index: -1,
      field: "access.access_code",
      message: 'access mode "link_code" requires an access_code',
    });
  }

  if (doc.release?.when === "on_date" && doc.release.at === undefined) {
    issues.push({
      questionId: null,
      index: -1,
      field: "release.at",
      message: 'release "on_date" requires an "at" timestamp',
    });
  }

  // Task 5 (#57, P5.4): docs/test-format.md's "ids are unique within the
  // test" line, both halves. **Publish-time** — an organiser mid-build may
  // legitimately have two fields called `email` for a second, which is why
  // the save-time gate (`apps/api/src/routes/tests.ts`'s `draftSchema`)
  // does not carry it and a schema could not express it anyway.
  const sectionIds = (test.sections as unknown[])
    .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.id === "string")
    .map((entry) => entry.id as string);
  for (const id of duplicates(sectionIds)) {
    issues.push({
      questionId: null,
      index: -1,
      field: "sections",
      message: `section id "${id}" is used more than once`,
    });
  }

  const form = doc.registration_form;
  if (form !== undefined && Array.isArray(form.fields)) {
    for (const id of duplicates(form.fields.map((f) => f.id))) {
      issues.push({
        questionId: null,
        index: -1,
        field: "registration_form.fields",
        message: `form field id "${id}" is used more than once`,
      });
    }

    for (const field of form.fields) {
      const isChoice = CHOICE_FIELD_TYPES.includes(field.type);
      // Publish-time, both directions of the same rule. The schema states
      // the forward half (`$defs/formField`'s `if`/`then`: a choice field
      // requires `options`) and nothing states the reverse, so an `options`
      // list on a `short_text` field imports clean today and is silently
      // dropped by every renderer.
      if (!isChoice && field.options !== undefined) {
        issues.push({
          questionId: null,
          index: -1,
          field: "registration_form.fields",
          message: `form field "${field.id}" is a ${field.type} field and cannot carry an options list`,
        });
      }
      if (isChoice && (field.options?.length ?? 0) < 2) {
        issues.push({
          questionId: null,
          index: -1,
          field: "registration_form.fields",
          message: `form field "${field.id}" is a ${field.type} field and needs at least two options`,
        });
      }

      // Save-time in class (see `unsatisfiableValidation`), reported here
      // so the whole report still arrives at once.
      const unsatisfiable = unsatisfiableValidation(field);
      if (unsatisfiable !== null) {
        issues.push({
          questionId: null,
          index: -1,
          field: "registration_form",
          message: `form field "${field.id}": ${unsatisfiable}`,
        });
      }
    }
  }

  (test.sections as unknown[]).forEach((raw: unknown, index) => {
    if (!isRecord(raw) || !isRecord(raw.source)) {
      issues.push({
        questionId: null,
        index,
        field: "sections",
        message: `entry at index ${index} is not a section object with a source`,
      });
      return;
    }
    const section = raw as unknown as Section;

    const issue = (field: string, message: string): void => {
      issues.push({ questionId: null, index, field, message });
    };

    // Keyed by ID so a question named by two sets of the same section is
    // judged once, and in the order the author wrote it.
    const drawable = new Map<string, Question>();

    /** Resolves named IDs, reporting (and skipping) any the banks lack. */
    const resolve = (ids: readonly string[], field: string): Question[] => {
      const found: Question[] = [];
      for (const id of ids) {
        const q = byId.get(id);
        if (q === undefined) {
          issues.push({
            questionId: id,
            index,
            field,
            message: `question "${id}" is not in the banks this test draws from`,
          });
          continue;
        }
        found.push(q);
        drawable.set(q.id, q);
      }
      return found;
    };

    // The same backstop `validateBank` keeps: whatever shape a future rule
    // reaches into, an error escaping this section's rules becomes one
    // issue at this section's index rather than an uncaught throw that
    // aborts the scan.
    try {
      const source = section.source;
      switch (source.kind) {
        case "fixed":
          resolve(source.questions, "source.questions");
          break;

        case "pool": {
          const matching = bank.filter((q) => matchesFilter(q, source.filter));
          if (matching.length < source.count) {
            issue(
              "source.count",
              `section "${section.id}" draws ${source.count} questions but only ${matching.length} match its filter`,
            );
          }
          for (const q of matching) drawable.set(q.id, q);
          break;
        }

        case "sets": {
          const totals = source.sets.map((set) => ({
            set: set.set,
            points: totalPoints(resolve(set.questions, "source.sets")),
          }));
          const points = totals.map((t) => t.points);
          const low = Math.min(...points);
          const high = Math.max(...points);
          if (round2(high - low) > tolerance) {
            issue(
              "source.sets",
              `section "${section.id}" has sets of unequal total points (${totals
                .map((t) => `${t.set}: ${t.points}`)
                .join(", ")}); the tolerance is ${tolerance}`,
            );
          }
          break;
        }
      }

      if (defaultMode !== undefined) {
        for (const q of drawable.values()) {
          // A question with its own mode never grades under the test
          // default, so the default's applicability says nothing about it.
          // `validateBank` already checked that own mode.
          if (q.scoring?.mode !== undefined) continue;
          const allowed = APPLICABLE_MODES[q.type];
          if (!allowed.includes(defaultMode)) {
            issues.push({
              questionId: q.id,
              index,
              field: "scoring.default_mode",
              message: `default scoring mode "${defaultMode}" does not apply to question "${q.id}" of type "${q.type}" drawn by section "${section.id}" (allowed: ${allowed.join(", ")})`,
            });
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      issue(
        "section",
        `section at index ${index} is structurally malformed: ${message}`,
      );
    }
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, test: doc };
}
