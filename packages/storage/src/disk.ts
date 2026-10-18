// The local-disk adapter: Docker self-hosting without MinIO, and the smallest
// install the PRD supports. Node only — Workers has no filesystem, and the
// deployment that uses this one is the one that is not on Workers.

/* eslint-disable @typescript-eslint/require-await --
   `signedUrl` is async on purpose: `assertKey` throws synchronously inside
   `signDiskUrl`, and a promise-returning interface must reject rather than
   throw at the call site. */

import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  assertKey,
  toBytes,
  SIGNED_URL_TTL_SECONDS,
  StorageKeyError,
  type StorageAdapter,
} from "./adapter.js";
import { signDiskUrl } from "./sign.js";

export interface DiskOptions {
  /** Directory the files live under. Created on first write. */
  root: string;
  /** Where the API serves them from, for signed URLs. */
  baseUrl: string;
  /** Deployment secret the signatures are made with. */
  secret: string;
}

export function diskAdapter(options: DiskOptions): StorageAdapter {
  const root = resolve(options.root);

  /**
   * `assertKey` already refuses traversal, so this is the second lock on the
   * same door: whatever the key, the resolved path must still be inside the
   * root. A single check that cannot be reasoned around beats trusting the
   * first one to have covered every encoding.
   */
  const pathFor = (key: string): string => {
    const full = resolve(root, assertKey(key));
    if (full !== root && !full.startsWith(root + sep)) {
      throw new StorageKeyError(key, "resolves outside the storage root");
    }
    return full;
  };

  return {
    put: async (key, body) => {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, toBytes(body));
    },

    get: async (key) => {
      const path = pathFor(key);
      try {
        const buffer = await readFile(path);
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        );
      } catch (error) {
        // A missing snapshot is an ordinary outcome, not a failure: the
        // proctoring path must never throw into the answering path.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    delete: async (keys) => {
      // Every key is checked before anything is removed, so one bad key in a
      // batch cannot leave the batch half-deleted.
      const paths = keys.map(pathFor);
      await Promise.all(paths.map((path) => rm(path, { force: true })));
    },

    list: async (prefix) => {
      const entries = await walk(root, root);
      return { keys: entries.filter((key) => key.startsWith(prefix)).sort() };
    },

    signedUrl: async (key, opts) =>
      signDiskUrl(options.baseUrl, key, {
        expiresInSeconds: opts.expiresInSeconds || SIGNED_URL_TTL_SECONDS,
        now: opts.now,
        secret: options.secret,
      }),
  };
}

/** Keys are paths relative to the root, with `/` separators on every OS. */
async function walk(root: string, directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(root, full)));
    } else {
      found.push(full.slice(root.length + 1).split(sep).join("/"));
    }
  }
  return found;
}
