import { describe, expect, it } from "vitest";
import {
  encryptApiKey,
  decryptApiKey,
  formatKeyHint,
} from "../../src/byok/crypto.js";

describe("BYOK AES-256-GCM Encryption (S-15)", () => {
  const masterKey = "pariksha-deployment-secret-field-encryption-key-32";
  const sampleAnthropicKey = "sk-ant-api03-abcdef1234567890-XYZ9988";
  const sampleOpenAiKey = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz-4321";

  it("encrypts and decrypts Anthropic key successfully", async () => {
    const encrypted = await encryptApiKey(sampleAnthropicKey, masterKey);
    expect(encrypted).not.toBe(sampleAnthropicKey);
    expect(typeof encrypted).toBe("string");

    const decrypted = await decryptApiKey(encrypted, masterKey);
    expect(decrypted).toBe(sampleAnthropicKey);
  });

  it("encrypts and decrypts OpenAI key successfully", async () => {
    const encrypted = await encryptApiKey(sampleOpenAiKey, masterKey);
    expect(encrypted).not.toBe(sampleOpenAiKey);

    const decrypted = await decryptApiKey(encrypted, masterKey);
    expect(decrypted).toBe(sampleOpenAiKey);
  });

  it("produces distinct ciphertexts for same key due to random IV", async () => {
    const enc1 = await encryptApiKey(sampleAnthropicKey, masterKey);
    const enc2 = await encryptApiKey(sampleAnthropicKey, masterKey);
    expect(enc1).not.toBe(enc2);

    expect(await decryptApiKey(enc1, masterKey)).toBe(sampleAnthropicKey);
    expect(await decryptApiKey(enc2, masterKey)).toBe(sampleAnthropicKey);
  });

  it("fails decryption when secret key is wrong", async () => {
    const encrypted = await encryptApiKey(sampleAnthropicKey, masterKey);
    const wrongKey = "different-deployment-secret-key-32";

    await expect(decryptApiKey(encrypted, wrongKey)).rejects.toThrow();
  });

  it("fails decryption if ciphertext is tampered with", async () => {
    const encrypted = await encryptApiKey(sampleAnthropicKey, masterKey);
    const tampered = encrypted.slice(0, -4) + "AAAA";

    await expect(decryptApiKey(tampered, masterKey)).rejects.toThrow();
  });

  it("formats key hint showing only provider prefix and last 4 characters", () => {
    expect(formatKeyHint(sampleAnthropicKey)).toBe("sk-ant-...9988");
    expect(formatKeyHint(sampleOpenAiKey)).toBe("sk-proj-...4321");
    expect(formatKeyHint("short")).toBe("sk-...hort");
  });
});
