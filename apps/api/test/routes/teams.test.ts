import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addMembership, closeClient, createTest, createUser, putDraftVersion } from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let ownerCookie = "";
let adminCookie = "";
let authorCookie = "";
let viewerCookie = "";
let viewerId = "";
let testId1 = "";
let testId2 = "";

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
    post({ slug: `teams-wsp-${suffix}`, name: "Teams Workspace" }, ownerCookie),
  );
  workspaceId = (await wspRes.json()).id;

  const adminId = await createUser(deps.db, {
    email: `admin-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: adminId, role: "admin", now: FIXED_NOW });
  adminCookie = await sessionCookie(deps, (await issueSession(deps, adminId)).token);

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  viewerCookie = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

  testId1 = (await createTest(deps.db, workspaceId, { slug: `math-${suffix}`, name: "Math Test", now: FIXED_NOW })).id;
  testId2 = (await createTest(deps.db, workspaceId, { slug: `phys-${suffix}`, name: "Physics Test", now: FIXED_NOW })).id;
});

describe("Teams REST API", () => {
  it("CRUD operations for teams", async () => {
    // 1. Author cannot create team (requires members.manage)
    const authorRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams`,
      post({ name: "Math Faculty" }, authorCookie),
    );
    expect(authorRes.status).toBe(403);

    // 2. Owner can create team
    const createRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams`,
      post({ name: "Math Faculty", description: "Department members" }, ownerCookie),
    );
    expect(createRes.status).toBe(201);
    const { team } = await createRes.json();
    expect(team.id).toMatch(/^team_/);
    expect(team.name).toBe("Math Faculty");
    expect(team.description).toBe("Department members");
    expect(team.workspaceId).toBe(workspaceId);

    // 3. Member (viewer) can list teams
    const listRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams`,
      get(viewerCookie),
    );
    expect(listRes.status).toBe(200);
    const { teams } = await listRes.json();
    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe(team.id);

    // 4. Member can get team
    const getRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}`,
      get(viewerCookie),
    );
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).team.id).toBe(team.id);

    // 404 on missing team
    const missingRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/team_nonexistent123`,
      get(viewerCookie),
    );
    expect(missingRes.status).toBe(404);

    // 5. Owner can update team
    const patchRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}`,
      patch({ name: "Applied Math Faculty", description: null }, ownerCookie),
    );
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()).team;
    expect(updated.name).toBe("Applied Math Faculty");
    expect(updated.description).toBeNull();

    // 6. Owner can delete team
    const delRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}`,
      del(ownerCookie),
    );
    expect(delRes.status).toBe(204);

    // Verify deletion
    const afterDel = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}`,
      get(ownerCookie),
    );
    expect(afterDel.status).toBe(404);
  });

  it("team members CRUD", async () => {
    const createRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams`,
      post({ name: "Graders Squad" }, ownerCookie),
    );
    const { team } = await createRes.json();

    // 1. Add member
    const addRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/members`,
      post({ userId: viewerId }, ownerCookie),
    );
    expect(addRes.status).toBe(201);

    // 2. List members
    const listRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/members`,
      get(viewerCookie),
    );
    expect(listRes.status).toBe(200);
    const { members } = await listRes.json();
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(viewerId);

    // 3. Remove member
    const removeRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/members/${viewerId}`,
      del(ownerCookie),
    );
    expect(removeRes.status).toBe(204);

    // Verify member removed
    const listAfter = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/members`,
      get(ownerCookie),
    );
    expect((await listAfter.json()).members).toHaveLength(0);
  });

  it("team resource grants CRUD", async () => {
    const createRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams`,
      post({ name: "Reviewers Team" }, ownerCookie),
    );
    const { team } = await createRes.json();

    // 1. Add grant
    const grantRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/grants`,
      post({ resourceType: "test", resourceId: testId1, role: "reviewer" }, ownerCookie),
    );
    expect(grantRes.status).toBe(201);
    const { grant } = await grantRes.json();
    expect(grant.id).toMatch(/^tgr_/);
    expect(grant.teamId).toBe(team.id);
    expect(grant.resourceType).toBe("test");
    expect(grant.resourceId).toBe(testId1);
    expect(grant.role).toBe("reviewer");

    // 2. List grants
    const listRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/grants`,
      get(viewerCookie),
    );
    expect(listRes.status).toBe(200);
    const { grants } = await listRes.json();
    expect(grants).toHaveLength(1);
    expect(grants[0].id).toBe(grant.id);

    // 3. Revoke grant
    const revokeRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/grants/${grant.id}`,
      del(ownerCookie),
    );
    expect(revokeRes.status).toBe(204);

    // Verify revoked
    const listAfter = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/grants`,
      get(ownerCookie),
    );
    expect((await listAfter.json()).grants).toHaveLength(0);
  });

  it("elevates user permissions through team grants", async () => {
    // Viewer cannot edit test (tests.edit requires author or above)
    const patchTestDenied = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId1}`,
      patch({ name: "Updated Math" }, viewerCookie),
    );
    expect(patchTestDenied.status).toBe(403);

    // Create team, add viewer, grant team "author" role on testId1
    const createRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/teams`,
      post({ name: "Math Authors" }, ownerCookie),
    );
    const { team } = await createRes.json();

    await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/members`,
      post({ userId: viewerId }, ownerCookie),
    );

    await app.request(
      `/api/v1/workspaces/${workspaceId}/teams/${team.id}/grants`,
      post({ resourceType: "test", resourceId: testId1, role: "author" }, ownerCookie),
    );

    // Now viewer can edit test on testId1
    const patchTestAllowed = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId1}`,
      patch({ name: "Updated Math" }, viewerCookie),
    );
    expect(patchTestAllowed.status).toBe(200);

    // But viewer still cannot edit test on testId2
    const patchTest2Denied = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId2}`,
      patch({ name: "Updated Physics" }, viewerCookie),
    );
    expect(patchTest2Denied.status).toBe(403);
  });
});
