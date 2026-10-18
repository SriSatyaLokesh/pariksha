// The storage seam. Snapshots, media and exports go through this interface
// and nothing else, so the same code runs on R2, on any S3, on MinIO, or on a
// disk in a Docker container (ADR 0002).

/** PRD S-16 / AC-26: a signed media URL lives for ten minutes. */
export const SIGNED_URL_TTL_SECONDS = 600;

export interface StorageAdapter {
  put(
    key: string,
    body: ArrayBuffer | Uint8Array,
    opts: { contentType: string },
  ): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  /** Batched: one call for many keys, never one call per key. */
  delete(keys: string[]): Promise<void>;
  list(
    prefix: string,
    cursor?: string,
  ): Promise<{ keys: string[]; cursor?: string }>;
  signedUrl(
    key: string,
    opts: { expiresInSeconds: number; now: number },
  ): Promise<string>;
}

export class StorageKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid storage key ${JSON.stringify(key)}: ${reason}`);
    this.name = "StorageKeyError";
  }
}

/**
 * A snapshot key is built from an attempt ID, and an attempt ID arrives over
 * the network. Refusing traversal here means no caller has to remember to
 * sanitise one — including the caller written in Phase 7 by someone who has
 * never read this file.
 *
 * Returns the key unchanged when it is acceptable, so it reads as a cast at
 * every call site.
 */
export function assertKey(key: string): string {
  if (key === "") throw new StorageKeyError(key, "a key cannot be empty");
  if (key.startsWith("/"))
    throw new StorageKeyError(key, "a key is relative, so it cannot start with /");
  if (key.includes("//"))
    throw new StorageKeyError(key, "a key cannot contain an empty segment");
  if (key.includes("\\"))
    throw new StorageKeyError(key, "a key separates segments with /, never \\");
  if (key.split("/").some((segment) => segment === ".." || segment === "."))
    throw new StorageKeyError(key, "a key cannot contain . or .. segments");
  // A NUL truncates a path in some filesystem APIs, turning a checked key
  // into a different one by the time it is opened.
  if (key.includes("\0"))
    throw new StorageKeyError(key, "a key cannot contain a NUL byte");
  return key;
}

/** Every adapter stores bytes; callers hand over either shape. */
export function toBytes(body: ArrayBuffer | Uint8Array): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}
