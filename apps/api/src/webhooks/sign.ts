// `K24`: the signature covers the exact bytes sent, not a re-serialisation
// of the payload. `rawBody` must be the literal string the request body
// carries — sign it and send it as the same value, never `JSON.stringify`
// it twice (key order or whitespace can differ between the two calls, and
// then every receiver's signature check fails, including correct ones).
//
// Web Crypto (`crypto.subtle`), not `node:crypto` — this runs on Workers.
// `crypto.subtle.sign` is Promise-only (there is no synchronous HMAC in
// Web Crypto), so this function is necessarily async.

export const SIGNATURE_HEADER = "X-Pariksha-Signature";

/** `t=<unix seconds>,v1=<hex>` where v1 = HMAC-SHA256("<t>.<raw body>"). */
export async function signatureHeader(
  rawBody: string,
  secret: string,
  nowSeconds: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${nowSeconds}.${rawBody}`),
  );
  const hex = [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${nowSeconds},v1=${hex}`;
}
