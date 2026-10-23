// `D7c`'s readiness aggregate (Phase 8c Task 5): `GET .../tests/readiness`,
// one response for every test in the workspace, bounded to four statements
// regardless of how many tests there are (`K21`) — the exact cost
// `tests.tsx`'s own docblock said a real meter here would need "one `GET
// .../checklist` per row" to produce.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { readinessFor } from "../../src/publish/readiness.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const TEST_COUNT = 12;

let workspaceId = "";
let authorCookie = "";
let viewerCookie = "";
let suffix = 0;

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const get = (cookie: string): RequestInit => send("GET", cookie);
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);

async function member(ws: string, role: "author" | "viewer", tag: string): Promise<string> {
  const userId = await createUser(deps.db, {
    email: `${role}-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, ws, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

/** `TEST_COUNT` tests, each left with the one open draft `createTest`
 *  always seeds (`T-02`) — enough for `buildChecklist` to run against.
 *  None is configured to be publishable: the aggregate's job is to answer
 *  for every test, not to make every test green. */
beforeEach(async () => {
  suffix += 1;
  const tag = `r${suffix}`;

  const ownerId = await createUser(deps.db, {
    email: `owner-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  workspaceId = (
    await (
      await app.request("/api/v1/workspaces", send("POST", ownerCookie, { slug: `rdy-${tag}`, name: "Rdy Co" }))
    ).json()
  ).id;

  authorCookie = await member(workspaceId, "author", tag);
  viewerCookie = await member(workspaceId, "viewer", tag);

  for (let i = 0; i < TEST_COUNT; i += 1) {
    await app.request(
      `/api/v1/workspaces/${workspaceId}/tests`,
      post({ name: `Test ${i}`, slug: `test-${i}-${tag}` }, authorCookie),
    );
  }
});

const readinessUrl = (): string => `/api/v1/workspaces/${workspaceId}/tests/readiness`;

async function readiness(cookie = authorCookie): Promise<Record<string, { ready: number; total: number }>> {
  const res = await app.request(readinessUrl(), get(cookie));
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json();
}

it("answers for every test in one response", async () => {
  const body = await readiness();
  expect(Object.keys(body)).toHaveLength(TEST_COUNT);
  // The same `buildChecklist` the single-test route runs, so the two can
  // never disagree about what "ready" means — a brand-new draft is never
  // all-green (it has no duration and no sections), so every row has
  // something to count.
  for (const summary of Object.values(body)) {
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.ready).toBeLessThanOrEqual(summary.total);
  }
});

// Fix round 1, Important 2: T-02's invariant is that a test always carries
// exactly one open draft, so nothing through the ordinary API ever leaves
// one without — `readinessFor`'s `if (!draft) continue` is defensive,
// written (its own comment says so) on the premise that the invariant
// might not hold forever. Correct-by-inspection is not pinned, so this
// reaches past the API and breaks the invariant on purpose, the only way
// to reach the branch at all.
it("omits a test with no open draft version, rather than throwing or reporting 0 / 0", async () => {
  const before = await readiness();
  const [testId] = Object.keys(before);

  await deps.db.run(
    "UPDATE test_version SET published_at = ? WHERE workspace_id = ? AND test_id = ? AND published_at IS NULL",
    [FIXED_NOW, workspaceId, testId],
  );

  const after = await readiness();
  expect(after[testId]).toBeUndefined();
  expect(Object.keys(after)).toHaveLength(TEST_COUNT - 1);
});

// Fix round 1, Important 2: the other correct-by-inspection path —
// `listTests` answers `[]`, the loop body never runs, and the result is
// `{}`. A fresh workspace, not `beforeEach`'s (which always seeds
// `TEST_COUNT` tests), so the empty case is real rather than filtered down
// to it.
it("answers {} for a workspace with no tests at all", async () => {
  const tag = `empty${suffix}`;
  const ownerId = await createUser(deps.db, {
    email: `owner-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  const emptyWorkspaceId = (
    await (
      await app.request("/api/v1/workspaces", send("POST", ownerCookie, { slug: `empty-${tag}`, name: "Empty Co" }))
    ).json()
  ).id;
  const emptyAuthorCookie = await member(emptyWorkspaceId, "author", tag);

  const res = await app.request(`/api/v1/workspaces/${emptyWorkspaceId}/tests/readiness`, get(emptyAuthorCookie));
  expect(res.status, await res.clone().text()).toBe(200);
  expect(await res.json()).toEqual({});
});

it("costs a bounded number of statements for twelve tests", async () => {
  const counting = countingDeps(deps);
  await readinessFor(counting.deps, workspaceId);
  expect(counting.counts().db).toBeLessThanOrEqual(4);
});

it("is readable by an Author, who is the person who has to fix it", async () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/readiness"]).toBe("tests.edit");
  expect((await app.request(readinessUrl(), get(authorCookie))).status).toBe(200);
});

it("refuses a Viewer, who holds no tests.edit", async () => {
  expect((await app.request(readinessUrl(), get(viewerCookie))).status).toBe(403);
});

it("measures the real subrequest cost of the readiness route, flat in test count", async () => {
  const counting = countingDeps(deps);
  expect((await createApp(counting.deps).request(readinessUrl(), get(authorCookie))).status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/readiness"]);
  // Whole-branch test-honesty review, §4 (`checklist.test.ts`'s own
  // precedent): the measurement alone is one lock, catching a regression
  // that adds a query. The literal is the second — without it, editing
  // `app.ts` makes the measurement agree with itself again and both go
  // green.
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/readiness"]).toBe(6);
});
