import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addMembership, closeClient, createTest, createUser, listAudit } from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let ownerCookie = "";
let adminCookie = "";
let adminId = "";
let testId = "";

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

const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);
const patch = (body: unknown, cookie: string): RequestInit => send("PATCH", cookie, body);
const del = (cookie: string): RequestInit => send("DELETE", cookie);

function withKey(secret: string, body?: unknown): RequestInit {
  return {
    method: body ? "PATCH" : "GET",
    headers: {
      authorization: `Bearer ${secret}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

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
    post({ slug: `demote-wsp-${suffix}`, name: "Demote Workspace" }, ownerCookie),
  );
  workspaceId = (await wspRes.json()).id;

  adminId = await createUser(deps.db, {
    email: `admin-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: adminId, role: "admin", now: FIXED_NOW });
  adminCookie = await sessionCookie(deps, (await issueSession(deps, adminId)).token);

  testId = (await createTest(deps.db, workspaceId, { slug: `test-${suffix}`, name: "Sample Test", now: FIXED_NOW })).id;
});

describe("API Key Demotion Cascade", () => {
  it("auto-revokes API keys when admin is demoted to viewer and writes audit event", async () => {
    // 1. Admin creates an API key with tests.edit scope
    const keyRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/keys`,
      post({ name: "CI Pipeline", scopes: ["tests.edit"] }, adminCookie),
    );
    expect(keyRes.status).toBe(201);
    const { secret } = await keyRes.json();
    expect(secret).toMatch(/^pk_/);

    // 2. Key can edit test
    const useRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
      withKey(secret, { name: "Patched Test Name" }),
    );
    expect(useRes.status).toBe(200);

    // 3. Owner demotes admin to viewer
    const demoteRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/members/${adminId}`,
      patch({ role: "viewer" }, ownerCookie),
    );
    expect(demoteRes.status).toBe(200);

    // 4. API key is now revoked / rejected
    const postDemoteRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
      withKey(secret, { name: "Another Patch" }),
    );
    expect([401, 403]).toContain(postDemoteRes.status);

    // 5. Audit event logged
    const audits = await listAudit(deps.db, workspaceId);
    const revocationAudit = audits.find((a) => a.action === "api_key.demotion_revoked");
    expect(revocationAudit).toBeDefined();
    expect(revocationAudit?.target).toBe(adminId);
  });

  it("auto-revokes API keys when admin is removed from workspace", async () => {
    // 1. Admin creates an API key
    const keyRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/keys`,
      post({ name: "Deploy Key", scopes: ["tests.edit"] }, adminCookie),
    );
    expect(keyRes.status).toBe(201);
    const { secret } = await keyRes.json();

    // 2. Key works
    const useRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
      withKey(secret, { name: "Deploy Key Patch" }),
    );
    expect(useRes.status).toBe(200);

    // 3. Owner removes admin
    const removeRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/members/${adminId}`,
      del(ownerCookie),
    );
    expect(removeRes.status).toBe(204);

    // 4. API key is revoked
    const postRemoveRes = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
      withKey(secret, { name: "Another Deploy Patch" }),
    );
    expect([401, 403]).toContain(postRemoveRes.status);
  });
});
