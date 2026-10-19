// Invite minting (#66, P6.2) — the organiser half of `invite_only`, and
// this phase's one `workspace`-authority route.
//
// The ruling the plan makes: Phase 5 owns the candidate list an invite is
// drawn from, Phase 6 owns the token. So the mint lives here, beside the
// `auth_token` table the gate already consumes from, guarded by
// `candidates.manage` and declared `workspace` in `ROUTE_AUTH`.
//
// The round trip — mint here, redeem at `/api/v1/run/.../access`, replay —
// is asserted in `test/run/access.test.ts`, deliberately in one test rather
// than split across the two files: a mint test that asserts a row and a
// consume test that asserts a redemption can both pass while the URL shape,
// the `kind` string or the payload disagree.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createUser,
  getCandidateByExternalId,
  listInvitedEntryIds,
  replaceCandidateList,
  type NewCandidate,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../src/app.js";
import { issueSession } from "../src/auth/session.js";
import { sha256Hex } from "../src/auth/tokens.js";
import { countingDeps } from "../src/instrument.js";
import type { MintedInvite } from "../src/routes/invites.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";
import { LISTED_CANDIDATES, LISTED_FORM, iso, seedTest, seedWorkspace, DAY } from "./run/fixtures.js";

const T = FIXED_NOW;

const { deps } = await testDeps({ env: { APP_URL: "https://pariksha.test" } });
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const body = (settings: Record<string, unknown>) => ({
  settings: {
    timing: { duration_minutes: 30, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
    registration_form: LISTED_FORM,
    ...settings,
  },
  sections: [{ id: "only", title: "Only", source: { kind: "pool" as const, count: 5 } }],
});

const workspaceId = await seedWorkspace(deps, "alpha", "Alpha Corp");
const otherWorkspaceId = await seedWorkspace(deps, "beta", "Beta Corp");

const testId = await seedTest(deps, workspaceId, {
  name: "Invited",
  slug: "invited",
  body: body({ access: { mode: "invite_only", candidate_list: "list.csv" } }),
});
await replaceCandidateList(deps.db, workspaceId, testId, LISTED_CANDIDATES, T);

/** A test in the *other* workspace, so "404 not 403" has something real. */
const testInWorkspaceB = await seedTest(deps, otherWorkspaceId, {
  name: "Elsewhere",
  slug: "elsewhere",
  body: body({ access: { mode: "invite_only" } }),
});

/** Two hundred list entries, for the "one batch, flat in the list's size"
 *  measurement. Its own test, so the counts above stay readable. */
const bigTestId = await seedTest(deps, workspaceId, {
  name: "Big",
  slug: "big",
  body: body({ access: { mode: "invite_only", candidate_list: "big.csv" } }),
});
const twoHundredIdentifiers = Array.from({ length: 200 }, (_, i) => `BULK${String(i).padStart(4, "0")}`);
await replaceCandidateList(
  deps.db,
  workspaceId,
  bigTestId,
  twoHundredIdentifiers.map((externalId): NewCandidate => ({ externalId, setLabel: null, formValues: {} })),
  T,
);

async function cookieFor(role: "admin" | "author", email: string): Promise<string> {
  const userId = await createUser(deps.db, { email, authProvider: "magic_link", now: T });
  await addMembership(deps.db, workspaceId, { userId, role, now: T });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

const asAdmin = await cookieFor("admin", "admin@alpha.test");
const asAuthor = await cookieFor("author", "author@alpha.test");

const mintRaw = (
  target: string,
  identifiers: string[],
  cookie: string,
  instance = app,
): Promise<Response> =>
  instance.request(`/api/v1/workspaces/${workspaceId}/tests/${target}/invites`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ identifiers }),
  });

async function mintInvites(target: string, identifiers: string[], cookie: string): Promise<MintedInvite[]> {
  const res = await mintRaw(target, identifiers, cookie);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { invites: MintedInvite[] }).invites;
}

const allAuthTokenRows = (): Promise<Record<string, unknown>[]> =>
  deps.db.query<Record<string, unknown>>("SELECT * FROM auth_token", []);

const tokenIn = (url: string): string => new URL(url).searchParams.get("invite") ?? "";

const auditFor = (target: string): Promise<{ action: string; detail_json: unknown }[]> =>
  deps.db.query<{ action: string; detail_json: unknown }>(
    "SELECT action, detail_json FROM audit_log WHERE workspace_id = ? AND target = ? ORDER BY at",
    [workspaceId, target],
  );

/** How many live, unspent invites this test holds for one list entry. */
async function liveInviteCount(target: string, identifier: string): Promise<number> {
  const entry = await getCandidateByExternalId(deps.db, workspaceId, target, identifier);
  const ids = await listInvitedEntryIds(deps.db, workspaceId, { testId: target, now: deps.now() });
  return ids.filter((id) => id === entry?.id).length;
}

/** Each test starts from an empty `auth_token` table, so "a second live
 *  link" and "one batch" are not measured against another test's leftovers. */
beforeEach(async () => {
  await deps.db.run("DELETE FROM auth_token", []);
  await deps.db.run("DELETE FROM audit_log", []);
});

it("an Admin mints one single-use link per candidate-list entry", async () => {
  const minted = await mintInvites(testId, ["21CS0147", "21CS0148"], asAdmin);
  expect(minted.map((m) => m.identifier)).toEqual(["21CS0147", "21CS0148"]);
  expect(new Set(minted.map((m) => m.url)).size).toBe(2);
  expect(minted[0]?.url).toMatch(/^https:\/\/[^/]+\/alpha\/invited\?invite=/);
  // The entry's own row, and the email out of `form_values_json` — the
  // `candidate` table has no email column (reconciliation row 14), so this
  // is the registration form's first `type: "email"` field, resolved.
  expect(minted[0]).toMatchObject({ listEntryId: expect.stringMatching(/^cnd_/), email: "ananya@vce.ac.in" });
  // The second entry's prefill carries no email, which is `null` and not
  // the identifier and not the string "undefined".
  expect(minted[1]?.email).toBeNull();
});

it("minting the whole list is the default — an empty identifier list means every entry", async () => {
  const minted = await mintInvites(testId, [], asAdmin);
  expect(minted.map((m) => m.identifier)).toEqual(["21CS0147", "21CS0148"]);
});

it("an Author cannot mint, and a cross-workspace test is 404 not 403", async () => {
  expect((await mintRaw(testId, ["21CS0147"], asAuthor)).status).toBe(403);
  expect((await mintRaw(testInWorkspaceB, ["21CS0147"], asAdmin)).status).toBe(404);
  // And nothing was written by either.
  expect(await allAuthTokenRows()).toHaveLength(0);
});

it("minting for an identifier that is not on the test's candidate list is 422, naming it", async () => {
  const res = await mintRaw(testId, ["99XX9999"], asAdmin);
  expect(res.status).toBe(422);
  expect(((await res.json()) as { error: { details: { unknown: string[] } } }).error.details.unknown).toEqual([
    "99XX9999",
  ]);
  // All or nothing: a batch with one unknown identifier writes no rows at
  // all, so an organiser never half-sends a list.
  expect(await allAuthTokenRows()).toHaveLength(0);
});

it("minting twice for the same entry does not issue a second live link", async () => {
  await mintInvites(testId, ["21CS0147"], asAdmin);
  expect((await mintInvites(testId, ["21CS0147"], asAdmin))[0]?.url).toBeUndefined();
  expect(await liveInviteCount(testId, "21CS0147")).toBe(1);
});

it("only the hash is stored — the minted URL's token appears in no row", async () => {
  const [m] = await mintInvites(testId, ["21CS0147"], asAdmin);
  const token = tokenIn(m?.url ?? "");
  expect(token).not.toBe("");
  expect(JSON.stringify(await allAuthTokenRows())).not.toContain(token);
  // And the row that *is* there is that token's digest, so the link is
  // redeemable and the column is not the secret.
  expect((await allAuthTokenRows())[0]).toMatchObject({ token_hash: await sha256Hex(token) });
});

it("minting 200 invites is one batch, flat in the list's size", async () => {
  const counting = countingDeps(deps);
  const res = await mintRaw(bigTestId, twoHundredIdentifiers, asAdmin, createApp(counting.deps));
  expect(res.status, await res.clone().text()).toBe(200);
  expect(((await res.json()) as { invites: MintedInvite[] }).invites).toHaveLength(200);
  expect(counting.counts().total).toBe(
    ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/invites"],
  );
});

it("the route is in ROUTE_ACTIONS and declared workspace in ROUTE_AUTH", () => {
  expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/:testId/invites"]).toBe("candidates.manage");
  expect(ROUTE_AUTH["POST /api/v1/workspaces/:id/tests/:testId/invites"]).toBe("workspace");
});

it("S-18: minting writes one audit row naming the test and the count, not the tokens", async () => {
  const minted = await mintInvites(testId, ["21CS0147", "21CS0148"], asAdmin);
  const rows = await auditFor(testId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: "invites.minted",
    detail_json: expect.stringContaining('"count":2'),
  });
  expect(JSON.stringify(rows[0])).not.toContain(tokenIn(minted[0]?.url ?? ""));
});
