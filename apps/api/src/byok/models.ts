// Model Registry & Pricing Engine for Pariksha BYOK AI Question Drafting (Phase 12).
// Provides pricing metadata and fallback handling for Anthropic, OpenAI, and OpenRouter.

import type { ModelMetadata, ModelPricing } from "./types.js";

export const ANTHROPIC_MODELS: ModelMetadata[] = [
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 200, completionPerMillionCents: 1000 },
    recommended: true,
  },
  {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 10, completionPerMillionCents: 50 },
  },
  {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 400, completionPerMillionCents: 2000 },
  },
  {
    id: "claude-fable-5-1",
    name: "Claude Fable 5.1",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 1000, completionPerMillionCents: 5000 },
  },
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 300, completionPerMillionCents: 1500 },
  },
  {
    id: "claude-3-5-sonnet-20241022",
    name: "Claude 3.5 Sonnet",
    provider: "anthropic",
    pricing: { promptPerMillionCents: 300, completionPerMillionCents: 1500 },
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
];

export const OPENAI_MODELS: ModelMetadata[] = [
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: "openai",
    pricing: { promptPerMillionCents: 200, completionPerMillionCents: 1000 },
    recommended: true,
  },
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    provider: "openai",
    pricing: { promptPerMillionCents: 100, completionPerMillionCents: 500 },
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    provider: "openai",
    pricing: { promptPerMillionCents: 10, completionPerMillionCents: 50 },
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    provider: "openai",
    pricing: { promptPerMillionCents: 1000, completionPerMillionCents: 5000 },
  },
  {
    id: "o3-mini",
    name: "o3 Mini",
    provider: "openai",
    pricing: { promptPerMillionCents: 110, completionPerMillionCents: 440 },
  },
  {
    id: "o3",
    name: "o3 Standard",
    provider: "openai",
    pricing: { promptPerMillionCents: 200, completionPerMillionCents: 800 },
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openai",
    pricing: { promptPerMillionCents: 15, completionPerMillionCents: 60 },
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
];

export const OPENROUTER_MODELS: ModelMetadata[] = [
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 14, completionPerMillionCents: 42 },
    recommended: true,
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 14, completionPerMillionCents: 28 },
  },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5 (OpenRouter)",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 200, completionPerMillionCents: 1000 },
  },
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Claude Haiku 5.5 (OpenRouter)",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 10, completionPerMillionCents: 50 },
  },
  {
    id: "openai/gpt-6.1-terra",
    name: "GPT-6.1 Terra (OpenRouter)",
    provider: "openrouter",
    pricing: { promptPerMillionCents: 100, completionPerMillionCents: 500 },
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

export const GEMINI_MODELS: ModelMetadata[] = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    pricing: { promptPerMillionCents: 15, completionPerMillionCents: 60 },
    recommended: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "gemini",
    pricing: { promptPerMillionCents: 125, completionPerMillionCents: 500 },
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "gemini",
    pricing: { promptPerMillionCents: 10, completionPerMillionCents: 40 },
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "gemini",
    pricing: { promptPerMillionCents: 125, completionPerMillionCents: 500 },
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "gemini",
    pricing: { promptPerMillionCents: 15, completionPerMillionCents: 60 },
  },
];

export const OPENCODE_MODELS: ModelMetadata[] = [
  {
    id: "deepseek-v4.1-flash-free",
    name: "DeepSeek V4.1 Flash Free",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
    recommended: true,
  },
  {
    id: "glm-5.3-flash-free",
    name: "GLM 5.3 Flash Free",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
  },
  {
    id: "nemotron-3.5-super-vl-free",
    name: "Nemotron 3.5 Super VL Free",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
  },
  {
    id: "nemotron-3.5-lightning-free",
    name: "Nemotron 3.5 Lightning Free",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
  },
  {
    id: "flint-40b-free",
    name: "Flint 40B Free",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
  },
  {
    id: "mimo-v2.6-flash-free",
    name: "MiMo V2.6 Flash Free",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
  },
  {
    id: "beam-free",
    name: "Beam Free",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
  },
  {
    id: "big-pickle",
    name: "Big Pickle",
    provider: "opencode",
    pricing: { promptPerMillionCents: 0, completionPerMillionCents: 0 },
  },
];

export const ALL_MODELS: ModelMetadata[] = [
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
  ...GEMINI_MODELS,
  ...OPENROUTER_MODELS,
  ...OPENCODE_MODELS,
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

  if (normProvider === "gemini") {
    if (normModel.includes("pro")) {
      return { promptPerMillionCents: 125, completionPerMillionCents: 500 };
    }
    return { promptPerMillionCents: 15, completionPerMillionCents: 60 };
  }

  if (normProvider === "opencode") {
    return { promptPerMillionCents: 0, completionPerMillionCents: 0 };
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

/**
 * Fetches live models and pricing dynamically from OpenRouter's public API.
 * Maps prompt/completion rates to USD cents per million tokens.
 */
export async function fetchLiveOpenRouterModels(): Promise<ModelMetadata[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name: string;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    if (!Array.isArray(data.data)) return [];

    return data.data.map((m) => {
      const promptRate = parseFloat(m.pricing?.prompt ?? "0");
      const completionRate = parseFloat(m.pricing?.completion ?? "0");
      return {
        id: m.id,
        name: m.name,
        provider: "openrouter",
        pricing: {
          promptPerMillionCents: Math.round(promptRate * 1_000_000 * 100),
          completionPerMillionCents: Math.round(completionRate * 1_000_000 * 100),
        },
      };
    });
  } catch {
    return [];
  }
}
