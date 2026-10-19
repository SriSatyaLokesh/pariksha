// Import — Moodle GIFT (#52, P4.8). `convertGift` is exercised directly for
// the five supported forms and for every unsupported construct GIFT can
// write; `one-bad.gift` goes through the real app to prove the route fails
// the whole import, the same all-or-nothing contract JSON and CSV both
// keep.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { validateBank } from "@pariksha/core";
import { createApp } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import { convertGift } from "../../src/import/gift.js";
import { IMPORT_MAX_TEXT_LENGTH } from "../../src/import/json.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

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
  const ownerId = await createUser(deps.db, { email: `owner-${suffix}@gift.test`, authProvider: "magic_link", now: FIXED_NOW });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `gift-${suffix}`, name: "GIFT Co" }),
  );
  workspaceId = (await created.json()).id;

  const authorId = await createUser(deps.db, { email: `author-${suffix}@gift.test`, authProvider: "magic_link", now: FIXED_NOW });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const bankRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks`,
    send("POST", authorCookie, { name: "Bank" }),
  );
  bankId = (await bankRes.json()).id;
});

function importGift(fixtureName: string): Promise<Response> {
  return app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/import?format=gift`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "text/plain" },
    body: read(fixtureName),
  });
}

async function questionCount(): Promise<number> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions?limit=200`,
    send("GET", authorCookie),
  );
  return (await res.json()).questions.length;
}

it("converts the five supported GIFT forms", () => {
  const { bank, issues } = convertGift(read("five-types.gift"));
  expect(issues).toEqual([]);
  expect(bank.questions.map((q) => q.type)).toEqual(["single", "multiple", "true_false", "numeric", "fill_blank"]);
  expect(validateBank(bank).ok).toBe(true);
});

it("GIFT ~%50% weights land as a partial-scoring multiple", () => {
  expect(convertGift("::q:: Pick {~%50%A ~%50%B ~%-100%C}").bank.questions[0]).toMatchObject({
    type: "multiple",
    key: ["A", "B"],
  });
});

it.each([
  ["matching", "::m:: Match {=a -> 1 =b -> 2}", /matching/i],
  ["essay", "::e:: Discuss {}", /essay/i],
  ["category", "$CATEGORY: /top/sub", /\$CATEGORY/],
  ["numeric range", "::n:: Value {#1..3}", /range/i],
])("an unsupported GIFT construct (%s) is a positioned error, never a silent skip", (_n, src, re) => {
  const { issues, bank } = convertGift(src);
  expect(bank.questions).toEqual([]);
  expect(issues[0]).toMatchObject({ line: 1, code: "gift_unsupported_construct", message: expect.stringMatching(re) });
});

it("GIFT comments, blank-line separation and escaped specials are handled", () => {
  expect(convertGift("// a comment\n\n::q:: 2 \\+ 2 is {#4}").bank.questions).toHaveLength(1);
});

// Fix round 1, finding 6: every case above puts its defect on line 1 of a
// single-line input, so an implementation that hard-coded `line: 1` would
// also pass all four. Here the construct is three lines in, behind a
// stripped comment and a real question — proving `stripComments` keeps each
// surviving line's *original* number (not its position after comments are
// removed) and that `splitBlocks` reports a block's own first line, not the
// block's ordinal position.
it("an unsupported construct's reported line survives a stripped comment and an earlier question", () => {
  const src = ["// leading comment", "::q1:: The sky is blue. {T}", "", "::m:: Match {=a -> 1 =b -> 2}"].join("\n");
  const { issues, bank } = convertGift(src);
  expect(bank.questions).toHaveLength(1);
  expect(issues[0]).toMatchObject({ line: 4, code: "gift_unsupported_construct" });
});

// Fix round 1, finding 7+6 together: this used to discard the response, so
// a route that 500'd would also leave zero questions and still pass; and it
// asserted nothing about *where* the import failed. `one-bad.gift`'s bad
// block (a matching question, "->") is on line 3, not line 1.
it("a GIFT file with any error imports nothing, and reports the real failure", async () => {
  const res = await importGift("one-bad.gift");
  expect(res.status, await res.clone().text()).toBe(422);
  expect((await res.json()).error.details.issues[0]).toMatchObject({
    line: 3,
    code: "gift_unsupported_construct",
    message: expect.stringMatching(/matching/i),
  });
  expect(await questionCount()).toBe(0);
});

// Fix round 1, finding 2 (critical): a block with only `~` entries and no
// positively-weighted one used to fall back to `entries[0]`, silently
// marking the first option correct — a clean "imported" report with a
// fabricated answer key. Now reported, not guessed at.
it("a GIFT answer block with no correct answer is a positioned error, not a fabricated one", () => {
  const { issues, bank } = convertGift("::q:: Pick {~A ~B ~C}");
  expect(bank.questions).toEqual([]);
  expect(issues[0]).toMatchObject({ field: "key", code: "gift_no_correct_answer" });
});

// Fix round 1, finding 4: `splitBlocks`' brace-depth count used to be a raw
// character scan with no escape awareness, unlike `findBraces`'s own. A
// legal `\{` in a prompt left `depth` stuck above zero forever, so no later
// blank line could ever separate blocks again — the entire rest of the file
// silently collapsed into one question.
it("an escaped brace in a prompt does not swallow the rest of the file", () => {
  const src = ["::q1:: Use the \\{ symbol. {T}", "", "::q2:: The sky is blue. {T}"].join("\n");
  const { bank, issues } = convertGift(src);
  expect(issues).toEqual([]);
  expect(bank.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
});

// Fix round 1, finding 5: GIFT's per-answer feedback (`=Paris#Correct!`) was
// glued onto the option's own id and text rather than stripped — one of the
// most common things in a real Moodle export.
it("per-answer feedback (#...) is stripped from option text, not glued onto it", () => {
  const { bank } = convertGift("::q:: Pick the capital. {=Paris#Correct! ~Lyon#No}");
  expect(bank.questions[0]).toMatchObject({ type: "single", key: "Paris", options: [{ text: "Paris" }, { text: "Lyon" }] });
});

// Fix round 1, finding 12: the weight regex only matched integers, so a
// fractional weight (`%33.3%`) folded into the option's own text instead of
// being parsed as a weight.
it("a fractional answer weight is parsed, not folded into option text", () => {
  const { bank } = convertGift("::q:: Pick {~%33.3%A ~%66.7%B}");
  expect(bank.questions[0]).toMatchObject({ options: [{ text: "A" }, { text: "B" }] });
});

// Fix round 1, finding 13: a bare `.includes("->")` misreported a
// legitimate option whose text merely contains "->" with no surrounding
// whitespace as a matching question.
it("an option containing '->' without surrounding spaces is not misreported as matching", () => {
  const { bank, issues } = convertGift("::q:: Pick {=A->B ~C}");
  expect(issues).toEqual([]);
  expect(bank.questions[0]).toMatchObject({ type: "single", key: "A->B" });
});

// Fix round 1, finding 8: the same size gate csv.test.ts proves — refused
// on raw text length before either converter (here, `convertGift`) ever
// runs, since both share `importBankText`'s one check.
it("an oversized GIFT body is refused before the converter runs at all", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/import?format=gift`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "text/plain" },
    body: "x".repeat(IMPORT_MAX_TEXT_LENGTH + 1),
  });
  expect(res.status).toBe(413);
  expect(await questionCount()).toBe(0);
});

// Round-trips the whole pipeline a unit test of `convertGift` alone cannot:
// `validateBankDocumentStructure` (the JSON Schema) sees the bank too, not
// just `validateBank`'s cross-field rules — so this also confirms the
// options/blanks/key shapes `convertGift` builds satisfy schemas/
// question-1.json, not only this package's own cross-field checks.
it("the five supported GIFT forms import whole through the real route", async () => {
  const res = await importGift("five-types.gift");
  expect(res.status, await res.clone().text()).toBe(200);
  expect(await questionCount()).toBe(5);
});
