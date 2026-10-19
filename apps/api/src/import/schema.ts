// The structural layer of import: "is `prompt` a string", "is `type` one of
// the twelve", "is `options` an array of at least two" — everything a JSON
// Schema can say on its own, checked against schemas/bank-1.json and
// schemas/question-1.json. Cross-field rules (`validateBank`,
// @pariksha/core) are a separate pass over the same document; this file
// knows nothing about them.
//
// `@cfworker/json-schema` rather than Ajv: Ajv compiles a validator function
// with `new Function`, which the Workers runtime refuses at request time.
// cfworker's validator walks the schema directly, no code generation, so it
// runs the same way on Node and on a Worker. The schemas are imported as
// JSON modules so they are inlined into the Worker bundle rather than read
// from disk, which does not exist there.
//
// Positioned the same way `ImportIssue` is: `{ questionId, index, field,
// message }`, `index` into `bank.questions` (or `bank.groups`, or -1 for the
// document as a whole) — so a structural issue and a cross-field issue from
// the same import read as one shape.

import { Validator, type OutputUnit } from "@cfworker/json-schema";
import bankSchema from "../../../../schemas/bank-1.json" with { type: "json" };
import questionSchema from "../../../../schemas/question-1.json" with { type: "json" };

export interface StructuralIssue {
  questionId: string | null;
  index: number;
  field: string;
  message: string;
}

// cfworker reports a failure at every level it bubbles through — `allOf`,
// `$ref`, `properties`, `items` and friends — never useful on their own,
// always alongside the one leaf error (`required`, `type`, `minItems`, …)
// that actually says what is wrong. Dropped here rather than threaded
// through field-by-field logic below.
const WRAPPER_KEYWORDS = new Set([
  "properties",
  "items",
  "allOf",
  "anyOf",
  "oneOf",
  "if",
  "then",
  "else",
  "$ref",
  "not",
  "propertyNames",
  "dependentSchemas",
  "true",
  "false",
]);

function pathOf(instanceLocation: string): string[] {
  return instanceLocation.replace(/^#\/?/, "").split("/").filter(Boolean);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The field a leaf error is about, from its own keyword and JSON pointer. */
function fieldOf(err: OutputUnit, path: string[], container: string | null): string {
  if (err.keyword === "required") {
    // "Instance does not have required property \"options\"."
    return /required property "([^"]+)"/.exec(err.error)?.[1] ?? container ?? "document";
  }
  // `path` looks like ["questions", "5", "options", "0"] — the field is the
  // first segment *after* the element's own index.
  if (path.length > 2) return path[2]!;
  // The element itself is malformed (wrong type, not an object at all): name
  // the array it lives in, the same convention `validateBank` uses for its
  // own "entry is not an object" issues.
  if (container) return container;
  if (err.keyword === "additionalProperties") {
    // "Property \"bogus\" does not match additional properties schema."
    return /Property "([^"]+)"/.exec(err.error)?.[1] ?? "document";
  }
  return path[0] ?? "document";
}

// Fix round 1, finding 6: built once, at module load, not once per request.
// The schemas are static JSON modules, `Validator.validate()` does not
// mutate `this` (it reads the `lookup` built in the constructor and
// `addSchema`), and an isolate reuses this module across requests — so a
// shared instance is safe and avoids re-dereferencing both schemas inside
// every request's CPU budget.
const validator = new Validator(bankSchema as never, "2020-12", false);
validator.addSchema(questionSchema as never);

/**
 * Checks `doc` against `schemas/bank-1.json` (which `$ref`s
 * `schemas/question-1.json` for each entry in `questions`). Never throws —
 * a document that is not even an object still comes back as a (possibly
 * empty) issue list, the same contract `validateBank` keeps.
 */
export function validateBankDocumentStructure(doc: unknown): StructuralIssue[] {
  const { errors } = validator.validate(doc);

  const issues: StructuralIssue[] = [];
  for (const err of errors) {
    if (WRAPPER_KEYWORDS.has(err.keyword)) continue;

    const path = pathOf(err.instanceLocation);
    const container = path[0] === "questions" || path[0] === "groups" ? path[0] : null;
    const index = container !== null && Number.isInteger(Number(path[1])) ? Number(path[1]) : -1;

    // ponytail: the bank schema's own `additionalProperties: false` fires a
    // second, document-root error for any malformed `questions`/`groups`
    // entry, duplicating the deeper, correctly-positioned error every such
    // case already produces (see the cfworker experiment this comment
    // documents the outcome of). A genuinely unknown top-level field (no
    // deeper error exists to shadow it) has nothing else reporting it, so
    // only that case is kept.
    if (err.instanceLocation === "#" && err.keyword === "additionalProperties") {
      const prop = /Property "([^"]+)"/.exec(err.error)?.[1];
      if (prop === "questions" || prop === "groups") continue;
    }

    const questions = isRecord(doc) && Array.isArray(doc.questions) ? doc.questions : undefined;
    const entry: unknown = container === "questions" ? questions?.[index] : undefined;
    const questionId = isRecord(entry) && typeof entry.id === "string" ? entry.id : null;

    issues.push({ questionId, index, field: fieldOf(err, path, container), message: err.error });
  }
  return issues;
}
