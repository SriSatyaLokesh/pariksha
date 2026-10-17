// R2 — the reference deployment's object store, free up to 10 GB.
//
// Two ways in, and they are not interchangeable:
//
// - From a Worker, the R2 *binding* is the cheap path: no signing, no DNS, no
//   subrequest to an external host. That is what `r2BindingAdapter` wraps.
// - From anywhere else (a Node container, a script, the setup tool), R2
//   speaks S3, so it is `s3Adapter` with R2's endpoint.
//
// Signed URLs come from the S3 path either way: a binding cannot presign, and
// a candidate's browser fetches a snapshot over HTTPS, not through a binding.

/* eslint-disable @typescript-eslint/require-await --
   These methods are `async` on purpose. `assertKey` throws synchronously, and
   an interface whose methods return promises must reject rather than throw at
   the call site — otherwise a caller using `.catch()` silently misses a bad
   key. The rule cannot see that reason. */

import type { R2Bucket } from "@cloudflare/workers-types";
import {
  assertKey,
  toBytes,
  SIGNED_URL_TTL_SECONDS,
  type StorageAdapter,
} from "./adapter.js";
import { s3Adapter, type S3Options } from "./s3.js";

export type R2Options = Omit<S3Options, "endpoint"> & { accountId: string };

/** R2 over its S3 API: `https://<account>.r2.cloudflarestorage.com`. */
export function r2Adapter(options: R2Options): StorageAdapter {
  return s3Adapter({
    bucket: options.bucket,
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
    region: options.region ?? "auto",
  });
}

/**
 * R2 through a Worker binding. `signer` is the S3-configured adapter, used
 * only for `signedUrl` — a binding has no way to presign, and nothing else
 * here needs one.
 */
export function r2BindingAdapter(
  bucket: R2Bucket,
  signer?: StorageAdapter,
): StorageAdapter {
  return {
    put: async (key, body, opts) => {
      await bucket.put(assertKey(key), toBytes(body), {
        httpMetadata: { contentType: opts.contentType },
      });
    },

    get: async (key) => {
      const object = await bucket.get(assertKey(key));
      return object ? object.arrayBuffer() : null;
    },

    delete: async (keys) => {
      for (const key of keys) assertKey(key);
      // R2's delete takes the whole array: one subrequest, not one per key.
      await bucket.delete(keys);
    },

    list: async (prefix, cursor) => {
      const listed = await bucket.list(cursor ? { prefix, cursor } : { prefix });
      const keys = listed.objects.map((object) => object.key);
      return listed.truncated ? { keys, cursor: listed.cursor } : { keys };
    },

    signedUrl: (key, opts) => {
      if (!signer) {
        throw new Error(
          "r2BindingAdapter needs an S3-configured signer to produce signed URLs: " +
            "an R2 binding cannot presign. Pass r2Adapter({ accountId, bucket, … }).",
        );
      }
      return signer.signedUrl(key, {
        expiresInSeconds: opts.expiresInSeconds || SIGNED_URL_TTL_SECONDS,
        now: opts.now,
      });
    },
  };
}
