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

it("every endpoint the actor allowlist names really does refuse an anonymous caller", async () => {
  for (const endpoint of Object.entries(ROUTE_AUTH)
    .filter(([, authority]) => authority === "actor")
    .map(([e]) => e)) {
    const [method = "GET", path = "/"] = endpoint.split(" ");
    const res = await app.request(path, {
      method,
      ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }),
    });
    expect(res.status, endpoint).toBe(401);
  }
});

it("a candidate route is reachable with no cookie and spends no session read", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request("/api/v1/run/alpha/aptitude");
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug"]);
});
