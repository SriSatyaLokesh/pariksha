// BYOK field-level encryption (S-15).
// AES-256-GCM authenticated encryption using native WebCrypto (crypto.subtle).
// No external dependencies.

const IV_LENGTH = 12;

/**
 * Derives a 256-bit CryptoKey from a secret string using SHA-256 digest.
 */
async function deriveKey(secret: string) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts an API key string with AES-256-GCM.
 * Output is base64(IV + Ciphertext + AuthTag).
 */
export async function encryptApiKey(plainKey: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plainKey);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.length);

  return Buffer.from(combined).toString("base64");
}

/**
 * Decrypts a base64-encoded AES-256-GCM ciphertext payload.
 */
export async function decryptApiKey(encryptedBase64: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const combined = Buffer.from(encryptedBase64, "base64");

  if (combined.length <= IV_LENGTH) {
    throw new Error("Invalid encrypted payload length");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const data = combined.subarray(IV_LENGTH);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Returns a safe key hint for display (e.g. sk-ant-...4a9b or sk-proj-...8f12).
 * Never exposes the full key.
 */
export function formatKeyHint(key: string): string {
  const trimmed = key.trim();
  const last4 = trimmed.slice(-4);
  if (trimmed.startsWith("sk-ant-")) {
    return `sk-ant-...${last4}`;
  }
  if (trimmed.startsWith("sk-proj-")) {
    return `sk-proj-...${last4}`;
  }
  return `sk-...${last4}`;
}
