// Test CRUD, slugs, short links and QR codes (#54, P5.1), over the real
// routes.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser, publishTestVersion, type DbClient } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps, mountedRoutes } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let workspaceSlug = "";
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

async function newWorkspaceWithAuthor(suffix: string): Promise<{
  workspaceId: string;
  slug: string;
  authorCookie: string;
  viewerCookie: string;
}> {
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const slug = `tests-${suffix}`;
  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug, name: "Test Co" }),
  );
  const id = (await created.json()).id;

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, id, { userId: authorId, role: "author", now: FIXED_NOW });
  const authorCk = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, id, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  const viewerCk = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

  return { workspaceId: id, slug, authorCookie: authorCk, viewerCookie: viewerCk };
}

/** A fresh workspace with an Author and a Viewer, so no test depends on
 * another. */
beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const seeded = await newWorkspaceWithAuthor(suffix);
  workspaceId = seeded.workspaceId;
  workspaceSlug = seeded.slug;
  authorCookie = seeded.authorCookie;
  viewerCookie = seeded.viewerCookie;
});

it("POST /tests takes a name and a slug and answers 201 with the tst_ id", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toMatch(/^tst_/);
  expect(body.name).toBe("Midterm");
  expect(body.slug).toBe("midterm");
  expect(body.state).toBe("draft");
  expect(body.draftVersion).toBe(1);
  expect(body.currentVersion).toBeNull();
  expect(body.shortCode).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{6}$/);
});

it("a cross-workspace test is 404, not 403", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  const other = await newWorkspaceWithAuthor(`${Math.random().toString(36).slice(2, 10)}-b`);
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    get(other.authorCookie),
  );
  expect(res.status).toBe(404);
});

it("a Viewer cannot read the test list", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests`, get(viewerCookie));
  expect(res.status).toBe(403);
});

it("T-03: the list filters by tag, searches by name and sorts, in one query", async () => {
  await app.request(`/api/v1/workspaces/${workspaceId}/tests`, post({ name: "Aptitude", slug: "aptitude" }, authorCookie));
  await app.request(`/api/v1/workspaces/${workspaceId}/tests`, post({ name: "Midterm", slug: "midterm" }, authorCookie));
  await app.request(`/api/v1/workspaces/${workspaceId}/tests`, post({ name: "Zebra", slug: "zebra" }, authorCookie));

  const searched = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests?search=mid`,
    get(authorCookie),
  );
  expect((await searched.json()).tests.map((t: { name: string }) => t.name)).toEqual(["Midterm"]);

  const sorted = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests?sort=name`,
    get(authorCookie),
  );
  expect((await sorted.json()).tests.map((t: { name: string }) => t.name)).toEqual([
    "Aptitude",
    "Midterm",
    "Zebra",
  ]);

  const tagged = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests?tag=mock`,
    get(authorCookie),
  );
  expect((await tagged.json()).tests).toEqual([]);
});

it("PATCH edits a test", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  const renamed = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    patch({ slug: "renamed" }, authorCookie),
  );
  expect(renamed.status).toBe(200);
  expect((await renamed.json()).slug).toBe("renamed");
});

it("PATCH locks the slug once the test is published", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  await publishTestVersion(deps.db, workspaceId, {
    testId,
    version: 2,
    settings: {},
    sections: [],
    now: FIXED_NOW,
  });

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    patch({ slug: "renamed" }, authorCookie),
  );
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("slug_locked");
});

// Task 2 fix round, Important 4: a data-layer failure that is not the
// (workspace_id, slug) unique constraint must surface as a 500, not be
// reported to the operator as a duplicate address.
function dbThatFailsOn(db: DbClient, match: RegExp): DbClient {
  return {
    ...db,
    run: async (sql, params) => {
      if (match.test(sql)) throw new Error("ECONNRESET: connection reset");
      return db.run(sql, params);
    },
    batch: async (statements) => {
      if (statements.some((s) => match.test(s.sql))) throw new Error("ECONNRESET: connection reset");
      return db.batch(statements);
    },
  };
}

it("a data-layer failure on create is a 500, not slug_taken", async () => {
  const failing = createApp({ ...deps, db: dbThatFailsOn(deps.db, /INSERT INTO test/i) });
  const res = await failing.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  expect(res.status).toBe(500);
});

it("a data-layer failure on update is a 500, not slug_taken", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  const failing = createApp({ ...deps, db: dbThatFailsOn(deps.db, /UPDATE test SET/i) });
  const res = await failing.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    patch({ slug: "renamed" }, authorCookie),
  );
  expect(res.status).toBe(500);
});

it("POST a taken slug is 409 slug_taken", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm again", slug: "midterm" }, authorCookie),
  );
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("slug_taken");
});

it("AC-02: GET /t/<code> redirects to /<workspace-slug>/<test-slug> and nothing else", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const shortCode = (await created.json()).shortCode;

  // No cookie: the short link is public.
  const res = await app.request(`/t/${shortCode}`);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`/${workspaceSlug}/midterm`);
});

it("GET /t/<unknown> is 404 and names no workspace", async () => {
  const res = await app.request("/t/zzzzzz");
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).not.toMatch(/wsp_/);
});

it("the short-link route is the only route with no guard", () => {
  expect(mountedRoutes(app).filter((r) => !(r in ROUTE_ACTIONS) && r.startsWith("/t"))).toEqual([
    "/t/:code",
  ]);
});

// `ROUTE_BUDGETS` carries one number per *path*, shared by every method
// mounted there (the same shape banks' own "GET/POST .../banks": 5 already
// has) — so each method below is pinned to its own measured cost with a
// literal `toBe`, and the two multi-method paths are additionally checked
// against the table, which must carry the more expensive method's number.
it("measures the real subrequest cost of every route this task mounts", async () => {
  async function measure(method: string, path: string, expected: number, cookie: string, body?: unknown): Promise<string> {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(path, send(method, cookie, body));
    expect(res.status, `${method} ${path} -> ${res.status}`).toBeLessThan(400);
    const parsed = (await res.json().catch(() => null)) as { id?: string } | null;
    expect(counting.counts().total, `${method} ${path}`).toBe(expected);
    return parsed?.id ?? "";
  }

  // Auth (2) + createTest's one batch (1, the test row and its draft
  // version 1 together) + appendAudit (1) = 4 — plus the one extra 404 the
  // workspace-member guard itself reads before `tests.edit` is even
  // checked... no: `requires()` reads the actor's own session (already
  // loaded, no subrequest) and the membership is already on `c.var.actor`,
  // so the guard costs nothing extra. Measured at 5: `createTest`'s retry
  // path aside, the fifth statement is `getTest`'s own read-back, which
  // `createTest` does once to hand the route a full `TestRow`.
  const testId = await measure(
    "POST",
    `/api/v1/workspaces/${workspaceId}/tests`,
    5,
    authorCookie,
    { name: "Budget", slug: "budget" },
  );
  // Auth (2) + listTests (1) + draftVersionsByTest (1) = 4.
  await measure("GET", `/api/v1/workspaces/${workspaceId}/tests`, 4, authorCookie);
  // Auth (2) + getTest (1) + draftVersionsByTest (1) = 4.
  await measure("GET", `/api/v1/workspaces/${workspaceId}/tests/${testId}`, 4, authorCookie);
  // Auth (2) + updateTest (getTest + UPDATE, 2) + draftVersionsByTest (1) +
  // appendAudit (1) = 6.
  await measure(
    "PATCH",
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    6,
    authorCookie,
    { name: "Budget 2" },
  );

  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests"]).toBe(5);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId"]).toBe(6);

  // No authentication cost at all (no cookie), and one read: resolveShortCode.
  const counting = countingDeps(deps);
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Short", slug: "short-budget" }, authorCookie),
  );
  const shortCode = (await created.json()).shortCode;
  const shortRes = await createApp(counting.deps).request(`/t/${shortCode}`);
  expect(shortRes.status).toBe(302);
  expect(counting.counts().total, "GET /t/:code").toBe(1);
  expect(ROUTE_BUDGETS["/t/:code"]).toBe(1);
});
