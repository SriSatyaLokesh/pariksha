// RFC 4180 by hand, not a dependency: quotes, `""` escapes, embedded
// newlines, CRLF, a leading BOM — the four cases the Worker bundle actually
// needs. Swap for `papaparse` if the matrix ever outgrows them (csv.ts's own
// comment makes the same point about the converter it feeds).

import type { Bank, ImportIssue } from "@pariksha/core";

/** Shared by every converter (csv.ts, gift.ts) — fix round 1, finding 9:
 * this was declared identically in both files, which is exactly the kind of
 * copy that drifts. `lines[i]` is the source line that produced
 * `bank.questions[i]`; `issues` are defects a converter found before a row
 * or block could become a question at all, each already carrying its own
 * `line` (never run through `lines`, because these never reached
 * `bank.questions`). */
export interface Converted {
  bank: Bank;
  lines: number[];
  issues: (ImportIssue & { line: number })[];
}

export interface DelimitedRow {
  fields: string[];
  /** The 1-based line of the source text this row *starts* on — not
   * `rowIndex + offset` (fix round 1, finding 3): a quoted field carrying
   * an embedded newline makes one CSV row span more than one physical
   * line, which row-index arithmetic has no way to see. */
  line: number;
}

/** Parses `text` into rows, each paired with the physical line it starts
 * on. A fully blank line (no quotes, no commas, nothing between two
 * newlines) produces no row at all — fix round 1, finding 10: without this,
 * a trailing blank line many editors add became a spurious one-column row. */
export function readDelimitedRows(text: string): DelimitedRow[] {
  const input = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: DelimitedRow[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let line = 1;
  let rowStartLine = 1;

  const pushRow = (): void => {
    row.push(field);
    rows.push({ fields: row, line: rowStartLine });
    row = [];
    field = "";
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r" && input[i + 1] === "\n") {
      line += 1;
      if (field !== "" || row.length > 0) pushRow();
      rowStartLine = line;
      i += 2;
    } else if (ch === "\n") {
      line += 1;
      if (field !== "" || row.length > 0) pushRow();
      rowStartLine = line;
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

/** `readDelimitedRows` without the per-row line numbers, for callers (and
 * tests) that only need the fields. */
export function readDelimited(text: string): string[][] {
  return readDelimitedRows(text).map((r) => r.fields);
}

/** Shared by csv.ts and gift.ts — fix round 1, finding 1: `Number("")` is
 * `0`, not an error, and `Number("abc")` is `NaN`, which `JSON.stringify`
 * silently turns into `null`. Both converters parse every numeric cell/entry
 * through this, so a blank or non-numeric value is "could not parse", an
 * issue, rather than a plausible-looking wrong answer. */
export function parseFiniteNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
