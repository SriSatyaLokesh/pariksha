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
  expect(issues[0]).toMatchObject({ line: 1, message: expect.stringMatching(re) });
});

it("GIFT comments, blank-line separation and escaped specials are handled", () => {
  expect(convertGift("// a comment\n\n::q:: 2 \\+ 2 is {#4}").bank.questions).toHaveLength(1);
});

it("a GIFT file with any error imports nothing", async () => {
  await importGift("one-bad.gift");
  expect(await questionCount()).toBe(0);
});
