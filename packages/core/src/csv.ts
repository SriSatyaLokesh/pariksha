// `K8`: the one CSV serialiser. `apps/api/src/import/rows.ts` already owns
// the reader (`readDelimited` / `readDelimitedRows`) this writer round-trips
// against — same RFC 4180 grammar, opposite direction. Swap for a dependency
// if the matrix ever outgrows hand-written quoting (that file's own comment
// makes the same point about the reader it feeds).

/** One column of an export: the header cell, verbatim, and how to read the
 * cell's value out of a row. */
export interface CsvColumn<T> {
  /** The header cell, verbatim. R-08 uses registration-field labels here. */
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

function csvCell(raw: string | number | boolean | null | undefined): string {
  const text = raw === null || raw === undefined ? "" : String(raw);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 quoting, CRLF line endings, and a leading UTF-8 BOM when `bom`
 * is true. `bom: false` is for appending a later page to a file that already
 * carries one (`K38`). */
export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  opts?: { bom?: boolean; header?: boolean },
): string {
  const bom = opts?.bom ?? true;
  const header = opts?.header ?? true;
  const lines: string[] = [];
  if (header) lines.push(columns.map((c) => csvCell(c.header)).join(","));
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  const body = lines.map((line) => `${line}\r\n`).join("");
  return (bom ? String.fromCharCode(0xfeff) : "") + body;
}

// `packages/core` owns no clock (test/acceptance.test.ts's purity gate bans
// `new Date`/`Date.now` etc. under src, even applied to a caller-supplied
// timestamp) — so epoch milliseconds are decomposed into UTC calendar
// fields by arithmetic instead. Days-since-epoch to y/m/d is Howard
// Hinnant's `civil_from_days` (public domain,
// http://howardhinnant.github.io/date_algorithms.html).
// ponytail: assumes `z >= 0` (1970-01-01 UTC or later) — every caller here
// passes a real export timestamp, never a pre-epoch one; add the negative
// branch if that ever stops being true.
function civilFromDays(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

/** `<slug>_<kind>_<YYYYMMDD-HHMM>.csv`, R-10's exact shape. Formats in UTC —
 * a filename that differs by the organiser's timezone is two files for one
 * export. */
export function csvFilename(slug: string, kind: string, at: number): string {
  const days = Math.floor(at / 86_400_000);
  const msOfDay = at - days * 86_400_000;
  const { y, m, d } = civilFromDays(days);
  const hours = Math.floor(msOfDay / 3_600_000);
  const minutes = Math.floor((msOfDay % 3_600_000) / 60_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${slug}_${kind}_${y}${pad(m)}${pad(d)}-${pad(hours)}${pad(minutes)}.csv`;
}

/** One page of an export. A route that reached its bound ALWAYS returns a
 * cursor — there is no shape where a full-looking page is a partial file. */
export interface CsvPage {
  csv: string;
  nextCursor: string | null;
}
