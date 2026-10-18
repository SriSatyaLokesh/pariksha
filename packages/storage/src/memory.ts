// An in-memory adapter: the dev server, and every test that needs storage
// without a container. It is a real implementation of the contract, not a
// mock — the suite in test/adapter.test.ts runs against it and against the
// disk adapter unchanged.

/* eslint-disable @typescript-eslint/require-await --
   Async on purpose: `assertKey` throws synchronously, and a promise-returning
   interface must reject rather than throw at the call site. */

import {
  assertKey,
  toBytes,
  SIGNED_URL_TTL_SECONDS,
  type StorageAdapter,
} from "./adapter.js";
import { signDiskUrl } from "./sign.js";

export function memoryAdapter(
  options: { baseUrl?: string; secret?: string } = {},
): StorageAdapter {
  const objects = new Map<string, Uint8Array>();
  const baseUrl = options.baseUrl ?? "https://memory.invalid/files";
  const secret = options.secret ?? "memory-adapter";

  return {
    put: async (key, body) => {
      objects.set(assertKey(key), toBytes(body));
    },

    get: async (key) => {
      const stored = objects.get(assertKey(key));
      if (!stored) return null;
      // A copy: a caller that mutates what it read must not change what is
      // stored, which is how the disk and R2 adapters behave.
      return stored.slice().buffer;
    },

    delete: async (keys) => {
      // Checked before anything is removed, so a bad key in a batch does not
      // leave half the batch deleted.
      for (const key of keys) assertKey(key);
      for (const key of keys) objects.delete(key);
    },

    list: async (prefix) => ({
      keys: [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(),
    }),

    signedUrl: async (key, opts) =>
      signDiskUrl(baseUrl, key, {
        expiresInSeconds: opts.expiresInSeconds || SIGNED_URL_TTL_SECONDS,
        now: opts.now,
        secret,
      }),
  };
}
