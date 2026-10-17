// Signing for the disk adapter.
//
// R2 and S3 presign through AWS SigV4 (see r2.ts and s3.ts). A disk has no
// such service in front of it, so the API signs the URL itself and checks the
// signature when the file is requested back.
//
// The rule this file exists to keep: the expiry is part of what is signed. An
// expiry a client can edit without invalidating the signature is not an
// expiry (Review Focus item 4, AC-26).

import { createHmac, timingSafeEqual } from "node:crypto";
import { assertKey } from "./adapter.js";

export { SIGNED_URL_TTL_SECONDS } from "./adapter.js";

/** What gets signed: the key and the instant it stops working, nothing else. */
function payload(key: string, expiresAt: number): string {
  return `${key}\n${expiresAt}`;
}

function hmac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("base64url");
}

export function signDiskUrl(
  baseUrl: string,
  key: string,
  opts: { expiresInSeconds: number; now: number; secret: string },
): string {
  assertKey(key);
  // Epoch milliseconds, like every other timestamp in this system.
  const expiresAt = opts.now + opts.expiresInSeconds * 1000;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${key}`);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("sig", hmac(opts.secret, payload(key, expiresAt)));
  return url.toString();
}

/**
 * True only when the signature matches and the clock has not passed the
 * expiry. `now` is a parameter so expiry is tested without faking a global
 * clock — and so a server with a skewed clock is a deployment problem rather
 * than an untestable one.
 */
export function verifyDiskSignature(
  url: URL,
  secret: string,
  now: number,
  options: { basePath?: string } = {},
): boolean {
  const signature = url.searchParams.get("sig");
  const expires = url.searchParams.get("expires");
  if (!signature || !expires) return false;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || now > expiresAt) return false;

  const key = keyFromUrl(url, options.basePath);
  if (key === null) return false;

  const expected = hmac(secret, payload(key, expiresAt));
  return equalInConstantTime(signature, expected);
}

/**
 * The key is the path after the base, not the whole path — the base is where
 * the deployment mounted the file route.
 */
function keyFromUrl(url: URL, basePath?: string): string | null {
  const path = decodeURIComponent(url.pathname);
  const base = basePath ? `/${basePath.replace(/^\/|\/$/g, "")}/` : null;

  const key = base
    ? path.startsWith(base)
      ? path.slice(base.length)
      : null
    : path.replace(/^\//, "").split("/").slice(1).join("/");

  if (key === null || key === "") return null;
  try {
    return assertKey(key);
  } catch {
    // A traversal key cannot have been signed by `signDiskUrl`, so a URL
    // carrying one is forged whatever its signature says.
    return null;
  }
}

function equalInConstantTime(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, and the length of a base64url
  // SHA-256 is not a secret, so compare it first and return rather than throw.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
