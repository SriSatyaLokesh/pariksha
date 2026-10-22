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

  // `civilFromDays` is a hand transcription of Hinnant's algorithm, which
  // `packages/core`'s purity gate forces on us in place of `Date` (see the
  // function's own comment). A transcription is right or wrong per BRANCH,
  // not overall, and one date exercises only one path: March-to-December,
  // non-leap, mid-month. These are the branches that date could not reach.
  //
  // `Date.UTC` is the oracle deliberately — the thing under test is whether
  // the arithmetic agrees with the platform's own calendar, so comparing it
  // to a hand-written expectation would only pin my arithmetic against my
  // arithmetic.
  it.each([
    // The year-rollback branch: Hinnant's era starts in March, so January
    // and February belong to the PREVIOUS era-year and the final
    // `y + (m <= 2 ? 1 : 0)` is what puts them back. Wrong, and every
    // January export lands in the wrong year.
    ["January, the year-rollback branch", Date.UTC(2026, 0, 1, 0, 0), "20260101-0000"],
    ["February, the same branch", Date.UTC(2026, 1, 28, 23, 59), "20260228-2359"],
    // A real leap day. 2028 is a leap year; 29 February exists only if the
    // `yoe / 4` and `yoe / 100` corrections are both right.
    ["a leap day", Date.UTC(2028, 1, 29, 12, 0), "20280229-1200"],
    // 2100 is NOT a leap year (divisible by 100, not by 400) — the century
    // rule, which a naive `% 4` gets wrong and which no test in 2026 would
    // otherwise reach.
    ["the day after a skipped leap day", Date.UTC(2100, 2, 1, 6, 30), "21000301-0630"],
    // Month end into month start, and the last minute of a year.
    ["a month end", Date.UTC(2026, 6, 31, 23, 59), "20260731-2359"],
    ["the last minute of a year", Date.UTC(2026, 11, 31, 23, 59), "20261231-2359"],
    // The epoch itself: `z === 0`, the boundary of the documented
    // non-negative assumption.
    ["the epoch", 0, "19700101-0000"],
  ])("formats %s in UTC", (_label, at, expected) => {
    expect(csvFilename("s", "results", at)).toBe(`s_results_${expected}.csv`);
  });
});
