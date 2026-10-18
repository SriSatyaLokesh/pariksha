// S3, and anything that speaks it: MinIO, Backblaze, Wasabi — and R2, which
// is this file with a different endpoint (see r2.ts).
//
// aws4fetch is used rather than the AWS SDK because it is 2.5 kB gzipped and
// runs on Workers; the SDK does neither.

import { AwsClient, AwsV4Signer } from "aws4fetch";
import {
  assertKey,
  toBytes,
  SIGNED_URL_TTL_SECONDS,
  type StorageAdapter,
} from "./adapter.js";

export interface S3Options {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `https://<account>.r2.cloudflarestorage.com` for R2, the S3 host otherwise. */
  endpoint: string;
  /** R2 ignores the region but SigV4 still signs one. */
  region?: string;
}

export function s3Adapter(options: S3Options): StorageAdapter {
  const region = options.region ?? "auto";
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
    region,
  });

  const base = `${options.endpoint.replace(/\/$/, "")}/${options.bucket}`;
  const urlFor = (key: string) => `${base}/${encodeURI(assertKey(key))}`;

  return {
    put: async (key, body, opts) => {
      const response = await client.fetch(urlFor(key), {
        method: "PUT",
        body: toBytes(body),
        headers: { "content-type": opts.contentType },
      });
      if (!response.ok) throw await storageError("put", key, response);
    },

    get: async (key) => {
      const response = await client.fetch(urlFor(key));
      // A missing snapshot is an ordinary outcome: the proctoring path must
      // never throw into the answering path.
      if (response.status === 404) return null;
      if (!response.ok) throw await storageError("get", key, response);
      return response.arrayBuffer();
    },

    delete: async (keys) => {
      // S3's DeleteObjects: one request for the whole batch, which is what
      // keeps a retention sweep inside the 50-subrequest ceiling.
      for (const key of keys) assertKey(key);
      if (keys.length === 0) return;

      const body =
        `<Delete>${keys
          .map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`)
          .join("")}<Quiet>true</Quiet></Delete>`;

      const response = await client.fetch(`${base}?delete`, {
        method: "POST",
        body,
        headers: { "content-type": "application/xml" },
      });
      if (!response.ok) throw await storageError("delete", keys.join(", "), response);
    },

    list: async (prefix, cursor) => {
      const url = new URL(base);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      if (cursor) url.searchParams.set("continuation-token", cursor);

      const response = await client.fetch(url.toString());
      if (!response.ok) throw await storageError("list", prefix, response);

      const xml = await response.text();
      const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) =>
        unescapeXml(m[1] ?? ""),
      );
      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
      return next?.[1] ? { keys, cursor: next[1] } : { keys };
    },

    signedUrl: async (key, opts) => {
      const url = new URL(urlFor(key));
      const expiresIn = opts.expiresInSeconds || SIGNED_URL_TTL_SECONDS;
      // X-Amz-Expires is part of the signed query, so moving it forward
      // breaks the signature rather than extending the grant (AC-26).
      url.searchParams.set("X-Amz-Expires", String(expiresIn));

      const signer = new AwsV4Signer({
        url: url.toString(),
        method: "GET",
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        service: "s3",
        region,
        signQuery: true,
        // Derived from the caller's clock, never Date.now(), so expiry is
        // testable without faking a global clock.
        datetime: toAmzDatetime(opts.now),
      });

      const signed = await signer.sign();
      return signed.url.toString();
    },
  };
}

/** SigV4's `YYYYMMDDTHHMMSSZ`. */
export function toAmzDatetime(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function storageError(
  operation: string,
  key: string,
  response: Response,
): Promise<Error> {
  // The body carries S3's own error code, which is the difference between
  // "the bucket does not exist" and "the credentials are wrong".
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  return new Error(
    `storage ${operation} failed for ${key}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`,
  );
}

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[
        c
      ] ?? c,
  );

const unescapeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
