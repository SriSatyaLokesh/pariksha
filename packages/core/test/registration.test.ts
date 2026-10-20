// T-17 / AC-12: the registration rules, stated once.
//
// The point of this file is that there is nothing to compare it against:
// `apps/web/src/components/testbuilder/RegistrationForm.tsx` and
// `apps/api/src/run/registration.ts` both call the functions tested here,
// so a rule asserted once is the rule both sides run.

import { describe, expect, it } from "vitest";
import {
  CONSENT_KEY,
  domainMatches,
  MAX_MATCH_INPUT,
  normaliseUniqueValue,
  normaliseValues,
  uniqueFieldIds,
  validateField,
  validateRegistration,
  type FormField,
  type RegistrationFormSpec,
} from "../src/index.js";

const field = (over: Partial<FormField> & Pick<FormField, "id" | "type" | "label">): FormField =>
  over as FormField;

const rollForm: RegistrationFormSpec = {
  fields: [
    {
      id: "roll",
      type: "short_text",
      label: "Roll",
      validation: { pattern: "^\\d{2}[A-Z]{2}\\d{4}$", pattern_message: "Format: 21CS0147" },
    },
  ],
};

const nameForm: RegistrationFormSpec = {
  fields: [{ id: "name", type: "short_text", label: "Name" }],
};

const campusHiringForm: RegistrationFormSpec = {
  fields: [
    { id: "full_name", type: "short_text", label: "Full name", required: true },
    { id: "email", type: "email", label: "Email", required: true, unique: true },
    { id: "roll_number", type: "short_text", label: "Roll number", required: true, unique: true },
    { id: "cgpa", type: "number", label: "CGPA", required: true, validation: { min: 0, max: 10 } },
  ],
};

describe("T-17: one issue per broken rule, positioned on the field", () => {
  it.each([
    ["required", field({ id: "name", type: "short_text", label: "Name", required: true }), {}, "required"],
    ["min_length", field({ id: "n", type: "short_text", label: "N", validation: { min_length: 3 } }), { n: "ab" }, "too_short"],
    ["max_length", field({ id: "n", type: "short_text", label: "N", validation: { max_length: 3 } }), { n: "abcd" }, "too_long"],
    ["pattern", rollForm.fields[0]!, { roll: "x" }, "pattern"],
    ["email domain", field({ id: "e", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } }), { e: "a@gmail.com" }, "domain"],
    ["number max", field({ id: "cgpa", type: "number", label: "C", validation: { min: 0, max: 10 } }), { cgpa: 11 }, "max"],
    ["number min", field({ id: "cgpa", type: "number", label: "C", validation: { min: 1, max: 10 } }), { cgpa: 0.5 }, "min"],
    ["not a number", field({ id: "cgpa", type: "number", label: "C" }), { cgpa: "ten" }, "not_a_number"],
    ["integer", field({ id: "yr", type: "number", label: "Y", validation: { integer: true } }), { yr: 2026.5 }, "integer"],
    ["date max", field({ id: "d", type: "date", label: "D", validation: { max: "2026-01-01" } }), { d: "2027-01-01" }, "max"],
    ["date min", field({ id: "d", type: "date", label: "D", validation: { min: "2026-01-01" } }), { d: "2025-01-01" }, "min"],
    ["dropdown", field({ id: "deg", type: "dropdown", label: "D", options: ["BE", "ME"] }), { deg: "PhD" }, "not_an_option"],
    ["radio", field({ id: "r", type: "radio", label: "R", options: ["a", "b"] }), { r: "z" }, "not_an_option"],
    ["checkbox", field({ id: "s", type: "checkbox", label: "S", options: ["a", "b"] }), { s: ["a", "z"] }, "not_an_option"],
    ["url domain", field({ id: "u", type: "url", label: "U", validation: { allowed_domains: ["github.com"] } }), { u: "https://evil.test" }, "domain"],
    ["consent", field({ id: "c", type: "consent", label: "C", required: true }), { c: false }, "required"],
  ])("%s is an issue on the field itself", (_name, f, values, code) => {
    expect(validateRegistration({ fields: [f] }, values)[0]).toMatchObject({ field: f.id, code });
  });

  it.each([
    ["an optional field left blank", field({ id: "n", type: "short_text", label: "N" }), {}],
    ["a value inside min_length", field({ id: "n", type: "short_text", label: "N", validation: { min_length: 2 } }), { n: "ab" }],
    ["a pattern that matches", rollForm.fields[0]!, { roll: "21CS0147" }],
    ["a domain that is the glob's own base", field({ id: "e", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } }), { e: "a@ac.in" }],
    ["a domain below the glob", field({ id: "e", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } }), { e: "a@vce.ac.in" }],
    ["an exact url domain", field({ id: "u", type: "url", label: "U", validation: { allowed_domains: ["github.com"] } }), { u: "https://github.com/x" }],
    ["a number at the boundary", field({ id: "c", type: "number", label: "C", validation: { min: 0, max: 10 } }), { c: 10 }],
    ["a numeric string", field({ id: "c", type: "number", label: "C", validation: { max: 10 } }), { c: "9.5" }],
    ["an option that is listed", field({ id: "d", type: "dropdown", label: "D", options: ["BE"] }), { d: "BE" }],
    ["every checkbox listed", field({ id: "s", type: "checkbox", label: "S", options: ["a", "b"] }), { s: ["a", "b"] }],
    ["a ticked consent", field({ id: "c", type: "consent", label: "C", required: true }), { c: true }],
    ["a field with no validation block", field({ id: "n", type: "short_text", label: "N" }), { n: "anything" }],
    ["a date with no bounds", field({ id: "d", type: "date", label: "D" }), { d: "2026-05-05" }],
  ])("%s is not an issue", (_name, f, values) => {
    expect(validateRegistration({ fields: [f] }, values)).toEqual([]);
  });

  it("collects every bad field rather than stopping at the first", () => {
    const issues = validateRegistration(campusHiringForm, { cgpa: 11 });
    expect(issues.map((i) => i.field).sort()).toEqual(["cgpa", "email", "full_name", "roll_number"]);
  });

  it("every issue names a field that exists in the form", () => {
    for (const issue of validateRegistration(campusHiringForm, {})) {
      expect(campusHiringForm.fields.map((f) => f.id)).toContain(issue.field);
    }
  });

  it("AC-12: pattern_message is the message, verbatim", () => {
    expect(validateRegistration(rollForm, { roll: "x" })[0]!.message).toBe("Format: 21CS0147");
  });

  it("a pattern with no pattern_message still says what went wrong", () => {
    const form = { fields: [field({ id: "r", type: "short_text", label: "R", validation: { pattern: "^a$" } })] };
    expect(validateRegistration(form, { r: "b" })[0]!.message).toBe(
      "This is not in the format this field expects.",
    );
  });

  it("an organiser's unparseable pattern lets the candidate through — it is not their defect", () => {
    const form = { fields: [field({ id: "r", type: "short_text", label: "R", validation: { pattern: "(" } })] };
    expect(validateRegistration(form, { r: "anything" })).toEqual([]);
  });

  it("a blank optional field never reaches its validation block", () => {
    const form = { fields: [field({ id: "n", type: "short_text", label: "N", validation: { min_length: 5 } })] };
    expect(validateRegistration(form, { n: "   " })).toEqual([]);
  });

  it("an email with no @ at all fails the domain rule rather than passing it", () => {
    const form = {
      fields: [field({ id: "e", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } })],
    };
    expect(validateRegistration(form, { e: "nope" })[0]).toMatchObject({ code: "domain" });
  });

  it("a url that is not a url fails the domain rule rather than passing it", () => {
    const form = {
      fields: [field({ id: "u", type: "url", label: "U", validation: { allowed_domains: ["github.com"] } })],
    };
    expect(validateRegistration(form, { u: "not a url" })[0]).toMatchObject({ code: "domain" });
  });

  it("allowed_domains on a field that is neither email nor url is ignored", () => {
    const form = {
      fields: [field({ id: "s", type: "short_text", label: "S", validation: { allowed_domains: ["x.test"] } })],
    };
    expect(validateRegistration(form, { s: "whatever" })).toEqual([]);
  });

  it("a checkbox group with no options declared refuses every tick", () => {
    const form = { fields: [field({ id: "s", type: "checkbox", label: "S" })] };
    expect(validateRegistration(form, { s: ["a"] })[0]).toMatchObject({ code: "not_an_option" });
  });

  it("validateField is the single-field view of the same rule", () => {
    expect(validateField(rollForm.fields[0]!, "x")).toMatchObject({ code: "pattern" });
    expect(validateField(rollForm.fields[0]!, "21CS0147")).toBeUndefined();
  });
});

describe("AC-12: a rule cannot be skipped by sending another JSON type", () => {
  // The whole of `AC-12` is "the server refuses a rule the browser was
  // patched to skip", and the cheapest patch is not a wrong *value* but a
  // wrong *type*: every string rule lives behind a string, so a number
  // slipped past `min_length`, `pattern` and `allowed_domains` alike and
  // was then coerced and stored. Each row below is a body no honest
  // client can produce.
  it.each([
    ["a number where a pattern is declared", rollForm.fields[0]!, { roll: 12345 }],
    ["a number where a domain rule is declared", field({ id: "e", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } }), { e: 999 }],
    ["an object where text is declared", field({ id: "n", type: "short_text", label: "N", validation: { min_length: 3 } }), { n: { toString: 1 } }],
    ["an array where text is declared", field({ id: "n", type: "short_text", label: "N" }), { n: ["a", "b"] }],
    ["an array where a number is declared", field({ id: "c", type: "number", label: "C", validation: { max: 10 } }), { c: [5] }],
    ["an object where a date is declared", field({ id: "d", type: "date", label: "D", validation: { max: "2026-01-01" } }), { d: {} }],
    ["a string where consent is declared", field({ id: "c", type: "consent", label: "C", required: true }), { c: "no" }],
    ["a number where consent is declared", field({ id: "c", type: "consent", label: "C", required: true }), { c: 1 }],
    ["a number inside a checkbox group", field({ id: "s", type: "checkbox", label: "S", options: ["a"] }), { s: [1] }],
    ["an object where a dropdown is declared", field({ id: "d", type: "dropdown", label: "D", options: ["BE"] }), { d: { v: "BE" } }],
  ])("%s is an issue, not a pass", (_name, f, values) => {
    expect(validateRegistration({ fields: [f] }, values)[0]).toMatchObject({
      field: f.id,
      code: "wrong_type",
    });
  });

  it("the two rules a wrong type used to walk past are both still applied", () => {
    // The reviewer's own reproduction, as a test: these two produced an
    // empty issue list and a 201.
    const form = {
      fields: [
        rollForm.fields[0]!,
        field({ id: "email", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } }),
      ],
    };
    expect(validateRegistration(form, { roll: 12345, email: 999 }).map((i) => i.field)).toEqual([
      "roll",
      "email",
    ]);
  });

  it("a number field still takes the string an HTML number input posts", () => {
    const f = field({ id: "c", type: "number", label: "C", validation: { max: 10 } });
    expect(validateRegistration({ fields: [f] }, { c: "9.5" })).toEqual([]);
    expect(validateRegistration({ fields: [f] }, { c: 9.5 })).toEqual([]);
  });

  it("a checkbox group still takes one bare string as well as an array", () => {
    const f = field({ id: "s", type: "checkbox", label: "S", options: ["a", "b"] });
    expect(validateRegistration({ fields: [f] }, { s: "a" })).toEqual([]);
  });
});

describe("#129: the pattern matcher is injected, so the server can bound it", () => {
  it("the injected matcher is what runs a pattern", () => {
    const seen: string[] = [];
    validateRegistration(rollForm, { roll: "x" }, {
      matcher: (p) => {
        seen.push(p);
        return false;
      },
    });
    expect(seen).toEqual(["^\\d{2}[A-Z]{2}\\d{4}$"]);
  });

  it("an injected matcher that passes produces no issue", () => {
    expect(validateRegistration(rollForm, { roll: "x" }, { matcher: () => true })).toEqual([]);
  });

  it("input past MAX_MATCH_INPUT is a positioned too_long issue, never an exception", () => {
    const over = "a".repeat(MAX_MATCH_INPUT + 1);
    const matcher = (): boolean => {
      throw new Error("the matcher must never see input this long");
    };
    expect(validateRegistration(rollForm, { roll: over }, { matcher })[0]).toMatchObject({
      field: "roll",
      code: "too_long",
    });
  });

  it("a pattern field at exactly MAX_MATCH_INPUT still reaches the matcher", () => {
    let reached = false;
    validateRegistration(rollForm, { roll: "a".repeat(MAX_MATCH_INPUT) }, {
      matcher: () => {
        reached = true;
        return true;
      },
    });
    expect(reached).toBe(true);
  });

  it("a long value on a field with no pattern is not capped by MAX_MATCH_INPUT", () => {
    const form = { fields: [field({ id: "essay", type: "long_text", label: "Essay" })] };
    expect(validateRegistration(form, { essay: "a".repeat(MAX_MATCH_INPUT + 500) })).toEqual([]);
  });
});

describe("S-11: only the fields the form declares are kept", () => {
  it("a field the form does not declare is dropped, not stored", () => {
    expect(normaliseValues(nameForm, { name: "A", secret: "x" })).toEqual({ name: "A" });
  });

  it("the consent acceptance key is not a stored value unless the form declares it", () => {
    expect(normaliseValues(nameForm, { name: "A", [CONSENT_KEY]: true })).toEqual({ name: "A" });
  });

  it("a declared field the candidate left out is absent rather than undefined", () => {
    expect(Object.keys(normaliseValues(campusHiringForm, { email: "a@b.ac.in" }))).toEqual(["email"]);
  });

  it.each([
    ["short_text", "short_text", 42, "42"],
    ["number", "number", "9.5", 9.5],
    ["consent", "consent", "yes", true],
    ["checkbox", "checkbox", "a", ["a"]],
  ] as const)("coerces a %s to its declared type", (_n, type, raw, expected) => {
    const form = { fields: [field({ id: "f", type, label: "F" })] };
    expect(normaliseValues(form, { f: raw })).toEqual({ f: expected });
  });

  it("keeps a checkbox array as an array of strings", () => {
    const form = { fields: [field({ id: "s", type: "checkbox", label: "S" })] };
    expect(normaliseValues(form, { s: ["a", 2] })).toEqual({ s: ["a", "2"] });
  });

  it("a number that is not a number is kept as the string the candidate typed", () => {
    // Validation has already refused it; normalisation must not turn it
    // into NaN, which is not JSON and would reach storage as null.
    const form = { fields: [field({ id: "n", type: "number", label: "N" })] };
    expect(normaliseValues(form, { n: "ten" })).toEqual({ n: "ten" });
  });
});

describe("T-21 / AC-12: unique fields and their one normalisation", () => {
  it("uniqueFieldIds is the form's own order", () => {
    expect(uniqueFieldIds(campusHiringForm)).toEqual(["email", "roll_number"]);
  });

  it("a form with no unique field has none", () => {
    expect(uniqueFieldIds(nameForm)).toEqual([]);
  });

  it("trims every unique value", () => {
    const f = field({ id: "roll", type: "short_text", label: "Roll" });
    expect(normaliseUniqueValue(f, "  21CS0147 ")).toBe("21CS0147");
  });

  it("lower-cases an email, and only an email", () => {
    expect(normaliseUniqueValue(field({ id: "e", type: "email", label: "E" }), " Ravi@College.AC.in ")).toBe(
      "ravi@college.ac.in",
    );
    expect(normaliseUniqueValue(field({ id: "r", type: "short_text", label: "R" }), " 21cs0147 ")).toBe(
      "21cs0147",
    );
  });

  it("a non-string unique value still normalises", () => {
    expect(normaliseUniqueValue(field({ id: "n", type: "number", label: "N" }), 42)).toBe("42");
    expect(normaliseUniqueValue(field({ id: "n", type: "number", label: "N" }), null)).toBe("");
  });
});

describe("the one domain glob dialect", () => {
  it.each([
    ["exact", "github.com", ["github.com"], true],
    ["exact, wrong host", "evil.test", ["github.com"], false],
    ["glob covers its own base", "ac.in", ["*.ac.in"], true],
    ["glob covers a child", "vce.ac.in", ["*.ac.in"], true],
    ["glob covers a grandchild", "cs.vce.ac.in", ["*.ac.in"], true],
    ["glob stops at the label boundary", "notac.in", ["*.ac.in"], false],
    ["case folds on both sides", "VCE.AC.IN", ["*.AC.in"], true],
    ["an empty list matches nothing", "ac.in", [], false],
    ["a host that is not a host", "*.ac.in", ["*.ac.in"], false],
  ])("%s", (_n, host, globs, expected) => {
    expect(domainMatches(host, globs)).toBe(expected);
  });
});
