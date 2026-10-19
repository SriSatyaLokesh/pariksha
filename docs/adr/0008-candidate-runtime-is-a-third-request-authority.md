# 0008. The candidate runtime is a third request authority

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Until Phase 6 this application had two kinds of request, and the difference
between them was visible by reading `createApp`.

A request was either **authenticated and workspace-scoped** — mounted under
`/api/v1/workspaces/:id/…`, carrying `requires(action)` or `requireMember()`,
with `guard()` ([`apps/api/src/middleware/authorize.ts`](../../apps/api/src/middleware/authorize.ts))
reading `c.req.param("id")` and refusing 401 / 404 / 403 in that order — or
it was one of a dozen obviously unauthenticated or actor-only routes:
`/health`, the sign-in legs, `/me`, `/setup/status`, the actor's own
workspace list, and Phase 5's public short link `/t/:code`.

The candidate is neither, and cannot be made into either.
[ADR 0005](0005-organiser-auth-before-the-candidate-runtime.md) is explicit:
"Candidate access is not organiser auth … Nothing in this decision gives a
candidate a user row." No user row means no session, no membership, and
nothing for `guard()` to find. Nor can a candidate URL name a workspace:
[`docs/PRD.md`](../PRD.md)'s `T-02` fixes it at `/<workspace-slug>/<test-slug>`,
and putting a `wsp_…` identifier in a URL a stranger holds is the opposite of
the 404-not-403 posture (`S-09`) that `authorize.ts` exists for.

What makes this a decision rather than a detail is the **second-order
effect**, and it is the one Phase 6's review focus names first. Today a
route in `app.ts` with no `requires()` on it looks wrong, and the two table
tests in [`authorization.test.ts`](../../apps/api/test/authorization.test.ts)
are built on `routeGuards(app)`, which reads the `GUARDS` WeakMap. A route
mounted with **no guard at all** is in neither `routeGuards(app)` nor
`ROUTE_ACTIONS`: it is absent from both sides of both assertions and ships
green. Phase 6 mounts a dozen deliberately unguarded routes, and from the
day it lands an unguarded line is an ordinary sight. The failure then
available is a Phase 7 snapshot route or a Phase 8 results route mounted
without a guard by accident — `routeGuards(app)` still equals
`ROUTE_ACTIONS`, `budget.test.ts` still passes because its budget line was
added, and the route is open to the internet.

Phase 5 saw the near edge of this and added a hand-written
`PUBLIC_OR_ACTOR_ONLY` list to `authorization.test.ts`, with its own note
that Phase 6's registry "is a fuller registry that carries the actor
requirement too; this is its precursor and should be folded into it rather
than kept beside it."

## Decision

**Every candidate route mounts under `/api/v1/run/…` and carries no
`requires()`.** The authority is the attempt token — 256 bits, only its hash
stored (`S-06`) — except for the routes that precede an attempt, of which the
landing page is the first. `{test}` in the PRD's REST table is the slug pair,
so the landing route is `GET /api/v1/run/:workspaceSlug/:testSlug`.

**`ROUTE_AUTH` in [`apps/api/src/app.ts`](../../apps/api/src/app.ts) is a
third registry beside `ROUTE_BUDGETS` and `ROUTE_ACTIONS`**, keyed
`"METHOD /path"`, naming **every mounted endpoint**'s authority. The three
are complementary, not duplicated: `GUARDS` says *which action*, `ROUTE_AUTH`
says *which authority*, `ROUTE_BUDGETS` says *what it may spend*.

It has **four** values, not the three the Phase 6 plan proposed:

| Value | Who is admitted | Checked by |
| --- | --- | --- |
| `workspace` | A signed-in actor with a membership in the workspace `:id` names | Asserted equal to `Object.keys(ROUTE_ACTIONS)`, and against the live `GUARDS` map through `routeAuthorities(app)` |
| `attempt` | The candidate's attempt token | `routeAuthorities(app)`, once Task 5's `attemptContext` registers itself the way `guard()` registers in `GUARDS` |
| `actor` | A signed-in user, and nothing more — these name no workspace in the path, so `guard()` would throw and `actorOr401` is the whole gate | A literal allowlist, plus a test that every one of them really answers 401 to an anonymous caller |
| `public` | No credential of any kind | A literal allowlist |

The fourth value is not a refinement. Six already-mounted endpoints
(`/me`, `setup/complete`, both `/workspaces` collection routes,
`auth/signout-everywhere`) require a signed-in user but have no workspace in
their path. Calling them `public` would be a false statement in the one table
every later task trusts, and calling them `workspace` would break the
equality with `ROUTE_ACTIONS` that makes a lost `requires()` detectable.

**The `public` and `actor` sets are each asserted by literal value**, so
widening either is a diff a human reviewer sees rather than one line blending
into a table of fifty. `authorization.test.ts`'s `PUBLIC_OR_ACTOR_ONLY` is
folded into this and deleted, as its own comment asked; that file's two guard
assertions are unchanged, because which *action* a guard enforces is still
its subject.

**The data layer stays absolute.** `resolvePublishedTest` — and, from Task 5,
`readAttemptByTokenHash` — cannot take a workspace ID, because the workspace
ID is what they produce. That is exactly
[ADR 0006](0006-identity-reads-sit-outside-the-workspace-guard.md)'s
admission test: "unable to know a workspace, not merely awkward to give one."
They do **not** join `identity.ts` — that ADR's own "to watch" section says a
function that is not about users or sessions should take a workspace ID
instead, and these cannot — so they get a third module,
`packages/db/src/repo/candidate-entry.ts`, exported from the package root and
deliberately outside `repo/index.ts`, with its own both-directions test
copying `identity.test.ts`. Every read after the resolution is an ordinary
`scoped()` function with the workspace ID it produced.

## Consequences

**`guard.ts`, `GUARDS` and the permission matrix are untouched.** Nothing
about organiser authorisation changes, and no exemption list grows. A
candidate route is not an exception to the guard; it is addressed somewhere
the guard was never asked about.

**"Unguarded" becomes declared rather than absent.** Mounting any route from
now on means adding a `ROUTE_AUTH` line in the same commit, or
`route-authority.test.ts` fails on a missing key — which is the point. Every
remaining Phase 6 task adds its lines that way.

**The honest classification costs vigilance, not code.** `ROUTE_AUTH` is
written by hand and checked against the live table only for the two
authorities that *are* middleware. `actor` and `public` carry nothing to read
back — `actorOr401` is called inside a handler, and "public" is the absence
of anything — so those two rest on their literals plus the anonymous-caller
probe. **Read a route's real guard before classifying it**: this task found
that `POST /api/v1/auth/signout` answers 204 to a caller with no session at
all (it clears a cookie and revokes whatever that cookie named), so it is
`public`, while its near-twin `signout-everywhere` calls `actorOr401` and is
`actor`. The two share a prefix and differ in authority.

**The subrequest floor for a candidate route is 0, not 2.** `authenticate`
calls `readSession` only when a signed session cookie is present, and a
candidate carries none — so a candidate route's budget is exactly what the
route itself reads and writes. The landing route measures 1.

**A candidate URL needs a host-level rewrite.** `/<workspace-slug>/<test-slug>`
has no file behind it, so `apps/web/public/_redirects` rewrites it onto
`exam.html` with a 200. The rule matches any two-segment path, so `/assets/*`
and `/fonts/*` are claimed above it and nothing may be added below it. One
cost is now accepted: a two-segment path naming no real test answers HTTP 200
with the exam shell rather than `404.html`, which is why `exam.html` carries
both a `noindex` meta tag and an `X-Robots-Tag` header.

**A workspace may not be reachable at the slug `attempt`.**
`/api/v1/run/attempt/…` is where Task 5 mounts the attempt routes. Hono
prefers a static segment to a parameter, so the two do not actually collide,
but `resolvePublishedTest` refuses that slug anyway, before its query and at
the cost of nothing — a belt beside the brace, and one fewer log line that
cannot be read two ways.
