// Task 2 (K24), Review Focus item 2. The verifier below is written from the
// documented header format using `node:crypto` — a DIFFERENT implementation
// of HMAC-SHA256 than `signatureHeader`'s Web Crypto one — not by calling
// `signatureHeader` a second time. A test that signs and verifies with the
// same function proves only that the function is deterministic; it would
// stay green even if `signatureHeader` signed the wrong bytes, so long as it
// did so consistently. This is the independent half: a receiver implementing
// the published recipe from scratch, with a different crypto library, has to
// land on the same digest.
import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signatureHeader } from "../../src/webhooks/sign";

/** Recomputes the MAC from the documented format (`docs/webhooks.md`), not
 * from any export of `sign.ts`, and compares it timing-safely — the
 * textbook mistake here is a `===` on a MAC. */
function verifyIndependently(header: string, rawBody: string, secret: string): boolean {
  const t = /t=(\d+)/.exec(header)![1];
  const v1 = /v1=([0-9a-f]+)/.exec(header)![1];
  const mac = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expected = Buffer.from(mac, "hex");
  const actual = Buffer.from(v1, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

describe("signatureHeader", () => {
  it("produces a signature an independent verifier accepts", async () => {
    const body = JSON.stringify({ event: "attempt.submitted", attemptId: "att_1" });
    const header = await signatureHeader(body, "whsec_x", 1_700_000_000);
    expect(verifyIndependently(header, body, "whsec_x")).toBe(true);
  });

  it("fails verification when one byte of the body changes", async () => {
    const header = await signatureHeader('{"a":1}', "whsec_x", 1_700_000_000);
    expect(verifyIndependently(header, '{"a":2}', "whsec_x")).toBe(false);
  });

  it("fails verification under a different secret", async () => {
    const header = await signatureHeader('{"a":1}', "whsec_x", 1_700_000_000);
    expect(verifyIndependently(header, '{"a":1}', "whsec_y")).toBe(false);
  });

  it("changes when only the timestamp changes, so t is inside the signed string", async () => {
    const a = await signatureHeader('{"a":1}', "whsec_x", 1_700_000_000);
    const b = await signatureHeader('{"a":1}', "whsec_x", 1_700_000_001);
    expect(a).not.toBe(b);
  });

  it("carries t and v1 in the documented format", async () => {
    const header = await signatureHeader('{"a":1}', "whsec_x", 1_700_000_000);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });
});
