// The whole OIDC flow against a provider that exists only in this file:
// a generated ES256 keypair, a discovery document, a JWKS and a token
// endpoint, all served by an injected `fetch`. A real provider could not be
// asked for a token with a wrong audience or an expired `exp`, which is
// exactly what Review Focus 5 needs covered — and no test may reach the
// network.

import { afterAll, beforeEach, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { closeClient, createUser } from "@pariksha/db";
import {
  authorizationUrl,
  handleCallback,
  safeReturnTo,
} from "../../src/auth/oidc.js";
import { FIXED_NOW, testDeps } from "../deps.js";

const T = FIXED_NOW;
const ISSUER = "https://issuer.test";
const CLIENT_ID = "client-abc";
const REDIRECT_URI = "https://pariksha.test/api/v1/auth/google/callback";

const { privateKey, publicKey } = await generateKeyPair("ES256", {
  extractable: true,
});
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };

/** What the fake token endpoint will hand back next. Set by each test. */
let nextIdToken: string;
/** Every request the code under test made, so caching can be asserted. */
let requests: string[] = [];

async function signIdToken(
  claims: Record<string, unknown>,
  options: { issuer?: string; audience?: string; expSeconds?: number } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt(Math.floor(T / 1000) - 10)
    .setExpirationTime(Math.floor(T / 1000) + (options.expSeconds ?? 300))
    .sign(privateKey as CryptoKey);
}

const providerFetch: typeof globalThis.fetch = (input) => {
  const url = String(input instanceof Request ? input.url : input);
  requests.push(url);

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
  if (url === `${ISSUER}/jwks`) {
    return Promise.resolve(Response.json({ keys: [jwk] }));
  }
  if (url === `${ISSUER}/token`) {
    return Promise.resolve(Response.json({ id_token: nextIdToken }));
  }
  return Promise.resolve(new Response("no such endpoint", { status: 404 }));
};

const { deps } = await testDeps({
  env: {
    OIDC_PROVIDERS: JSON.stringify([
      {
        id: "google",
        label: "Google",
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: "shh",
        redirectUri: REDIRECT_URI,
        scopes: ["openid", "email", "profile"],
      },
    ]),
  },
});

afterAll(() => closeClient(deps.db));
beforeEach(() => {
  requests = [];
});

/** Starts a flow and signs an ID token carrying the nonce it minted. */
async function start(
  returnTo = "/w/acme/tests",
  claims: Record<string, unknown> = { sub: "sub-1", email: "a@example.test" },
  options: { issuer?: string; audience?: string; expSeconds?: number } = {},
): Promise<{ code: string; state: string }> {
  const { url, stateId } = await authorizationUrl(
    deps,
    "google",
    returnTo,
    providerFetch,
  );
  const nonce = new URL(url).searchParams.get("nonce");
  nextIdToken = await signIdToken({ ...claims, nonce }, options);
  return { code: "auth-code", state: stateId };
}

it("the authorization URL carries state, a S256 code challenge and the configured scopes", async () => {
  const { url, stateId } = await authorizationUrl(
    deps,
    "google",
    "/w/acme/tests",
    providerFetch,
  );

  const parsed = new URL(url);
  expect(`${parsed.origin}${parsed.pathname}`).toBe(`${ISSUER}/authorize`);
  expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    state: stateId,
    code_challenge_method: "S256",
  });
  // The challenge is base64url and not the verifier itself — a plain
  // challenge would make PKCE decorative.
  expect(parsed.searchParams.get("code_challenge")).toMatch(
    /^[A-Za-z0-9_-]{43}$/,
  );
  expect(parsed.searchParams.get("nonce")).toMatch(/\S/);
});

it("the PKCE verifier never leaves the server", async () => {
  const { url, stateId } = await authorizationUrl(
    deps,
    "google",
    "/",
    providerFetch,
  );
  const challenge = new URL(url).searchParams.get("code_challenge");

  const rows = await deps.db.query<Record<string, unknown>>(
    "SELECT * FROM auth_token WHERE kind = 'oidc_state'",
  );
  const stored = JSON.stringify(rows);
  expect(stored).toContain("codeVerifier");
  expect(stored).not.toContain(challenge);
  // Not even the state itself: the row is keyed by its hash (S-03's rule,
  // applied to every short-lived secret this server mints).
  expect(stored).not.toContain(stateId);
});

it("a callback whose state was already used is refused", async () => {
  const params = await start();

  await expect(
    handleCallback(deps, "google", params, providerFetch),
  ).resolves.toMatchObject({ email: "a@example.test" });
  await expect(
    handleCallback(deps, "google", params, providerFetch),
  ).rejects.toThrow(/state/i);
});

it("a callback with a state this browser never started is refused", async () => {
  await start();
  await expect(
    handleCallback(
      deps,
      "google",
      { code: "auth-code", state: "never-issued" },
      providerFetch,
    ),
  ).rejects.toThrow(/state/i);
});

it("a state minted for one provider cannot be redeemed at another", async () => {
  const params = await start();
  await expect(
    handleCallback(deps, "unknown-provider", params, providerFetch),
  ).rejects.toThrow();
});

it("an ID token with a wrong nonce, audience or issuer is refused", async () => {
  const cases: {
    name: string;
    claims?: Record<string, unknown>;
    options?: { issuer?: string; audience?: string; expSeconds?: number };
  }[] = [
    { name: "wrong nonce", claims: { sub: "s", email: "e@x.test" } },
    { name: "wrong audience", options: { audience: "someone-else" } },
    { name: "wrong issuer", options: { issuer: "https://evil.test" } },
    { name: "expired", options: { expSeconds: -600 } },
  ];

  for (const bad of cases) {
    const { url, stateId } = await authorizationUrl(
      deps,
      "google",
      "/",
      providerFetch,
    );
    const nonce = new URL(url).searchParams.get("nonce");
    nextIdToken = await signIdToken(
      // The nonce case deliberately signs one the server never minted.
      bad.claims
        ? { ...bad.claims, nonce: "a-nonce-nobody-asked-for" }
        : { sub: "s", email: "e@x.test", nonce },
      bad.options ?? {},
    );

    await expect(
      handleCallback(
        deps,
        "google",
        { code: "auth-code", state: stateId },
        providerFetch,
      ),
      bad.name,
    ).rejects.toThrow();
  }
});

it("an ID token signed by the wrong key is refused", async () => {
  const other = await generateKeyPair("ES256", { extractable: true });
  const { url, stateId } = await authorizationUrl(
    deps,
    "google",
    "/",
    providerFetch,
  );
  nextIdToken = await new SignJWT({
    sub: "s",
    email: "forged@example.test",
    nonce: new URL(url).searchParams.get("nonce"),
  })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setExpirationTime(Math.floor(T / 1000) + 300)
    .sign(other.privateKey as CryptoKey);

  await expect(
    handleCallback(
      deps,
      "google",
      { code: "auth-code", state: stateId },
      providerFetch,
    ),
  ).rejects.toThrow();
});

it("safeReturnTo accepts only same-origin paths", () => {
  expect(safeReturnTo("/w/acme/tests")).toBe("/w/acme/tests");
  expect(safeReturnTo("/")).toBe("/");
  for (const bad of [
    "https://evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "/\\evil.example",
    "\\/evil.example",
    "/ /evil",
    "",
    undefined,
  ]) {
    expect(safeReturnTo(bad), String(bad)).toBe("/");
  }
});

it("the callback honours only a safe returnTo", async () => {
  const params = await start("https://evil.example");
  await expect(
    handleCallback(deps, "google", params, providerFetch),
  ).resolves.toMatchObject({ returnTo: "/" });
});

it("a second sign-in with the same provider subject reuses the user rather than creating one", async () => {
  const email = "repeat@example.test";
  const claims = { sub: "stable-subject", email };

  const first = await handleCallback(
    deps,
    "google",
    await start("/", claims),
    providerFetch,
  );
  const second = await handleCallback(
    deps,
    "google",
    await start("/", claims),
    providerFetch,
  );

  expect(second.userId).toBe(first.userId);
  expect(
    await deps.db.query('SELECT id FROM "user" WHERE email = ?', [email]),
  ).toHaveLength(1);
});

it("an OIDC sign-in adopts an account that already exists for the address", async () => {
  const email = "already@example.test";
  const existing = await createUser(deps.db, {
    email,
    authProvider: "magic_link",
    now: T,
  });

  const result = await handleCallback(
    deps,
    "google",
    await start("/", { sub: "fresh-subject", email }),
    providerFetch,
  );

  expect(result.userId).toBe(existing);
});

it("an ID token whose email the provider says is unverified is refused", async () => {
  const params = await start("/", {
    sub: "unverified",
    email: "nope@example.test",
    email_verified: false,
  });
  await expect(
    handleCallback(deps, "google", params, providerFetch),
  ).rejects.toThrow(/verif/i);
});

it("discovery and JWKS are fetched once per isolate, not once per sign-in", async () => {
  // Two subrequests on a cold isolate and zero on a warm one, against the
  // platform's 50 (ADR 0002). Every test above has already warmed the cache,
  // so the only provider request a sign-in makes here is the token exchange.
  const params = await start("/", {
    sub: "cached",
    email: "cached@example.test",
  });
  requests = [];
  await handleCallback(deps, "google", params, providerFetch);

  expect(requests).toEqual([`${ISSUER}/token`]);
});
