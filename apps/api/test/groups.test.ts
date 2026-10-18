// Passage groups: the shared stimulus a handful of questions in a bank can
// hang off (#50, P4.6). Groups live in `question_bank.groups_json` — there
// is no groups table — so every assertion here goes through the bank/group
// routes and `listGroups`, the same way banks.test.ts exercises banks and
// questions over the real app rather than a repo function in isolation.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
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
let bankId = "";

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

/** A fresh workspace, Author, Viewer and bank — nothing here depends on the
 * order tests run in. */
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
    send("POST", ownerCookie, { slug: `grp-${suffix}`, name: "Groups Co" }),
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

  const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie));
  bankId = (await bankRes.json()).id;
});

it("a group is created with an id, an optional title and a Markdown passage", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", title: "Orders", passage: "| a |\n| - |" }, authorCookie),
  );
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ id: "orders-table", title: "Orders", passage: "| a |\n| - |" });
});

it("a duplicate group id in the same bank is rejected with the field named", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "x" }, authorCookie),
  );
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "x" }, authorCookie),
  );
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatchObject({ code: "duplicate_group", details: { field: "id" } });
});

it("deleting a group that questions reference is refused and names them", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "| a |\n| - |" }, authorCookie),
  );
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "DIN-001", type: "true_false", prompt: "P1", key: true, group: "orders-table" }, authorCookie),
  );
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "DIN-002", type: "true_false", prompt: "P2", key: true, group: "orders-table" }, authorCookie),
  );

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups/orders-table`,
    del(authorCookie),
  );
  expect(res.status).toBe(409);
  expect((await res.json()).error.details.questions).toEqual(["DIN-001", "DIN-002"]);

  // Refused, not removed.
  const stillThere = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    get(authorCookie),
  );
  expect((await stillThere.json()).groups).toContainEqual(expect.objectContaining({ id: "orders-table" }));
});

it("a question cannot name a group that does not exist — the same rule validateBank enforces", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "Q1", type: "true_false", prompt: "P", key: true, group: "nope" }, authorCookie),
  );
  expect(res.status).toBe(422);
  expect((await res.json()).error.details.issues[0]).toMatchObject({ field: "group" });
});

it("the passage is stored as Markdown, verbatim, and the entry carries no rendered form", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "| a |\n| - |" }, authorCookie),
  );
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`, get(authorCookie));
  const row = (await res.json()).groups.find((g: { id: string }) => g.id === "orders-table");
  expect(row.passage).toBe("| a |\n| - |");
  expect(Object.keys(row)).not.toContain("passage_html");
});

// Task 6 does not add a bank export route (that is Task 7's job — see
// packages/db/src/repo/banks.ts's `upsertQuestions` comment). What export
// will need, groups persisting and a question keeping its group reference,
// is checked here directly instead of against a route that does not exist
// yet.
it("a group persists and a question keeps its group reference", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "| a |\n| - |" }, authorCookie),
  );
  const qRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "DIN-001", type: "true_false", prompt: "P1", key: true, group: "orders-table" }, authorCookie),
  );
  const questionId = (await qRes.json()).id;

  const groups = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`, get(authorCookie));
  expect((await groups.json()).groups).toContainEqual(expect.objectContaining({ id: "orders-table" }));

  const question = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`,
    get(authorCookie),
  );
  expect((await question.json()).document.group).toBe("orders-table");
});

it("a group reports how many questions reference it", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "x" }, authorCookie),
  );
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post({ id: "DIN-001", type: "true_false", prompt: "P1", key: true, group: "orders-table" }, authorCookie),
  );

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`, get(authorCookie));
  expect((await res.json()).groups).toContainEqual(
    expect.objectContaining({ id: "orders-table", questionCount: 1 }),
  );
});

it("updates a group's title and passage", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", title: "Orders", passage: "old" }, authorCookie),
  );
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups/orders-table`,
    patch({ title: "Orders v2", passage: "new" }, authorCookie),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id: "orders-table", title: "Orders v2", passage: "new" });
});

it("deletes a group nothing references", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "x" }, authorCookie),
  );
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups/orders-table`,
    del(authorCookie),
  );
  expect(res.status).toBe(204);

  const listed = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`, get(authorCookie));
  expect((await listed.json()).groups).toEqual([]);
});

it("a missing group is 404 on PATCH and DELETE", async () => {
  const patched = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups/nope`,
    patch({ passage: "x" }, authorCookie),
  );
  expect(patched.status).toBe(404);

  const deleted = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups/nope`,
    del(authorCookie),
  );
  expect(deleted.status).toBe(404);
});

it("a Viewer cannot write a group", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "x", passage: "x" }, viewerCookie),
  );
  expect(res.status).toBe(403);
});

it("a Viewer cannot read a group either — there is no banks.view", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`, get(viewerCookie));
  expect(res.status).toBe(403);
});

it("every route this task mounts has a ROUTE_BUDGETS entry under the ceiling", () => {
  for (const r of mountedRoutes(app).filter((route) => route.includes("groups"))) {
    expect(ROUTE_BUDGETS[r], r).toBeLessThan(SUBREQUEST_LIMIT);
  }
});

// Same technique as banks.test.ts's "measures the real subrequest cost"
// test: a fresh `countingDeps` per call so one route's count never leaks
// into another's, measured against the table in app.ts.
it("measures the real subrequest cost of every group route against ROUTE_BUDGETS", async () => {
  async function measure(method: string, routeKey: string, path: string, init: RequestInit): Promise<void> {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(path, { method, ...init });
    expect(res.status, `${method} ${path} -> ${res.status}`).toBeLessThan(400);
    expect(counting.counts().total, `${method} ${routeKey}`).toBeLessThanOrEqual(ROUTE_BUDGETS[routeKey]!);
  }

  await measure(
    "POST",
    "/api/v1/workspaces/:id/banks/:bankId/groups",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    post({ id: "orders-table", passage: "x" }, authorCookie),
  );
  await measure(
    "GET",
    "/api/v1/workspaces/:id/banks/:bankId/groups",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups`,
    get(authorCookie),
  );
  await measure(
    "PATCH",
    "/api/v1/workspaces/:id/banks/:bankId/groups/:groupId",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups/orders-table`,
    patch({ title: "Measured" }, authorCookie),
  );
  // Delete last: it removes the row the measurements above still needed.
  await measure(
    "DELETE",
    "/api/v1/workspaces/:id/banks/:bankId/groups/:groupId",
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/groups/orders-table`,
    del(authorCookie),
  );
});
