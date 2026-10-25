// Stub for Cloudflare Workers bundle where Argon2id is not supported or needed (Docker self-host only).
export async function hash(): Promise<string> {
  throw new Error("Argon2id is not supported on Cloudflare Workers");
}

export async function verify(): Promise<boolean> {
  throw new Error("Argon2id is not supported on Cloudflare Workers");
}
