// Import — CSV, positions translated through the header offset (#52,
// P4.8). `readDelimited` and `convertCsv` are exercised directly (no bank,
// no DB); the positioned-error tests go through the real app, the same way
// json.test.ts exercises JSON import, so it is the *route's* translation of
// `Converted.lines` that is proven, not just the converter in isolation.
//
// Review Focus 4, and why each positioned test here would fail against an
// off-by-one: `bad-key.csv` has a header plus three data rows, with the
// defect on the third. A converter that forgot the header (`lines[i] = i +
// 1`) would report line 3, not 4 — these tests assert the exact line, not
// merely that a line is present, so that mistake fails them. `short-row.csv`
// and `ordering-row.csv` put their defect on *different* rows (1 and 2 of
// the data) for the same reason: a translation that happened to work for
// one row by coincidence (off-by-one cancelling out) is caught by the
// other.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { validateBank } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { CSV_COLUMNS, convertCsv } from "../../src/import/csv.js";
import { IMPORT_MAX_TEXT_LENGTH } from "../../src/import/json.js";
import { readDelimited } from "../../src/import/rows.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

/** Builds one CSV data row from named columns, defaulting every column this
 * test doesn't care about to "" — avoids hand-counting commas (easy to get
 * wrong, as `csv.ts`'s own 10-column grammar punishes silently) for the
 * inline fixtures below. */
function csvRow(overrides: Partial<Record<(typeof CSV_COLUMNS)[number], string>>): string {
  return CSV_COLUMNS.map((c) => overrides[c] ?? "").join(",");
}
const CSV_HEADER = CSV_COLUMNS.join(",");

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const IMPORT_ROUTE_KEY = "/api/v1/workspaces/:id/banks/:bankId/import";

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), "utf8");
}

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

let workspaceId = "";
let authorCookie = "";
let bankId = "";

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, { email: `owner-${suffix}@csv.test`, authProvider: "magic_link", now: FIXED_NOW });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `csv-${suffix}`, name: "CSV Co" }),
  );
  workspaceId = (await created.json()).id;

  const authorId = await createUser(deps.db, { email: `author-${suffix}@csv.test`, authProvider: "magic_link", now: FIXED_NOW });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const bankRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks`,
    send("POST", authorCookie, { name: "Bank" }),
  );
  bankId = (await bankRes.json()).id;
});

function importCsv(fixtureName: string): Promise<Response> {
  return app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/import?format=csv`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "text/csv" },
    body: read(fixtureName),
  });
}

function importJson(doc: unknown): Promise<Response> {
  return app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`, send("POST", authorCookie, doc));
}

async function questionCount(): Promise<number> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions?limit=200`,
    send("GET", authorCookie),
  );
  return (await res.json()).questions.length;
}

it.each([
  ['a,"b,c",d\n', [["a", "b,c", "d"]]],
  ['a,"line\nbreak",c\n', [["a", "line\nbreak", "c"]]],
  ['a,"say ""hi""",c\n', [["a", 'say "hi"', "c"]]],
  ["﻿a,b\r\nc,d\r\n", [["a", "b"], ["c", "d"]]],
])("readDelimited parses %j", (text, rows) => {
  expect(readDelimited(text)).toEqual(rows);
});

it("the five CSV types convert into pariksha/bank@1 and pass validateBank", () => {
  const { bank, issues } = convertCsv(read("five-types.csv"));
  expect(issues).toEqual([]);
  expect(bank.questions.map((q) => q.type)).toEqual(["single", "multiple", "true_false", "numeric", "fill_blank"]);
  expect(validateBank(bank).ok).toBe(true);
});

it("Review Focus 4: a bad key reports the CSV line, not the question index", async () => {
  const res = await importCsv("bad-key.csv"); // header + 3 rows, defect on row 3 => line 4
  expect((await res.json()).error.details.issues[0]).toMatchObject({ line: 4, field: "key" });
  expect(await questionCount()).toBe(0);
});

it("Review Focus 4: the message is identical to the one the same defect gets as JSON", async () => {
  const viaCsv = (await (await importCsv("bad-key.csv")).json()).error.details.issues[0].message;
  const sameDefectAsJson = {
    format: "pariksha/bank@1",
    name: "Bank",
    questions: [
      {
        id: "Q3",
        type: "single",
        prompt: "Pick one.",
        options: [
          { id: "X", text: "X" },
          { id: "Y", text: "Y" },
        ],
        key: "z",
      },
    ],
  };
  const viaJson = (await (await importJson(sameDefectAsJson)).json()).error.details.issues[0].message;
  expect(viaCsv).toBe(viaJson);
});

it("a CSV naming a type outside the five is a positioned error", async () => {
  expect((await (await importCsv("ordering-row.csv")).json()).error.details.issues[0]).toMatchObject({
    line: 2,
    field: "type",
    code: "csv_unsupported_type",
    message: expect.stringMatching(/csv import supports.*ordering/i),
  });
});

it("a row with the wrong column count reports its line rather than shifting every field", async () => {
  expect((await (await importCsv("short-row.csv")).json()).error.details.issues[0]).toMatchObject({
    line: 3,
    code: "csv_column_count",
  });
});

// Fix round 1, finding 3: `lines[i]` used to be `rowIndex + 2`, which is row
// arithmetic, not line arithmetic — it silently assumed every CSV row is
// exactly one physical line. `embedded-newline.csv`'s first data row quotes
// a field with an embedded newline, so it spans physical lines 2-3; its
// second data row (the one with the bad key) actually starts at physical
// line 4, not line 3 the way `rowIndex + 2` would claim. This is the exact
// feature `readDelimitedRows`/`rows.ts` exists for.
it("a quoted field with an embedded newline does not shift later rows' reported line", async () => {
  expect((await (await importCsv("embedded-newline.csv")).json()).error.details.issues[0]).toMatchObject({
    line: 4,
    field: "key",
  });
});

// Fix round 1, finding 11: the header was never read before, only skipped —
// a column-reordered (or simply wrong) header then has every cell bound to
// the wrong field, and only a coincidental type mismatch would ever surface
// it. Now checked once, loudly, rather than silently misread.
it("a CSV whose header does not match CSV_COLUMNS is a single loud error, not a silent misread", () => {
  const reordered = ["type", "id", "prompt", "options", "key", "points", "mode", "difficulty", "tags", "explanation"].join(",");
  const { bank, issues } = convertCsv(`${reordered}\nsingle,Q1,P,A|B,A,,,,,\n`);
  expect(bank.questions).toEqual([]);
  expect(issues[0]).toMatchObject({ line: 1, field: "header", code: "csv_header_mismatch" });
});

// Fix round 1, finding 10: a line with nothing between two newlines (one
// editors routinely append at end of file, or leave in the middle) used to
// become a spurious one-column row, reported as "expected 10 columns, got
// 1" even though the file has no real defect.
it("a blank line is not a spurious short row", () => {
  const row = csvRow({ id: "Q1", type: "true_false", prompt: "P", key: "true" });
  const row2 = csvRow({ id: "Q2", type: "true_false", prompt: "P2", key: "true" });
  const { issues, bank } = convertCsv(`${CSV_HEADER}\n${row}\n\n${row2}\n`);
  expect(issues).toEqual([]);
  expect(bank.questions).toHaveLength(2);
});

// Fix round 1, finding 1 (critical): a cell that does not fit its own
// grammar used to become a *plausible wrong answer* rather than a reported
// defect. Each case below is squarely "what the converter could not parse
// at all" — the converter's own charter — not a second copy of a
// `validateBank` rule.
it.each([
  // Excel's own autoformat of a `true` cell — silently became `false`.
  [csvRow({ id: "Q1", type: "true_false", prompt: "P", key: "TRUE" }), "key", "csv_unparseable_value"],
  // A blank numeric key — `Number("")` is `0`, a plausible correct answer.
  [csvRow({ id: "Q1", type: "numeric", prompt: "P", key: "" }), "key", "csv_unparseable_value"],
  // A non-numeric numeric key — `Number("abc")` is `NaN`, which
  // `JSON.stringify` silently turns into `null`.
  [csvRow({ id: "Q1", type: "numeric", prompt: "P", key: "abc" }), "key", "csv_unparseable_value"],
  // A non-numeric points cell — same NaN-to-null path into `scoring.points`.
  [csvRow({ id: "Q1", type: "true_false", prompt: "P", key: "true", points: "abc" }), "points", "csv_unparseable_value"],
])("a cell that cannot be parsed at all is a reported issue, not a plausible wrong answer (%#)", (row, field, code) => {
  const { bank, issues } = convertCsv(`${CSV_HEADER}\n${row}\n`);
  expect(bank.questions).toEqual([]);
  expect(issues[0]).toMatchObject({ field, code });
});

// Task 8's own version of json.test.ts's "measures the real subrequest cost"
// test: the same route, the same handler, and — because a CSV bank never
// declares groups (no column for one) — the group-free number that test's
// own `bankOf(200)` case measures for JSON, not the 7 a bank with groups
// costs. Pinned with `toBe` (fix round 1, finding 5, applied here too), and
// checked against the one `ROUTE_BUDGETS` entry this route shares with
// every format.
it("measures the real subrequest cost of importing via CSV, within the route's shared budget", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import?format=csv`,
    { method: "POST", headers: { cookie: authorCookie, "content-type": "text/csv" }, body: read("five-types.csv") },
  );

  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBe(6);
  expect(counting.counts().total).toBeLessThanOrEqual(ROUTE_BUDGETS[IMPORT_ROUTE_KEY]!);
});

// Fix round 1, finding 8: the JSON path's size gate runs immediately after
// one native `JSON.parse` call; CSV has none, so `readDelimited`'s
// per-character scan would otherwise run to completion on an unbounded body
// before `IMPORT_MAX_QUESTIONS` (which only sees a question count that
// exists *after* conversion) ever got a chance to refuse it. Refused here on
// the raw text length, before `convertCsv` runs at all — no DB calls spent
// either, since `bankOr404` already ran before this gate.
it("an oversized CSV body is refused before the converter runs at all", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/import?format=csv`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "text/csv" },
    body: "x".repeat(IMPORT_MAX_TEXT_LENGTH + 1),
  });
  expect(res.status).toBe(413);
  expect(await questionCount()).toBe(0);
});
