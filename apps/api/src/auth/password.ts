// Phase 10: Docker self-host password authentication and TOTP 2FA (S-01, S-02).
// Argon2id hashing on Node, and standard RFC 6238 TOTP using Node crypto.

import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Lazy import @node-rs/argon2 so Workers target (which does not support Argon2id)
 * does not eagerly resolve native or WASI binaries at bundle time.
 */
async function getArgon2() {
  return await import("@node-rs/argon2");
}

/** Hash a password using Argon2id with RFC 9106 recommended parameters. */
export async function hashPassword(password: string): Promise<string> {
  const { hash } = await getArgon2();
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

/** Verify a password against an Argon2id hash. */
export async function verifyPassword(hashString: string, password: string): Promise<boolean> {
  try {
    const { verify } = await getArgon2();
    return await verify(hashString, password);
  } catch {
    return false;
  }
}

/** Generate a 160-bit (20-byte) cryptographically secure Base32 secret for TOTP. */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/** Encode bytes to Base32 RFC 4648 without padding. */
export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/** Decode a Base32 string to bytes. */
export function base32Decode(str: string): Uint8Array {
  const cleaned = str.replace(/[\s-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  let index = 0;
  const output = new Uint8Array(((cleaned.length * 5) / 8) | 0);

  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_ALPHABET.indexOf(cleaned[i]!);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }

  return output.slice(0, index);
}

/** Generate a 6-digit TOTP code for a given timestamp (epoch ms). */
export function generateTotp(secret: string, forTime = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(forTime / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[19]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return (binary % 1_000_000).toString().padStart(6, "0");
}

/**
 * Verify a 6-digit TOTP token against a secret.
 * Allows a +/- 1 step (30s) drift window to tolerate slight clock differences.
 */
export function verifyTotp(
  token: string,
  secret: string,
  window = 1,
  forTime = Date.now(),
): boolean {
  if (!/^\d{6}$/.test(token.trim())) return false;
  const currentStep = Math.floor(forTime / 1000 / 30);

  for (let step = -window; step <= window; step++) {
    const stepTime = (currentStep + step) * 30 * 1000;
    if (generateTotp(secret, stepTime) === token.trim()) {
      return true;
    }
  }

  return false;
}

/** Generate an otpauth:// URI for QR code generation in authenticator apps. */
export function getTotpUri(email: string, secret: string, issuer = "Pariksha"): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}
