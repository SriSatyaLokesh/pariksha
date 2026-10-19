// Candidate-list CSV → rows (Task 9, #60 / #56, P5.7b).
//
// **The list needs no vocabulary of its own.** Every column is either the
// reserved `set` or a registration field id, and the identity column is
// the test's first `unique: true` field — so the header an organiser
// writes is the form they already built, and nothing has to be kept in
// step by hand. `examples/reasoning-aptitude/candidates.csv` is the worked
// reference.
//
// It is also what gives UX-17's "the registration form has at least one
// unique field" row teeth: without one, a list cannot be keyed at all, and
// the upload says so rather than inventing a key.
//
// Parsing is `readDelimitedRows`'s (apps/api/src/import/rows.ts, Phase 4
// Task 8) — the repo's one CSV reader, RFC 4180 by hand, and the reason
// every issue below already carries the physical source line rather than
// `rowIndex + 2`: a quoted field with an embedded newline makes one row
// span more than one line, which arithmetic cannot see.
//
// This file reports; it never throws and never writes. All-or-nothing is
// the route's and only the route's: `replaceCandidateList` runs only when
// `issues` is empty, and `rows` is partial whenever it is not.

import type { FormField, ImportIssue, RegistrationFormSpec } from "@pariksha/core";
import type { NewCandidate } from "@pariksha/db";
import { readDelimitedRows } from "./rows.js";

export type PositionedIssue = ImportIssue & { line: number };

export interface CandidateImportReport {
  imported: number;
  issues: PositionedIssue[];
}

/** The reserved column: a set *label* ("A"), matched against the labels the
 * test's `sets` sections declare. Never `attempt.set_no`. */
export const SET_COLUMN = "set";

/**
 * The field a list is keyed on: the first `unique: true` field in the
 * form's own order. One rule, stated once, because the panel prints it in
 * the expected-columns line and the converter keys on it — the two
 * disagreeing would mean an organiser uploading exactly what the screen
 * asked for and being refused.
 */
export function identityField(form: RegistrationFormSpec | undefined): FormField | null {
  return form?.fields.find((field) => field.unique === true) ?? null;
}

const issue = (line: number, field: string, message: string): PositionedIssue => ({
  questionId: null,
  index: -1,
  line,
  field,
  message,
});

export function convertCandidateCsv(
  text: string,
  form: RegistrationFormSpec | undefined,
  setLabels: readonly string[],
): { rows: NewCandidate[]; issues: PositionedIssue[] } {
  const parsed = readDelimitedRows(text);
  const header = parsed[0];
  if (header === undefined) {
    return { rows: [], issues: [issue(1, "header", "this file has no rows at all")] };
  }

  const identity = identityField(form);
  if (identity === null) {
    return {
      rows: [],
      issues: [
        issue(
          header.line,
          "header",
          "a candidate list is keyed on an identity column, so this test needs a registration field marked unique — " +
            "mark one (a roll number or a college email address) and upload again",
        ),
      ],
    };
  }

  const columns = header.fields.map((name) => name.trim());
  const fieldIds = new Set((form?.fields ?? []).map((field) => field.id));
  const issues: PositionedIssue[] = [];

  for (const name of columns) {
    if (name === SET_COLUMN || fieldIds.has(name)) continue;
    issues.push(
      issue(
        header.line,
        "header",
        `"${name}" is not a field of this test's registration form — every column is either a field id or the reserved "${SET_COLUMN}"`,
      ),
    );
  }

  const identityAt = columns.indexOf(identity.id);
  if (identityAt === -1) {
    issues.push(
      issue(
        header.line,
        "header",
        `this list needs a "${identity.id}" column — it is this test's first unique registration field, and the identity every row is keyed on`,
      ),
    );
  }

  const setAt = columns.indexOf(SET_COLUMN);
  const rows: NewCandidate[] = [];
  const seen = new Map<string, number>();

  for (const row of parsed.slice(1)) {
    if (row.fields.length !== columns.length) {
      issues.push(
        issue(
          row.line,
          "row",
          `has ${row.fields.length} column(s); the header has ${columns.length}`,
        ),
      );
      continue;
    }
    // Every later check reads a column by index, so a header the file
    // cannot be keyed against is reported once and the rows are skipped
    // rather than each inventing the same complaint.
    if (identityAt === -1) continue;

    const externalId = (row.fields[identityAt] ?? "").trim();
    if (externalId === "") {
      issues.push(issue(row.line, identity.id, `is empty — every row needs its ${identity.label.toLowerCase()}`));
      continue;
    }
    const first = seen.get(externalId);
    if (first !== undefined) {
      issues.push(issue(row.line, identity.id, `"${externalId}" is already used on line ${first}`));
      continue;
    }
    seen.set(externalId, row.line);

    const rawSet = setAt === -1 ? "" : (row.fields[setAt] ?? "").trim();
    if (rawSet !== "" && !setLabels.includes(rawSet)) {
      issues.push(
        issue(
          row.line,
          SET_COLUMN,
          setLabels.length === 0
            ? `no section defines a set "${rawSet}" — this test has no sets section, so leave the column empty`
            : `no section defines a set "${rawSet}" — this test defines ${setLabels.join(", ")}`,
        ),
      );
      continue;
    }

    // Prefill: every other column, by field id. A blank cell is left out
    // rather than stored as "", so a registration's own empty answer and
    // "the list said nothing" stay distinguishable.
    const formValues: Record<string, unknown> = {};
    columns.forEach((name, at) => {
      if (at === identityAt || name === SET_COLUMN || !fieldIds.has(name)) return;
      const value = (row.fields[at] ?? "").trim();
      if (value !== "") formValues[name] = value;
    });

    rows.push({ externalId, setLabel: rawSet === "" ? null : rawSet, formValues });
  }

  // `rows` holds only the lines that converted, so it is partial whenever
  // `issues` is non-empty. That is deliberate and the caller's business:
  // all-or-nothing is the route's gate (it refuses before reading `rows`
  // at all), and blanking the array here as well was a second copy of the
  // rule that no test could ever see fail — a mutation run found exactly
  // that and nothing caught it.
  return { rows, issues };
}

/** Every set label the test's `sets` sections declare, deduplicated — what
 * a `set` cell is checked against. */
export function setLabelsOf(sections: readonly unknown[]): string[] {
  const labels = new Set<string>();
  for (const section of sections) {
    const source = (section as { source?: { kind?: string; sets?: { set?: string }[] } }).source;
    if (source?.kind !== "sets") continue;
    for (const set of source.sets ?? []) {
      if (typeof set.set === "string") labels.add(set.set);
    }
  }
  return [...labels];
}

/**
 * The cap on an uploaded list, in bytes. A candidate row is a handful of
 * short cells, so 2 MB is tens of thousands of them — well past any
 * single sitting — and the limit exists so a Worker cannot be made to
 * buffer an arbitrary body, not to bound a realistic cohort.
 */
export const CANDIDATE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
