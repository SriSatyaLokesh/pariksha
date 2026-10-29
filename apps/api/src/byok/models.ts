// Model Registry & Pricing Engine for Pariksha BYOK AI Question Drafting (Phase 12).
// Provides pricing metadata and fallback handling for Anthropic, OpenAI, and OpenRouter.

export * from "@pariksha/core";
import type { ModelMetadata } from "@pariksha/core";

/**
 * Fetches live models and pricing dynamically from OpenRouter's public API.
 * Maps prompt/completion rates to USD cents per million tokens.
 */
export async function fetchLiveOpenRouterModels(): Promise<ModelMetadata[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(5_000),
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
