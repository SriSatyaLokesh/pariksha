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

function exportWithout(doc: Bank, id: string): Bank {
  return { ...doc, questions: doc.questions.filter((q) => q.id !== id) };
}

it("AC-04 / AC-05: the example bank round-trips byte-for-byte through import and export", async () => {
  const bank = exampleBank();
  await matchBankMetadata(bank);
  const importRes = await importJson(bank);
  expect(importRes.status, await importRes.clone().text()).toBe(200);

  const out = await exportBank();
  expect(out).toEqual({ ...bank, $schema: expect.any(String) });
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

it("measures the real subrequest cost of the single-question export against ROUTE_BUDGETS", async () => {
  await importJson(exampleBank());
  const qid = await internalQuestionId("LOG-001");

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${qid}/export`,
    send("GET", authorCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[QUESTION_EXPORT_ROUTE_KEY]!);
});

it("every route this task mounts has a ROUTE_BUDGETS entry under the ceiling", () => {
  for (const r of mountedRoutes(app).filter((route) => route.includes("export"))) {
    expect(ROUTE_BUDGETS[r], r).toBeLessThan(SUBREQUEST_LIMIT);
  }
});
