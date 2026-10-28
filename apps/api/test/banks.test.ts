// Bank and question CRUD, over the real routes.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createTest,
  createUser,
  getDraftVersion,
  publishDraftVersion,
  putDraftVersion,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps, mountedRoutes, SUBREQUEST_LIMIT } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let authorCookie = "";
let viewerCookie = "";

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

const get = (cookie: string): RequestInit => send("GET", cookie);
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);
const patch = (body: unknown, cookie: string): RequestInit => send("PATCH", cookie, body);
const del = (cookie: string): RequestInit => send("DELETE", cookie);

/** A fresh workspace with an Author and a Viewer, so no test depends on
 * another. */
beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `bank-${suffix}`, name: "Bank Co" }),
  );
  workspaceId = (await created.json()).id;

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  viewerCookie = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);
});

it("POST /banks takes a name and nothing else (UX-02)", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "SQL basics" }, authorCookie));

  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ id: expect.stringMatching(/^bnk_/), name: "SQL basics" });
});

it("a cross-workspace bank is 404, not 403", async () => {
  const otherOwnerId = await createUser(deps.db, {
    email: `other-${Math.random()}@beta.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const otherCookie = await sessionCookie(deps, (await issueSession(deps, otherOwnerId)).token);
  const otherWorkspace = await app.request(
    "/api/v1/workspaces",
    send("POST", otherCookie, { slug: `beta-${Math.random().toString(36).slice(2, 8)}`, name: "Beta" }),
  );
  const otherWorkspaceId = (await otherWorkspace.json()).id;
  const bankInB = await app.request(
    `/api/v1/workspaces/${otherWorkspaceId}/banks`,
    post({ name: "B's bank" }, otherCookie),
  );
  const bankInBId = (await bankInB.json()).id;

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankInBId}`, get(authorCookie));
  expect(res.status).toBe(404);
});

it("a Viewer cannot write a bank", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "x" }, viewerCookie));
  expect(res.status).toBe(403);
});

it("a Viewer can read a bank (banks.view)", async () => {
  const created = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "x" }, authorCookie));
  const bankId = (await created.json()).id;

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}`, get(viewerCookie));
  expect(res.status).toBe(200);
});

it("updates a bank's editable fields and deletes it clean", async () => {
  const created = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Draft" }, authorCookie));
  const bankId = (await created.json()).id;

  const updated = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}`,
    patch({ description: "Core SQL", tags: ["sql"] }, authorCookie),
  );
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ description: "Core SQL", tags: ["sql"] });

  const deleted = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}`, del(authorCookie));
  expect(deleted.status).toBe(204);

  const gone = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}`, get(authorCookie));
  expect(gone.status).toBe(404);
});

it("writes a question, lists it, surfaces its tags, and deletes it clean when nothing blocks it", async () => {
  const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie));
  const bankId = (await bankRes.json()).id;

  const question = {
    id: "Q1",
    type: "true_false",
    prompt: "The sky is blue.",
    key: true,
    tags: ["demo"],
  };
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post(question, authorCookie),
  );
  expect(created.status).toBe(201);
  const row = await created.json();
  expect(row).toMatchObject({ refId: "Q1", document: question });

  const listed = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    get(authorCookie),
  );
  expect((await listed.json()).questions).toHaveLength(1);

  const tags = await app.request(`/api/v1/workspaces/${workspaceId}/tags`, get(authorCookie));
  expect((await tags.json()).tags).toEqual(["demo"]);

  // Nothing has published a test yet, so this is the "nothing blocks it"
  // path — fixture-review finding 6's UX-05-proper (a real 409, end to end)
  // is its own test below.
  const deleted = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${row.id}`,
    del(authorCookie),
  );
  expect(deleted.status).toBe(204);
});

it("UX-05: refuses to delete a question a published test holds, with a 409 naming it", async () => {
  const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie));
  const bankId = (await bankRes.json()).id;

  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "Q1", type: "true_false", prompt: "The sky is blue.", key: true }, authorCookie),
  );
  const questionId = (await created.json()).id;

  const testId = (await createTest(deps.db, workspaceId, { slug: "midterm", name: "Midterm" })).id;
  // The real transition (Task 11): the draft head is written, then stamped
  // in place and numbered 1 — never an INSERT alongside it at version 2.
  const head = await getDraftVersion(deps.db, workspaceId, testId);
  await putDraftVersion(
    deps.db,
    workspaceId,
    head!,
    { settings: {}, sections: [{ id: "s1", title: "Section 1", source: { kind: "fixed", questions: [questionId] } }] },
    FIXED_NOW,
  );
  await publishDraftVersion(deps.db, workspaceId, testId, FIXED_NOW);

  const refused = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`,
    del(authorCookie),
  );
  expect(refused.status).toBe(409);
  const body = await refused.json();
  expect(body.error.code).toBe("question_in_use");
  expect(body.error.message).toContain("Midterm");
  expect(body.error.details.blockedBy).toEqual(["Midterm"]);

  // Refused, not removed.
  const stillThere = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`,
    get(authorCookie),
  );
  expect(stillThere.status).toBe(200);
});

it("finding 4: a non-numeric limit is a 400, not a silent NaN reaching the query", async () => {
  const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie));
  const bankId = (await bankRes.json()).id;

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions?limit=abc`,
    get(authorCookie),
  );
  expect(res.status).toBe(400);
});

it("finding 4: a limit over 200 is a 400", async () => {
  const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie));
  const bankId = (await bankRes.json()).id;

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions?limit=500`,
    get(authorCookie),
  );
  expect(res.status).toBe(400);
});

it("finding 4: a cursor with no ':' is a 400, not a silently empty page", async () => {
  const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie));
  const bankId = (await bankRes.json()).id;

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions?cursor=not-a-cursor`,
    get(authorCookie),
  );
  expect(res.status).toBe(400);
});

it("every route this task mounts has a ROUTE_BUDGETS entry under the ceiling", () => {
  for (const r of mountedRoutes(app).filter((route) => route.includes("bank") || route.includes("media"))) {
    expect(ROUTE_BUDGETS[r], r).toBeLessThan(SUBREQUEST_LIMIT);
  }
});

// Fixture-review finding 3: the declared numbers in `ROUTE_BUDGETS` are
// measured here, not guessed — each case re-wraps `deps` in a fresh
// `countingDeps` (the same helper `budget.test.ts` uses for `/health`) so
// one route's count can never leak into another's, then asserts the
// measured total against the table in app.ts. A regression that adds a
// query to any of these routes fails here before it fails in production.
it("measures the real subrequest cost of every bank/question route against ROUTE_BUDGETS", async () => {
  const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie));
  const bankId = (await bankRes.json()).id;
  const qRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "Q1", type: "true_false", prompt: "P", key: true }, authorCookie),
  );
  const questionId = (await qRes.json()).id;

  async function measure(method: string, routeKey: string, path: string, init: RequestInit): Promise<void> {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(path, { method, ...init });
    expect(res.status, `${method} ${path} → ${res.status}`).toBeLessThan(400);
    expect(counting.counts().total, `${method} ${routeKey}`).toBeLessThanOrEqual(ROUTE_BUDGETS[routeKey]!);
  }

  await measure("GET", "/api/v1/workspaces/:id/banks", `/api/v1/workspaces/${workspaceId}/banks`, get(authorCookie));
  await measure(
    "POST",
    "/api/v1/workspaces/:id/banks",
    `/api/v1/workspaces/${workspaceId}/banks`,
    post({ name: "Measured" }, authorCookie),
  );
  await measure(
    "GET",
    "/api/v1/workspaces/:id/banks/:bankId",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}`,
    get(authorCookie),
  );
  await measure(
    "PATCH",
    "/api/v1/workspaces/:id/banks/:bankId",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}`,
    patch({ description: "d" }, authorCookie),
  );
  await measure("GET", "/api/v1/workspaces/:id/tags", `/api/v1/workspaces/${workspaceId}/tags`, get(authorCookie));
  await measure(
    "GET",
    "/api/v1/workspaces/:id/banks/:bankId/questions",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    get(authorCookie),
  );
  await measure(
    "POST",
    "/api/v1/workspaces/:id/banks/:bankId/questions",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "Q2", type: "true_false", prompt: "P2", key: true }, authorCookie),
  );
  await measure(
    "GET",
    "/api/v1/workspaces/:id/banks/:bankId/questions/:qid",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`,
    get(authorCookie),
  );
  await measure(
    "PATCH",
    "/api/v1/workspaces/:id/banks/:bankId/questions/:qid",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`,
    patch({ id: "Q1", type: "true_false", prompt: "P changed", key: true }, authorCookie),
  );
  // Deletes last: they remove the rows the measurements above still needed.
  await measure(
    "DELETE",
    "/api/v1/workspaces/:id/banks/:bankId/questions/:qid",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`,
    del(authorCookie),
  );
  await measure(
    "DELETE",
    "/api/v1/workspaces/:id/banks/:bankId",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}`,
    del(authorCookie),
  );
});
