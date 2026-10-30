// The access gate, all four modes, over the mounted application.
//
// Every assertion goes through `app.request()` on a real `createApp(deps)`
// (Global Constraints): the question is what a candidate holding no cookie
// receives, and a unit test of the switch would answer a different one.
//
// The property the whole file is shaped around is `S-10`. A wrong code, an
// identifier that is not on the list and a request from outside the network
// must be refusals a candidate cannot tell apart *wherever telling them
// apart would say something the candidate has not proved they may know* —
// so the off-list refusal is compared to the wrong-code refusal byte for
// byte, and the off-network refusal is compared against itself with a right
// and a wrong code.

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import {
  addMembership,
  closeClient,
  createUser,
  getCandidateByExternalId,
  listTests,
  resolvePublishedTest,
} from "@pariksha/db";
import { normaliseEmail } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { sha256Hex } from "../../src/auth/tokens.js";
import { issueSession } from "../../src/auth/session.js";
import { countingDeps } from "../../src/instrument.js";
import { EMAIL_CODE_TTL_MS, ENTRY_TTL_MS, REFUSALS, readEntryToken } from "../../src/run/entry.js";
import { LIMITS } from "../../src/run/limit.js";
import type { MintedInvite } from "../../src/routes/invites.js";
import type { EmailMessage } from "../../src/email/adapter.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedPublishedTest } from "./fixtures.js";

const T = FIXED_NOW;
const ISSUER = "https://candidate-issuer.test";
const CLIENT_ID = "client-sso";
/** Discovery and JWKS, which `oidc.ts` caches for the isolate's lifetime —
 *  so a measurement taken after any other test in this file has run is the
 *  warm cost, and the declared budget is the cold one. */
const COLD_DISCOVERY = 2;

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };

let nextIdToken = "";
const providerFetch: typeof globalThis.fetch = (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === `${ISSUER}/.well-known/openid-configuration`) {
    return Promise.resolve(
      Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      }),
    );
  }
  if (url === `${ISSUER}/jwks`) return Promise.resolve(Response.json({ keys: [jwk] }));
  if (url === `${ISSUER}/token`) return Promise.resolve(Response.json({ id_token: nextIdToken }));
  return Promise.resolve(new Response("no such endpoint", { status: 404 }));
};

let clock = T;
let sent: EmailMessage[] = [];

const { deps } = await testDeps({
  now: () => clock,
  env: {
    APP_URL: "https://pariksha.test",
    OIDC_PROVIDERS: JSON.stringify([
      {
        id: "college",
        label: "College",
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: "shh",
        redirectUri: "https://pariksha.test/api/v1/auth/college/callback",
      },
    ]),
  },
});
deps.http = providerFetch;
// The access gate is the one candidate route that sends mail, and the
// six-digit code exists nowhere but in that message — so the sender is
// collected rather than printed, the same shape `auth/magicLink.test.ts`
// uses, through the seam `AppDeps` now carries for it.
deps.email = {
  send: (message: EmailMessage) => {
    sent.push(message);
    return Promise.resolve();
  },
};

const app = createApp(deps);

afterAll(() => closeClient(deps.db));
beforeEach(async () => {
  clock = T;
  sent = [];
  // Task 4's fix round (C-1): `/email-code` now charges a bucket per
  // address, and this suite asks for codes at the same two addresses
  // under a frozen clock — so without this reset the file exhausts its
  // own limit and later tests read a 429 as a bug in the route.
  await deps.db.run("DELETE FROM rate_limit", []);
});

const workspaceId = await seedPublishedTest(deps);
const tests = await listTests(deps.db, workspaceId);
const idOf = (slug: string): string => {
  const found = tests.find((test) => test.slug === slug);
  if (!found) throw new Error(`no fixture test with slug ${slug}`);
  return found.id;
};

/** An Admin of the fixture workspace, so the invite round trip can start
 *  at the organiser route rather than at a hand-written token row. */
let adminCookie = "";
beforeAll(async () => {
  const userId = await createUser(deps.db, {
    email: "admin@alpha.test",
    authProvider: "magic_link",
    now: T,
  });
  await addMembership(deps.db, workspaceId, { userId, role: "admin", now: T });
  adminCookie = await sessionCookie(deps, (await issueSession(deps, userId)).token);
});

interface Body {
  code?: string;
  invite?: string;
  email?: string;
  otp?: string;
  identifier?: string;
}

const post = (path: string, body: Body, init: RequestInit = {}): Promise<Response> =>
  app.request(path, {
    method: "POST",
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  });

const authTokenRows = (kind?: string): Promise<Record<string, unknown>[]> =>
  kind === undefined
    ? deps.db.query<Record<string, unknown>>("SELECT * FROM auth_token", [])
    : deps.db.query<Record<string, unknown>>("SELECT * FROM auth_token WHERE kind = ?", [kind]);

const countAuthTokens = async (kind: string): Promise<number> => (await authTokenRows(kind)).length;

const countUsers = async (): Promise<number> =>
  Number((await deps.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM "user"', []))[0]?.n ?? 0);

/**
 * The test version a slug pair resolves to. An entry token's digest is
 * salted with it (Task 2 review, T2-I-1), so reading one back needs the
 * same value the route hashed with.
 */
const versionOf = async (slug: string): Promise<string> => {
  const test = await resolvePublishedTest(deps.db, "alpha", slug, clock);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  return test.testVersionId;
};

// --- link_code ---------------------------------------------------------

it("link_code: the right code yields a single-use entry token", async () => {
  const res = await post("/api/v1/run/alpha/aptitude/access", { code: "OPENSESAME" });
  expect(res.status).toBe(200);
  const { entryToken } = (await res.json()) as { entryToken: string };
  const aptitude = await versionOf("aptitude");
  expect(await readEntryToken(deps, aptitude, entryToken)).toMatchObject({
    testVersionId: expect.stringMatching(/^ver_/),
    workspaceId,
  });

  // T2-I-1: the digest is salted with the test version, so the token a
  // candidate earned at one test matches no row at another — and `asClaim`
  // compares the claim's own `testVersionId` as well, so even a row found
  // some other way is checked against the test that is answering.
  expect(await readEntryToken(deps, await versionOf("pooled"), entryToken)).toBeNull();

  // `readEntryToken` reads without consuming — Task 3 consumes it in the
  // same batch as the registration write — so it is the expiry, not the
  // read, that ends it.
  expect(await readEntryToken(deps, aptitude, entryToken)).not.toBeNull();
  clock = T + ENTRY_TTL_MS + 1;
  expect(await readEntryToken(deps, aptitude, entryToken)).toBeNull();
});

it("link_code: a wrong code is refused with an actionable message and mints nothing", async () => {
  const before = await countAuthTokens("run_entry");
  const res = await post("/api/v1/run/alpha/aptitude/access", { code: "nope" });
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error).toMatchObject({
    code: "code_wrong",
    message: expect.stringMatching(/check|ask|organiser/i),
  });
  expect(await countAuthTokens("run_entry")).toBe(before);
});

it("link_code: the comparison is exact, but a pasted code's surrounding space is not the candidate's fault", async () => {
  expect((await post("/api/v1/run/alpha/aptitude/access", { code: " OPENSESAME " })).status).toBe(200);
  expect((await post("/api/v1/run/alpha/aptitude/access", { code: "opensesame" })).status).toBe(403);
});

it("a request that carries none of the mode's field is a 400, not a refusal", async () => {
  // The distinction a candidate may safely be told: "you sent nothing" says
  // nothing about the secret, and the gate's refusals are reserved for
  // values that were actually wrong.
  const res = await post("/api/v1/run/alpha/aptitude/access", {});
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
});

it("a test that is not open refuses before any code is looked at", async () => {
  for (const slug of ["scheduled", "shut"]) {
    const res = await post(`/api/v1/run/alpha/${slug}/access`, { code: "OPENSESAME" });
    expect(res.status, slug).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code, slug).toBe("window_closed");
  }
  // A draft, an archived test and one that does not exist stay 404 — the
  // same answer the landing route gives, because a candidate holds no
  // credential that could tell the three apart.
  expect((await post("/api/v1/run/alpha/draft-only/access", { code: "x" })).status).toBe(404);
  expect((await post("/api/v1/run/alpha/archived/access", { code: "x" })).status).toBe(404);
  expect((await post("/api/v1/run/alpha/nosuch/access", { code: "x" })).status).toBe(404);
});

// --- invite_only: mint and consume as one round trip --------------------

/**
 * The organiser half and the candidate half of one invite, in one test.
 * A mint test that asserts a row and a consume test that asserts a
 * redemption can both pass while the URL shape, the `kind` string or the
 * payload disagree — so only one test ever touches both.
 */
async function mintInvites(slug: string, identifiers: string[]): Promise<MintedInvite[]> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${idOf(slug)}/invites`,
    {
      method: "POST",
      headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ identifiers }),
    },
  );
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { invites: MintedInvite[] }).invites;
}

async function mintOne(identifier = "21CS0147"): Promise<string> {
  const [minted] = await mintInvites("invited", [identifier]);
  expect(minted?.url, "nothing was minted").toBeTruthy();
  return minted?.url ?? "";
}

const inviteIn = (url: string): string => new URL(url).searchParams.get("invite") ?? "";

const redeem = (url: string): Promise<Response> =>
  post("/api/v1/run/alpha/invited/access", { invite: inviteIn(url) });

it("invite_only: a link minted by the organiser route works once, and the replay is 410", async () => {
  const url = await mintOne();
  expect((await redeem(url)).status).toBe(200);

  const again = await redeem(url);
  expect(again.status).toBe(410);
  expect(((await again.json()) as { error: { message: string } }).error.message).toMatch(
    /already used.*organiser/i,
  );
});

it("invite_only: two concurrent redemptions produce exactly one entry token", async () => {
  const url = await mintOne("21CS0148");
  const before = await countAuthTokens("run_entry");
  const [a, b] = await Promise.all([redeem(url), redeem(url)]);
  expect([a.status, b.status].sort()).toEqual([200, 410]);
  expect(await countAuthTokens("run_entry")).toBe(before + 1);
});

it("invite_only: an invite is bound to its test, and only a `run_invite` is one", async () => {
  const url = await mintOne("21CS0149");
  const token = inviteIn(url);
  // The same live token, the same workspace, a different test.
  expect((await post("/api/v1/run/alpha/listed/access", { invite: token })).status).toBe(403);
  // A token that was never minted is the same answer as a used one.
  expect((await post("/api/v1/run/alpha/invited/access", { invite: "a".repeat(43) })).status).toBe(410);
  // And an entry token is not an invite: `kind` is in the WHERE clause, so
  // the one cannot be redeemed as the other.
  const { entryToken } = (await (
    await post("/api/v1/run/alpha/aptitude/access", { code: "OPENSESAME" })
  ).json()) as { entryToken: string };
  expect((await post("/api/v1/run/alpha/invited/access", { invite: entryToken })).status).toBe(410);
  // The bound invite is still live for its own test, so the three refusals
  // above were about binding and not about the token being spent.
  expect((await redeem(url)).status).toBe(200);
});

it("invite_only: a link minted for one test is not even tried at another, let alone spent there", async () => {
  const url = await mintOne("21CS0151");
  const token = inviteIn(url);
  // `open-invite` is `invite_only` with no candidate list, so the invite
  // branch is really reached here. An unsalted digest would match this
  // row and admit the candidate to a test they were never invited to.
  expect((await post("/api/v1/run/alpha/open-invite/access", { invite: token })).status).toBe(410);
  // And the wrong test did not spend it — the link still works where it
  // belongs, which a read-then-consume would have broken.
  expect((await redeem(url)).status).toBe(200);
});

it("invite_only: the entry token an invite yields carries the list row it was minted for", async () => {
  const url = await mintOne("21CS0150");
  const { entryToken } = (await (await redeem(url)).json()) as { entryToken: string };
  const claim = await readEntryToken(deps, await versionOf("invited"), entryToken);
  expect(claim).toMatchObject({ listRef: expect.stringMatching(/^cnd_/) });
  // The row, and **only** the row. `21CS0150`'s prefill carries
  // `deepa@vce.ac.in`, which the claim used to copy and nothing ever read
  // back — the unread field beside `listRef` that let the `email_code`
  // leg prove one identity and bind another (final review, Critical 1).
  expect(claim).not.toHaveProperty("email");
});

// --- T-21: the candidate list ------------------------------------------

it("T-21: an identifier absent from the candidate list is refused like a wrong code", async () => {
  const onList = await post("/api/v1/run/alpha/listed/access", { code: "OPENSESAME", identifier: "21CS0147" });
  const offList = await post("/api/v1/run/alpha/listed/access", { code: "OPENSESAME", identifier: "99XX9999" });
  expect(onList.status).toBe(200);
  expect(offList.status).toBe(403);
  expect(await offList.text()).toBe(
    await (await post("/api/v1/run/alpha/listed/access", { code: "nope" })).text(),
  );
});

it("T-21: the list is checked before the code, so no identifier and a wrong code are one refusal", async () => {
  const wrongCode = await post("/api/v1/run/alpha/listed/access", { code: "nope", identifier: "21CS0147" });
  const noIdentifier = await post("/api/v1/run/alpha/listed/access", { code: "OPENSESAME" });
  expect(wrongCode.status).toBe(403);
  expect(await wrongCode.text()).toBe(await noIdentifier.text());
});

it("T-21: the list is this test's list, not the workspace's", async () => {
  // `21CS0149` is on `invited`'s list and not on `listed`'s — the exact
  // row a query missing its `test_id` would wrongly find.
  const res = await post("/api/v1/run/alpha/listed/access", { code: "OPENSESAME", identifier: "21CS0149" });
  expect(res.status).toBe(403);
});

it("a test that sets no candidate list ignores an identifier rather than refusing it", async () => {
  expect(
    (await post("/api/v1/run/alpha/aptitude/access", { code: "OPENSESAME", identifier: "99XX9999" })).status,
  ).toBe(200);
});

// --- email_code --------------------------------------------------------

/** The six digits out of the message the collecting sender was handed. */
function sentCode(): string {
  const match = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "");
  expect(match, "the email carries no six-digit code").not.toBeNull();
  return match?.[1] ?? "";
}

it("email_code: six digits, emailed, 10-minute expiry, never stored in the clear", async () => {
  expect((await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" })).status).toBe(202);
  const code = sentCode();
  expect(code).toMatch(/^\d{6}$/);
  expect(JSON.stringify(await authTokenRows())).not.toContain(code);

  clock = T + EMAIL_CODE_TTL_MS + 1;
  expect((await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: code })).status).toBe(401);
});

it("email_code: the right code inside the window yields an entry token, and it carries no address", async () => {
  await post("/api/v1/run/alpha/otp/email-code", { email: "A@B.ac.in" });
  const code = sentCode();
  clock = T + EMAIL_CODE_TTL_MS - 1;
  // Lower-cased on both sides, so a code sent to `A@B.ac.in` is
  // redeemable at `a@b.ac.in`.
  const res = await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: code });
  expect(res.status).toBe(200);
  const { entryToken } = (await res.json()) as { entryToken: string };
  const claim = await readEntryToken(deps, await versionOf("otp"), entryToken);
  // What the mode verified is spent on resolving the list row inside the
  // leg (there is none here), never written down for a reader who never
  // came — so no address sits in `auth_token.payload_json` for 30
  // minutes.
  expect(claim).toMatchObject({ workspaceId: expect.stringMatching(/^wsp_/) });
  expect(claim).not.toHaveProperty("email");
});

it("T2-I-2: a code issued to a padded address is redeemable, not dead on arrival", async () => {
  // The lockout Task 2's review named: the issue leg hashed the address
  // **as typed** and the redeem leg trimmed it, so a candidate who
  // pasted their address with a space was refused forever by a code
  // that was correct and no retry could fix. Both legs now go through
  // `normaliseEmail`. A case-only fixture passes under the old
  // `.toLowerCase()` too and proves nothing — the padding is the test.
  await post("/api/v1/run/alpha/otp/email-code", { email: "  a@b.ac.in " });
  const code = sentCode();
  clock = T + EMAIL_CODE_TTL_MS - 1;
  expect((await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: code })).status).toBe(200);
});

it("T2-I-2: and the padding may be on the redeeming side instead", async () => {
  await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" });
  const code = sentCode();
  clock = T + EMAIL_CODE_TTL_MS - 1;
  expect(
    (await post("/api/v1/run/alpha/otp/access", { email: " A@b.ac.in  ", otp: code })).status,
  ).toBe(200);
});

it("email_code: a code is bound to its address, and spent when it is used", async () => {
  await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" });
  const code = sentCode();
  expect((await post("/api/v1/run/alpha/otp/access", { email: "c@d.ac.in", otp: code })).status).toBe(401);
  expect((await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: "000000" })).status).toBe(401);
  expect((await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: code })).status).toBe(200);
  expect((await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: code })).status).toBe(401);
});

it("email_code: a code minted on one test is not redeemable on another", async () => {
  await post("/api/v1/run/alpha/gauntlet/email-code", { email: "a@b.ac.in" });
  const code = sentCode();
  expect((await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: code })).status).toBe(401);
});

it("email_code: an address outside the domain rule is refused before anything is sent", async () => {
  const res = await post("/api/v1/run/alpha/otp/email-code", { email: "a@gmail.com" });
  expect(res.status).toBe(403);
  expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({
    code: "domain_not_allowed",
    message: expect.stringContaining("*.ac.in"),
  });
  expect(sent).toHaveLength(0);
});

// --- T-21 under email_code: the verified address is the identity -------

/** A `gauntlet` list row's id, by the address it is keyed on. */
const rowOf = async (externalId: string): Promise<string> =>
  (await getCandidateByExternalId(deps.db, workspaceId, idOf("gauntlet"), externalId))?.id ?? "";

/** A code at `email`, redeemed on `gauntlet` with whatever else is sent. */
async function redeemOnGauntlet(email: string, body: Body = {}): Promise<Response> {
  await post("/api/v1/run/alpha/gauntlet/email-code", { email });
  return post("/api/v1/run/alpha/gauntlet/access", { email, otp: sentCode(), ...body });
}

it("Critical 1: a code at your own inbox does not admit you as another listed candidate", async () => {
  // The whole attack in three lines: Mallory is listed, asks for a code
  // at her own address, and types Ananya's identifier at the gate. The
  // binding this replaces — `listEntry(deps, test, input.identifier)`
  // computed before the mode switch — answered 200 with Ananya's row in
  // the claim, from which `/form` reissues Ananya's registration token
  // and `/start` mints an attempt as her.
  const stolen = await redeemOnGauntlet("mallory@vce.ac.in", { identifier: "ananya@vce.ac.in" });
  expect(stolen.status).toBe(403);
  expect(await stolen.json()).toMatchObject({ error: { code: REFUSALS.code_wrong.code } });

  // And the honest redemption binds the row the *address* names.
  const mine = await redeemOnGauntlet("mallory@vce.ac.in");
  expect(mine.status).toBe(200);
  const { entryToken } = (await mine.json()) as { entryToken: string };
  const claim = await readEntryToken(deps, await versionOf("gauntlet"), entryToken);
  expect(claim?.listRef).toBe(await rowOf("mallory@vce.ac.in"));
  expect(claim?.listRef).not.toBe(await rowOf("ananya@vce.ac.in"));
});

it("T-21: an address absent from the list is refused like a wrong code, in the same bytes as a mismatch", async () => {
  // `:334`'s assertion for the mode that verifies an address. Both
  // refusals are `code_wrong` byte for byte: one says "you are not on
  // this list" and the other "that is not you", and a gate that told
  // them apart would enumerate the organiser's list to anyone holding a
  // code at any address the domain rule allows.
  const offList = await redeemOnGauntlet("stranger@vce.ac.in");
  const mismatch = await redeemOnGauntlet("mallory@vce.ac.in", { identifier: "ananya@vce.ac.in" });
  expect(offList.status).toBe(403);
  expect(await offList.text()).toBe(await mismatch.text());
});

it("T-21: the list is checked after the code is spent, so a stranger learns nothing without one", async () => {
  // A wrong code answers `code_expired` (401) and an off-list address
  // answers `code_wrong` (403) — so checking the list *before* the
  // redemption would make the pair a membership oracle for a caller who
  // holds no code at all. It is checked after, and this is what pins
  // the order.
  await post("/api/v1/run/alpha/gauntlet/email-code", { email: "stranger@vce.ac.in" });
  const guess = await post("/api/v1/run/alpha/gauntlet/access", {
    email: "stranger@vce.ac.in",
    otp: "000000",
  });
  expect(guess.status).toBe(401);
  expect(await guess.json()).toMatchObject({ error: { code: REFUSALS.code_expired.code } });
});

it("T-21: a blank identifier is what the gate's own form calls it — optional", async () => {
  // `email_code` reads the address, so the field `Registration.tsx`
  // labels optional really is optional here; `link_code` is the mode
  // that cannot do without it, which is what `candidateList` on the
  // landing payload is for.
  expect((await redeemOnGauntlet("ananya@vce.ac.in", { identifier: "" })).status).toBe(200);
});

// --- sso ---------------------------------------------------------------

async function ssoStart(slug = "sso"): Promise<URL> {
  const started = await app.request(`/api/v1/run/alpha/${slug}/sso/start`);
  expect(started.status, await started.clone().text()).toBe(302);
  return new URL(started.headers.get("location") ?? "");
}

async function signFor(authorize: URL, claims: Record<string, unknown>): Promise<void> {
  nextIdToken = await new SignJWT({ sub: "sub-1", nonce: authorize.searchParams.get("nonce"), ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt(Math.floor(T / 1000) - 10)
    .setExpirationTime(Math.floor(T / 1000) + 300)
    .sign(privateKey as CryptoKey);
}

async function ssoCallback(claims: Record<string, unknown>, slug = "sso"): Promise<Response> {
  const authorize = await ssoStart(slug);
  await signFor(authorize, claims);
  const state = authorize.searchParams.get("state") ?? "";
  return app.request(`/api/v1/run/alpha/${slug}/sso/callback?code=auth-code&state=${state}`);
}

it("sso: the start leg sends the candidate's own callback as the redirect URI, not the organiser's", async () => {
  const authorize = await ssoStart();
  expect(authorize.searchParams.get("redirect_uri")).toBe(
    "https://pariksha.test/api/v1/run/alpha/sso/sso/callback",
  );
  // PKCE and the nonce are the organiser flow's, unchanged — the candidate
  // leg reuses `authorizationUrl` rather than growing a second one.
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("nonce")).toBeTruthy();
  expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
});

it("sso: a verified address inside the domain rule gets an entry token, no user row and no cookie", async () => {
  const usersBefore = await countUsers();
  const res = await ssoCallback({ email: "s@college.ac.in", email_verified: true });

  expect(res.status).toBe(302);
  expect(res.headers.get("set-cookie") ?? "").not.toContain("pk_session");
  expect(await countUsers()).toBe(usersBefore);

  // The entry token rides back on the candidate's own URL, so the browser
  // lands on the test it started from.
  const back = new URL(res.headers.get("location") ?? "", "https://pariksha.test");
  expect(back.pathname).toBe("/alpha/sso");
  expect(
    await readEntryToken(deps, await versionOf("sso"), back.searchParams.get("entry") ?? ""),
  ).toMatchObject({ testVersionId: await versionOf("sso") });
});

it("sso: an address outside allow_email_domains is refused and the rule is named", async () => {
  const res = await ssoCallback({ email: "s@gmail.com", email_verified: true });
  expect(((await res.json()) as { error: unknown }).error).toMatchObject({
    code: "domain_not_allowed",
    message: expect.stringContaining("*.ac.in"),
  });
});

it("sso: no email_verified claim is refused unless the provider is configured for it", async () => {
  expect((await ssoCallback({ email: "s@college.ac.in" })).status).toBe(401);
  expect((await ssoCallback({ email: "s@college.ac.in", email_verified: false })).status).toBe(401);
});

it("sso: the state is single-use, so a captured callback cannot be replayed", async () => {
  const authorize = await ssoStart();
  await signFor(authorize, { email: "s@college.ac.in", email_verified: true });
  const url = `/api/v1/run/alpha/sso/sso/callback?code=auth-code&state=${authorize.searchParams.get("state") ?? ""}`;
  expect((await app.request(url)).status).toBe(302);
  expect((await app.request(url)).status).toBe(400);
});

it("T-21: an sso candidate off the test's list is refused, verified address and all", async () => {
  // The candidate types nothing at this gate, so the verified address is
  // the identity the list is checked against — without this, an sso test
  // with a candidate list admits anyone at the right domain.
  const onList = await ssoCallback({ email: "s@college.ac.in", email_verified: true }, "sso-listed");
  expect(onList.status).toBe(302);

  const offList = await ssoCallback({ email: "nobody@college.ac.in", email_verified: true }, "sso-listed");
  expect(offList.status).toBe(403);
  expect(((await offList.json()) as { error: { code: string } }).error.code).toBe("code_wrong");
});

it("sso: a test that is not an sso test has no sso leg", async () => {
  expect((await app.request("/api/v1/run/alpha/aptitude/sso/start")).status).toBe(400);
  expect((await app.request("/api/v1/run/alpha/aptitude/sso/callback?code=c&state=s")).status).toBe(400);
});

// --- the allowlists, checked before the mode's own gate -----------------

it("T-21: the IP allowlist is checked first, so an off-network candidate learns nothing about their code", async () => {
  const off = { headers: { "CF-Connecting-IP": "203.0.113.9" } };
  const right = await post("/api/v1/run/alpha/lab/access", { code: "OPENSESAME" }, off);
  const wrong = await post("/api/v1/run/alpha/lab/access", { code: "nope" }, off);
  expect(await right.clone().text()).toBe(await wrong.text());
  expect(((await right.json()) as { error: { code: string } }).error.code).toBe("ip_not_allowed");
});

it("an on-network candidate with the right code passes, through either header", async () => {
  for (const headers of [{ "CF-Connecting-IP": "10.1.2.3" }, { "X-Forwarded-For": "10.1.2.3, 70.41.3.18" }]) {
    expect(
      (await post("/api/v1/run/alpha/lab/access", { code: "OPENSESAME" }, { headers })).status,
      JSON.stringify(headers),
    ).toBe(200);
  }
});

it("a request with no client-IP header is refused when the test sets allow_ip_ranges", async () => {
  // Failing open on an allowlist is the whole of the bug: a deployment
  // behind a proxy that strips the header would otherwise admit everyone.
  expect((await post("/api/v1/run/alpha/lab/access", { code: "OPENSESAME" })).status).toBe(403);
});

it("C-02: every refusal message tells the candidate what to do next", () => {
  const refusals = Object.values(REFUSALS);
  expect(refusals.length).toBeGreaterThan(0);
  for (const refusal of refusals) {
    expect(refusal.message, refusal.code).toMatch(/\b(check|ask|contact|try|wait|use|sign)\b/i);
    // And a status, never a bare sentence: C-02 is about the candidate
    // being told what to do, and a 500 tells them nothing.
    expect(refusal.status, refusal.code).toBeLessThan(500);
  }
});

/** The access gate with its refusal bucket already full — the row is
 *  exactly what 300 wrong codes in a minute would have written. */
async function exhaustedGate(): Promise<Response> {
  const version = await versionOf("aptitude");
  await deps.db.run("DELETE FROM rate_limit WHERE bucket = ?", [`test_access:${version}`]);
  await deps.db.run("INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, ?)", [
    `test_access:${version}`,
    clock,
    LIMITS.test_access.limit,
  ]);
  const res = await post("/api/v1/run/alpha/aptitude/access", { code: "nope" });
  await deps.db.run("DELETE FROM rate_limit WHERE bucket = ?", [`test_access:${version}`]);
  return res;
}

/** One trip through `alpha/signup`'s gate, for the one refusal that only
 *  a registration can produce. */
async function signupEntryToken(): Promise<string> {
  const res = await post("/api/v1/run/alpha/signup/access", { code: "OPENSESAME" });
  return ((await res.json()) as { entryToken: string }).entryToken;
}

it("C-02: the codes the gate really answers with are the catalogue's own", async () => {
  // A catalogue is only worth asserting on if the routes use it: each of
  // these is a real refusal one of the four modes produces.
  const seen = new Set<string>();
  for (const res of [
    await post("/api/v1/run/alpha/aptitude/access", { code: "nope" }),
    await post("/api/v1/run/alpha/invited/access", { invite: "a".repeat(43) }),
    await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: "000000" }),
    await post("/api/v1/run/alpha/otp/email-code", { email: "a@gmail.com" }),
    await post("/api/v1/run/alpha/lab/access", { code: "OPENSESAME" }),
    await post("/api/v1/run/alpha/shut/access", { code: "OPENSESAME" }),
    // Task 3's two: a `run_entry` token that is not live, and the
    // refusal `S-07`'s bucket answers in place of whatever the caller
    // was really refused for.
    await app.request("/api/v1/run/alpha/aptitude/form", {
      headers: { authorization: `Bearer ${"a".repeat(43)}` },
    }),
    await exhaustedGate(),
    // Task 4's: a registration with no proof of work (ADR 0009). The
    // entry token is real, so this is the bot check and nothing else.
    await app.request("/api/v1/run/alpha/signup/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await signupEntryToken()}`,
      },
      body: JSON.stringify({ values: {} }),
    }),
  ]) {
    seen.add(((await res.json()) as { error: { code: string } }).error.code);
  }
  expect([...seen].sort()).toEqual(Object.keys(REFUSALS).sort());
});

// --- Task 4 fix round, C-1: the emailed code's own buckets -------------
//
// `/email-code` was the one route in the candidate runtime with no limit
// at all, and the most expensive one to abuse: every call writes an
// `auth_token` row **and** sends a message to an address a stranger
// typed. Within an allowed domain that is a mailbomb pointed at third
// parties and an uncapped bill pointed at the operator, and `S-07`'s
// rate-limit half cannot be called complete without it.
//
// Two buckets, because the two abuses are different shapes and one
// ceiling cannot size both: thousands of addresses sprayed at one test,
// and thousands of codes aimed at one inbox.

const rateBuckets = async (): Promise<string[]> =>
  (await deps.db.query<{ bucket: string }>("SELECT bucket FROM rate_limit", [])).map(
    (row) => row.bucket,
  );

const codeOf = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

/** Puts a bucket at its ceiling without making `limit` real requests. */
async function fillBucket(kind: keyof typeof LIMITS, key: string): Promise<void> {
  await deps.db.run("DELETE FROM rate_limit WHERE bucket = ?", [`${kind}:${key}`]);
  await deps.db.run("INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, ?)", [
    `${kind}:${key}`,
    clock,
    LIMITS[kind].limit,
  ]);
}

const addressKey = (email: string): Promise<string> => sha256Hex(normaliseEmail(email));

it("S-07: the email-code bucket limits per address as well as per test", async () => {
  // One address, up to its own ceiling. A candidate who loses the first
  // message and asks again must not be refused, so the limit sits above
  // any honest retry and far below a bombing run.
  for (let i = 0; i < LIMITS.email_code_address.limit; i++) {
    expect((await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" })).status).toBe(202);
  }
  const refused = await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" });
  expect(refused.status).toBe(429);
  expect(await codeOf(refused)).toBe("too_many_attempts");

  // The other direction is untouched: a second address on the same test
  // still gets its code, so one abused inbox cannot deny the hall.
  expect((await post("/api/v1/run/alpha/otp/email-code", { email: "c@d.ac.in" })).status).toBe(202);
});

it("S-07: the per-test bucket refuses a spray across thousands of addresses, before any send", async () => {
  await fillBucket("email_code", await versionOf("otp"));
  const sentBefore = sent.length;
  const refused = await post("/api/v1/run/alpha/otp/email-code", { email: "fresh@b.ac.in" });
  expect(refused.status).toBe(429);
  // Charged before `issueEmailCode`, so the refusal costs no row and no
  // message. A limiter that fired after the send would have stopped
  // nothing worth stopping.
  expect(sent.length).toBe(sentBefore);
});

it("S-07: no email address reaches the rate_limit table in the clear", async () => {
  await post("/api/v1/run/alpha/otp/email-code", { email: "ananya@vce.ac.in" });
  const buckets = JSON.stringify(await rateBuckets());
  expect(buckets).not.toContain("ananya");
  expect(buckets).not.toContain("vce.ac.in");
  // `S-15`'s shape, the same one `candidate_unique` has: a digest of a
  // value the reader does not hold, never the value.
  expect(buckets).toContain(`email_code_address:${await addressKey("ananya@vce.ac.in")}`);
});

it("S-07: the address bucket is the normalised address, so case and spacing are one identity", async () => {
  await post("/api/v1/run/alpha/otp/email-code", { email: "Ananya@VCE.ac.in" });
  await post("/api/v1/run/alpha/otp/email-code", { email: " ananya@vce.ac.in " });
  const rows = await deps.db.query<{ count: number }>(
    "SELECT count FROM rate_limit WHERE bucket = ?",
    [`email_code_address:${await addressKey("ananya@vce.ac.in")}`],
  );
  // One counter at two, not two counters at one — otherwise retyping the
  // address with a capital letter buys a fresh allowance. `normaliseEmail`
  // is the same function `emailCodeHash` and `normaliseUniqueValue` use.
  expect(rows[0]?.count).toBe(2);
});

it("S-07: neither email bucket is keyed on a client IP — a whole campus shares one", async () => {
  await post(
    "/api/v1/run/alpha/otp/email-code",
    { email: "a@b.ac.in" },
    { headers: { "CF-Connecting-IP": "198.51.100.77" } },
  );
  expect(JSON.stringify(await rateBuckets())).not.toContain("198.51.100.77");
});

it("the window rolls: an address refused this minute can ask again later", async () => {
  await fillBucket("email_code_address", await addressKey("a@b.ac.in"));
  expect((await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" })).status).toBe(429);
  clock = T + LIMITS.email_code_address.windowMs + 1;
  expect((await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" })).status).toBe(202);
  clock = T;
});

it("S-07: stale buckets are swept and live ones are not", async () => {
  // `takeRateToken` wrote one row per bucket and nothing ever deleted
  // one, which was fine while every key was a test version — and stopped
  // being fine when a bucket keyed on a digest of an address a stranger
  // typed landed on two unauthenticated routes. Swept where that row is
  // written.
  await fillBucket("test_register", await versionOf("otp"));
  await deps.db.run("INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, ?)", [
    "email_code_address:stale",
    T - LIMITS.email_code_address.windowMs - 1,
    3,
  ]);

  expect((await post("/api/v1/run/alpha/otp/email-code", { email: "sweep@b.ac.in" })).status).toBe(
    202,
  );

  const buckets = await rateBuckets();
  expect(buckets).not.toContain("email_code_address:stale");
  // **And the live one survives.** A sweep that took the open windows
  // with it would not be housekeeping, it would be the way past every
  // ceiling in `LIMITS` — one `/email-code` call per thousand
  // registrations and `test_register` never fires again.
  expect(buckets).toContain(`test_register:${await versionOf("otp")}`);
});

it("S-07: every anti-abuse ceiling and window is pinned to a literal", () => {
  // Without this, each number is only ever read back out of the constant
  // the route uses — so any ceiling could be raised to anything, or to
  // `Infinity`, with the suite green. The point of the numbers is that
  // changing one is a diff a reviewer sees.
  expect(LIMITS).toEqual({
    test_access: { limit: 300, windowMs: 60_000 },
    test_register: { limit: 1_000, windowMs: 300_000 },
    email_code: { limit: 1_000, windowMs: 300_000 },
    email_code_address: { limit: 5, windowMs: 600_000 },
    result_code: { limit: 20, windowMs: 600_000 },
    short_link: { limit: 300, windowMs: 60_000 },
    // Phase 7c Task 1 (`Q7c`): the proctoring event ingest, per attempt.
    attempt_events: { limit: 120, windowMs: 300_000 },
    // `B3` (whole-branch review): the proctoring snapshot route, per
    // attempt, same window as `attempt_events` — see
    // `LIMITS.attempt_snapshot`'s own comment for the arithmetic.
    attempt_snapshot: { limit: 150, windowMs: 300_000 },
    // BYOK audio evaluation rate limit per attempt.
    attempt_audio_check: { limit: 60, windowMs: 300_000 },
    // Phase 13 (#278): organiser auth rate limiting.
    auth_magic_link_address: { limit: 5, windowMs: 600_000 },
    auth_password_signin_address: { limit: 5, windowMs: 600_000 },
    auth_totp_verify_user: { limit: 5, windowMs: 300_000 },
  });
});

// --- measured budgets ---------------------------------------------------

const measure = async (request: () => RequestInit & { url: string }): Promise<number> => {
  const counting = countingDeps(deps);
  const { url, ...init } = request();
  const res = await createApp(counting.deps).request(url, init);
  expect(res.status, `${url} did not answer`).toBeLessThan(400);
  return counting.counts().total;
};

const asJson = (url: string, body: unknown): RequestInit & { url: string } => ({
  url,
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

it("measures the real subrequest cost of /access at its heaviest", async () => {
  // `gauntlet` is `email_code` *and* candidate-listed, which is the only
  // combination that pays for all four: resolve the test, read the list
  // row, consume the one-time code, insert the entry token.
  await post("/api/v1/run/alpha/gauntlet/email-code", { email: "ananya@vce.ac.in" });
  const otp = sentCode();
  expect(
    await measure(() =>
      // With an identifier typed, so the measurement covers the
      // mismatch comparison too — which is why it is a comparison of
      // normalised keys and not a second list read.
      asJson("/api/v1/run/alpha/gauntlet/access", {
        email: "ananya@vce.ac.in",
        otp,
        identifier: "ananya@vce.ac.in",
      }),
    ),
  ).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/access"]);
});

it("measures the real subrequest cost of /email-code — the message is not a subrequest", async () => {
  expect(
    await measure(() => asJson("/api/v1/run/alpha/otp/email-code", { email: "x@y.ac.in" })),
  ).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/email-code"]);
});

it("measures the real subrequest cost of both sso legs", async () => {
  const warmStart = await measure(() => ({ url: "/api/v1/run/alpha/sso/sso/start" }));
  // Resolve the test, insert the state row. Discovery and JWKS are two
  // more on a cold isolate, which is what the declared budget carries.
  expect(warmStart + COLD_DISCOVERY).toBe(
    ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/sso/start"],
  );

  // On `sso-listed`, so the measurement includes the candidate-list read
  // the declared budget has to cover.
  const authorize = await ssoStart("sso-listed");
  await signFor(authorize, { email: "s@college.ac.in", email_verified: true });
  const state = authorize.searchParams.get("state") ?? "";
  const warmCallback = await measure(() => ({
    url: `/api/v1/run/alpha/sso-listed/sso/callback?code=auth-code&state=${state}`,
  }));
  // Resolve, consume the state, exchange the code (one `http`), insert the
  // entry token — plus the same cold pair.
  expect(warmCallback + COLD_DISCOVERY).toBe(
    ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/sso/callback"],
  );
});
