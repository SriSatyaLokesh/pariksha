// Workspaces, memberships and the audit log, over the real routes.
//
// Two properties here are security properties rather than features: a role
// change drops the demoted member's sessions on the spot (Review Focus 4),
// and every one of S-18's events leaves a row nobody can edit afterwards.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createUser,
  findUserByEmail,
  listAudit,
  listMemberships,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../src/instrument.js";
import { issueSession, readSession } from "../src/auth/session.js";
import { requestMagicLink } from "../src/auth/magicLink.js";
import type { EmailMessage } from "../src/email/adapter.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps({ env: { APP_URL: "https://pariksha.test" } });
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let ownerCookie = "";
let ownerId = "";
let workspaceId = "";

function send(
  method: string,
  cookie: string,
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

/** A fresh owner with a fresh workspace, so no test depends on another. */
beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  ownerCookie = await sessionCookie(
    deps,
    (await issueSession(deps, ownerId)).token,
  );

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `alpha-${suffix}`, name: "Alpha" }),
  );
  expect(created.status).toBe(201);
  workspaceId = (await created.json()).id;
});

it("creating a workspace makes the creator its owner", async () => {
  const members = await listMemberships(deps.db, workspaceId);
  expect(members).toEqual([
    expect.objectContaining({ userId: ownerId, role: "owner" }),
  ]);

  const mine = await app.request("/api/v1/workspaces", send("GET", ownerCookie));
  expect(mine.status).toBe(200);
  expect((await mine.json()).workspaces).toEqual([
    expect.objectContaining({ id: workspaceId, name: "Alpha", role: "owner" }),
  ]);
});

it("GET /me names the signed-in user and every membership", async () => {
  const res = await app.request("/api/v1/me", send("GET", ownerCookie));

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    user: { id: ownerId },
    memberships: [{ workspaceId, role: "owner" }],
  });
});

it("a workspace setting change is written and audited", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}`,
    send("PATCH", ownerCookie, { name: "Alpha College", settings: { locale: "te" } }),
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    name: "Alpha College",
    settings: { locale: "te" },
  });
  expect(await listAudit(deps.db, workspaceId)).toContainEqual(
    expect.objectContaining({
      actor: ownerId,
      action: "workspace.settings",
      target: workspaceId,
    }),
  );
});

it("changing a member's role revokes that member's sessions", async () => {
  const bob = await createUser(deps.db, {
    email: `bob-${workspaceId}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await app.request(
    `/api/v1/workspaces/${workspaceId}/members`,
    send("POST", ownerCookie, { userId: bob, role: "admin" }),
  );
  const bobSession = (await issueSession(deps, bob)).token;
  expect(await readSession(deps, bobSession)).not.toBeNull();

  const patched = await app.request(
    `/api/v1/workspaces/${workspaceId}/members`,
    send("POST", ownerCookie, { userId: bob, role: "viewer" }),
  );

  expect(patched.status).toBe(200);
  expect(await readSession(deps, bobSession)).toBeNull();
});

it("an invitation creates the account it names, so a new organiser can be added by email", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/members`,
    send("POST", ownerCookie, { email: `NEW-${workspaceId}@alpha.test`, role: "author" }),
  );

  expect(res.status).toBe(201);
  // Addresses are typed by people and matched by machines, here as anywhere.
  expect(await findUserByEmail(deps.db, `new-${workspaceId}@alpha.test`)).not.toBeNull();

  const listed = await app.request(
    `/api/v1/workspaces/${workspaceId}/members`,
    send("GET", ownerCookie),
  );
  expect((await listed.json()).members).toHaveLength(2);
});

it("removing a member revokes their sessions and refuses to strand the workspace", async () => {
  const bob = await createUser(deps.db, {
    email: `bob2-${workspaceId}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await app.request(
    `/api/v1/workspaces/${workspaceId}/members`,
    send("POST", ownerCookie, { userId: bob, role: "admin" }),
  );
  const bobSession = (await issueSession(deps, bob)).token;

  const removed = await app.request(
    `/api/v1/workspaces/${workspaceId}/members?userId=${bob}`,
    send("DELETE", ownerCookie),
  );
  expect(removed.status).toBe(204);
  expect(await readSession(deps, bobSession)).toBeNull();

  // An owner who can remove the last owner locks everyone out of a workspace
  // no one can then administer, and nothing undoes it.
  const lastOwner = await app.request(
    `/api/v1/workspaces/${workspaceId}/members?userId=${ownerId}`,
    send("DELETE", ownerCookie),
  );
  expect(lastOwner.status).toBe(409);
  expect((await lastOwner.json()).error.code).toBe("last_owner");
});

it("S-18: sign-in, role change and member removal each append one audit entry with actor, action and target", async () => {
  const bob = await createUser(deps.db, {
    email: `bob3-${workspaceId}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await app.request(
    `/api/v1/workspaces/${workspaceId}/members`,
    send("POST", ownerCookie, { userId: bob, role: "admin" }),
  );

  // Sign-in through the real route: the audit row can only be written once
  // the session exists, because until then nobody knows which workspaces the
  // actor belongs to.
  const sent: EmailMessage[] = [];
  await requestMagicLink(deps, `bob3-${workspaceId}@alpha.test`, {
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  });
  const token = /token=(\S+)/.exec(sent[0]?.text ?? "")?.[1];
  const signedIn = await app.request(
    `/api/v1/auth/magic-link/callback?token=${token}`,
  );
  expect(signedIn.status).toBe(302);

  await app.request(
    `/api/v1/workspaces/${workspaceId}/members`,
    send("POST", ownerCookie, { userId: bob, role: "viewer" }),
  );
  await app.request(
    `/api/v1/workspaces/${workspaceId}/members?userId=${bob}`,
    send("DELETE", ownerCookie),
  );

  const entries = await listAudit(deps.db, workspaceId);
  for (const [action, actor, target] of [
    ["auth.signin", bob, bob],
    ["member.role_change", ownerId, bob],
    ["member.remove", ownerId, bob],
  ] as const) {
    expect(
      entries.filter((entry) => entry.action === action),
      action,
    ).toEqual([expect.objectContaining({ actor, action, target })]);
  }
});

it("signing out ends this session; signing out everywhere ends the rest", async () => {
  const second = (await issueSession(deps, ownerId)).token;
  const first = (await issueSession(deps, ownerId)).token;
  const firstCookie = await sessionCookie(deps, first);

  expect(
    (await app.request("/api/v1/auth/signout", send("POST", firstCookie)))
      .status,
  ).toBe(204);
  expect(await readSession(deps, first)).toBeNull();
  expect(await readSession(deps, second)).not.toBeNull();

  const thirdCookie = await sessionCookie(
    deps,
    (await issueSession(deps, ownerId)).token,
  );
  expect(
    (
      await app.request(
        "/api/v1/auth/signout-everywhere",
        send("POST", thirdCookie),
      )
    ).status,
  ).toBe(204);
  expect(await readSession(deps, second)).toBeNull();
});

it("the heaviest routes stay inside their declared budget", async () => {
  for (const [route, init, path] of [
    ["/api/v1/workspaces", send("POST", ownerCookie, { slug: `b-${Math.random().toString(36).slice(2, 8)}`, name: "B" }), "/api/v1/workspaces"],
    [
      `/api/v1/workspaces/${workspaceId}/members`,
      send("POST", ownerCookie, { email: `late-${workspaceId}@alpha.test`, role: "viewer" }),
      "/api/v1/workspaces/:id/members",
    ],
    [`/api/v1/workspaces/${workspaceId}`, send("GET", ownerCookie), "/api/v1/workspaces/:id"],
    ["/api/v1/me", send("GET", ownerCookie), "/api/v1/me"],
  ] as const) {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(route, init);

    expect(res.status, route).toBeLessThan(400);
    expect(counting.counts().total, path).toBeLessThanOrEqual(
      ROUTE_BUDGETS[path] ?? SUBREQUEST_LIMIT,
    );
  }
});
