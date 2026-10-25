import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "@pariksha/db";
import { migrate } from "@pariksha/db";
import { newId } from "@pariksha/db";
import { createWorkspace } from "@pariksha/db";
import { createBank, listQuestions } from "@pariksha/db";
import { setByokCredential } from "@pariksha/db";
import { encryptApiKey } from "../../src/byok/crypto.js";
import { draftQuestions } from "../../src/byok/draft.js";
import * as clientModule from "../../src/byok/client.js";

describe("BYOK AI Question Drafting Engine (Phase 12 Gates)", () => {
  let db: DbClient;
  let wspId: string;
  let bankId: string;
  const masterKey = "pariksha-test-field-encryption-key-32b";
  const realApiKey = "sk-ant-valid-key-for-test-9999";

  beforeEach(async () => {
    db = sqliteClient(":memory:");
    await migrate(db);

    wspId = newId("wsp");
    await createWorkspace(db, wspId, { name: "Test Org", slug: "test-org" });
    bankId = await createBank(db, wspId, { name: "Science Bank" });

    const encKey = await encryptApiKey(realApiKey, masterKey);
    await setByokCredential(db, wspId, "anthropic", encKey, "sk-ant-...9999", 5000);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeClient(db);
  });

  it("Gate 1: Rejects entire batch if any question fails validation, writing 0 questions", async () => {
    // 1 valid question, 1 invalid question (key references nonexistent option 'z')
    const mockedQuestions = [
      {
        id: "Q1",
        type: "single",
        prompt: "Valid question?",
        options: [
          { id: "a", text: "Option A" },
          { id: "b", text: "Option B" },
        ],
        key: "a",
        scoring: { mode: "all_or_nothing", points: 1 },
      },
      {
        id: "Q2",
        type: "single",
        prompt: "Broken question?",
        options: [
          { id: "a", text: "Option A" },
          { id: "b", text: "Option B" },
        ],
        key: "z", // INVALID: does not exist in options
        scoring: { mode: "all_or_nothing", points: 1 },
      },
    ];

    vi.spyOn(clientModule, "invokeAiDrafting").mockResolvedValue({
      questions: mockedQuestions as never,
      model: "claude-3-5-sonnet",
      usage: { promptTokens: 100, completionTokens: 50, estimatedCostCents: 2 },
    });

    await expect(
      draftQuestions(db, wspId, bankId, masterKey, {
        prompt: "Generate physics quiz",
        count: 2,
        provider: "anthropic",
      }),
    ).rejects.toThrow(/validation failed/i);

    // Verify 0 questions were written to the bank
    const inBank = await listQuestions(db, wspId, bankId);
    expect(inBank.rows.length).toBe(0);
  });

  it("Gate 2 & Gate 3: Successfully drafts questions using workspace key and never leaks decrypted key", async () => {
    const validQuestions = [
      {
        id: "Q1",
        type: "true_false",
        prompt: "Light travels faster than sound in a vacuum.",
        key: true,
        scoring: { mode: "all_or_nothing", points: 1 },
      },
    ];

    const spy = vi.spyOn(clientModule, "invokeAiDrafting").mockResolvedValue({
      questions: validQuestions as never,
      model: "claude-3-5-sonnet",
      usage: { promptTokens: 120, completionTokens: 40, estimatedCostCents: 1 },
    });

    const result = await draftQuestions(db, wspId, bankId, masterKey, {
      prompt: "Physics light speed",
      count: 1,
      provider: "anthropic",
    });

    // Check invokeAiDrafting received the decrypted key belonging to this workspace
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: realApiKey,
        provider: "anthropic",
      }),
    );

    // Check return value does not leak the key
    expect((result as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    expect(result.questions.length).toBe(1);

    // Check questions were inserted into the bank
    const inBank = await listQuestions(db, wspId, bankId);
    expect(inBank.rows.length).toBe(1);
    expect(inBank.rows[0]?.document.prompt).toBe("Light travels faster than sound in a vacuum.");
  });

  it("Gate 4: Refuses drafting when monthly spend limit is reached or exceeded", async () => {
    // Set spend limit to 10 cents
    const encKey = await encryptApiKey(realApiKey, masterKey);
    await setByokCredential(db, wspId, "anthropic", encKey, "sk-ant-...9999", 10);

    // Pre-record usage exceeding the limit
    const { recordByokUsage } = await import("@pariksha/db");
    await recordByokUsage(db, wspId, "anthropic", "claude-3-5-sonnet", 5000, 2000, 12);

    await expect(
      draftQuestions(db, wspId, bankId, masterKey, {
        prompt: "More questions",
        count: 1,
        provider: "anthropic",
      }),
    ).rejects.toThrow(/spend limit.*exceeded/i);
  });
});
