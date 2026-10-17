import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diskAdapter } from "../src/disk.js";
import { verifyDiskSignature, SIGNED_URL_TTL_SECONDS } from "../src/sign.js";

// Review Focus item 4: an expiry a client can edit without invalidating the
// signature is not an expiry. AC-26 / S-16 is the test that catches it.

const SECRET = "deployment-secret";
const T = 1_760_000_000_000; // a fixed clock, so nothing here fakes Date.now()

const adapter = diskAdapter({
  root: mkdtempSync(join(tmpdir(), "pariksha-sign-")),
  baseUrl: "https://example.test/files",
  secret: SECRET,
});

const sign = (key = "snap/1.jpg", expiresInSeconds = SIGNED_URL_TTL_SECONDS) =>
  adapter.signedUrl(key, { expiresInSeconds, now: T });

const withQuery = (url: string, name: string, value: string) => {
  const edited = new URL(url);
  edited.searchParams.set(name, value);
  return edited;
};

describe("signed URLs", () => {
  it("the default TTL is ten minutes", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(600);
  });

  it("AC-26 / S-16: stops working after ten minutes", async () => {
    const url = new URL(await sign());

    expect(verifyDiskSignature(url, SECRET, T)).toBe(true);
    expect(verifyDiskSignature(url, SECRET, T + 599_000)).toBe(true);
    expect(verifyDiskSignature(url, SECRET, T + 601_000)).toBe(false);
  });

  it("editing the expiry invalidates it", async () => {
    // The whole point: the expiry is inside the signed string, so moving it
    // forward breaks the signature instead of extending the grant.
    const url = await sign();
    const tampered = withQuery(url, "expires", String(T + 86_400_000));

    expect(verifyDiskSignature(tampered, SECRET, T + 601_000)).toBe(false);
    expect(verifyDiskSignature(tampered, SECRET, T)).toBe(false);
  });

  it("editing the key invalidates it", async () => {
    // Otherwise one candidate's signed snapshot URL is every candidate's.
    const url = new URL(await sign("snap/mine.jpg"));
    const tampered = new URL(url.toString().replace("snap/mine.jpg", "snap/theirs.jpg"));

    expect(verifyDiskSignature(tampered, SECRET, T)).toBe(false);
  });

  it("a signature made with another secret is refused", async () => {
    const url = new URL(await sign());
    expect(verifyDiskSignature(url, "a-different-secret", T)).toBe(false);
  });

  it("a URL with no signature, or an empty one, is refused", async () => {
    const url = await sign();
    expect(verifyDiskSignature(withQuery(url, "sig", ""), SECRET, T)).toBe(false);

    const stripped = new URL(url);
    stripped.searchParams.delete("sig");
    expect(verifyDiskSignature(stripped, SECRET, T)).toBe(false);
  });

  it("a signature of the wrong length is refused rather than throwing", async () => {
    // A constant-time comparison needs equal lengths; this is the input that
    // finds out whether that was handled or left to throw.
    const url = await sign();
    expect(verifyDiskSignature(withQuery(url, "sig", "abcd"), SECRET, T)).toBe(
      false,
    );
  });

  it("two keys signed at the same instant get different signatures", async () => {
    const a = new URL(await sign("snap/a.jpg"));
    const b = new URL(await sign("snap/b.jpg"));
    expect(a.searchParams.get("sig")).not.toBe(b.searchParams.get("sig"));
  });

  it("carries the expiry as epoch milliseconds, like every other timestamp", async () => {
    const url = new URL(await sign());
    expect(Number(url.searchParams.get("expires"))).toBe(
      T + SIGNED_URL_TTL_SECONDS * 1000,
    );
  });

  it("refuses to sign a traversal key", async () => {
    await expect(sign("../escape")).rejects.toThrow(/key/i);
  });
});
