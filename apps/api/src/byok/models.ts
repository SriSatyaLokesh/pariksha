// Model Registry & Pricing Engine for Pariksha BYOK AI Question Drafting (Phase 12).
// Provides pricing metadata and fallback handling for Anthropic, OpenAI, and OpenRouter.

import type { ModelMetadata, ModelPricing } from "./types.js";

export const ANTHROPIC_MODELS: ModelMetadata[] = [
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 300, completionPerMillionCents: 1500 },
    recommended: true,
  },
  {
    id: "claude-3-5-haiku-20241022",
    name: "Claude 3.5 Haiku",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 80, completionPerMillionCents: 400 },
  },
  {
    id: "claude-3-opus-20240229",
    name: "Claude 3 Opus",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 1500, completionPerMillionCents: 7500 },
  },
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 300, completionPerMillionCents: 1500 },
  },
];

export const OPENAI_MODELS: ModelMetadata[] = [
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    pricing: { promptPerMillionCents: 15, completionPerMillionCents: 60 },
    recommended: true,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    pricing: { promptPerMillionCents: 250, completionPerMillionCents: 1000 },
  },
  {
    id: "o1-preview",
    name: "o1 Preview",
    provider: "openai",
    pricing: { promptPerMillionCents: 1500, completionPerMillionCents: 6000 },
  },
  {
    id: "o1-mini",
    name: "o1 Mini",
    provider: "openai",
    pricing: { promptPerMillionCents: 300, completionPerMillionCents: 1200 },
  },
  {
    id: "o3-mini",
    name: "o3 Mini",
    provider: "openai",
    pricing: { promptPerMillionCents: 110, completionPerMillionCents: 440 },
  },
];

export const OPENROUTER_MODELS: ModelMetadata[] = [
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 14, completionPerMillionCents: 28 },
    recommended: true,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B Instruct",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 12, completionPerMillionCents: 30 },
  },
  {
    id: "mistralai/mistral-large-2411",
    name: "Mistral Large 2411",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 200, completionPerMillionCents: 600 },
  },
];

export const ALL_MODELS: ModelMetadata[] = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...OPENROUTER_MODELS,
];

/**
 * Returns metadata for a registered model by ID, optionally scoped by provider.
 */
export function getModelMetadata(modelId: string, provider?: string): ModelMetadata | undefined {
  const normId = modelId.trim().toLowerCase();
  return ALL_MODELS.find((m) => {
    const idMatches = m.id.toLowerCase() === normId;
    if (!idMatches) return false;
    if (provider) {
      return m.provider.toLowerCase() === provider.toLowerCase();
    }
    return true;
  });
}

/**
 * Returns all registered models for a given provider.
 */
export function listModelsForProvider(provider: string): ModelMetadata[] {
  const norm = provider.trim().toLowerCase();
  return ALL_MODELS.filter((m) => m.provider.toLowerCase() === norm);
}

/**
 * Returns all supported models across all providers.
 */
export function getAllSupportedModels(): ModelMetadata[] {
  return [...ALL_MODELS];
}

/**
 * Resolves safe fallback pricing for custom or unregistered model IDs.
 */
export function getFallbackPricing(provider: string, modelId?: string): ModelPricing {
  const normProvider = provider.trim().toLowerCase();
  const normModel = (modelId ?? "").trim().toLowerCase();

  if (normProvider === "anthropic") {
    if (normModel.includes("haiku")) {
      return { promptPerMillionCents: 80, completionPerMillionCents: 400 };
    }
    if (normModel.includes("opus")) {
      return { promptPerMillionCents: 1500, completionPerMillionCents: 7500 };
    }
    return { promptPerMillionCents: 300, completionPerMillionCents: 1500 };
  }

  if (normProvider === "openai") {
    if (normModel.includes("mini")) {
      return { promptPerMillionCents: 15, completionPerMillionCents: 60 };
    }
    if (normModel.includes("o1") || normModel.includes("o3")) {
      return { promptPerMillionCents: 300, completionPerMillionCents: 1200 };
    }
    return { promptPerMillionCents: 250, completionPerMillionCents: 1000 };
  }

  if (normProvider === "openrouter") {
    return { promptPerMillionCents: 50, completionPerMillionCents: 150 };
  }

  return { promptPerMillionCents: 200, completionPerMillionCents: 800 };
}

/**
 * Calculates cost in USD cents based on token usage and model pricing.
 * Enforces a minimum 1-cent floor for non-zero token consumption.
 */
export function calculateCostCents(
  pricing: ModelPricing,
  promptTokens: number,
  completionTokens: number,
): number {
  if (promptTokens + completionTokens === 0) {
    return 0;
  }

  const cost =
    (promptTokens * pricing.promptPerMillionCents +
      completionTokens * pricing.completionPerMillionCents) /
    1_000_000;

  return Math.max(1, Math.round(cost));
}
