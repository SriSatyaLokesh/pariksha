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
  AccessMode,
  Section,
  Test,
  TestAccess,
  TestTiming,
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
 *
 * `validation.pattern` is the third shape, and #57's acceptance row names
 * it alongside the other two — "min above max, *a regex matching nothing
 * allowed*" (task 5/6 review, M3). It is here rather than in its own
 * function for the same reason the other two are: the builder renders one
 * `role="alert"` row per field and `validateTest` pushes one issue per
 * field, so a second function would be a second row, a second issue and a
 * second thing to keep wired.
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
  // The same check `matchBlank` runs on a question author's pattern, and
  // the reason `assertSafeRegex` is exported from this package at all: the
  // candidate-side renderer swallows the throw deliberately (an organiser's
  // defect must not become the candidate's error), so without this the
  // pattern was inert everywhere and an organiser's `([a-z]+)+$` saved,
  // published, and met every candidate's registration on the server.
  if (v.pattern !== undefined) {
    try {
      assertSafeRegex(v.pattern);
    } catch (err) {
      // `assertSafeRegex` speaks to a *question* author and offers
      // `accepted`, a list of whole answers a registration field does not
      // have. The cause is the half worth repeating; the offer is dropped
      // rather than made to someone who cannot act on it.
      const why = (err instanceof Error ? err.message : String(err))
        .replace(/^unsafe regex: /, "")
        .replace(/(, or|—) list the alternative forms in `accepted` instead/, "")
        .trim();
      return `pattern "${v.pattern}" cannot be used — ${why}`;
    }
  }
  return null;
}

// --- T-20, T-21: access allowlists (Task 8, #60, P5.7) -----------------
//
// An allowlist that silently accepts something nothing can match is worse
// than no allowlist at all: on test day the candidate is refused, the
// organiser is told nothing, and the cause is a typo made weeks earlier.
// So these two parsers are strict, they are the *only* copy (the panel and
// the save path both call them), and every refusal says what a correct one
// looks like.
//
// ponytail: syntax only — prefix-length and label-shape bounds, no range
// arithmetic and no address normalisation. `10.0.0.1/24` is accepted with
// its host bits set, because that is unambiguous shorthand and not a
// mistake the organiser needs stopping. Upgrade path, when Phase 6
// actually matches a candidate's address: parse to an integer pair and
// compare, in a `net.ts` of its own, with these as the first gate.

/** `0`-`255` with no leading zero — `010` is octal in some resolvers and
 * decimal in others, so it is never a safe thing to store. */
const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;

/** One label of a hostname: letters, digits and inner hyphens, 1-63 long. */
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Why this is not a CIDR range, or `null` when it is one. */
export function invalidCidr(raw: string): string | null {
  const example = "for example 10.0.0.0/24, or 2001:db8::/32";
  if (raw !== raw.trim() || raw === "") return `"${raw}" is not a network range — ${example}`;

  const slash = raw.indexOf("/");
  if (slash === -1 || raw.indexOf("/", slash + 1) !== -1) {
    return `"${raw}" has no prefix length — a range needs one, ${example}`;
  }
  const address = raw.slice(0, slash);
  const prefix = raw.slice(slash + 1);

  if (!/^(0|[1-9]\d{0,2})$/.test(prefix)) {
    return `"${raw}" has a prefix length that is not a plain number — ${example}`;
  }
  const bits = Number(prefix);

  if (address.includes(":")) {
    if (!isIpv6(address)) return `"${raw}" is not an IPv6 address — ${example}`;
    if (bits > 128) return `"${raw}" has a prefix length above 128 — an IPv6 range cannot, ${example}`;
    return null;
  }

  const octets = address.split(".");
  if (octets.length !== 4 || octets.some((octet) => !IPV4_OCTET.test(octet) || Number(octet) > 255)) {
    return `"${raw}" is not an IPv4 address — four numbers 0-255 with no leading zeros, ${example}`;
  }
  if (bits > 32) return `"${raw}" has a prefix length above 32 — an IPv4 range cannot, ${example}`;
  return null;
}

/** Plain IPv6 text, `::` compression included. No zone id (`%eth0`) and no
 * embedded IPv4 (`::ffff:10.0.0.1`): both have two spellings for one
 * address, which is a matcher bypass waiting to happen. */
function isIpv6(address: string): boolean {
  const halves = address.split("::");
  if (halves.length > 2) return false;
  const hextets = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const groups = halves.flatMap(hextets);
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  return halves.length === 2 ? groups.length <= 7 : groups.length === 8;
}

/**
 * Why this is not an email-domain glob, or `null` when it is one.
 *
 * ASCII or punycode only: a label written in a non-Latin script is refused
 * rather than accepted and compared bytewise against the punycode a mail
 * server will actually present, which would never match.
 */
export function invalidDomainGlob(raw: string): string | null {
  const example = "for example ac.in or *.ac.in";
  if (raw !== raw.trim() || raw === "") return `"${raw}" is not a domain — ${example}`;

  const lower = raw.toLowerCase();
  // A wildcard that matches everything is not a restriction, however it is
  // spelled — and an organiser who typed one believes they have set one.
  if (lower === "*" || lower === "*.*") {
    return `"${raw}" matches every domain, which is not an allowlist — remove it, or name a domain, ${example}`;
  }

  const wildcard = lower.startsWith("*.");
  const domain = wildcard ? lower.slice(2) : lower;
  if (domain.includes("*")) {
    return `"${raw}" uses * somewhere other than the front — only a leading *. is a wildcard, ${example}`;
  }

  const labels = domain.split(".");
  if (labels.some((label) => !DOMAIN_LABEL.test(label))) {
    return `"${raw}" is not a domain — letters, digits and inner hyphens, ${example}`;
  }
  if (domain.length > 253) return `"${raw}" is longer than a domain name can be — ${example}`;

  // `*.in` and `*.com` allow a whole country or generic top level, which
  // reads on the screen as a restriction and is not one; `in` on its own
  // is not a domain anybody has an address at.
  if (labels.length < 2) {
    return wildcard
      ? `"${raw}" would match every domain under one top level — name at least two labels, ${example}`
      : `"${raw}" is a single label, not a domain — ${example}`;
  }
  return null;
}

/**
 * The malformed entries in `access`'s two allowlists, as `{ field, message }`.
 *
 * **Save-time**, and the only save-time rule in this file. A half-typed
 * access code or an unchosen release date is ordinary authoring and the
 * write path lets it through; a stored range nothing can parse is not —
 * it becomes a candidate silently refused on test day with the cause
 * weeks behind them. `apps/api/src/routes/tests.ts` refuses the PATCH on
 * these, and `validateTest` reports them too so one publish report still
 * arrives whole.
 */
export function allowlistIssues(
  access: TestAccess | undefined,
): { field: string; message: string }[] {
  if (access === undefined) return [];
  const issues: { field: string; message: string }[] = [];
  for (const range of access.allow_ip_ranges ?? []) {
    const why = invalidCidr(range);
    if (why !== null) issues.push({ field: "access.allow_ip_ranges", message: why });
  }
  for (const glob of access.allow_email_domains ?? []) {
    const why = invalidDomainGlob(glob);
    if (why !== null) issues.push({ field: "access.allow_email_domains", message: why });
  }
  return issues;
}

/** What the two allowlists, together, let through — in the words the panel
 * shows an organiser and the words Task 13's checklist row uses, which is
 * the point of it living here rather than in either. */
export function describeAllowlists(access: TestAccess): string {
  const domains = access.allow_email_domains ?? [];
  const ranges = access.allow_ip_ranges ?? [];
  const list = (values: readonly string[]): string =>
    values.length === 1 ? (values[0] ?? "") : `${values.slice(0, -1).join(", ")} or ${values[values.length - 1] ?? ""}`;

  if (domains.length > 0 && ranges.length > 0) {
    return `Only addresses matching ${list(domains)}, and only from ${list(ranges)}.`;
  }
  if (domains.length > 0) return `Only addresses matching ${list(domains)}.`;
  if (ranges.length > 0) return `Only from ${list(ranges)}.`;
  return UNRESTRICTED[access.mode];
}

/** What "no allowlist" means, per mode — never the empty string, because a
 * blank where a restriction should be is the one thing an organiser reads
 * as "I have not finished" rather than "anyone". */
const UNRESTRICTED: Readonly<Record<AccessMode, string>> = {
  link_code: "Anyone with the link and the code.",
  invite_only: "Anyone holding their own invite link.",
  email_code: "Anyone who can receive mail at the address they enter.",
  sso: "Anyone who can sign in with their own account.",
};

/** `YYYY-MM-DDThh:mm[:ss[.fff]]` followed by `Z` or `±hh:mm` — what
 * `schemas/test-1.json`'s `format: date-time` means, and nothing looser. */
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * An RFC 3339 timestamp as minutes since the epoch, or `null` when it is
 * not one. Only ever compared against another of these, never rendered.
 *
 * Hand-rolled rather than `Date.parse` because this package owns no clock
 * and calls no `Date` — `packages/core/test/acceptance.test.ts` enforces
 * that — and because `Date.parse` is engine-dependent outside the ISO
 * grammar, so the same document could validate differently in two
 * runtimes. The civil-days arithmetic is Howard Hinnant's, shifted so the
 * era starts in March and February's length stops being a special case.
 */
function instantMinutes(raw: string): number | null {
  const m = RFC3339.exec(raw);
  if (!m) return null;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const second = Number(m[6] ?? "0");
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  // 24:00 and the leap second 23:59:60 are both legal RFC 3339 and neither
  // is a time any organiser means to type.
  if (hour > 23 || minute > 59 || second > 59) return null;

  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const days = era * 146097 + dayOfEra - 719468;

  let offset = 0;
  if (m[7] === undefined) {
    const offsetHours = Number(m[9]);
    const offsetMinutes = Number(m[10]);
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    offset = (m[8] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  }
  return days * 1440 + hour * 60 + minute - offset;
}

/**
 * T-12 - T-15's three cross-field timing rules (Task 7, #59, P5.6), as
 * `{ field, message }` pairs so the builder's `TimingPanel` and
 * `validateTest` state the same sentence rather than wording it twice.
 *
 * **Publish-time.** A half-set window is an ordinary draft: an organiser
 * who has typed `opens_at` and not yet `closes_at` has not made a mistake,
 * and `apps/api/src/routes/tests.ts` deliberately saves it. The panel runs
 * these on blur as a nag; Task 13's checklist is where they block.
 *
 * "Opens in the past" is deliberately *not* here: this package is pure and
 * takes no clock, so that rule belongs to the checklist, which has `now`.
 */
export function timingIssues(
  timing: TestTiming | undefined,
  sections: readonly Section[],
): { field: string; message: string }[] {
  if (timing === undefined) return [];
  const issues: { field: string; message: string }[] = [];

  /** An unparseable timestamp compared as a number would silently satisfy
   * every rule below rather than fail one. Reported as its own issue
   * instead, and withheld from the comparisons. */
  const instant = (key: "opens_at" | "closes_at" | "latest_start_at"): number | null => {
    const raw = timing[key];
    if (raw === undefined) return null;
    const parsed = instantMinutes(raw);
    if (parsed === null) {
      issues.push({
        field: `timing.${key}`,
        message: `"${raw}" is not a date and time — use an RFC 3339 timestamp, for example 2026-11-14T09:00:00+05:30`,
      });
      return null;
    }
    return parsed;
  };

  const opens = instant("opens_at");
  const closes = instant("closes_at");
  const latestStart = instant("latest_start_at");

  if (opens !== null && closes !== null && closes <= opens) {
    issues.push({
      field: "timing.closes_at",
      message: `the window closes at ${timing.closes_at ?? ""}, which is not after it opens at ${timing.opens_at ?? ""} — move the close later, or the open earlier`,
    });
  }

  if (latestStart !== null) {
    const beforeOpen = opens !== null && latestStart < opens;
    const afterClose = closes !== null && latestStart > closes;
    if (beforeOpen || afterClose) {
      issues.push({
        field: "timing.latest_start_at",
        message: `the latest start ${timing.latest_start_at ?? ""} falls ${beforeOpen ? "before the window opens" : "after the window closes"} — it has to sit inside the window, and defaults to closes_at when unset`,
      });
    }
  }

  // T-12's "overall duration, optional per-section durations": a sum above
  // the whole is unsatisfiable however the candidate spends the time.
  const total = sections.reduce((sum, section) => sum + (section.time_limit_minutes ?? 0), 0);
  if (total > timing.duration_minutes) {
    issues.push({
      field: "timing.duration_minutes",
      message: `sections total ${total} minutes against an overall ${timing.duration_minutes} — raise the duration or shorten a section`,
    });
  }

  return issues;
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
 * - `closes_at` is after `opens_at`, `latest_start_at` falls inside the
 *   window, and the per-section durations sum to no more than
 *   `duration_minutes` (Task 7, #59, P5.6).
 * - every CIDR in `access.allow_ip_ranges` and every glob in
 *   `access.allow_email_domains` parses (Task 8, #60, P5.7). Unlike the
 *   rest of this function these are *save-time* in class — see
 *   `allowlistIssues` — and are reported here so the whole report still
 *   arrives at once.
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

  // Task 8 (#60, P5.7) widened this from "undefined" to "shorter than
  // four characters" (task 5/6 review, M4). `schemas/test-1.json` puts
  // `minLength: 4` on `access_code`, but `draftSchema()` strips every
  // `minLength` by keyword, so empty and one-character codes save — and
  // nothing replaced the floor at publish, which left a test publishable
  // on `mode: "link_code"` with a one-character code. A half-typed code is
  // ordinary authoring; a published one is the whole access control.
  const code = doc.access?.mode === "link_code" ? (doc.access.access_code ?? "") : null;
  if (code !== null && code.trim().length < 4) {
    issues.push({
      questionId: null,
      index: -1,
      field: "access.access_code",
      message:
        code === ""
          ? 'access mode "link_code" requires an access_code'
          : `access mode "link_code" requires an access_code of at least 4 characters; "${code}" is ${code.trim().length}`,
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

  // Task 7 (#59, P5.6). The sections are read off `doc` rather than the
  // raw array because only `time_limit_minutes` matters here and a
  // structurally broken entry is already reported, at its own index, by
  // the per-section pass below.
  for (const issue of timingIssues(doc.timing, Array.isArray(doc.sections) ? doc.sections : [])) {
    issues.push({ questionId: null, index: -1, ...issue });
  }

  // Task 8 (#60, P5.7). Save-time in class (see `allowlistIssues`),
  // reported here so the whole publish report still arrives at once.
  for (const issue of allowlistIssues(doc.access)) {
    issues.push({ questionId: null, index: -1, ...issue });
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
