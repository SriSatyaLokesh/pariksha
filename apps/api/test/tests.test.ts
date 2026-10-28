// Test CRUD, slugs, short links and QR codes (#54, P5.1), over the real
// routes.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser, publishDraftVersion, type DbClient } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../src/app.js";
import { LIMITS } from "../src/run/limit.js";
import { countingDeps, mountedRoutes } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let workspaceSlug = "";
let authorCookie = "";
let viewerCookie = "";

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

const get = (cookie: string): RequestInit => send("GET", cookie);
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);
const patch = (body: unknown, cookie: string): RequestInit => send("PATCH", cookie, body);

async function newWorkspaceWithAuthor(suffix: string): Promise<{
  workspaceId: string;
  slug: string;
  authorCookie: string;
  viewerCookie: string;
}> {
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const slug = `tests-${suffix}`;
  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug, name: "Test Co" }),
  );
  const id = (await created.json()).id;

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, id, { userId: authorId, role: "author", now: FIXED_NOW });
  const authorCk = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, id, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  const viewerCk = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

  return { workspaceId: id, slug, authorCookie: authorCk, viewerCookie: viewerCk };
}

/** A fresh workspace with an Author and a Viewer, so no test depends on
 * another. */
beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const seeded = await newWorkspaceWithAuthor(suffix);
  workspaceId = seeded.workspaceId;
  workspaceSlug = seeded.slug;
  authorCookie = seeded.authorCookie;
  viewerCookie = seeded.viewerCookie;
});

it("POST /tests takes a name and a slug and answers 201 with the tst_ id", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.id).toMatch(/^tst_/);
  expect(body.name).toBe("Midterm");
  expect(body.slug).toBe("midterm");
  expect(body.state).toBe("draft");
  expect(body.draftVersion).toBe(1);
  expect(body.currentVersion).toBeNull();
  expect(body.shortCode).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{6}$/);
});

it("a cross-workspace test is 404, not 403", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  const other = await newWorkspaceWithAuthor(`${Math.random().toString(36).slice(2, 10)}-b`);
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    get(other.authorCookie),
  );
  expect(res.status).toBe(404);
});

it("a Viewer can read the test list (tests.view)", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests`, get(viewerCookie));
  expect(res.status).toBe(200);
});

it("T-03: the list filters by tag, searches by name and sorts, in one query", async () => {
  await app.request(`/api/v1/workspaces/${workspaceId}/tests`, post({ name: "Aptitude", slug: "aptitude" }, authorCookie));
  await app.request(`/api/v1/workspaces/${workspaceId}/tests`, post({ name: "Midterm", slug: "midterm" }, authorCookie));
  await app.request(`/api/v1/workspaces/${workspaceId}/tests`, post({ name: "Zebra", slug: "zebra" }, authorCookie));

  const searched = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests?search=mid`,
    get(authorCookie),
  );
  expect((await searched.json()).tests.map((t: { name: string }) => t.name)).toEqual(["Midterm"]);

  const sorted = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests?sort=name`,
    get(authorCookie),
  );
  expect((await sorted.json()).tests.map((t: { name: string }) => t.name)).toEqual([
    "Aptitude",
    "Midterm",
    "Zebra",
  ]);

  const tagged = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests?tag=mock`,
    get(authorCookie),
  );
  expect((await tagged.json()).tests).toEqual([]);
});

it("PATCH edits a test", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  const renamed = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    patch({ slug: "renamed" }, authorCookie),
  );
  expect(renamed.status).toBe(200);
  expect((await renamed.json()).slug).toBe("renamed");
});

it("PATCH locks the slug once the test is published", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  await publishDraftVersion(deps.db, workspaceId, testId, FIXED_NOW);

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    patch({ slug: "renamed" }, authorCookie),
  );
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("slug_locked");
});

// Task 2 fix round, Important 4: a data-layer failure that is not the
// (workspace_id, slug) unique constraint must surface as a 500, not be
// reported to the operator as a duplicate address.
function dbThatFailsOn(db: DbClient, match: RegExp): DbClient {
  return {
    ...db,
    run: async (sql, params) => {
      if (match.test(sql)) throw new Error("ECONNRESET: connection reset");
      return db.run(sql, params);
    },
    batch: async (statements) => {
      if (statements.some((s) => match.test(s.sql))) throw new Error("ECONNRESET: connection reset");
      return db.batch(statements);
    },
  };
}

it("a data-layer failure on create is a 500, not slug_taken", async () => {
  const failing = createApp({ ...deps, db: dbThatFailsOn(deps.db, /INSERT INTO test/i) });
  const res = await failing.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  expect(res.status).toBe(500);
});

it("a data-layer failure on update is a 500, not slug_taken", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const testId = (await created.json()).id;

  const failing = createApp({ ...deps, db: dbThatFailsOn(deps.db, /UPDATE test SET/i) });
  const res = await failing.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    patch({ slug: "renamed" }, authorCookie),
  );
  expect(res.status).toBe(500);
});

it("POST a taken slug is 409 slug_taken", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );

  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm again", slug: "midterm" }, authorCookie),
  );
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("slug_taken");
});

it("AC-02: GET /t/<code> redirects to /<workspace-slug>/<test-slug> and nothing else", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: "midterm" }, authorCookie),
  );
  const { id: testId, shortCode } = await created.json();

  // Whole-branch security review, M3: a draft resolves to nothing. Until
  // this predicate landed, the pair (workspace slug, test slug) of a test
  // nobody was ever given a link to was readable with no cookie — and with
  // no rate limiter anywhere in the repo until Phase 6, a 32^6 sweep made
  // it an enumeration oracle over author-chosen, meaningful names.
  expect((await app.request(`/t/${shortCode}`)).status).toBe(404);

  await publishDraftVersion(deps.db, workspaceId, testId, FIXED_NOW);

  // No cookie: the short link is public once the test is published.
  const res = await app.request(`/t/${shortCode}`);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`/${workspaceSlug}/midterm`);
});

it("GET /t/<unknown> is 404 and names no workspace", async () => {
  const res = await app.request("/t/zzzzzz");
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).not.toMatch(/wsp_/);
});

// --- Phase 6 Task 4 (#68, P6.4): the one enumerable surface -----------
//
// Phase 5 shipped `/t/:code` with no limiter and said so in its handoff;
// the reconciliation carried it into this phase. A six-character code is
// the only thing on this instance a stranger can guess at, and until this
// bucket existed a 32^6 sweep was free.

/** Fills the instance-wide `short_link` bucket, the way 300 misses in a
 *  minute would have. */
async function fillShortLinkBucket(db = deps.db): Promise<void> {
  await db.run("DELETE FROM rate_limit WHERE bucket = ?", ["short_link"]);
  await db.run("INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, ?)", [
    "short_link",
    FIXED_NOW,
    LIMITS.short_link.limit,
  ]);
}

const rateBuckets = async (): Promise<string[]> =>
  (await deps.db.query<{ bucket: string }>("SELECT bucket FROM rate_limit", [])).map(
    (row) => row.bucket,
  );

it("S-07: a short code that resolves to nothing is counted, and the next one is 429", async () => {
  await deps.db.run("DELETE FROM rate_limit", []);
  expect((await app.request("/t/qqqqqq")).status).toBe(404);
  expect(await rateBuckets()).toEqual(["short_link"]);

  await fillShortLinkBucket();
  const res = await app.request("/t/qqqqqq");
  expect(res.status).toBe(429);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("too_many_attempts");
});

it("S-07: the bucket is instance-wide, so a sweep that never repeats a code still meets it", async () => {
  // The whole reason this bucket exists. A per-code counter is, against
  // an enumeration of 32^6, a counter that never reaches 2 — every probe
  // is a fresh key. Six distinct codes here, one bucket, count six.
  await deps.db.run("DELETE FROM rate_limit", []);
  for (const code of ["aaaaaa", "bbbbbb", "cccccc", "dddddd", "ffffff", "gggggg"]) {
    expect((await app.request(`/t/${code}`)).status).toBe(404);
  }
  const rows = await deps.db.query<{ bucket: string; count: number }>(
    "SELECT bucket, count FROM rate_limit",
    [],
  );
  expect(rows).toEqual([{ bucket: "short_link", count: 6 }]);

  // And the sweep is actually stopped, not merely counted.
  await fillShortLinkBucket();
  expect((await app.request("/t/hhhhhh")).status).toBe(429);
});

it("S-07: a short code that resolves is never charged, so a projected link is not a bucket", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Projected", slug: "projected" }, authorCookie),
  );
  const { id, shortCode } = (await created.json()) as { id: string; shortCode: string };
  await publishDraftVersion(deps.db, workspaceId, id, FIXED_NOW);

  await deps.db.run("DELETE FROM rate_limit", []);
  // Far past the limit, and every one of them a hit: 500 candidates
  // reading the same projector in the same minute is the expected load.
  for (let i = 0; i < 3; i++) expect((await app.request(`/t/${shortCode}`)).status).toBe(302);
  expect(await rateBuckets()).toEqual([]);
});

it("S-07: no bucket is keyed on a client IP — a whole campus shares one", async () => {
  await deps.db.run("DELETE FROM rate_limit", []);
  await app.request("/t/wwwwww", { headers: { "CF-Connecting-IP": "198.51.100.77" } });
  expect(JSON.stringify(await rateBuckets())).not.toContain("198.51.100.77");
  // Nor on the code: the bucket name is the kind and nothing else.
  expect(await rateBuckets()).toEqual(["short_link"]);
});

it("the window rolls: the limit is spendable again once windowMs has passed", async () => {
  // Its own database, because its clock is an hour ahead of this file's.
  const later = await testDeps({ now: () => FIXED_NOW + LIMITS.short_link.windowMs + 1 });
  await fillShortLinkBucket(later.deps.db);
  // 404, not 429: the stale window is reset by the same statement that
  // counts, so the miss is charged against a fresh one.
  expect((await createApp(later.deps).request("/t/eeeeee")).status).toBe(404);
  closeClient(later.deps.db);
});

it("the short-link route is the only route with no guard", () => {
  expect(mountedRoutes(app).filter((r) => !(r in ROUTE_ACTIONS) && r.startsWith("/t"))).toEqual([
    "/t/:code",
  ]);
});

// `ROUTE_BUDGETS` carries one number per *path*, shared by every method
// mounted there (the same shape banks' own "GET/POST .../banks": 5 already
// has) — so each method below is pinned to its own measured cost with a
// literal `toBe`, and the two multi-method paths are additionally checked
// against the table, which must carry the more expensive method's number.
it("measures the real subrequest cost of every route this task mounts", async () => {
  async function measure(method: string, path: string, expected: number, cookie: string, body?: unknown): Promise<string> {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(path, send(method, cookie, body));
    expect(res.status, `${method} ${path} -> ${res.status}`).toBeLessThan(400);
    const parsed = (await res.json().catch(() => null)) as { id?: string } | null;
    expect(counting.counts().total, `${method} ${path}`).toBe(expected);
    return parsed?.id ?? "";
  }

  // Auth (2) + createTest's one batch (1, the test row and its draft
  // version 1 together) + appendAudit (1) = 4 — plus the one extra 404 the
  // workspace-member guard itself reads before `tests.edit` is even
  // checked... no: `requires()` reads the actor's own session (already
  // loaded, no subrequest) and the membership is already on `c.var.actor`,
  // so the guard costs nothing extra. Measured at 5: `createTest`'s retry
  // path aside, the fifth statement is `getTest`'s own read-back, which
  // `createTest` does once to hand the route a full `TestRow`.
  const testId = await measure(
    "POST",
    `/api/v1/workspaces/${workspaceId}/tests`,
    5,
    authorCookie,
    { name: "Budget", slug: "budget" },
  );
  // Auth (2) + listTests (1) + draftVersionsByTest (1) = 4.
  await measure("GET", `/api/v1/workspaces/${workspaceId}/tests`, 4, authorCookie);
  // Auth (2) + getTest (1) + draftVersionsByTest (1) = 4.
  await measure("GET", `/api/v1/workspaces/${workspaceId}/tests/${testId}`, 4, authorCookie);
  // Auth (2) + updateTest (getTest + UPDATE, 2) + draftVersionsByTest (1) +
  // appendAudit (1) = 6.
  await measure(
    "PATCH",
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    6,
    authorCookie,
    { name: "Budget 2" },
  );

  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests"]).toBe(5);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId"]).toBe(6);

  // No authentication cost at all (no cookie), and one read: resolveShortCode.
  const counting = countingDeps(deps);
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Short", slug: "short-budget" }, authorCookie),
  );
  const short = await created.json();
  await publishDraftVersion(deps.db, workspaceId, short.id, FIXED_NOW);
  const shortRes = await createApp(counting.deps).request(`/t/${short.shortCode}`);
  expect(shortRes.status).toBe(302);
  expect(counting.counts().total, "GET /t/:code").toBe(1);

  // The miss is the expensive path, and it is what the table carries:
  // `resolveShortCode` (1) plus the one `takeRateToken` statement (1).
  // A hit stays at 1 above — the limiter counts misses only, which is why
  // 500 candidates opening the projected link cost exactly what they did
  // before this bucket existed.
  const missing = countingDeps(deps);
  const missRes = await createApp(missing.deps).request("/t/nnnnnn");
  expect(missRes.status).toBe(404);
  expect(missing.counts().total, "GET /t/:code (miss)").toBe(2);
  expect(ROUTE_BUDGETS["/t/:code"]).toBe(2);
});

// --- Phase 6.5c Task 3 (D6b): `closesAt` on the wire --------------------
//
// `opens_at`/`closes_at` live in `TestTiming` inside the version body, so
// `toWire` is the only place that holds them at list time — it already
// destructures `publishedTiming` to derive `state` and throws it away.
// Home's agenda cannot say the one thing that matters most without it.
//
// Parsed, not forwarded: the wire carries an epoch, the document carries a
// string, and `instant` is the same parse `deriveState` judges the window
// by — so a wire `closesAt` and a wire `state` can never disagree about
// what the document said.

/** A published test whose document carries `timing`, which is where a
 *  closing time really lives. */
async function publishedWithTiming(
  timing: Record<string, unknown> | undefined,
): Promise<string> {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Closing", slug: `closing-${Math.random().toString(36).slice(2, 8)}` }, authorCookie),
  );
  const testId = (await created.json()).id;
  if (timing !== undefined) {
    const patched = await app.request(
      `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
      patch({ settings: { timing } }, authorCookie),
    );
    expect(patched.status, await patched.text()).toBe(200);
  }
  await publishDraftVersion(deps.db, workspaceId, testId, FIXED_NOW);
  return testId;
}

async function wireFor(testId: string): Promise<{ closesAt: number | null }> {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests`, get(authorCookie));
  expect(res.status).toBe(200);
  const row = (await res.json()).tests.find((t: { id: string }) => t.id === testId);
  expect(row, "the test is in the list").toBeDefined();
  return row;
}

it("returns closesAt from the published timing", async () => {
  const closesAt = FIXED_NOW + 3_600_000;
  const testId = await publishedWithTiming({
    duration_minutes: 60,
    closes_at: new Date(closesAt).toISOString(),
  });
  expect((await wireFor(testId)).closesAt).toBe(closesAt);
});

it("returns null for a test that has never been published", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Draft only", slug: "draft-only" }, authorCookie),
  );
  const testId = (await created.json()).id;
  expect((await wireFor(testId)).closesAt).toBeNull();
});

it("returns null when the published timing sets no closing time", async () => {
  const testId = await publishedWithTiming({ duration_minutes: 60 });
  expect((await wireFor(testId)).closesAt).toBeNull();
});

// Not reachable through the route — `schemas/test-1.json` declares
// `closes_at` as `format: date-time` and the draft validator asserts it —
// but a row written by an import, an older build or a hand-edit can carry
// one, and the wire must answer "no closing time" rather than NaN. This is
// the same answer `deriveState` already gives such a row, which is the
// point: one parse, one verdict.
it("returns null when the stored closing time cannot be parsed", async () => {
  const testId = await publishedWithTiming({ duration_minutes: 60 });
  await deps.db.run(
    "UPDATE test_version SET settings_json = ? WHERE workspace_id = ? AND test_id = ? AND published_at IS NOT NULL",
    [
      deps.db.jsonParam({ timing: { duration_minutes: 60, closes_at: "whenever" } }),
      workspaceId,
      testId,
    ],
  );
  expect((await wireFor(testId)).closesAt).toBeNull();
});
