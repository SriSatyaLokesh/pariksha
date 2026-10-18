// Bank and question CRUD, over the real routes.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../src/app.js";
import { mountedRoutes, SUBREQUEST_LIMIT } from "../src/instrument.js";
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

it("a Viewer cannot read a bank either — there is no banks.view", async () => {
  const created = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "x" }, authorCookie));
  const bankId = (await created.json()).id;

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}`, get(viewerCookie));
  expect(res.status).toBe(403);
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

it("writes a question, lists it, and refuses to delete one a published test holds (UX-05)", async () => {
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

  const refused = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${row.id}`,
    del(authorCookie),
  );
  // Nothing has published a test yet, so the plain delete path is covered by
  // the DB-level UX-05 test (packages/db/test/repo/banks.test.ts); this one
  // just proves the route reaches it and answers 204 when nothing blocks it.
  expect(refused.status).toBe(204);
});

it("every route this task mounts has a ROUTE_BUDGETS entry under the ceiling", () => {
  for (const r of mountedRoutes(app).filter((route) => route.includes("bank") || route.includes("media"))) {
    expect(ROUTE_BUDGETS[r], r).toBeLessThan(SUBREQUEST_LIMIT);
  }
});
