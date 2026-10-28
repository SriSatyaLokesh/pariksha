import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  GEMINI_MODELS,
  OPENROUTER_MODELS,
  OPENCODE_MODELS,
  calculateCostCents,
  getAllSupportedModels,
  getFallbackPricing,
  getModelMetadata,
  listModelsForProvider,
  providerModelsSummary,
} from "../src/ai-models.js";

describe("BYOK AI Models Registry & Helpers", () => {
  it("provides non-empty model lists for all supported providers", () => {
    expect(ANTHROPIC_MODELS.length).toBeGreaterThan(0);
    expect(OPENAI_MODELS.length).toBeGreaterThan(0);
    expect(GEMINI_MODELS.length).toBeGreaterThan(0);
    expect(OPENROUTER_MODELS.length).toBeGreaterThan(0);
    expect(OPENCODE_MODELS.length).toBeGreaterThan(0);

    const all = getAllSupportedModels();
    expect(all.length).toBe(
      ANTHROPIC_MODELS.length +
        OPENAI_MODELS.length +
        GEMINI_MODELS.length +
        OPENROUTER_MODELS.length +
        OPENCODE_MODELS.length,
    );
  });

  it("lists models filtered by provider", () => {
    const anthropic = listModelsForProvider("anthropic");
    expect(anthropic).toHaveLength(ANTHROPIC_MODELS.length);
    expect(anthropic.every((m) => m.provider === "anthropic")).toBe(true);

    const openai = listModelsForProvider("OPENAI"); // Case-insensitive
    expect(openai).toHaveLength(OPENAI_MODELS.length);
  });

  it("finds model metadata by ID with case insensitivity", () => {
    const m = getModelMetadata("CLAUDE-sonnet-5-5");
    expect(m).toBeDefined();
    expect(m?.name).toBe("Claude Sonnet 5.5");
    expect(m?.recommended).toBe(true);

    const notFound = getModelMetadata("non-existent-model");
    expect(notFound).toBeUndefined();
  });

  it("generates dynamic provider models summary strings for UI cards", () => {
    const summary = providerModelsSummary("anthropic");
    expect(summary).toContain("Claude Sonnet 5.5");
    expect(summary).toContain("Claude 3.7 Sonnet");

    const openaiSummary = providerModelsSummary("openai");
    expect(openaiSummary).toContain("GPT-6.1 Sol");

    const unknown = providerModelsSummary("unknown-provider");
    expect(unknown).toBe("Supports custom models.");
  });

  it("calculates cost accurately with 1-cent non-zero floor", () => {
    const pricing = { promptPerMillionCents: 200, completionPerMillionCents: 1000 };
    expect(calculateCostCents(pricing, 0, 0)).toBe(0);
    // 1 token of prompt at 200 cents/million = 0.0002 cents -> rounds to 1
    expect(calculateCostCents(pricing, 1, 0)).toBe(1);
    // 500,000 prompt tokens (100 cents) + 100,000 completion tokens (100 cents) = 200 cents ($2.00)
    expect(calculateCostCents(pricing, 500_000, 100_000)).toBe(200);
  });

  it("provides sensible fallback pricing for custom model IDs", () => {
    const anthropicHaiku = getFallbackPricing("anthropic", "claude-haiku-custom");
    expect(anthropicHaiku.promptPerMillionCents).toBe(80);

    const openaiMini = getFallbackPricing("openai", "custom-gpt-mini");
    expect(openaiMini.promptPerMillionCents).toBe(15);

    const opencode = getFallbackPricing("opencode", "anything");
    expect(opencode.promptPerMillionCents).toBe(0);
  });
});
