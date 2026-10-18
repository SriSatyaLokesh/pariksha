// The one place this server mints and digests a secret.
//
// Sessions, OIDC `state` and magic links all want the same two things —
// 256 bits of CSPRNG output, and its SHA-256 for the row that stands in for
// it — and three copies of that is three places for a future "just this once
// it can be shorter" to hide. Web Crypto globals rather than `node:crypto`,
// because the same build runs on Workers.

/** 32 random bytes, base64url, so the value survives a header or a URL. */
export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await digest(value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The shape RFC 7636 wants for a PKCE S256 challenge. */
export async function sha256Base64Url(value: string): Promise<string> {
  return base64url(await digest(value));
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
