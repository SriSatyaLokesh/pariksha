import { describe, expect, it } from "vitest";
import { s3Adapter, toAmzDatetime } from "../src/s3.js";
import { r2Adapter } from "../src/r2.js";
import { SIGNED_URL_TTL_SECONDS } from "../src/adapter.js";

// No network and no MinIO here: these assert the shape of what gets signed,
// which is where AC-26 can regress. A round-trip against a real S3 is the
// shared suite in adapter.test.ts, run when a container is available.

const T = 1_760_000_000_000;

const adapter = s3Adapter({
  bucket: "pariksha-media",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret-example",
  endpoint: "https://s3.eu-west-1.amazonaws.com",
  region: "eu-west-1",
});

const sign = (key = "snap/1.jpg", expiresInSeconds = SIGNED_URL_TTL_SECONDS) =>
  adapter.signedUrl(key, { expiresInSeconds, now: T });

describe("S3 presigned URLs", () => {
  it("signs with SigV4 and names the ten-minute expiry", async () => {
    const url = new URL(await sign());

    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.pathname).toBe("/pariksha-media/snap/1.jpg");
  });

  it("signs the expiry, so editing it cannot extend the grant", async () => {
    // Two URLs identical but for the expiry. If the signature were computed
    // over everything else, these would match — and an expiry a client can
    // edit without invalidating the signature is not an expiry.
    const short = new URL(await sign("snap/1.jpg", 600));
    const long = new URL(await sign("snap/1.jpg", 86_400));

    expect(short.searchParams.get("X-Amz-Signature")).not.toBe(
      long.searchParams.get("X-Amz-Signature"),
    );
    expect(short.searchParams.get("X-Amz-SignedHeaders")).toBe(
      long.searchParams.get("X-Amz-SignedHeaders"),
    );
  });

  it("signs the key, so one candidate's URL is not another's", async () => {
    const mine = new URL(await sign("snap/mine.jpg"));
    const theirs = new URL(await sign("snap/theirs.jpg"));

    expect(mine.searchParams.get("X-Amz-Signature")).not.toBe(
      theirs.searchParams.get("X-Amz-Signature"),
    );
  });

  it("signs against the caller's clock, not the process clock", async () => {
    // `now` is a parameter precisely so this is assertable: the same key
    // signed at two instants differs, without faking Date.now().
    const earlier = new URL(await sign());
    const later = new URL(
      await adapter.signedUrl("snap/1.jpg", {
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
        now: T + 3_600_000,
      }),
    );

    expect(earlier.searchParams.get("X-Amz-Date")).not.toBe(
      later.searchParams.get("X-Amz-Date"),
    );
    expect(earlier.searchParams.get("X-Amz-Signature")).not.toBe(
      later.searchParams.get("X-Amz-Signature"),
    );
  });

  it("puts the credential scope in the region it was configured with", async () => {
    const url = new URL(await sign());
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/eu-west-1/s3/");
  });

  it("refuses a traversal key before it signs anything", async () => {
    await expect(sign("../escape")).rejects.toThrow(/key/i);
  });

  it("formats the datetime the way SigV4 requires", () => {
    expect(toAmzDatetime(Date.UTC(2026, 9, 17, 7, 30, 15))).toBe("20261017T073015Z");
  });
});

describe("R2 over its S3 API", () => {
  it("points at the account's r2.cloudflarestorage.com endpoint", async () => {
    const r2 = r2Adapter({
      accountId: "abc123",
      bucket: "snapshots",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-example",
    });

    const url = new URL(
      await r2.signedUrl("snap/1.jpg", {
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
        now: T,
      }),
    );

    expect(url.host).toBe("abc123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/snapshots/snap/1.jpg");
    // R2 ignores the region, but SigV4 still signs one.
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/");
  });
});
