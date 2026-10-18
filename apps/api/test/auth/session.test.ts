import { afterAll, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createUser,
  createWorkspace,
  newId,
} from "@pariksha/db";
import {
  SESSION_IDLE_MS,
  issueSession,
  readSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
} from "../../src/auth/session.js";
import type { AppDeps } from "../../src/app.js";
import { FIXED_NOW, testDeps } from "../deps.js";

const T = FIXED_NOW;
const HOUR = 60 * 60 * 1000;

let clock = T;
const { deps } = await testDeps({ now: () => clock });

/** Moves the shared clock and hands back the deps, so a call reads `at(T + h)`. */
function at(instant: number): AppDeps {
  clock = instant;
  return deps;
}

afterAll(() => closeClient(deps.db));

async function aUser(email: string): Promise<string> {
  return createUser(deps.db, { email, authProvider: "oidc", now: T });
}

async function aWorkspace(userId: string, role: string): Promise<string> {
  const workspaceId = newId("wsp");
  await createWorkspace(deps.db, workspaceId, {
    slug: workspaceId,
    name: workspaceId,
    now: T,
  });
  await addMembership(deps.db, workspaceId, { userId, role, now: T });
  return workspaceId;
}

/**
 * Counts every statement a call reaches the database with. The Workers free
 * plan allows 50 subrequests per invocation and each D1 call is one, so the
 * cost of `readSession` — which runs on every authenticated request — is a
 * property worth asserting rather than reviewing.
 */
function countingDeps(base: AppDeps): { deps: AppDeps; calls: () => number } {
  const counted = new Set(["query", "run", "all", "exec"]);
  let calls = 0;
  const db = new Proxy(base.db, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || !counted.has(String(property))) {
        return value;
      }
      return (...args: unknown[]) => {
        calls += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { deps: { ...base, db }, calls: () => calls };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

it("S-03: a session expires after 12 hours of inactivity", async () => {
  const user = await aUser("expiry@example.test");
  const { token, expiresAt } = await issueSession(at(T), user);
  // A second token, never read, so the sliding window of the first does not
  // decide the second assertion.
  const { token: untouched } = await issueSession(at(T), user);

  expect(expiresAt).toBe(T + SESSION_IDLE_MS);
  expect(
    await readSession(at(T + SESSION_IDLE_MS - 1000), token),
  ).not.toBeNull();
  expect(
    await readSession(at(T + SESSION_IDLE_MS + 1000), untouched),
  ).toBeNull();
});

it("activity slides the idle window forward", async () => {
  const user = await aUser("sliding@example.test");
  const { token } = await issueSession(at(T), user);

  expect(await readSession(at(T + 11 * HOUR), token)).not.toBeNull();
  // 22 hours after issue, and alive only because the read at +11h moved the
  // window — the whole point of an idle timeout rather than an absolute one.
  expect(await readSession(at(T + 22 * HOUR), token)).not.toBeNull();
});

it("only the hash of a session token is stored", async () => {
  const user = await aUser("hashed@example.test");
  const { token } = await issueSession(at(T), user);

  const rows = await deps.db.query<Record<string, unknown>>(
    "SELECT * FROM session WHERE user_id = ?",
    [user],
  );
  expect(rows).toHaveLength(1);

  // Every column, not just one named `token`: a token concatenated into a
  // label or copied into a spare column is the same leak, and a row shape
  // assertion would not see it.
  for (const [column, value] of Object.entries(rows[0] ?? {})) {
    expect(String(value), `session.${column} holds the token`).not.toContain(
      token,
    );
  }
  expect(rows[0]).toMatchObject({ token_hash: await sha256Hex(token) });
});

it("rotation invalidates the previous token", async () => {
  const user = await aUser("rotated@example.test");
  const { token } = await issueSession(at(T), user);

  const next = await rotateSession(at(T), token);

  expect(next?.token).toBeTypeOf("string");
  expect(next?.token).not.toBe(token);
  expect(await readSession(at(T), token)).toBeNull();
  expect(await readSession(at(T), next?.token ?? "")).not.toBeNull();
});

it("rotating a token that is not a live session returns null", async () => {
  expect(await rotateSession(at(T), "not-a-session")).toBeNull();
});

it("revoking one session leaves the user's other sessions alone", async () => {
  const user = await aUser("one-device@example.test");
  const { token: revoked } = await issueSession(at(T), user);
  const { token: kept } = await issueSession(at(T), user);

  await revokeSession(at(T), revoked);

  expect(await readSession(at(T), revoked)).toBeNull();
  expect(await readSession(at(T), kept)).not.toBeNull();
});

it("sign out everywhere revokes every session a user holds", async () => {
  const user = await aUser("everywhere@example.test");
  const bystander = await aUser("bystander@example.test");
  const tokens = [
    (await issueSession(at(T), user)).token,
    (await issueSession(at(T), user)).token,
    (await issueSession(at(T), user)).token,
  ];
  const { token: othersToken } = await issueSession(at(T), bystander);

  await revokeAllSessions(at(T), user);

  for (const token of tokens) {
    expect(await readSession(at(T), token)).toBeNull();
  }
  expect(await readSession(at(T), othersToken)).not.toBeNull();
});

it("the actor carries every membership and its per-test grants", async () => {
  const user = await aUser("actor@example.test");
  const workspaceId = newId("wsp");
  const testId = newId("tst");
  await createWorkspace(deps.db, workspaceId, {
    slug: workspaceId,
    name: "Actor",
    now: T,
  });
  await addMembership(deps.db, workspaceId, {
    userId: user,
    role: "admin",
    testGrants: [{ testId, role: "reviewer" }],
    now: T,
  });
  const { token } = await issueSession(at(T), user);

  expect(await readSession(at(T), token)).toEqual({
    userId: user,
    email: "actor@example.test",
    memberships: [
      {
        workspaceId,
        role: "admin",
        grants: [{ testId, role: "reviewer" }],
      },
    ],
  });
});

it("a user with no membership is still an actor", async () => {
  const user = await aUser("unaffiliated@example.test");
  const { token } = await issueSession(at(T), user);

  expect(await readSession(at(T), token)).toMatchObject({
    userId: user,
    memberships: [],
  });
});

it("an unknown token is not a session", async () => {
  expect(await readSession(at(T), "not-a-session")).toBeNull();
});

it("readSession costs the same database calls at three memberships as at one", async () => {
  const one = await aUser("one-workspace@example.test");
  const three = await aUser("three-workspaces@example.test");
  await aWorkspace(one, "owner");
  await aWorkspace(three, "owner");
  await aWorkspace(three, "author");
  await aWorkspace(three, "viewer");
  const { token: tokenOne } = await issueSession(at(T), one);
  const { token: tokenThree } = await issueSession(at(T), three);

  const cheap = countingDeps(at(T));
  expect((await readSession(cheap.deps, tokenOne))?.memberships).toHaveLength(
    1,
  );

  const busy = countingDeps(at(T));
  expect((await readSession(busy.deps, tokenThree))?.memberships).toHaveLength(
    3,
  );

  // Exactly two, not "at most two": one join to read, one update to slide
  // the window. The exact number is also what proves the counter is counting.
  expect(cheap.calls()).toBe(2);
  expect(busy.calls()).toBe(cheap.calls());
});
