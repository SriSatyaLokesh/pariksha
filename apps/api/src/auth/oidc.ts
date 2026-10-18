// OIDC authorization code flow with PKCE (S-01, S-02).
//
// Two properties this file exists to hold, both from the plan's Review Focus:
//
//   5. `state`, the PKCE verifier and the nonce never leave the server. They
//      live in one short-lived `auth_token` row keyed by the hash of the
//      state, and the callback consumes that row in a single statement. A
//      callback is therefore only honoured by the browser that started the
//      flow, and only once — without that, a callback captured from a
//      redirect can be replayed into somebody else's session.
//
//   2. `returnTo` is a same-origin path or nothing. The callback is the
//      natural place for `?returnTo=https://evil.example` to slip in, and a
//      freshly authenticated organiser is exactly who an attacker wants to
//      land on their page.
//
// The ID token is verified against the provider's JWKS rather than trusted
// because the token endpoint answered: signature, `iss`, `aud`, `exp` and
// `nonce`, all through `jose`, which runs on Workers and on Node.

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { consumeAuthToken, createUser, findUserByEmail, insertAuthToken } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import type { OidcProvider } from "../env.js";
import { ApiError } from "../errors.js";
import { randomToken, sha256Base64Url, sha256Hex } from "./tokens.js";

/**
 * How long a half-finished sign-in stays redeemable. Long enough for a
 * password manager and a second factor at the provider, short enough that a
 * state left in a browser's history is dead by the time anyone finds it.
 */
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

const STATE_KIND = "oidc_state";

/**
 * Review Focus 2. A return target is a same-origin *path*: a single leading
 * `/`, then a character that is neither `/` (which makes `//evil.example` a
 * protocol-relative URL) nor `\` (which browsers normalise to `/`, smuggling
 * the same thing past a naive check), and no whitespace anywhere (which can
 * hide a scheme).
 *
 * `apps/web/src/lib/api.ts` has the same rule. It is not shared code and must
 * not become shared code: that one decides where a browser is sent and can be
 * edited by whoever holds the browser, this one decides what the server
 * honours. The server validates independently or it does not validate.
 */
const SAFE_RETURN_TO = /^\/(?![/\\])[^\s\\]*$/;

export function safeReturnTo(raw: string | undefined): string {
  return raw !== undefined && SAFE_RETURN_TO.test(raw) ? raw : "/";
}

type Fetch = typeof globalThis.fetch;

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface ProviderMetadata {
  discovery: Discovery;
  jwks: ReturnType<typeof createLocalJWKSet>;
}

interface StatePayload {
  providerId: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
}

/**
 * Discovery and JWKS for the isolate's lifetime: two subrequests on a cold
 * isolate and none on a warm one, against the platform's 50 (ADR 0002). The
 * promise is cached rather than the value, so two sign-ins arriving together
 * on a cold isolate share one pair of fetches instead of racing to four.
 */
const metadata = new Map<string, Promise<ProviderMetadata>>();

export async function authorizationUrl(
  deps: AppDeps,
  providerId: string,
  returnTo: string,
  http: Fetch = globalThis.fetch,
): Promise<{ url: string; stateId: string }> {
  const provider = configured(deps, providerId);
  const { discovery } = await load(provider, http);

  const state = randomToken();
  const codeVerifier = randomToken();
  const nonce = randomToken();
  const now = deps.now();

  const payload: StatePayload = {
    providerId,
    codeVerifier,
    nonce,
    // Validated on the way in as well as on the way out, so a stored row can
    // never hold a target the callback would then have to be trusted to
    // re-check.
    returnTo: safeReturnTo(returnTo),
  };
  await insertAuthToken(deps.db, {
    tokenHash: await sha256Hex(state),
    kind: STATE_KIND,
    payload,
    now,
    expiresAt: now + OIDC_STATE_TTL_MS,
  });

  const url = new URL(discovery.authorization_endpoint);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: provider.redirectUri,
    scope: provider.scopes.join(" "),
    state,
    nonce,
    code_challenge: await sha256Base64Url(codeVerifier),
    code_challenge_method: "S256",
  })) {
    url.searchParams.set(key, value);
  }

  return { url: url.toString(), stateId: state };
}

export async function handleCallback(
  deps: AppDeps,
  providerId: string,
  params: { code: string; state: string },
  http: Fetch = globalThis.fetch,
): Promise<{ userId: string; email: string; returnTo: string }> {
  const provider = configured(deps, providerId);

  const stored = asStatePayload(
    await consumeAuthToken(
      deps.db,
      await sha256Hex(params.state),
      STATE_KIND,
      deps.now(),
    ),
  );
  // Unknown, expired, already consumed and minted for a different provider
  // all answer the same way: a caller learning which of the four happened
  // learns something about a flow that is not theirs.
  if (!stored || stored.providerId !== providerId) {
    throw new ApiError(
      400,
      "invalid_state",
      "This sign-in state is unknown, expired or already used",
    );
  }

  const { discovery, jwks } = await load(provider, http);
  const idToken = await exchange(http, discovery.token_endpoint, provider, {
    code: params.code,
    codeVerifier: stored.codeVerifier,
  });

  const { payload: claims } = await jwtVerify(idToken, jwks, {
    issuer: provider.issuer,
    audience: provider.clientId,
    // The injected clock, not the wall clock: expiry is the application's
    // one notion of time (AC-13) and a test moves it.
    currentDate: new Date(deps.now()),
  });

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new ApiError(400, "invalid_id_token", "The ID token names no subject");
  }
  // The binding to the browser that started the flow. `state` proves the
  // callback came back to the session that opened it; `nonce` proves the ID
  // token was minted for that same request and not replayed from another.
  if (claims.nonce !== stored.nonce) {
    throw new ApiError(400, "invalid_nonce", "The ID token answers a different sign-in");
  }
  if (typeof claims.email !== "string" || !claims.email.includes("@")) {
    throw new ApiError(400, "invalid_id_token", "The ID token carries no email address");
  }
  // Email is the account key here, so an unverified one is an account
  // takeover: anyone who can register `owner@school.test` at a sloppy
  // provider would otherwise sign in as the owner.
  if (claims.email_verified === false) {
    throw new ApiError(
      400,
      "email_not_verified",
      "The provider has not verified this address",
    );
  }

  const email = claims.email.trim().toLowerCase();
  const userId =
    (await findUserByEmail(deps.db, email)) ??
    (await createUser(deps.db, {
      email,
      authProvider: `oidc:${providerId}`,
      now: deps.now(),
    }));

  // ponytail: the account is keyed by the verified email, not by `sub`, so
  // an organiser whose address changes at the provider arrives as a new
  // user. The schema already makes email unique and both sign-in flows have
  // to land on the same row, so a second identity key would be a
  // `provider_identity` table — worth it when someone actually reports a
  // renamed address, not before.
  return { userId, email, returnTo: stored.returnTo };
}

function configured(deps: AppDeps, providerId: string): OidcProvider {
  const provider = deps.env.oidcProviders?.find((p) => p.id === providerId);
  if (!provider) {
    throw new ApiError(
      404,
      "unknown_provider",
      `No identity provider named ${providerId}`,
    );
  }
  return provider;
}

function load(provider: OidcProvider, http: Fetch): Promise<ProviderMetadata> {
  let pending = metadata.get(provider.issuer);
  if (!pending) {
    pending = (async () => {
      const discovery = await getJson<Discovery>(
        http,
        `${provider.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
      );
      const keys = await getJson<JSONWebKeySet>(http, discovery.jwks_uri);
      return { discovery, jwks: createLocalJWKSet(keys) };
    })();
    metadata.set(provider.issuer, pending);
  }
  // A provider that was down once must not be unreachable for the rest of
  // the isolate's life.
  return pending.catch((error: unknown) => {
    metadata.delete(provider.issuer);
    throw error;
  });
}

async function getJson<T>(http: Fetch, url: string): Promise<T> {
  const response = await http(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new ApiError(
      502,
      "provider_unavailable",
      `The identity provider answered ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

async function exchange(
  http: Fetch,
  tokenEndpoint: string,
  provider: OidcProvider,
  input: { code: string; codeVerifier: string },
): Promise<string> {
  const response = await http(tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: provider.redirectUri,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code_verifier: input.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new ApiError(
      502,
      "oidc_exchange_failed",
      `The token endpoint answered ${response.status}`,
    );
  }
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string") {
    throw new ApiError(502, "oidc_exchange_failed", "No ID token was returned");
  }
  return body.id_token;
}

/** The row was written by this module, so this is a shape check, not a parse. */
function asStatePayload(raw: unknown): StatePayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<StatePayload>;
  return typeof value.providerId === "string" &&
    typeof value.codeVerifier === "string" &&
    typeof value.nonce === "string" &&
    typeof value.returnTo === "string"
    ? (value as StatePayload)
    : null;
}
