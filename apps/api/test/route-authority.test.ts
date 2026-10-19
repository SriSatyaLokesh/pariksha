// Review Focus 1. THE LOAD-BEARING FILE.
//
// Until Phase 6 a route in `app.ts` either carried `requires()` /
// `requireMember()` or was one of a dozen obviously actor-only or public
// ones, and `authorization.test.ts` could carry the whole gap in one
// hand-written list. Phase 6 mounts a dozen deliberately unguarded routes,
// and from the day it lands "no `requires()` on this line" is an ordinary
// sight — so the gap stops being visible by reading.
//
// `ROUTE_AUTH` is the third registry beside `ROUTE_BUDGETS` and
// `ROUTE_ACTIONS`: `GUARDS` says *which action*, `ROUTE_AUTH` says *which
// authority*, `ROUTE_BUDGETS` says *what it may spend*. The failure it
// exists to catch is a Phase 7 snapshot route or a Phase 8 results route
// mounted with no guard at all: `routeGuards(app)` still equals
// `ROUTE_ACTIONS`, `budget.test.ts` still passes because the budget line was
// added, and the route is open to the internet. Here it is a missing key,
// and a missing key fails.
//
// Every later task in this phase adds its line in the same commit as its
// route.

import { afterAll, expect, it } from "vitest";
import { closeClient } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps, mountedEndpoints, routeAuthorities } from "../src/instrument.js";
import { testDeps } from "./deps.js";
import { seedPublishedTest } from "./run/fixtures.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

await seedPublishedTest(deps);

it("every mounted endpoint declares an authority", () => {
  expect(new Set(mountedEndpoints(app))).toEqual(new Set(Object.keys(ROUTE_AUTH)));
});

it("the workspace-authority set is exactly the guarded set", () => {
  // A route that loses its requires() in a later phase stops matching here
  // even though routeGuards(app) === ROUTE_ACTIONS still holds on both
  // sides — because ROUTE_ACTIONS would have lost the same line.
  expect(
    new Set(
      Object.entries(ROUTE_AUTH)
        .filter(([, authority]) => authority === "workspace")
        .map(([endpoint]) => endpoint),
    ),
  ).toEqual(new Set(Object.keys(ROUTE_ACTIONS)));
});

it("the declared authorities match the middleware actually mounted", () => {
  // `routeAuthorities` reads the live route table, not the declaration, so
  // this is the direction `ROUTE_AUTH` cannot satisfy by agreeing with
  // itself: declaring `workspace` over a route that mounts no guard, or
  // `attempt` over one that mounts no attempt context, fails here.
  const live = routeAuthorities(app);
  const declaredLive = Object.fromEntries(
    Object.entries(ROUTE_AUTH).filter(
      ([, authority]) => authority === "workspace" || authority === "attempt",
    ),
  );
  expect(live).toEqual(declaredLive);
});

it("the public set is a literal allowlist, so widening it is a visible diff", () => {
  expect(
    Object.entries(ROUTE_AUTH)
      .filter(([, authority]) => authority === "public")
      .map(([endpoint]) => endpoint)
      .sort(),
  ).toEqual([
    "GET /api/v1/auth/:provider/callback",
    "GET /api/v1/auth/:provider/start",
    "GET /api/v1/health",
    "GET /api/v1/run/:workspaceSlug/:testSlug",
    "GET /api/v1/setup/status",
    "GET /t/:code",
    "POST /api/v1/auth/magic-link",
    "POST /api/v1/auth/signout",
  ]); // every later task that adds one edits this literal
});

it("the actor set is a literal allowlist too — signed in, but naming no workspace", () => {
  expect(
    Object.entries(ROUTE_AUTH)
      .filter(([, authority]) => authority === "actor")
      .map(([endpoint]) => endpoint)
      .sort(),
  ).toEqual([
    "GET /api/v1/me",
    "GET /api/v1/workspaces",
    "POST /api/v1/auth/signout-everywhere",
    "POST /api/v1/setup/complete",
    "POST /api/v1/workspaces",
  ]);
});

/**
 * A concrete URL for every endpoint whose path carries a parameter. There
 * is no default: `probeOf` refuses a path that still contains a `:`, so a
 * later task that adds a parameterised `public` or `actor` route has to
 * supply a URL here rather than have its probe silently skip.
 */
const PROBE_URL: Readonly<Record<string, string>> = {
  "GET /api/v1/run/:workspaceSlug/:testSlug": "/api/v1/run/alpha/aptitude",
  "GET /api/v1/auth/:provider/start": "/api/v1/auth/google/start",
  "GET /api/v1/auth/:provider/callback": "/api/v1/auth/google/callback",
  "GET /t/:code": "/t/ABC123",
};

function probeOf(endpoint: string): { method: string; url: string } {
  const [method = "GET", path = "/"] = endpoint.split(" ");
  const url = PROBE_URL[endpoint] ?? path;
  expect(url, `${endpoint} is parameterised and needs a PROBE_URL entry`).not.toContain(":");
  return { method, url };
}

const anonymously = (endpoint: string): Promise<Response> => {
  const { method, url } = probeOf(endpoint);
  return app.request(url, {
    method,
    ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }),
  });
};

const endpointsWithAuthority = (wanted: string): string[] =>
  Object.entries(ROUTE_AUTH)
    .filter(([, authority]) => authority === wanted)
    .map(([endpoint]) => endpoint);

it("every endpoint the actor allowlist names really does refuse an anonymous caller", async () => {
  const actors = endpointsWithAuthority("actor");
  expect(actors.length).toBeGreaterThan(0);
  for (const endpoint of actors) {
    expect((await anonymously(endpoint)).status, endpoint).toBe(401);
  }
});

/**
 * The mirror of the assertion above, and the reason both exist.
 *
 * `public` and `actor` are the two authorities that carry no middleware for
 * `routeAuthorities` to read back, so the literal is all that holds them —
 * and a literal only catches a human reading one new line in a sorted list.
 * Without this, a Phase 7 or Phase 8 route that calls `actorOr401` inside
 * its handler but is declared `public` passes every other assertion in this
 * file. Task 12's scrubber then enumerates it from `ROUTE_AUTH` as
 * candidate-reachable and reports clean on a body it could never obtain.
 *
 * 401 **and** 403: both mean "you needed a credential you did not send",
 * which is the one thing a `public` route may never answer. Any other
 * status is fine — these probes send placeholder parameters and empty
 * bodies, so a 400, a 404 or a redirect all say the route was reached.
 */
it("every endpoint the public allowlist names really is reachable without one", async () => {
  const publics = endpointsWithAuthority("public");
  expect(publics.length).toBeGreaterThan(0);
  for (const endpoint of publics) {
    const status = (await anonymously(endpoint)).status;
    expect(status, `${endpoint} answered ${String(status)} to an anonymous caller`).not.toBe(401);
    expect(status, `${endpoint} answered ${String(status)} to an anonymous caller`).not.toBe(403);
  }
});

it("a candidate route is reachable with no cookie and spends no session read", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request("/api/v1/run/alpha/aptitude");
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug"]);
});
