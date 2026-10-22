// `K8`/`K38`/`KG6` (Phase 8a Task 4): `toCsv` is the one CSV serialiser and
// `csvFilename` is R-10's exact shape. The round-trip tests below import
// `readDelimited` from `apps/api/src/import/rows.ts` — the repo's existing
// reader — rather than asserting string literals: writer and reader proving
// each other is cheaper than a second grammar.

import { describe, expect, it } from "vitest";
import { readDelimited } from "../../../apps/api/src/import/rows.js";
import type { CsvColumn } from "../src/csv.js";
import { csvFilename, toCsv } from "../src/csv.js";

type Row = Record<string, string | number | boolean | null | undefined>;

function col<T extends Row>(name: keyof T & string): CsvColumn<T> {
  return { header: name, value: (row) => row[name] };
}

const BOM = String.fromCharCode(0xfeff);
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

describe("toCsv", () => {
  it("leads with a UTF-8 BOM", () => {
    expect([...new TextEncoder().encode(toCsv([{ a: 1 }], [col("a")]))].slice(0, 3)).toEqual([
      0xef, 0xbb, 0xbf,
    ]);
  });

  it("omits the BOM and the header on a continuation page", () => {
    const page = toCsv([{ a: 1 }], [col("a")], { bom: false, header: false });
    expect(page.startsWith(BOM)).toBe(false);
    expect(page).toBe("1\r\n");
  });

  it("quotes a cell holding a comma, a quote, a newline and a non-Latin name", () => {
    const nasty = 'சத்யா, "the" tester\nsecond line';
    const out = toCsv([{ a: nasty }], [col("a")]);
    expect(out).toContain('"சத்யா, ""the"" tester\nsecond line"');
  });

  it("round-trips through the repo's own reader", () => {
    const rows = [{ a: 'x,"y"', b: "z" }];
    const out = toCsv(rows, [col("a"), col("b")]);
    expect(readDelimited(stripBom(out))).toEqual([
      ["a", "b"],
      ['x,"y"', "z"],
    ]);
  });

  it("round-trips a single cell carrying all four hazards together", () => {
    // The trap: a comma, a double quote, an embedded newline and a
    // non-Latin name all in the same cell. Four separate cells, each with
    // one hazard, would not catch a quoting bug that only appears when
    // they combine — this is the one honest test of RFC 4180 quoting
    // (AC-27) feeding back through the repo's own reader.
    const nasty = 'சத்யா, "the" tester\nsecond line';
    const out = toCsv([{ a: nasty }], [col("a")]);
    expect(readDelimited(stripBom(out))).toEqual([["a"], [nasty]]);
  });

  it("writes an absent value as an empty cell, never as 'undefined'", () => {
    expect(toCsv([{ a: undefined }], [col("a")])).toContain("\r\n\r\n");
  });
});

describe("csvFilename", () => {
  it("names the file R-10's way", () => {
    expect(csvFilename("math-final", "results", Date.UTC(2026, 9, 22, 14, 35))).toBe(
      "math-final_results_20261022-1435.csv",
    );
  });
});
