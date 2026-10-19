// Import — Pariksha JSON, all-or-nothing with positioned errors (#51, P4.7).
// Exercised over the real app, the same way banks.test.ts and groups.test.ts
// exercise banks/questions/groups, so a bug in wiring (the route not
// actually calling `importBankJson`, a budget regression) fails here and not
// only in a unit test of the import module in isolation.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps, mountedRoutes, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

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

// `ROUTE_BUDGETS` is keyed by bare path, not by `METHOD path` — see any
// existing entry in app.ts (`ROUTE_ACTIONS` is the one keyed by method).
const IMPORT_ROUTE_KEY = "/api/v1/workspaces/:id/banks/:bankId/import";

let workspaceId = "";
let authorCookie = "";
let viewerCookie = "";
let bankId = "";

/** A fresh workspace, Author, Viewer and empty bank, same shape
 * groups.test.ts and banks.test.ts both set up — nothing here depends on
 * the order tests run in. */
beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@import.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `imp-${suffix}`, name: "Import Co" }),
  );
  workspaceId = (await created.json()).id;

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@import.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@import.test`,
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

// One question of every type (QUESTION_TYPES, packages/core/src/types.ts),
// plus one passage group nothing references yet — a realistic small bank,
// not the cheapest possible fixture ("Declared budgets are measured... with
// a realistic fixture, not the cheapest one"). `LOG-001` sits at index 5 and
// is the one AC-05 corrupts.
function exampleBank(): Record<string, unknown> {
  return {
    format: "pariksha/bank@1",
    name: "Example bank — one of each type",
    groups: [{ id: "g1", title: "Passage", passage: "Some shared passage text." }],
    questions: [
      { id: "TF-001", type: "true_false", prompt: "P0", key: true },
      {
        id: "MUL-001",
        type: "multiple",
        prompt: "P1",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
          { id: "c", text: "C" },
        ],
        key: ["a", "b"],
      },
      {
        id: "SEL-001",
        type: "select_k",
        prompt: "P2",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
          { id: "c", text: "C" },
        ],
        k: 2,
        key: ["a", "b"],
      },
      {
        id: "AR-001",
        type: "assertion_reason",
        prompt: "P3",
        assertion: "X",
        reason: "Y",
        key: "both_true_explains",
      },
      {
        id: "MM-001",
        type: "multi_matching",
        prompt: "P4",
        left: ["L1", "L2"],
        right: ["R1", "R2"],
        key: { L1: ["R1"], L2: ["R2"] },
      },
      {
        id: "LOG-001",
        type: "single",
        prompt: "P5",
        options: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
        ],
        key: "a",
      },
      {
        id: "MAT-001",
        type: "matching",
        prompt: "P6",
        left: ["L1", "L2"],
        right: ["R1", "R2"],
        key: { L1: "R1", L2: "R2" },
      },
      { id: "ORD-001", type: "ordering", prompt: "P7", items: ["one", "two", "three"] },
      {
        id: "FB-001",
        type: "fill_blank",
        prompt: "Fill {{a}}.",
        blanks: [{ id: "a", accepted: ["x"] }],
      },
      { id: "NUM-001", type: "numeric", prompt: "P9", key: { value: 5 } },
      { id: "SA-001", type: "short_answer", prompt: "P10" },
      { id: "LA-001", type: "long_answer", prompt: "P11" },
    ],
  };
}

/** `exampleBank()` with one question's `key` pointed at an option that does
 * not exist — a cross-field defect `validateBank` (not the JSON Schema)
 * catches. */
function withBadKey(bank: Record<string, unknown>, id = "LOG-001"): Record<string, unknown> {
  const questions = (bank.questions as Record<string, unknown>[]).map((q) =>
    q.id === id ? { ...q, key: "not-an-option" } : q,
  );
  return { ...bank, questions };
}

/** `n` minimal, valid, distinct questions — the fixture Review Focus 3
 * scales, isolated to the one axis that test is about (question count, not
 * groups). */
function bankOf(n: number): Record<string, unknown> {
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

function post(doc: unknown, cookie: string, dryRun = false): Promise<Response> {
  return app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import${dryRun ? "?dryRun=1" : ""}`,
    send("POST", cookie, doc),
  );
}

async function questionCount(): Promise<number> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions?limit=200`,
    send("GET", authorCookie),
  );
  return (await res.json()).questions.length;
}

async function questionRow(refId: string): Promise<{ prompt_md: string } | undefined> {
  const rows = await deps.db.query<{ prompt_md: string }>(
    "SELECT prompt_md FROM question WHERE workspace_id = ? AND bank_id = ? AND ref_id = ?",
    [workspaceId, bankId, refId],
  );
  return rows[0];
}

it("AC-05: a bank with one bad question imports nothing and reports the position and reason", async () => {
  const res = await post(withBadKey(exampleBank()), authorCookie);

  expect(res.status).toBe(422);
  expect(await questionCount()).toBe(0);
  expect((await res.json()).error.details.issues).toContainEqual(
    expect.objectContaining({
      questionId: "LOG-001",
      index: 5,
      field: "key",
      message: expect.stringMatching(/not among the options/),
    }),
  );
});

it("the example bank — one question of every type — imports whole", async () => {
  const bank = exampleBank();
  const res = await post(bank, authorCookie);

  expect(res.status).toBe(200);
  expect(await questionCount()).toBe((bank.questions as unknown[]).length);
});

it("D-02: structural and cross-field issues arrive together, in one report", async () => {
  const bad = withBadKey(exampleBank());
  const doc = {
    ...exampleBank(),
    questions: [{ id: "A", type: "single" }, (bad.questions as Record<string, unknown>[])[5]],
  };

  const res = await post(doc, authorCookie);
  const issues = (await res.json()).error.details.issues as { field: string }[];

  expect(res.status).toBe(422);
  expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["options", "key"]));
});

// Review Focus 3's own point: an importer that issues one write per question
// (or, after fix round 1, one read-modify-write per group) passes at ten
// and fails in production at sixty. `bankOf(200)` isolates the
// question-count axis (no groups) so this test is about that axis alone —
// pinned to the exact measured count (fix round 1, finding 5: a `<=`
// assertion never catches a budget number that is too high, only `toBe`
// does), not just bounded above.
it("Review Focus 3: importing 200 questions stays within the route's budget", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`,
    send("POST", authorCookie, bankOf(200)),
  );

  expect(res.status, await res.clone().text()).toBe(200);
  // auth (2) + bankOr404 (1) + listQuestionRefIds (1) + batch (1) +
  // appendAudit (1) = 6, unaffected by `bankOf`'s question count and by
  // `writeImportedBank`'s groups read (skipped entirely — this fixture
  // declares none).
  expect(counting.counts().total).toBe(6);
  expect(counting.counts().total).toBeLessThan(10);
});

// The number in ROUTE_BUDGETS itself, measured rather than guessed — a
// realistic fixture (one group, twelve questions), not `bankOf(200)`'s
// group-free one. See app.ts's comment on this route's budget line for why
// the two differ. Pinned with `toBe`, not `toBeLessThanOrEqual` (finding 5):
// a budget that merely bounds the measurement from above would have let the
// original, too-low estimate of 6 ship instead of being caught by this test.
it("measures the real subrequest cost of importing the example bank against ROUTE_BUDGETS", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`,
    send("POST", authorCookie, exampleBank()),
  );

  expect(res.status, await res.clone().text()).toBe(200);
  // The one axis that does cost more than the group-free path: one extra
  // read of the bank's current groups before merging. auth (2) + bankOr404
  // (1) + listQuestionRefIds (1) + groups read (1) + batch (1) +
  // appendAudit (1) = 7 — flat in question count and in group *count* (a
  // bank with ten groups still costs this one read, not ten), though it
  // does grow from 6 to 7 the moment a bank declares any group at all.
  expect(counting.counts().total).toBe(7);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[IMPORT_ROUTE_KEY]);
});

// Fix round 1, finding 8: the body is still JSON.parsed to count
// `questions.length` — refused before the *expensive* stages (structural
// and cross-field validation), not before parsing, which the old name
// overclaimed.
it("an import over IMPORT_MAX_QUESTIONS is refused before structural or cross-field validation runs", async () => {
  const res = await post(bankOf(501), authorCookie);
  expect(res.status).toBe(413);
  expect(await questionCount()).toBe(0);
});

it("an import stores the Markdown source verbatim and derives nothing from it", async () => {
  const bank = exampleBank();
  await post(bank, authorCookie);

  const row = await questionRow("LOG-001");
  expect(row?.prompt_md).toBe((bank.questions as { prompt: string }[])[5]!.prompt);
});

it("a duplicate ref_id against questions already in the bank is an issue, not a silent overwrite", async () => {
  await post(exampleBank(), authorCookie);
  const res = await post(exampleBank(), authorCookie);

  expect(res.status).toBe(422);
  const issues = (await res.json()).error.details.issues;
  expect(issues[0]).toMatchObject({
    field: "id",
    message: expect.stringMatching(/already in this bank/),
  });
  // All-or-nothing: the second import added nothing on top of the first.
  expect(await questionCount()).toBe((exampleBank().questions as unknown[]).length);
});

it("dryRun reports exactly what a real import would and writes nothing", async () => {
  const bank = exampleBank();
  const res = await post(bank, authorCookie, true);

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ imported: (bank.questions as unknown[]).length, issues: [] });
  expect(await questionCount()).toBe(0);
});

it("dryRun reports issues the same way a real import would, and still writes nothing", async () => {
  const res = await post(withBadKey(exampleBank()), authorCookie, true);

  expect(res.status).toBe(422);
  expect((await res.json()).error.details.issues).toContainEqual(
    expect.objectContaining({ questionId: "LOG-001", field: "key" }),
  );
  expect(await questionCount()).toBe(0);
});

it("a Viewer cannot import", async () => {
  const res = await post(exampleBank(), viewerCookie);
  expect(res.status).toBe(403);
});

it("importing into a bank in another workspace is 404, not 403", async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const otherOwnerId = await createUser(deps.db, {
    email: `other-${suffix}@import.test`,
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
    `/api/v1/workspaces/${otherWorkspaceId}/banks/${bankId}/import`,
    send("POST", otherCookie, exampleBank()),
  );
  expect(res.status).toBe(404);
});

it("every route this task mounts has a ROUTE_BUDGETS entry under the ceiling", () => {
  for (const r of mountedRoutes(app).filter((route) => route.includes("import"))) {
    expect(ROUTE_BUDGETS[r], r).toBeLessThan(SUBREQUEST_LIMIT);
  }
});
