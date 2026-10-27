// Extensible Provider Router for Pariksha BYOK AI Question Drafting (Phase 12).
// Routes question drafting requests to registered provider adapters, parses JSON, and tracks token costs.

import type { Question } from "@pariksha/core";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { calculateCostCents, getFallbackPricing, getModelMetadata } from "./models.js";
import { cleanJsonOutput } from "./prompts.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  RouteDraftResult,
} from "./types.js";

const ADAPTER_REGISTRY = new Map<string, ProviderAdapter>();

/**
 * Registers a provider adapter in the global registry.
 */
export function registerAdapter(adapter: ProviderAdapter): void {
  ADAPTER_REGISTRY.set(adapter.id.toLowerCase(), adapter);
}

/**
 * Retrieves a provider adapter by ID.
 */
export function getAdapter(providerId: string): ProviderAdapter | undefined {
  return ADAPTER_REGISTRY.get(providerId.toLowerCase());
}

/**
 * Lists all registered provider adapters.
 */
export function listAdapters(): ProviderAdapter[] {
  return Array.from(ADAPTER_REGISTRY.values());
}

// Register built-in default adapters
registerAdapter(new AnthropicAdapter());
registerAdapter(new OpenAIAdapter());
registerAdapter(new GeminiAdapter());
registerAdapter(new OpenRouterAdapter());

/**
 * Routes a question drafting request to the appropriate provider adapter.
 * Cleans markdown code fences, verifies JSON schema, and computes token cost cents.
 */
export async function routeDraftRequest(
  provider: string,
  req: ProviderRequest,
): Promise<RouteDraftResult> {
  const adapter = getAdapter(provider);
  if (!adapter) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const resolvedModel = req.model || adapter.defaultModel;
  const response = await adapter.call({
    ...req,
    model: resolvedModel,
  });

  const cleaned = cleanJsonOutput(response.rawJson);
  let parsed: { questions?: Question[] };
  try {
    parsed = JSON.parse(cleaned) as { questions?: Question[] };
  } catch {
    throw new Error("AI provider returned invalid non-JSON output.");
  }

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error("AI provider JSON missing 'questions' array.");
  }

  const actualModel = response.model || resolvedModel;
  const meta = getModelMetadata(actualModel, adapter.id);
  const pricing = meta?.pricing ?? getFallbackPricing(adapter.id, actualModel);

  const estimatedCostCents = calculateCostCents(
    pricing,
    response.promptTokens,
    response.completionTokens,
  );

  return {
    questions: parsed.questions,
    model: actualModel,
    usage: {
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      estimatedCostCents,
    },
  };
}
