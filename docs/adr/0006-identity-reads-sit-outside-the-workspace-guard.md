# 0006. Identity reads sit outside the workspace guard, not inside an exemption list

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

`S-09` requires that every query touching tenant data is scoped by workspace ID in the
data layer. Phase 2 made that structural rather than a review habit: every repository
function is wrapped in `scoped()` ([`packages/db/src/repo/guard.ts`](../../packages/db/src/repo/guard.ts)),
which refuses a missing or malformed workspace ID and registers itself by name in
`REPO_FUNCTIONS`. A test enumerates the exports of `repo/index.ts` and proves every one
of them is registered — so a function added in a later phase without the guard fails the
build instead of shipping an unscoped read.

Phase 3's sessions broke the assumption the guard was built on. **A session is looked up
before any workspace is known.** The lookup is precisely what tells the request which
workspaces the actor may see at all, so `readSessionActor` cannot take a workspace ID as
its first argument — there is nothing to pass. The same is true of `createUser` and of
revoking every session a user holds. Six functions in total are, by their nature,
pre-workspace.

The obvious move is an exemption list inside `guard.ts`: a set of names the scoping test
skips. It was rejected. An exemption list is a list that grows — the next phase with an
awkward function adds a name rather than arguing with the design, and the guard decays
from "every repository function is scoped" into "every repository function is scoped,
except the ones that aren't". The value of the rule is that it has no exceptions to
reason about.

## Decision

Pre-workspace identity functions live in their own module,
[`packages/db/src/repo/identity.ts`](../../packages/db/src/repo/identity.ts), which is
exported from the package root but **deliberately not re-exported from
`repo/index.ts`**. The barrel the scoping test reads therefore keeps its rule intact and
literal, with no exemption clause and no change to `guard.ts`.

The separation is itself tested, in both directions
([`packages/db/test/repo/identity.test.ts`](../../packages/db/test/repo/identity.test.ts)):

- `UNSCOPED_BY_DESIGN` names exactly six functions — `createUser`, `insertSession`,
  `readSessionActor`, `touchSession`, `deleteSession`, `deleteUserSessions`. A seventh
  function added to `identity.ts` fails the test until someone writes its name down, so
  the set cannot grow as a side effect of adding an import.
- No name in that set may appear in `repo/index.ts`'s exports or in `REPO_FUNCTIONS`, so
  the two halves cannot drift into each other.

The functions are unscoped because they are **pre-authentication**, not because they are
inconvenient to scope. That is the admission test for anything joining them: a candidate
function must be unable to know a workspace, not merely awkward to give one.

## Consequences

**Easier.** The workspace guard stays absolute, which is what makes it worth having —
a reviewer reading `repo/index.ts` needs no table of exceptions. Sessions get the single
joined read the subrequest budget demands, without the guard's signature fighting them.

**Harder.** `@pariksha/db` now exports six functions that will happily read a user row
with no workspace in sight, and nothing in the type system stops an application module
from calling `readSessionActor` directly instead of going through
`apps/api/src/auth/session.ts`. The protection is the narrowness of the set and the test
that pins it, not the compiler.

**To watch.** Three things would each justify revisiting this:

- The set growing past identity. If a function that is not about users or sessions is
  proposed for `identity.ts`, the right response is almost always that it *can* take a
  workspace ID and should.
- Phase 11's password and TOTP sign-in, which adds credential reads to the same
  pre-workspace position and should extend this module rather than invent a third place.
- Any future need to scope a session to one workspace — an organiser signed into two
  workspaces in two tabs, say. That is a change to the session model, not an exemption,
  and would need its own record.
