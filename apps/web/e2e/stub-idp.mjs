// An OpenID Connect provider that exists only for the end-to-end run.
//
// `apps/api/test/auth/oidc.test.ts` already does this in-process: a generated
// ES256 keypair, a discovery document, a JWKS and a token endpoint, served by
// an injected `fetch`. Over a browser the server has to reach the provider
// itself, so the same three endpoints are served over HTTP here — plus an
// `/authorize` that redirects straight back to the callback with a code,
// since there is nobody to show a consent screen to.
//
// No OIDC library and no container: WebCrypto signs the ID token in a dozen
// lines, and `jose` is a dependency of apps/api, not of apps/web. Nothing
// here is reachable from a build — it is started by playwright.config.ts and
// it listens on the loopback interface only.

// Imported rather than taken off the global object, the way
// scripts/prerender.mjs already does: the repository's ESLint config
// declares only `process` and `console` for .mjs files.
import { createServer } from "node:http";
import { webcrypto } from "node:crypto";
import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import { URL, URLSearchParams } from "node:url";

const PORT = Number(process.env.IDP_PORT ?? 9797);
const ISSUER = `http://127.0.0.1:${PORT}`;
/** The one account this provider knows. It becomes the instance owner. */
const EMAIL = "owner@college.test";

const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const exported = await webcrypto.subtle.exportKey("jwk", publicKey);
const jwk = {
  kty: exported.kty,
  crv: exported.crv,
  x: exported.x,
  y: exported.y,
  kid: "e2e",
  alg: "ES256",
  use: "sig",
};

/** `code` → the `nonce` the authorization request carried. Single use. */
const pending = new Map();

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const segment = (value) => b64(JSON.stringify(value));

async function idToken(claims) {
  const signingInput = `${segment({ alg: "ES256", kid: "e2e", typ: "JWT" })}.${segment(claims)}`;
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64(new Uint8Array(signature))}`;
}

function json(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);

  if (url.pathname === "/.well-known/openid-configuration") {
    return json(res, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    });
  }

  if (url.pathname === "/jwks") return json(res, { keys: [jwk] });

  if (url.pathname === "/authorize") {
    const code = `code-${pending.size + 1}-${Date.now()}`;
    pending.set(code, url.searchParams.get("nonce"));
    const back = new URL(url.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }

  if (url.pathname === "/token") {
    void (async () => {
      const form = await body(req);
      const nonce = pending.get(form.get("code"));
      pending.delete(form.get("code"));
      const seconds = Math.floor(Date.now() / 1000);
      json(res, {
        token_type: "Bearer",
        access_token: "stub",
        id_token: await idToken({
          iss: ISSUER,
          // Whatever client asked is who the token is for: the stub holds no
          // registration, so there is no client id to keep in step with
          // playwright.config.ts.
          aud: form.get("client_id"),
          sub: "stub-subject",
          email: EMAIL,
          // The API fails closed on an absent claim (apps/api/src/auth/oidc.ts),
          // so a provider that says nothing cannot sign anyone in at all.
          email_verified: true,
          nonce,
          iat: seconds - 5,
          exp: seconds + 300,
        }),
      });
    })();
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("no such endpoint");
});

server.listen(PORT, "127.0.0.1", () => {
  console.info(`[stub-idp] ${ISSUER}`);
});
