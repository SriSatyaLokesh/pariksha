// T-17 / AC-12: the registration form's rules, and the **one** copy of them.
//
// `docs/test-format.md:110` — "Every rule is re-checked on the server. The
// browser's copy of it is a courtesy, not a control" — and the cheapest way
// to make the browser's copy *be* the server's rule is one implementation
// and two callers:
//
//   * `apps/web/src/components/testbuilder/RegistrationForm.tsx` renders the
//     issue beside the field, for the builder's preview and for the
//     candidate's own form (one renderer, ADR 0004's shape).
//   * `apps/api/src/run/registration.ts` answers 422 with the same `code`
//     and the same `message`, which is what makes `AC-12`'s "byte-identical"
//     assertion true by construction rather than by review.
//
// `packages/core` is a pure leaf package: no I/O, no clock, no randomness.
// That is why the regex matcher is **injected** (issue #129) — the server
// needs a bounded one (`apps/api/src/run/bounded.ts`) and a bound needs a
// host this package does not have. The matcher returns a boolean and never
// throws: an *organiser's* unsafe or unparseable pattern is the organiser's
// defect, blocked at publish by `unsatisfiableValidation`, and must never
// become the candidate's refusal. A candidate's over-long input is the
// different case and is a real, positioned `too_long` issue — emitted from
// here so both sides say the same sentence.

import type { FormField, RegistrationFormSpec } from "./types.js";

/** One broken rule, positioned on the field it broke. `code` is for a
 *  machine, `message` is the sentence a candidate reads — the same one on
 *  both sides of the wire. */
export interface FieldIssue {
  field: string;
  code: string;
  message: string;
}

/**
 * The reserved key the consent acceptance arrives under, beside the form's
 * own field values. It is not a form field, so `normaliseValues` drops it:
 * consent is stored as `candidate.consent_version` + `consent_at`, never as
 * a row in `form_values_json`.
 */
export const CONSENT_KEY = "consent";

/**
 * The longest candidate value a `validation.pattern` is ever run against —
 * `docs/question-format.md`'s `short_answer` ceiling. Backtracking cost
 * grows with input length whatever the pattern is, so this cap is the half
 * of the bound that does not depend on the grammar check being right.
 *
 * It lives here rather than in `apps/api` so the browser refuses the same
 * input with the same sentence as the server.
 */
export const MAX_MATCH_INPUT = 500;

/** `(pattern, input) => boolean`. Never throws: see the header. */
export type PatternMatcher = (pattern: string, input: string) => boolean;

/**
 * The browser's matcher, and this module's default. An unparseable pattern
 * passes, for the reason the header gives.
 *
 * The server injects `matchBounded` instead, which adds `assertSafeRegex`
 * before compiling — the execution-time half of the gate
 * `unsatisfiableValidation` already applies at save and publish.
 */
const permissiveMatcher: PatternMatcher = (pattern, input) => {
  try {
    return new RegExp(pattern).test(input);
  } catch {
    return true;
  }
};

/**
 * Whether `domain` matches any of `globs`. `*.ac.in` covers `ac.in` and
 * everything below it; anything without a leading `*.` is exact.
 *
 * **The one glob dialect.** It was three: this rule, `emailInDomains`
 * (`apps/api/src/run/net.ts`, the access-level allowlist) and a
 * compile-to-`RegExp` copy in the web renderer that read one `*` as exactly
 * one label — so `*.edu.in` matched `cs.edu.in` and refused `edu.in`, the
 * opposite of what `access.allow_email_domains` does with the same string.
 * `invalidDomainGlob` (validate.ts) already refuses anything but a leading
 * `*.` at save and publish, so the regex dialect was matching shapes
 * nothing can store. Both callers now delegate here.
 */
export function domainMatches(domain: string, globs: readonly string[]): boolean {
  const host = domain.trim().toLowerCase();
  // A host has to be a host, or a candidate typing `*.ac.in` as their
  // address matches the glob `*.ac.in` by string equality.
  if (host === "" || !host.split(".").every((label) => DOMAIN_LABEL.test(label))) return false;
  return globs.some((raw) => {
    const glob = raw.trim().toLowerCase();
    if (!glob.startsWith("*.")) return host === glob;
    const base = glob.slice(2);
    // The suffix must break on a label boundary, or `notac.in` is inside
    // `*.ac.in`.
    return host === base || host.endsWith(`.${base}`);
  });
}

/** One domain label: letters, digits and inner hyphens. */
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * An email address as every digest and comparison in the product must see
 * it: trimmed and lower-cased.
 *
 * One function because the alternative is a class of bug that cannot be
 * retried out of: `issueEmailCode` hashed the address as typed and
 * `consumeEmailCode` hashed it trimmed, so a candidate who pasted their
 * address with a trailing space was refused forever by a code that was
 * correct (Task 2 review, T2-I-2). Same reason `normaliseUniqueValue`
 * delegates here rather than repeating the two operations.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The one normalisation a `unique: true` value passes through, wherever it
 * is compared: the `candidate_unique` hash, the `external_id` written for a
 * self-registration, the access gate's candidate-list lookup, and the CSV
 * upload that writes the list in the first place.
 *
 * Trim, and lower-case for an email. Nothing else — a roll number's case is
 * the organiser's to decide, and folding it would merge `21cs0147` and
 * `21CS0147` into one candidate on a list that deliberately distinguishes
 * them. Four normalisations that drift is the defect (`T-21`: a listed
 * person refused because the upload trimmed and the gate did not); one
 * function is the fix.
 */
export function normaliseUniqueValue(field: FormField, value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return field.type === "email" ? normaliseEmail(text) : text.trim();
}

/** The `unique: true` fields, in the form's own order. The first of them is
 *  the identity a candidate list is keyed on (`identityField`). */
export function uniqueFieldIds(form: RegistrationFormSpec): string[] {
  return form.fields.filter((field) => field.unique === true).map((field) => field.id);
}

/** True for "the candidate has not answered this yet", for every control
 *  shape: a blank box, an unticked consent, an empty checkbox group. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

const issue = (field: FormField, code: string, message: string): FieldIssue => ({
  field: field.id,
  code,
  message,
});

/** The host an `allowed_domains` rule is checked against, or `null` when
 *  the value is not an address at all — which fails the rule rather than
 *  skipping it. */
function hostOf(value: string, kind: "email" | "url"): string | null {
  if (kind === "email") {
    const parts = value.trim().split("@");
    // More than one `@` has two readings and whichever is picked, the other
    // is the bypass (`net.ts` refuses it for the same reason).
    return parts.length === 2 && parts[0] !== "" ? (parts[1] ?? null) : null;
  }
  // Parsed by hand rather than with `URL`: `packages/core` is a pure leaf
  // package with no DOM and no Node lib, and a four-line authority parse
  // is cheaper than widening its `lib` for one call. The authority is
  // everything after the scheme up to the first `/`, `?` or `#`; the part
  // after the **last** `@` is the host, which is what a browser does and
  // therefore what `https://github.com@evil.test` has to resolve to; the
  // port is dropped. Anything that is not a host at all is refused by
  // `domainMatches`, which only admits real labels.
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value.trim());
  const authority = match?.[1];
  if (authority === undefined || authority === "") return null;
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  const colon = hostAndPort.indexOf(":");
  return colon === -1 ? hostAndPort : hostAndPort.slice(0, colon);
}

/**
 * One field's issue, or `undefined`. A `switch` on the type behind a shared
 * `required` check, collecting rather than throwing, which is what lets the
 * route name every bad field at once.
 */
export function validateField(
  field: FormField,
  value: unknown,
  matcher: PatternMatcher = permissiveMatcher,
): FieldIssue | undefined {
  if (isBlank(value)) {
    return field.required === true ? issue(field, "required", "This answer is required.") : undefined;
  }

  const options = field.options ?? [];
  if (field.type === "dropdown" || field.type === "radio") {
    if (!options.includes(String(value))) {
      return issue(field, "not_an_option", "Choose from the options listed.");
    }
  }
  if (field.type === "checkbox") {
    const chosen = Array.isArray(value) ? value : [value];
    if (!chosen.every((one) => options.includes(String(one)))) {
      return issue(field, "not_an_option", "Choose from the options listed.");
    }
  }

  // The type's own shape, before any `validation` block: a `number` field
  // holding "ten" is wrong whether or not the organiser set a range, and a
  // field with no `validation` at all would otherwise skip the check.
  const numeric = field.type === "number" ? Number(value) : 0;
  if (Number.isNaN(numeric)) return issue(field, "not_a_number", "Enter a number.");

  const v = field.validation;
  if (v === undefined) return undefined;

  if (typeof value === "string") {
    if (v.min_length !== undefined && value.length < v.min_length) {
      return issue(field, "too_short", `Use at least ${String(v.min_length)} characters.`);
    }
    if (v.max_length !== undefined && value.length > v.max_length) {
      return issue(field, "too_long", `Use at most ${String(v.max_length)} characters.`);
    }
    if (v.pattern !== undefined) {
      // The input cap, before the matcher rather than inside it: both
      // sides then refuse the same input with the same sentence, and the
      // server's bounded matcher never has to decide what to do with a
      // value it cannot afford to run.
      if (value.length > MAX_MATCH_INPUT) {
        return issue(field, "too_long", `Use at most ${String(MAX_MATCH_INPUT)} characters.`);
      }
      if (!matcher(v.pattern, value)) {
        return issue(
          field,
          "pattern",
          v.pattern_message ?? "This is not in the format this field expects.",
        );
      }
    }
    if (v.allowed_domains !== undefined && (field.type === "email" || field.type === "url")) {
      const host = hostOf(value, field.type);
      if (host === null || !domainMatches(host, v.allowed_domains)) {
        return issue(field, "domain", `Use an address at ${v.allowed_domains.join(", ")}.`);
      }
    }
  }

  if (field.type === "number") {
    const n = numeric;
    if (v.integer === true && !Number.isInteger(n)) {
      return issue(field, "integer", "Enter a whole number.");
    }
    if (typeof v.min === "number" && n < v.min) {
      return issue(field, "min", `Enter ${String(v.min)} or more.`);
    }
    if (typeof v.max === "number" && n > v.max) {
      return issue(field, "max", `Enter ${String(v.max)} or less.`);
    }
  }

  if (field.type === "date" && typeof value === "string") {
    if (typeof v.min === "string" && value < v.min) {
      return issue(field, "min", `Choose ${v.min} or later.`);
    }
    if (typeof v.max === "string" && value > v.max) {
      return issue(field, "max", `Choose ${v.max} or earlier.`);
    }
  }

  return undefined;
}

/** Every broken rule at once — what a caller about to submit wants, and
 *  what the server answers 422 with. */
export function validateRegistration(
  form: RegistrationFormSpec,
  values: Readonly<Record<string, unknown>>,
  opts: { matcher?: PatternMatcher } = {},
): FieldIssue[] {
  const matcher = opts.matcher ?? permissiveMatcher;
  const issues: FieldIssue[] = [];
  for (const field of form.fields) {
    const found = validateField(field, values[field.id], matcher);
    if (found !== undefined) issues.push(found);
  }
  return issues;
}

/**
 * `S-11`: only the fields the form declares, coerced to their declared
 * type. A key the form never asked for is dropped rather than stored — a
 * registration body is candidate-supplied and `form_values_json` is the
 * column an organiser's results export reads.
 *
 * A declared field the candidate left out is **absent**, not `undefined`:
 * `undefined` does not survive JSON and would reach the column as `null`,
 * which reads as "answered with nothing" rather than "not answered".
 */
export function normaliseValues(
  form: RegistrationFormSpec,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const field of form.fields) {
    const raw = values[field.id];
    if (raw === undefined) continue;
    switch (field.type) {
      case "consent":
        kept[field.id] = raw === true || raw === "true" || raw === "yes" || raw === "on";
        break;
      case "number": {
        const n = Number(raw);
        // Not a number is kept as typed: validation has already refused
        // it, and `NaN` is not JSON — it would reach storage as null and
        // lose what the candidate actually wrote.
        kept[field.id] = Number.isNaN(n) ? String(raw) : n;
        break;
      }
      case "checkbox":
        kept[field.id] = (Array.isArray(raw) ? raw : [raw]).map((one) => String(one));
        break;
      default:
        kept[field.id] = String(raw);
    }
  }
  return kept;
}
