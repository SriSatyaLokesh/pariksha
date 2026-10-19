// Export — bank and question JSON round-trip (#53, P4.9). This is the other
// half of AC-05: Task 7's import (apps/api/src/import/json.ts) writes a
// `pariksha/bank@1` document to rows; this reads those rows back into one.
// The round trip is the net that catches a regression in either
// `toQuestionRow`/`toQuestionDocument` (Task 2, packages/db/src/repo/
// question-document.ts) or the mapping this task adds
// (apps/api/src/export/bank.ts) — proved against
// examples/reasoning-aptitude/questions.json, which exercises all twelve
// question types (docs/ROADMAP.md's Phase 4 gate), not a convenient subset.

import { afterAll, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateBank, type Bank, type Question } from "@pariksha/core";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps, mountedRoutes, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { validateBankDocumentStructure } from "../../src/import/schema.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const EXPORT_ROUTE_KEY = "/api/v1/workspaces/:id/banks/:bankId/export";
const QUESTION_EXPORT_ROUTE_KEY = "/api/v1/workspaces/:id/banks/:bankId/questions/:qid/export";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as unknown;
}

/** A fresh parse per call: a caller mutating its own copy (the `?ids=`
 * selection tests below) never corrupts another test's. All twelve
 * `QUESTION_TYPES`, one passage group, per docs/ROADMAP.md's Phase 4 gate —
 * this is the file the gate itself names. */
function exampleBank(): Bank {
  return readJson("examples/reasoning-aptitude/questions.json") as Bank;
}

/** `n` minimal, valid, distinct questions, no groups — the fixture Review
 * Focus 3 (json.test.ts) and this task's own budget test both isolate the
 * question-count axis with, the same shape `bankOf` already takes there. */
function bankOf(n: number): Bank {
  return {
    format: "pariksha/bank@1",
    name: `Bank of ${n}`,
    questions: Array.from({ length: n }, (_, i) => ({
      id: `Q-${String(i).padStart(4, "0")}`,
      type: "true_false",
      prompt: `Question ${i}`,
      key: true,
    })),
  };
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
let viewerCookie = "";
let bankId = "";

/** A fresh workspace, Author, Viewer and empty bank — the same shape
 * json.test.ts and banks.test.ts both set up. */
beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@export.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `exp-${suffix}`, name: "Export Co" }),
  );
  workspaceId = (await created.json()).id;

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@export.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@export.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  viewerCookie = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

  const bankRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks`,
    send("POST", authorCookie, { name: "Bank" }),
  );
  bankId = (await bankRes.json()).id;
});

function importJson(doc: unknown): Promise<Response> {
  return app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`, send("POST", authorCookie, doc));
}

async function exportBank(qs = ""): Promise<Bank> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export${qs}`,
    send("GET", authorCookie),
  );
  return (await res.json()) as Bank;
}

async function internalQuestionId(refId: string): Promise<string> {
  const rows = await deps.db.query<{ id: string }>(
    "SELECT id FROM question WHERE workspace_id = ? AND bank_id = ? AND ref_id = ?",
    [workspaceId, bankId, refId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no such question: ${refId}`);
  return row.id;
}

/** `createBank` only ever sets a name — `importBankJson` writes groups and
 * questions, never the bank's own name/description/license (Task 7's
 * `writeImportedBank`). A byte-for-byte round trip needs those three set to
 * match the document under test, the same way an Author would set them
 * through the bank settings screen before importing content into it. */
async function matchBankMetadata(doc: Bank): Promise<void> {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}`,
    send("PATCH", authorCookie, {
      name: doc.name,
      ...(doc.description !== undefined && { description: doc.description }),
      ...(doc.license !== undefined && { license: doc.license }),
    }),
  );
}

async function patchQuestion(refId: string, doc: Question): Promise<Response> {
  const qid = await internalQuestionId(refId);
  return app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${qid}`,
    send("PATCH", authorCookie, doc),
  );
}

/** `POST .../questions`, not import — the question-create route's
 * `assertValid` only blocks on `isSaveTimeIssue` (`group` or
 * `unsafe_regex`), so a question whose options share text saves here even
 * though `validateBank` (and, since Fix round 1 finding 2, export itself)
 * refuses it — exactly the "ordinary mid-draft state" the Task 6 ruling
 * protects. */
function postQuestion(doc: Question): Promise<Response> {
  return app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`, send("POST", authorCookie, doc));
}

function exportWithout(doc: Bank, id: string): Bank {
  return { ...doc, questions: doc.questions.filter((q) => q.id !== id) };
}

/** Sorted by `id` — `question.created_at` is identical for every row a
 * single bulk import writes (`writeImportedBank`'s one `db.batch()`), so
 * `listQuestions`' `ORDER BY created_at, id` tie-breaks on the row's own
 * internal, randomly generated id (packages/db/src/ids.ts's `newId`) rather
 * than the order a document's `questions` array held them in. There is no
 * column recording that order (Phase 4 never modelled one — only an
 * ordering-type *question*'s own item order is, via `ReorderableList`), so
 * "round-trips with no loss" is checked here as set equality, field for
 * field, not array-position equality — a pre-existing property of
 * `listQuestions` this task's file scope does not touch. */
function byId(doc: Bank): Bank {
  return { ...doc, questions: [...doc.questions].sort((a, b) => a.id.localeCompare(b.id)) };
}

it("AC-04 / AC-05: the example bank round-trips byte-for-byte through import and export", async () => {
  const bank = exampleBank();
  await matchBankMetadata(bank);
  const importRes = await importJson(bank);
  expect(importRes.status, await importRes.clone().text()).toBe(200);

  const out = await exportBank();
  expect(byId(out)).toEqual(byId({ ...bank, $schema: expect.any(String) }));
});

it("the exported document validates against bank-1.json and question-1.json", async () => {
  await importJson(exampleBank());
  const out = await exportBank();

  expect(validateBankDocumentStructure(out)).toEqual([]);
  expect(validateBank(out).ok).toBe(true);
});

it("every one of the 12 types survives the round trip, field for field", async () => {
  const bank = exampleBank();
  await importJson(bank);
  const out = await exportBank();

  // Not a convenient subset: the fixture itself must carry all twelve.
  expect(new Set(bank.questions.map((q) => q.type)).size).toBe(12);

  for (const q of bank.questions) {
    expect(
      out.questions.find((e) => e.id === q.id),
      q.type,
    ).toEqual(q);
  }
});

it("Review Focus 2: a question whose type was changed away and back exports no stale field", async () => {
  const bank = exampleBank();
  await importJson(bank);

  const original = bank.questions.find((q) => q.id === "QNT-003");
  if (!original || original.type !== "select_k") throw new Error("fixture changed under this test");

  const asSingle: Question = {
    id: "QNT-003",
    type: "single",
    prompt: original.prompt,
    options: original.options,
    key: "b",
  };
  await patchQuestion("QNT-003", asSingle);
  const backRes = await patchQuestion("QNT-003", original);
  expect(backRes.status, await backRes.clone().text()).toBe(200);

  const out = await exportBank();
  const q = out.questions.find((e) => e.id === "QNT-003");
  expect(q).toEqual(original);
  expect(validateBank({ format: "pariksha/bank@1", name: "x", questions: [q] }).ok).toBe(true);
});

it("export carries no internal identifier", async () => {
  await importJson(exampleBank());
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export`,
    send("GET", authorCookie),
  );
  const text = await res.text();
  for (const leak of ["workspace_id", "qst_", "bnk_"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("a re-export after an unrelated question is edited leaves the others identical", async () => {
  const bank = exampleBank();
  await importJson(bank);
  const out = await exportBank();

  const log001 = bank.questions.find((q) => q.id === "LOG-001");
  if (!log001) throw new Error("fixture changed under this test");
  const edited: Question = { ...log001, prompt: "Edited prompt, unrelated to the rest of the bank." };
  const editRes = await patchQuestion("LOG-001", edited);
  expect(editRes.status, await editRes.clone().text()).toBe(200);

  const out2 = await exportBank();
  expect(exportWithout(out2, "LOG-001")).toEqual(exportWithout(out, "LOG-001"));
  // And the edit itself did land.
  expect(out2.questions.find((q) => q.id === "LOG-001")).toEqual(edited);
});

it("?ids= exports only the selected questions and still validates", async () => {
  await importJson(exampleBank());
  const sel = await exportBank("?ids=LOG-001,QNT-003");

  expect(sel.questions.map((q) => q.id)).toEqual(["LOG-001", "QNT-003"]);
  expect(validateBank(sel).ok).toBe(true);
});

// Fix round 1, finding 1: a round-trip test that never POSTs the exported
// document back to `/import` proves nothing about the actual round trip —
// `toEqual` against the bank already imported only proves export reads back
// what import wrote, not that import will take the result back. This is the
// proof the brief asked for.
it("AC-05's missing half: the exported document itself re-imports clean into a second bank", async () => {
  await importJson(exampleBank());
  const out = await exportBank();

  const secondBankRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks`,
    send("POST", authorCookie, { name: "Second bank" }),
  );
  const secondBankId = (await secondBankRes.json()).id;

  const reimportRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${secondBankId}/import`,
    send("POST", authorCookie, out),
  );
  expect(reimportRes.status, await reimportRes.clone().text()).toBe(200);

  const reexportRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${secondBankId}/export`,
    send("GET", authorCookie),
  );
  const reexported = (await reexportRes.json()) as Bank;
  // `name`/`description`/`license` are the *bank's* own metadata, never
  // written by `importBankJson` (Task 7 — confirmed by this file's own
  // `matchBankMetadata` helper, needed for exactly this reason) — the
  // second bank keeps the name it was created with, so only what import
  // actually writes (groups and questions) is compared here.
  expect(byId(reexported).questions).toEqual(byId(out).questions);
  expect(reexported.groups).toEqual(out.groups);
});

// Fix round 1, finding 1's two concrete breakages — closed by finding 2's
// fix: export now runs the same structural + cross-field checks import
// would, and refuses rather than hands back a file import would reject.
it("an empty bank is refused at export, not downloaded as a file its own import would reject", async () => {
  // `beforeEach` leaves `bankId` with no questions at all yet.
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/export`, send("GET", authorCookie));
  expect(res.status).toBe(422);
  const body = (await res.json()) as { error: { code: string; details: { issues: unknown[] } } };
  expect(body.error.code).toBe("not_exportable");
  expect(body.error.details.issues.length).toBeGreaterThan(0);
});

it("?ids= matching no real question is refused the same way an empty bank is", async () => {
  await importJson(exampleBank());
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export?ids=does-not-exist`,
    send("GET", authorCookie),
  );
  expect(res.status).toBe(422);
});

// Fix round 1, finding 2: the question-create route saves this (Task 6's own
// ruling — only `group`/`unsafe_regex` block a save), so the only place left
// to catch it is export itself, which is exactly what this proves.
it("a question with colliding option text reaches storage through the editor, and export refuses to re-emit it", async () => {
  await importJson(exampleBank());
  const bad: Question = {
    id: "COL-001",
    type: "single",
    prompt: "Pick one.",
    options: [
      { id: "o1", text: "X" },
      { id: "o2", text: "X" },
    ],
    key: "o2",
  };
  const createRes = await postQuestion(bad);
  expect(createRes.status, await createRes.clone().text()).toBe(201);

  const bankExportRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export`,
    send("GET", authorCookie),
  );
  expect(bankExportRes.status).toBe(422);
  const bankBody = (await bankExportRes.json()) as { error: { details: { issues: { code?: string }[] } } };
  expect(bankBody.error.details.issues.some((i) => i.code === "duplicate_option_text")).toBe(true);

  const qid = await internalQuestionId("COL-001");
  const questionExportRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${qid}/export`,
    send("GET", authorCookie),
  );
  expect(questionExportRes.status).toBe(422);
});

it("a Viewer cannot export", async () => {
  await importJson(exampleBank());
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export`,
    send("GET", viewerCookie),
  );
  expect(res.status).toBe(403);
});

it("exporting a bank in another workspace is 404, not 403", async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const otherOwnerId = await createUser(deps.db, {
    email: `other-${suffix}@export.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const otherCookie = await sessionCookie(deps, (await issueSession(deps, otherOwnerId)).token);
  const otherWorkspace = await app.request(
    "/api/v1/workspaces",
    send("POST", otherCookie, { slug: `other-${suffix}`, name: "Other Co" }),
  );
  const otherWorkspaceId = (await otherWorkspace.json()).id;

  const res = await app.request(
    `/api/v1/workspaces/${otherWorkspaceId}/banks/${bankId}/export`,
    send("GET", otherCookie),
  );
  expect(res.status).toBe(404);
});

it("exporting an unknown question is 404", async () => {
  await importJson(exampleBank());
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/qst_does_not_exist/export`,
    send("GET", authorCookie),
  );
  expect(res.status).toBe(404);
});

it("single-question export returns the question document, losslessly", async () => {
  const bank = exampleBank();
  await importJson(bank);
  const qid = await internalQuestionId("LOG-001");

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${qid}/export`,
    send("GET", authorCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(await res.json()).toEqual(bank.questions.find((q) => q.id === "LOG-001"));
});

it("exporting a bank with 200 questions stays within the route's budget", async () => {
  await importJson(bankOf(200));

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export`,
    send("GET", authorCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBeLessThanOrEqual(ROUTE_BUDGETS[EXPORT_ROUTE_KEY]!);
});

// The number in ROUTE_BUDGETS itself, measured against a realistic bank
// (seventeen questions, one passage group — examples/reasoning-aptitude/
// questions.json, not `bankOf(200)`'s group-free fixture), pinned with
// `toBe`, not `toBeLessThanOrEqual` — a budget that merely bounds the
// measurement from above would let a too-low guess ship uncaught, the same
// finding Task 7's review made of its own import budget.
it("measures the real subrequest cost of exporting a realistic bank against ROUTE_BUDGETS", async () => {
  await importJson(exampleBank());

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export`,
    send("GET", authorCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[EXPORT_ROUTE_KEY]!);
});

// `?ids=` must cost the same regardless of how many ids are named — the
// route always fetches the bank whole and filters in memory, so a selection
// of two costs exactly what the unfiltered export above costs.
it("?ids= costs the same as an unfiltered export, regardless of selection size", async () => {
  await importJson(exampleBank());

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/export?ids=LOG-001`,
    send("GET", authorCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[EXPORT_ROUTE_KEY]!);
});

// Fix round 1, finding 2's budget consequence: validating a single
// question's `group` reference for real (rather than always handing an
// empty `groups` array to `exportIssues` and risking a false "group does not
// exist" refusal on an otherwise-valid, group-referencing question) costs
// one more fetch — but only when the question actually names a group.
// Pinned against the worst case, "DIN-001" (references "library-loans"), not
// the cheapest realistic question — the same "measure the heavy case, not
// the convenient one" rule this task's other budgets already follow.
it("measures the real subrequest cost of the single-question export against ROUTE_BUDGETS", async () => {
  await importJson(exampleBank());
  const qid = await internalQuestionId("DIN-001");

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${qid}/export`,
    send("GET", authorCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[QUESTION_EXPORT_ROUTE_KEY]!);
});

// The cheap, common case: a question with no `group` costs no extra fetch at
// all — `assertQuestionExportable` only reads groups when the question
// names one.
it("a question with no group costs 2 less than one with a group, in the single-question export", async () => {
  await importJson(exampleBank());
  const qid = await internalQuestionId("LOG-001");

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${qid}/export`,
    send("GET", authorCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[QUESTION_EXPORT_ROUTE_KEY]! - 2);
});

it("every route this task mounts has a ROUTE_BUDGETS entry under the ceiling", () => {
  for (const r of mountedRoutes(app).filter((route) => route.includes("export"))) {
    expect(ROUTE_BUDGETS[r], r).toBeLessThan(SUBREQUEST_LIMIT);
  }
});
