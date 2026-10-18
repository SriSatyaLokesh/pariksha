// The first-run wizard, which is Review Focus item 1 of the Phase 3 plan.
//
// Every test here starts a whole new instance — a fresh in-memory database —
// because "empty instance" is the precondition and a shared database would
// leave the order of the file deciding which tests are meaningful.
//
// The property under test is not "the wizard works". It is that the wizard
// is closed, server-side, from the moment the instance is claimed: by a
// second request, by a concurrent one, and by a request that asks nicely.

import { afterAll, expect, it } from "vitest";
import {
  closeClient,
  createUser,
  findUserByEmail,
  listMemberships,
  listUserWorkspaces,
  type DbClient,
} from "@pariksha/db";
import type { Hono } from "hono";
import { createApp, type AppBindings, type AppDeps } from "../src/app.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const opened: DbClient[] = [];

afterAll(() => Promise.all(opened.map(closeClient)));

async function instance(env: Record<string, unknown> = {}): Promise<{
  deps: AppDeps;
  app: Hono<AppBindings>;
}> {
  const { deps } = await testDeps({
    env: { APP_URL: "https://pariksha.test", ...env },
  });
  opened.push(deps.db);
  return { deps, app: createApp(deps) };
}

/** An operator who has already signed in — the wizard's precondition. */
async function signedIn(
  deps: AppDeps,
  email = "operator@alpha.test",
): Promise<{ userId: string; cookie: string }> {
  const userId = await createUser(deps.db, {
    email,
    authProvider: "oidc:test",
    now: FIXED_NOW,
  });
  const { token } = await issueSession(deps, userId);
  return { userId, cookie: await sessionCookie(deps, token) };
}

function post(cookie: string | null, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie === null ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  };
}

function count(deps: AppDeps, table: string): Promise<number> {
  return deps.db
    .query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
    .then((rows) => Number(rows[0]?.n ?? 0));
}

it("on an empty instance, setup is needed and lists the configured providers", async () => {
  const { app } = await instance({ EMAIL_CONSOLE: "true" });

  const res = await app.request("/api/v1/setup/status");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    needed: true,
    providers: expect.any(Array),
  });
});

it("status answers an unauthenticated caller and tells it nothing else", async () => {
  // The sign-in screen asks before anyone has signed in, so this route is
  // reachable without a session — which is exactly why it must not become a
  // way to read who holds an account here.
  const { deps, app } = await instance({ EMAIL_CONSOLE: "true" });
  await signedIn(deps, "someone@alpha.test");

  const body = (await (await app.request("/api/v1/setup/status")).json()) as {
    needed: boolean;
    providers: { id: string; kind: string }[];
  };

  expect(Object.keys(body).sort()).toEqual(["needed", "providers"]);
  expect(body.providers.map((provider) => provider.kind)).toEqual([
    "magic_link",
  ]);
  expect(JSON.stringify(body)).not.toContain("someone@alpha.test");
});

it("an unauthenticated completion on an empty instance is refused", async () => {
  // The attack this endpoint is: whoever reaches it first owns the instance.
  // Signing in is the prerequisite, and the identity that signed in is the
  // only candidate for owner.
  const { deps, app } = await instance();

  const res = await app.request(
    "/api/v1/setup/complete",
    post(null, { name: "Taken Over" }),
  );

  expect(res.status).toBe(401);
  expect(await count(deps, "workspace")).toBe(0);
  expect(await count(deps, "membership")).toBe(0);
});

it("completing setup creates the instance owner and the first workspace", async () => {
  const { deps, app } = await instance();
  const { userId, cookie } = await signedIn(deps);

  const res = await app.request(
    "/api/v1/setup/complete",
    post(cookie, { name: "Acme College" }),
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: string; slug: string; name: string };
  expect(body).toMatchObject({ slug: "acme-college", name: "Acme College" });
  expect(await listUserWorkspaces(deps.db, userId)).toEqual([
    { id: body.id, slug: "acme-college", name: "Acme College", role: "owner" },
  ]);
});

it("the owner is the signed-in actor, never an identity named in the body", async () => {
  const { deps, app } = await instance();
  const { userId, cookie } = await signedIn(deps, "operator@alpha.test");

  const res = await app.request(
    "/api/v1/setup/complete",
    post(cookie, {
      name: "Acme College",
      email: "attacker@evil.example",
      userId: "usr_attacker",
      role: "owner",
    }),
  );

  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: string };
  expect(await listMemberships(deps.db, id)).toMatchObject([
    { userId, role: "owner" },
  ]);
  expect(await findUserByEmail(deps.db, "attacker@evil.example")).toBeNull();
  expect(await count(deps, '"user"')).toBe(1);
});

it("after setup, status reports needed false and complete returns 409", async () => {
  const { deps, app } = await instance();
  const { cookie } = await signedIn(deps);
  await app.request("/api/v1/setup/complete", post(cookie, { name: "First" }));

  const status = await (await app.request("/api/v1/setup/status")).json();
  const again = await app.request(
    "/api/v1/setup/complete",
    // A different, unused slug: the refusal is the instance already being
    // claimed, not a collision on this one name.
    post(cookie, { name: "Second" }),
  );

  expect(status).toMatchObject({ needed: false });
  expect(again.status).toBe(409);
  expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
    "setup_complete",
  );
  expect(await count(deps, "workspace")).toBe(1);
});

it("a second owner cannot be minted by a different signed-in actor", async () => {
  const { deps, app } = await instance();
  const first = await signedIn(deps, "first@alpha.test");
  await app.request(
    "/api/v1/setup/complete",
    post(first.cookie, { name: "First" }),
  );
  const second = await signedIn(deps, "second@alpha.test");

  const res = await app.request(
    "/api/v1/setup/complete",
    post(second.cookie, { name: "Mine Now" }),
  );

  expect(res.status).toBe(409);
  expect(await listUserWorkspaces(deps.db, second.userId)).toEqual([]);
});

it("two concurrent completions produce exactly one owner", async () => {
  // `Promise.all` over two `app.request` calls does NOT interleave in this
  // harness — better-sqlite3 is synchronous and the first request runs to
  // completion before the second issues a query, so this assertion passes
  // against a read-then-insert implementation too. It is kept because it is
  // the plan's, and because it would catch a regression that broke even the
  // sequential case; the test with teeth is the one below it.
  const { deps, app } = await instance();
  const { cookie } = await signedIn(deps);
  const complete = (name: string) =>
    app.request("/api/v1/setup/complete", post(cookie, { name }));

  const [a, b] = await Promise.all([complete("Alpha"), complete("Beta")]);

  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect(await count(deps, '"user"')).toBe(1);
  expect(await count(deps, "workspace")).toBe(1);
  expect(await count(deps, "membership")).toBe(1);
});

it("a completion whose claim read saw an unclaimed instance is still refused", async () => {
  // The real race, forced rather than hoped for: both requests are held at
  // the "is this instance claimed?" read until both have reached it, so
  // both resume believing setup is still needed. What separates one owner
  // from two at that point is whether the condition is re-asked by the
  // statement that inserts. Against a read-then-insert implementation this
  // test produces two 200s and two workspaces — it was watched doing so
  // before `createFirstWorkspace` existed.
  const { deps } = await instance();
  const { cookie } = await signedIn(deps);

  let arrived = 0;
  let open = (): void => {};
  const bothArrived = new Promise<void>((resolve) => {
    open = resolve;
  });
  const held: DbClient = {
    ...deps.db,
    query: async <T>(sql: string, params?: unknown[]) => {
      if (sql.includes("FROM workspace LIMIT 1")) {
        if (++arrived === 2) open();
        await bothArrived;
      }
      return deps.db.query<T>(sql, params);
    },
  } as DbClient;
  const app = createApp({ ...deps, db: held });
  const complete = (name: string) =>
    app.request("/api/v1/setup/complete", post(cookie, { name }));

  const [a, b] = await Promise.all([complete("Alpha"), complete("Beta")]);

  expect(arrived).toBe(2);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect(await count(deps, "workspace")).toBe(1);
  expect(await count(deps, "membership")).toBe(1);
});

it("setup cannot be re-enabled by any request", async () => {
  const { deps, app } = await instance();
  const { cookie } = await signedIn(deps);
  await app.request("/api/v1/setup/complete", post(cookie, { name: "First" }));

  const attempts: RequestInit[] = [
    post(cookie, { force: true, name: "Forced" }),
    post(cookie, { needed: true, name: "Reopened" }),
    { method: "DELETE", headers: { cookie } },
    { method: "PUT", headers: { cookie } },
  ];
  for (const attempt of attempts) {
    const res = await app.request("/api/v1/setup/complete", attempt);
    expect(res.status, `${attempt.method} was accepted`).not.toBe(200);
  }

  expect(
    await (await app.request("/api/v1/setup/status")).json(),
  ).toMatchObject({ needed: false });
  expect(await count(deps, "workspace")).toBe(1);
});

it("the workspace slug is validated, and is the instance's only one", async () => {
  const { deps, app } = await instance();
  const { cookie } = await signedIn(deps);

  const rejected = await Promise.all(
    [
      { name: "Acme", slug: "Not A Slug" },
      { name: "Acme", slug: "-leading-dash" },
      { name: "Acme", slug: "x" },
      // No ASCII letter or digit survives, so no slug can be derived and the
      // operator has to name one rather than get a generated placeholder.
      { name: "परीक्षा" },
      { name: "" },
    ].map(
      async (body) =>
        (await app.request("/api/v1/setup/complete", post(cookie, body)))
          .status,
    ),
  );
  expect(rejected).toEqual([400, 400, 400, 400, 400]);
  expect(await count(deps, "workspace")).toBe(0);

  const accepted = await app.request(
    "/api/v1/setup/complete",
    post(cookie, { name: "Acme College", slug: "acme" }),
  );
  expect(accepted.status).toBe(200);
  // Unique by construction rather than by a caught constraint violation:
  // setup refuses once a workspace exists, so it can never write a second
  // slug to collide with the first.
  const duplicate = await app.request(
    "/api/v1/setup/complete",
    post(cookie, { name: "Acme College", slug: "acme" }),
  );
  expect(duplicate.status).toBe(409);
  expect(await count(deps, "workspace")).toBe(1);
});
