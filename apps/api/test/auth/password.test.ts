import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  getTotpUri,
  hashPassword,
  verifyPassword,
  verifyTotp,
} from "../../src/auth/password.js";

describe("Password and TOTP Authentication (Phase 10)", () => {
  describe("Argon2id password hashing", () => {
    it("hashes and verifies a correct password", async () => {
      const password = "my-secure-password-123";
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(hash, password)).toBe(true);
      expect(await verifyPassword(hash, "wrong-password")).toBe(false);
    });
  });

  describe("Base32 encoding and decoding", () => {
    it("round-trips arbitrary buffers", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const encoded = base32Encode(data);
      const decoded = base32Decode(encoded);
      expect(Array.from(decoded)).toEqual(Array.from(data));
    });

    it("generates random 32-character secret", () => {
      const secret = generateTotpSecret();
      expect(secret).toHaveLength(32);
      expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
    });
  });

  describe("RFC 6238 TOTP", () => {
    // RFC 6238 Appendix B test vector (Secret: '12345678901234567890' in ASCII -> 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' in Base32)
    const testSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    it("generates and verifies TOTP code at current time", () => {
      const now = Date.now();
      const code = generateTotp(testSecret, now);

      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
      expect(verifyTotp(code, testSecret, 1, now)).toBe(true);
    });

    it("accepts codes within the +/- 1 step drift window", () => {
      const now = 1700000000000;
      const codePast = generateTotp(testSecret, now - 30_000);
      const codeFuture = generateTotp(testSecret, now + 30_000);

      expect(verifyTotp(codePast, testSecret, 1, now)).toBe(true);
      expect(verifyTotp(codeFuture, testSecret, 1, now)).toBe(true);

      // Outside window (2 steps away = 60s)
      const codeTooOld = generateTotp(testSecret, now - 65_000);
      expect(verifyTotp(codeTooOld, testSecret, 1, now)).toBe(false);
    });

    it("generates correct otpauth URI", () => {
      const uri = getTotpUri("alice@example.com", "JBSWY3DPEHPK3PXP", "Pariksha");
      expect(uri).toBe(
        "otpauth://totp/Pariksha:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Pariksha&algorithm=SHA1&digits=6&period=30",
      );
    });
  });
});
