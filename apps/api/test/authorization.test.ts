// AC-23: the permission matrix is enforced by the server, not described by
// it. The table test below is the gate — every (role, action) pair, against
// the real middleware — and the tests after it hold the distinctions the
// matrix alone cannot: anonymous is 401 and not 403, and a resource in
// another workspace is 404 and not either (S-09).

import { afterAll, beforeAll, expect, it } from "vitest";
import { ACTIONS, ROLES, can, type Action, type Role } from "@pariksha/core";
import * as db from "@pariksha/db";
import {
  addMembership,
  closeClient,
  createUser,
  createWorkspace,
  newId,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS } from "../src/app.js";
import { guardedRoutes, routeGuards } from "../src/instrument.js";
import { requires } from "../src/middleware/authorize.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps({ env: { APP_URL: "https://pariksha.test" } });
const app = createApp(deps);

/**
 * Phase 3 mounts routes for two of the thirteen actions, so the matrix is
 * exercised through one probe route per action on the real application, with
 * the real `authenticate` and the real `requires`. Asserting against eleven
 * routes that do not exist yet would assert nothing; asserting against the
 * guard itself is the gate AC-23 describes.
 */
const probe = createApp(deps);
for (const action of ACTIONS) {
  probe.get(`/api/v1/probe/:id/${action}`, requires(action), (c) =>
    c.json({ ok: true }),
  );
}

const wspA = newId("wsp");
const wspB = newId("wsp");
const cookies = new Map<Role, string>();
let ownerOfB = "";

beforeAll(async () => {
  for (const [id, slug] of [
    [wspA, "alpha"],
    [wspB, "beta"],
  ] as const) {
    await createWorkspace(deps.db, id, { slug, name: slug, now: FIXED_NOW });
  }

  for (const role of ROLES) {
    const userId = await createUser(deps.db, {
      email: `${role}@alpha.test`,
      authProvider: "magic_link",
      now: FIXED_NOW,
    });
    await addMembership(deps.db, wspA, { userId, role, now: FIXED_NOW });
    const { token } = await issueSession(deps, userId);
    cookies.set(role, await sessionCookie(deps, token));
  }

  const other = await createUser(deps.db, {
    email: "owner@beta.test",
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, wspB, {
    userId: other,
    role: "owner",
    now: FIXED_NOW,
  });
  ownerOfB = await sessionCookie(deps, (await issueSession(deps, other)).token);
});

afterAll(() => closeClient(deps.db));

function asMember(role: Role): RequestInit {
  return { headers: { cookie: cookies.get(role) ?? "" } };
}

function callRouteFor(action: Action, init: RequestInit): Promise<Response> {
  return probe.request(`/api/v1/probe/${wspA}/${action}`, init);
}

it("AC-23: every allowed action succeeds and every other returns 403", async () => {
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      const res = await callRouteFor(action, asMember(role));
      if (can({ role, action })) {
        expect(res.status, `${role}/${action}`).not.toBe(403);
      } else {
        expect(res.status, `${role}/${action}`).toBe(403);
      }
    }
  }
});

// MINOR-8 (whole-branch review): this table is the one file a future
// permission-matrix change edits, and before this it had no idea a second
// kind of principal — a scoped API key — exists at all, which is exactly
// why MAJOR-4's drift (a key's frozen scopes silently falling out of step
// with a `can()` the matrix moved) would go unnoticed here. A key scoped to
// exactly one action should answer every route in the same table the way a
// role granted only that one action would: pass on its own action, 403 on
// every other.
it("AC-23, for a key: a key scoped to exactly one action passes only that action's route", async () => {
  const scopedAction: Action = "results.export";
  const { secret } = await db.createApiKey(deps.db, wspA, {
    name: "authorization-table probe key",
    scopes: [scopedAction],
    now: FIXED_NOW,
  });
  const asKey: RequestInit = { headers: { authorization: `Bearer ${secret}` } };

  for (const action of ACTIONS) {
    const res = await callRouteFor(action, asKey);
    expect(res.status, `key/${action}`).toBe(action === scopedAction ? 200 : 403);
  }
});

it("S-09: a member of workspace A gets 404, not 403, for a workspace-B resource", async () => {
  expect(
    (await app.request(`/api/v1/workspaces/${wspB}`, asMember("owner"))).status,
  ).toBe(404);
  // The same request from a member of B answers, so the 404 above is the
  // guard and not a route that is simply missing.
  expect(
    (
      await app.request(`/api/v1/workspaces/${wspB}`, {
        headers: { cookie: ownerOfB },
      })
    ).status,
  ).toBe(200);
});

it("S-09: a write to another workspace is 404 too, before the action is weighed", async () => {
  const res = await app.request(`/api/v1/workspaces/${wspB}`, {
    method: "PATCH",
    headers: {
      cookie: cookies.get("owner") ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "stolen" }),
  });

  expect(res.status).toBe(404);
  expect((await res.json()).error.code).toBe("not_found");
});

it("an anonymous request to a guarded route is 401, not 403", async () => {
  for (const path of [
    `/api/v1/probe/${wspA}/tests.edit`,
    `/api/v1/workspaces/${wspA}`,
    `/api/v1/workspaces/${wspA}/members`,
    "/api/v1/me",
    "/api/v1/workspaces",
  ]) {
    const res = await probe.request(path);
    expect(res.status, path).toBe(401);
    expect((await res.json()).error.code, path).toBe("unauthenticated");
  }
});

it("a cookie that is not a live session is anonymous, not an error", async () => {
  expect(
    (
      await app.request("/api/v1/me", {
        headers: { cookie: "pk_session=not-a-real-token" },
      })
    ).status,
  ).toBe(401);
});

it("every guarded route is covered by this table", () => {
  expect(new Set(guardedRoutes(app))).toEqual(
    new Set(Object.keys(ROUTE_ACTIONS)),
  );
});

it("the table names the action each guard actually enforces", () => {
  // Keys alone would let the table claim `workspace.settings` over a route
  // that enforces something else; the values come off the live middleware.
  expect(routeGuards(app)).toEqual(ROUTE_ACTIONS);
});

/**
 * Whole-branch security review, M2 asked for an exhaustive "every mounted
 * endpoint is guarded, or is named by hand with the reason it has no
 * workspace to guard on" check, and this file carried it as
 * `PUBLIC_OR_ACTOR_ONLY` — with its own note that Phase 6's `ROUTE_AUTH`
 * "is a fuller registry that carries the actor requirement too; this is its
 * precursor and should be folded into it rather than kept beside it."
 *
 * Phase 6 Task 1 (#65, ADR 0008) did that fold, so the list is **gone from
 * here** rather than duplicated. `apps/api/test/route-authority.test.ts`
 * now makes the same guarantee strictly more strongly: `ROUTE_AUTH` names
 * every mounted endpoint (not just the unguarded ones), separates
 * "signed-in actor" from "no credential at all" (which one flat list could
 * not), and asserts each of those two sets by literal value so widening
 * either is a diff a reviewer sees.
 *
 * The two assertions above stay exactly as they were: `GUARDS` says which
 * action, and that is still this file's subject.
 */

it("the magic-link route answers identically for a known and an unknown address", async () => {
  const ask = (email: string) =>
    app.request("/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });

  const known = await ask("owner@alpha.test");
  const unknown = await ask("nobody@alpha.test");

  expect(unknown.status).toBe(known.status);
  expect(await unknown.text()).toBe(await known.text());
});

it("the OIDC start route redirects to the provider, over the injected fetch", async () => {
  // A second database, because this one needs a provider configured. The
  // point of the test is that `deps.http` reaches `authorizationUrl`: without
  // it the route would be unreachable without a real identity provider, and
  // nothing local would ever exercise it.
  const issuer = "https://start.test";
  const { deps: base } = await testDeps({
    env: {
      OIDC_PROVIDERS: JSON.stringify([
        {
          id: "google",
          label: "Google",
          issuer,
          clientId: "client-abc",
          clientSecret: "shh",
          redirectUri: `${issuer}/back`,
        },
      ]),
    },
  });
  const oidc = createApp({
    ...base,
    http: (input) =>
      Promise.resolve(
        String(input).endsWith("/jwks")
          ? Response.json({ keys: [] })
          : Response.json({
              issuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              jwks_uri: `${issuer}/jwks`,
            }),
      ),
  });

  const res = await oidc.request("/api/v1/auth/google/start");
  const location = new URL(res.headers.get("location") ?? "");

  expect(res.status).toBe(302);
  expect(`${location.origin}${location.pathname}`).toBe(`${issuer}/authorize`);
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  closeClient(base.db);
});

it("the audit repository exposes no update or delete", () => {
  expect(
    Object.keys(db)
      .filter((name) => name.toLowerCase().includes("audit"))
      .sort(),
  ).toEqual(["appendAudit", "listAudit"]);
});
