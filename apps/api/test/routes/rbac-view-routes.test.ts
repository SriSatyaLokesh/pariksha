import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let ownerCookie = "";
let reviewerCookie = "";
let viewerCookie = "";
let viewerId = "";
let testId1 = "";
let testId2 = "";
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

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const wspRes = await app.request(
    "/api/v1/workspaces",
    post({ slug: `wsp-${suffix}`, name: "Test Workspace" }, ownerCookie),
  );
  workspaceId = (await wspRes.json()).id;

  // Create two tests and a bank as owner
  const t1Res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Math Test", slug: `math-${suffix}` }, ownerCookie),
  );
  testId1 = (await t1Res.json()).id;

  const t2Res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Physics Test", slug: `phys-${suffix}` }, ownerCookie),
  );
  testId2 = (await t2Res.json()).id;

  const bRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks`,
    post({ name: "Question Bank 1" }, ownerCookie),
  );
  bankId = (await bRes.json()).id;

  // Create a Reviewer member
  const reviewerId = await createUser(deps.db, {
    email: `reviewer-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: reviewerId, role: "reviewer", now: FIXED_NOW });
  reviewerCookie = await sessionCookie(deps, (await issueSession(deps, reviewerId)).token);

  // Create a Viewer member
  viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  viewerCookie = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);
});

describe("RBAC View Routes & Resource Grants", () => {
  it("allows reviewer to read tests, draft, and banks", async () => {
    const testRes = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId1}`, get(reviewerCookie));
    expect(testRes.status).toBe(200);

    const draftRes = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId1}/draft`, get(reviewerCookie));
    expect(draftRes.status).toBe(200);

    const bankRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}`, get(reviewerCookie));
    expect(bankRes.status).toBe(200);
  });

  it("allows viewer to read banks, but rejects bank creation with 403", async () => {
    const listRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, get(viewerCookie));
    expect(listRes.status).toBe(200);

    const writeRes = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Forbidden" }, viewerCookie));
    expect(writeRes.status).toBe(403);
  });

  it("allows owner to assign testGrants to a viewer, elevating permissions on that test only", async () => {
    // Viewer cannot edit test1 or test2 initially
    const edit1Before = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId1}`,
      patch({ name: "Renamed Math" }, viewerCookie),
    );
    expect(edit1Before.status).toBe(403);

    // Update viewer membership with testGrants on testId1 via PATCH
    const patchMemberRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/members/${viewerId}`,
      patch({ testGrants: { [testId1]: "author" } }, ownerCookie),
    );
    expect(patchMemberRes.status).toBe(200);

    // Re-issue viewer session cookie because sessions are revoked on membership update
    viewerCookie = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

    // Now viewer can edit testId1
    const edit1After = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId1}`,
      patch({ name: "Renamed Math" }, viewerCookie),
    );
    expect(edit1After.status).toBe(200);

    // Viewer still cannot edit testId2
    const edit2 = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId2}`,
      patch({ name: "Renamed Physics" }, viewerCookie),
    );
    expect(edit2.status).toBe(403);
  });

  it("allows owner to invite member with testGrants via POST /members", async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const email = `elevated-${suffix}@alpha.test`;

    const inviteRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/members`,
      post({ email, role: "viewer", testGrants: { [testId1]: "author" } }, ownerCookie),
    );
    expect(inviteRes.status).toBe(201);
    const body = await inviteRes.json();
    expect(body.testGrants).toEqual({ [testId1]: "author" });
  });
});
