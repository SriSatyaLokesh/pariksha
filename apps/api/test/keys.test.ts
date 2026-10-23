// Scoped API key endpoints, over the real routes and the real
// `authenticate`/`authorize` middleware (Phase 8d Task 2, `K25`, `K26`,
// `KG2`, `KG5`).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_AUTH, type AppBindings, type AppDeps } from "../src/app.js";
import { issueSession } from "../src/auth/session.js";
import { requires } from "../src/middleware/authorize.js";
import { countingDeps } from "../src/instrument.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

// `results.export` and `tests.edit` are two of this phase's scopes, but
// only `tests.edit` guards a real route today — `results.export`,
// `attempts.grade` and the rest of Phase 8's grading/results actions have
// no route yet (`grep -rn '"results.export"' apps/api/src` finds only
// `packages/core/src/permissions.ts`). Proven the same way
// `authorization.test.ts` proves the whole matrix: a probe route per
// action, `requires()` wired for real, on the real app.
//
// A function, not a module-level constant (MINOR-4, whole-branch review):
// the subrequest-cost test below needs a probe app built over
// `countingDeps`' own wrapped `deps`, which is a fresh object per
// measurement — the single module-level `probe` instance could not be
// reused for that without also counting every other test's traffic.
function buildProbe(probeDeps: AppDeps): Hono<AppBindings> {
  const probeApp = createApp(probeDeps);
  probeApp.get("/api/v1/probe/:id/results.export", requires("results.export"), (c) => c.json({ ok: true }));
  probeApp.get("/api/v1/probe/:id/tests.edit", requires("tests.edit"), (c) => c.json({ ok: true }));
  return probeApp;
}

const probe = buildProbe(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let otherWorkspaceId = "";
let ownerCookie = "";
let adminCookie = "";
let authorCookie = "";

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function withKey(secret: string): RequestInit {
  return { headers: { authorization: `Bearer ${secret}` } };
}

async function member(suffix: string, role: "admin" | "author"): Promise<string> {
  const id = await createUser(deps.db, {
    email: `${role}-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: id, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, id)).token);
}

const url = (): string => `/api/v1/workspaces/${workspaceId}/keys`;

async function createKey(scopes: string[], cookie = ownerCookie, name = "A key"): Promise<{ id: string; secret: string }> {
  const res = await app.request(url(), send("POST", cookie, { name, scopes }));
  expect(res.status, `creating a key with ${JSON.stringify(scopes)} -> ${res.status}`).toBe(201);
  return res.json();
}

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `key-${suffix}`, name: "Alpha" }),
  );
  workspaceId = (await created.json()).id;

  const otherOwnerId = await createUser(deps.db, {
    email: `owner-b-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const otherOwnerCookie = await sessionCookie(deps, (await issueSession(deps, otherOwnerId)).token);
  const otherCreated = await app.request(
    "/api/v1/workspaces",
    send("POST", otherOwnerCookie, { slug: `other-${suffix}`, name: "Beta" }),
  );
  otherWorkspaceId = (await otherCreated.json()).id;

  adminCookie = await member(suffix, "admin");
  // `KG2`/`F1`: the role the 403 fixtures need — one that holds neither
  // `keys.manage` nor the scope under test, so a passing 403 could not be
  // explained by the wrong wiring either.
  authorCookie = await member(suffix, "author");
});

describe("POST — create", () => {
  it("returns the secret exactly once, and the list that follows never carries it", async () => {
    const { id, secret } = await createKey(["results.export"]);
    expect(secret).toMatch(/^pk_/);
    expect(id).toMatch(/^key_/);

    const listed = await app.request(url(), send("GET", ownerCookie));
    expect(JSON.stringify(await listed.json())).not.toContain(secret);
  });

  // `K26`: refused at creation, not merely at use — for the role that
  // holds the action itself. An Owner holds `keys.manage`, so a 403 here
  // could not be explained by "they don't hold it"; it has to be this
  // rule, the one the brief names as "refused at creation, not merely at
  // use" (`K26`).
  it("refuses keys.manage at creation, even for an Owner who holds it", async () => {
    const res = await app.request(url(), send("POST", ownerCookie, { name: "bad", scopes: ["keys.manage"] }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("scope_forbidden");
  });

  it("refuses members.manage at creation, even for an Owner who holds it", async () => {
    const res = await app.request(url(), send("POST", ownerCookie, { name: "bad", scopes: ["members.manage"] }));
    expect(res.status).toBe(422);
  });

  // "A key may never widen what its creator could do": the subset check,
  // paired — the 403 beside the 200 that proves it is a real check and
  // not a check that only ever passes.
  it("refuses a scope the creator's own role does not hold", async () => {
    // Admin does not hold workspace.settings (Owner-only).
    const res = await app.request(url(), send("POST", adminCookie, { name: "too much", scopes: ["workspace.settings"] }));
    expect(res.status).toBe(403);
    // MINOR-3 (whole-branch review): status alone does not say *why* — a
    // 403 from the wrong check (K26, say) would pass this test too without
    // the reason pinned.
    expect((await res.json()).error.message).toMatch(/may not grant a key/);
  });

  it("an Owner can grant the same scope — the 200 beside the 403 above, proving the subset check and not a blanket refusal", async () => {
    const res = await app.request(url(), send("POST", ownerCookie, { name: "ok", scopes: ["workspace.settings"] }));
    expect(res.status).toBe(201);
  });

  it("refuses an action that is not a real Action at all", async () => {
    const res = await app.request(url(), send("POST", ownerCookie, { name: "bogus", scopes: ["invented.action"] }));
    expect(res.status).toBe(400);
  });

  it("an Author cannot create a key — it is keys.manage, which Admin holds and Author doesn't", async () => {
    const res = await app.request(url(), send("POST", authorCookie, { name: "x", scopes: ["results.export"] }));
    expect(res.status).toBe(403);
  });

  it("an Admin can create one — the 200 beside the 403 above", async () => {
    const res = await app.request(url(), send("POST", adminCookie, { name: "x", scopes: ["results.export"] }));
    expect(res.status).toBe(201);
  });
});

describe("GET — list", () => {
  it("an Author cannot list keys", async () => {
    expect((await app.request(url(), send("GET", authorCookie))).status).toBe(403);
  });

  it("an Admin can — the 200 beside the 403 above", async () => {
    expect((await app.request(url(), send("GET", adminCookie))).status).toBe(200);
  });
});

describe("DELETE — revoke", () => {
  // Revoking marks the row, it does not delete it — an organiser auditing
  // "what has ever had access" needs the revoked key to stay listed, with
  // `revokedAt` set, not vanish the way a deleted webhook does.
  it("marks the key revoked; it stays listed rather than disappearing", async () => {
    const { id } = await createKey(["results.export"]);
    expect((await app.request(`${url()}/${id}`, send("DELETE", ownerCookie))).status).toBe(204);

    const listed = await app.request(url(), send("GET", ownerCookie));
    const key = (await listed.json()).keys.find((k: { id: string }) => k.id === id);
    expect(key).toBeDefined();
    expect(key.revokedAt).not.toBeNull();
  });

  it("404s for a key id that does not exist in this workspace", async () => {
    const res = await app.request(`${url()}/key_doesnotexist0001`, send("DELETE", ownerCookie));
    expect(res.status).toBe(404);
  });

  it("an Author cannot revoke a key", async () => {
    const { id } = await createKey(["results.export"]);
    expect((await app.request(`${url()}/${id}`, send("DELETE", authorCookie))).status).toBe(403);
  });

  it("an Admin can — the 200 beside the 403 above", async () => {
    const { id } = await createKey(["results.export"]);
    expect((await app.request(`${url()}/${id}`, send("DELETE", adminCookie))).status).toBe(204);
  });
});

// `K25`: a key satisfies the existing `workspace` authority rather than a
// credential of its own. The pair in the middle (the brief's own tests 3
// and 4) is the whole point: one key, one route it holds, one it doesn't.
describe("authenticating with a key (K25)", () => {
  it("admits a key holding the route's action", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await probe.request(`/api/v1/probe/${workspaceId}/results.export`, withKey(secret));
    expect(res.status).toBe(200);
  });

  it("refuses a key that does not hold it", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await probe.request(`/api/v1/probe/${workspaceId}/tests.edit`, withKey(secret));
    expect(res.status).toBe(403);
    // MINOR-3 (whole-branch review): the reason, not just the status.
    expect((await res.json()).error.message).toMatch(/This key does not hold/);
  });

  // MAJOR-1 (whole-branch review): the pair above does not actually prove
  // the scope check is load-bearing. `authenticate.ts`'s placeholder role
  // for a key actor is `"viewer"`, and `viewer` happens to hold exactly
  // `results.export` and nothing resembling `tests.edit` — so deleting the
  // entire `apiKeyScopes` branch in `requires()` and falling through to
  // `can({role: "viewer", action})` still passes both assertions above, by
  // coincidence of which two actions this pair chose to probe. This one
  // does not have that coincidence: a key scoped to `tests.edit` alone,
  // probed against `results.export` — an action the placeholder role
  // *does* hold but this key was never granted — must still be 403. If the
  // scope check is removed, `viewer` holding `results.export` turns this
  // into a 200, which is exactly the failure this test exists to catch.
  it("refuses a scope the key lacks even when the placeholder role would hold it", async () => {
    const { secret } = await createKey(["tests.edit"]);
    const res = await probe.request(`/api/v1/probe/${workspaceId}/results.export`, withKey(secret));
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toMatch(/This key does not hold/);
  });

  // The creator's own session holds both — the key narrows, it does not
  // widen, and this is the proof: the human who minted a results.export-only
  // key can still reach tests.edit over their own cookie.
  it("the creator's own session still reaches both", async () => {
    await createKey(["results.export"]);
    const exportRes = await probe.request(`/api/v1/probe/${workspaceId}/results.export`, send("GET", ownerCookie));
    const editRes = await probe.request(`/api/v1/probe/${workspaceId}/tests.edit`, send("GET", ownerCookie));
    expect(exportRes.status).toBe(200);
    expect(editRes.status).toBe(200);
  });

  it("refuses a revoked key immediately", async () => {
    const { id, secret } = await createKey(["results.export"]);
    await app.request(`${url()}/${id}`, send("DELETE", ownerCookie));

    const res = await probe.request(`/api/v1/probe/${workspaceId}/results.export`, withKey(secret));
    expect(res.status).toBe(401);
  });

  it("refuses a key against another workspace's URL", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await probe.request(`/api/v1/probe/${otherWorkspaceId}/results.export`, withKey(secret));
    expect(res.status).toBe(404);
  });

  it("refuses an unknown key the same way an absent one is refused — 401, not a fall-through to anonymous success on a public route", async () => {
    const res = await probe.request(`/api/v1/probe/${workspaceId}/results.export`, withKey("pk_doesnotexist"));
    expect(res.status).toBe(401);
  });

  // A Bearer token that is not `pk_`-shaped (the `entry` authority's own
  // single-use token is exactly this shape) is not treated as a key
  // attempt at all — `authenticate.ts`'s `apiKeyFrom` falls through to the
  // cookie path, and with no cookie present either, 401 follows for the
  // ordinary "no actor" reason, not from a failed key resolution.
  it("a non-pk_ Bearer token falls through to the cookie path, not a key resolution attempt", async () => {
    const res = await probe.request(`/api/v1/probe/${workspaceId}/results.export`, {
      headers: { authorization: "Bearer not-a-key-at-all" },
    });
    expect(res.status).toBe(401);
  });

  // MINOR-7 (whole-branch review): the scheme word is case-insensitive per
  // RFC 7235 §2.1. Before this fix, `Authorization: bearer pk_…` fell
  // through to the cookie path and answered 401 with no signal at all
  // about why — this proves the lowercase form is recognised the same way
  // the canonical-case form already is.
  it("recognises a lowercase bearer scheme the same way as Bearer", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await probe.request(`/api/v1/probe/${workspaceId}/results.export`, {
      headers: { authorization: `bearer ${secret}` },
    });
    expect(res.status).toBe(200);
  });
});

// CRITICAL-1 (whole-branch review): a key satisfies the `workspace`
// authority, and nothing else — `requireMember()`'s routes (which name a
// workspace but no particular action) and the five `"actor"` routes
// (which name no workspace at all) both have no scope for a key to be
// checked against, and before this fix nothing checked at all. Each case
// here is one of the concrete routes the review named reachable.
describe("CRITICAL-1 — a key cannot reach an authority that names no action", () => {
  it("refuses a key on POST /workspaces (actor) — the orphan-membership exploit", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await app.request("/api/v1/workspaces", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "junk-0001", name: "junk" }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses a key on GET /workspaces (actor)", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await app.request("/api/v1/workspaces", withKey(secret));
    expect(res.status).toBe(403);
  });

  it("refuses a key on GET /me (actor) — no fabricated identity", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await app.request("/api/v1/me", withKey(secret));
    expect(res.status).toBe(403);
  });

  it("refuses a key on POST /auth/signout-everywhere (actor)", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await app.request("/api/v1/auth/signout-everywhere", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.status).toBe(403);
  });

  it("refuses a key on POST /setup/complete (actor), before the route's own 409 is ever reached", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await app.request("/api/v1/setup/complete", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Takeover" }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses a key on a requireMember() route (GET /workspaces/:id) — membership alone is not a scope", async () => {
    const { secret } = await createKey(["results.export"]);
    const res = await app.request(`/api/v1/workspaces/${workspaceId}`, withKey(secret));
    expect(res.status).toBe(403);
  });

  // The creator's own session is untouched by any of the above — this
  // guard is about keys, not about narrowing what a human organiser can
  // reach.
  it("the creator's own session still reaches every route above", async () => {
    expect((await app.request("/api/v1/workspaces", send("GET", ownerCookie))).status).toBe(200);
    expect((await app.request("/api/v1/me", send("GET", ownerCookie))).status).toBe(200);
    expect((await app.request(`/api/v1/workspaces/${workspaceId}`, send("GET", ownerCookie))).status).toBe(200);
  });
});

// `K25` as an assertion: `ROUTE_AUTH` still carries exactly five
// authorities. The brief's own cheapest guard in the plan —
// `route-authority.test.ts` carries the fuller, structural version of this
// (the `workspace` key set equals `Object.keys(ROUTE_ACTIONS)`, unchanged
// by this task); this is the literal value-set form the brief names.
it("adds no sixth authority", () => {
  expect(new Set(Object.values(ROUTE_AUTH))).toEqual(new Set(["public", "entry", "attempt", "actor", "workspace"]));
});

it("measures the real subrequest cost of every route this task mounts", async () => {
  async function measure(method: string, path: string, expected: number, body?: unknown): Promise<string> {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(path, send(method, ownerCookie, body));
    expect(res.status, `${method} ${path} -> ${res.status}`).toBeLessThan(400);
    expect(counting.counts().total, `${method} ${path}`).toBe(expected);
    const parsed = (await res.json().catch(() => null)) as { id?: string } | null;
    return parsed?.id ?? "";
  }

  const id = await measure("POST", url(), 4, { name: "budget", scopes: ["results.export"] });
  await measure("GET", url(), 3);
  await measure("DELETE", `${url()}/${id}`, 4);
});

// `KG5`: no secret ever appears in a response body, a log line or an audit
// row — except the single creation response. The log/audit half is
// structural (`appendAudit`'s call sites here never pass the secret —
// `routes/keys.ts` is short enough to read), so this covers the response
// bodies `KG5` actually names a route by.
describe("KG5", () => {
  it("list and the revoke response never contain the secret", async () => {
    const { id, secret } = await createKey(["results.export"]);

    const listed = await app.request(url(), send("GET", ownerCookie));
    expect(JSON.stringify(await listed.json())).not.toContain(secret);

    await app.request(`${url()}/${id}`, send("DELETE", ownerCookie));
    const listedAfter = await app.request(url(), send("GET", ownerCookie));
    expect(JSON.stringify(await listedAfter.json())).not.toContain(secret);
  });

  it("the one creation response is the exception — it does carry the secret", async () => {
    const { secret } = await createKey(["results.export"]);
    expect(secret).toMatch(/^pk_/);
  });
});
