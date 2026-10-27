import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "@pariksha/db";
import { migrate } from "@pariksha/db";
import { newId } from "@pariksha/db";
import { createWorkspace } from "@pariksha/db";
import { createBank, listQuestions } from "@pariksha/db";
import { setByokCredential, getByokUsageSummary } from "@pariksha/db";
import { encryptApiKey } from "../../src/byok/crypto.js";
import { draftQuestions, commitDraftQuestions } from "../../src/byok/draft.js";
import * as routerModule from "../../src/byok/router.js";

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

  it("Gate 1 (Preview): Preview generates draft questions, captures validation issues, charges tokens, and writes 0 questions to the bank", async () => {
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

    vi.spyOn(routerModule, "routeDraftRequest").mockResolvedValue({
      questions: mockedQuestions as never,
      model: "claude-3-5-sonnet-20241022",
      usage: { promptTokens: 100, completionTokens: 50, estimatedCostCents: 2 },
    });

    const result = await draftQuestions(db, wspId, bankId, masterKey, {
      prompt: "Generate physics quiz",
      count: 2,
      provider: "anthropic",
    });

    // Preview returns both questions and captures validation issue without throwing
    expect(result.questions).toHaveLength(2);
    expect(result.validationIssues.length).toBeGreaterThan(0);
    expect(result.validationIssues[0]?.field).toBe("key");
    expect(result.validationIssues[0]?.message).toContain("not among the options");
    expect(result.usage.promptTokens).toBe(100);

    // Verify 0 questions were written to the bank during preview (Gate 1)
    const inBank = await listQuestions(db, wspId, bankId);
    expect(inBank.rows.length).toBe(0);

    // Verify usage was charged (tokens were consumed)
    const usage = await getByokUsageSummary(db, wspId);
    expect(usage.totalPromptTokens).toBe(100);
    expect(usage.totalCompletionTokens).toBe(50);
    expect(usage.totalCostCents).toBe(2);
  });

  it("Gate 1 (Commit): Atomically commits approved questions with unique q_... IDs and rejects batches with invalid schema", async () => {
    const invalidQuestions = [
      {
        id: "Q_INVALID",
        type: "single",
        prompt: "Invalid key?",
        options: [{ id: "a", text: "A" }],
        key: "x",
        scoring: { mode: "all_or_nothing", points: 1 },
      },
    ];

    // Committing invalid questions must reject atomically
    await expect(
      commitDraftQuestions(db, wspId, bankId, invalidQuestions as never),
    ).rejects.toThrow(/validation failed/i);

    const afterInvalid = await listQuestions(db, wspId, bankId);
    expect(afterInvalid.rows.length).toBe(0);

    // Committing valid questions assigns unique q_... IDs and inserts into bank
    const approvedQuestions = [
      {
        id: "DRAFT-Q1",
        type: "true_false",
        prompt: "Water boils at 100C at 1 atm.",
        key: true,
        scoring: { mode: "all_or_nothing", points: 1 },
      },
      {
        type: "single",
        prompt: "Select 2",
        options: [
          { id: "1", text: "One" },
          { id: "2", text: "Two" },
        ],
        key: "2",
        scoring: { mode: "all_or_nothing", points: 1 },
      },
    ];

    const commitResult = await commitDraftQuestions(db, wspId, bankId, approvedQuestions as never);
    expect(commitResult.importedCount).toBe(2);
    expect(commitResult.bankId).toBe(bankId);

    const inBank = await listQuestions(db, wspId, bankId);
    expect(inBank.rows.length).toBe(2);

    for (const row of inBank.rows) {
      expect(row.refId.startsWith("q_")).toBe(true);
      expect(row.document.id.startsWith("q_")).toBe(true);
    }
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

    const spy = vi.spyOn(routerModule, "routeDraftRequest").mockResolvedValue({
      questions: validQuestions as never,
      model: "claude-3-5-sonnet-20241022",
      usage: { promptTokens: 120, completionTokens: 40, estimatedCostCents: 1 },
    });

    const result = await draftQuestions(db, wspId, bankId, masterKey, {
      prompt: "Physics light speed",
      count: 1,
      provider: "anthropic",
    });

    // Check routeDraftRequest received the decrypted key belonging to this workspace
    expect(spy).toHaveBeenCalledWith(
      "anthropic",
      expect.objectContaining({
        apiKey: realApiKey,
      }),
    );

    // Check return value does not leak the key
    expect((result as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    expect(result.questions.length).toBe(1);
    expect(result.validationIssues).toEqual([]);

    // Check questions were NOT inserted into the bank during draft preview
    const inBankPreview = await listQuestions(db, wspId, bankId);
    expect(inBankPreview.rows.length).toBe(0);

    // Commit writes them
    await commitDraftQuestions(db, wspId, bankId, result.questions);
    const inBankCommitted = await listQuestions(db, wspId, bankId);
    expect(inBankCommitted.rows.length).toBe(1);
    expect(inBankCommitted.rows[0]?.document.prompt).toBe("Light travels faster than sound in a vacuum.");
  });

  it("Gate 4: Refuses drafting when monthly spend limit is reached in current UTC month", async () => {
    // Set spend limit to 10 cents
    const encKey = await encryptApiKey(realApiKey, masterKey);
    await setByokCredential(db, wspId, "anthropic", encKey, "sk-ant-...9999", 10);

    // Pre-record usage exceeding the limit in the current UTC month
    const { recordByokUsage } = await import("@pariksha/db");
    await recordByokUsage(db, wspId, "anthropic", "claude-3-5-sonnet-20241022", 5000, 2000, 12);

    await expect(
      draftQuestions(db, wspId, bankId, masterKey, {
        prompt: "More questions",
        count: 1,
        provider: "anthropic",
      }),
    ).rejects.toThrow(/spend limit.*exceeded/i);
  });
});
