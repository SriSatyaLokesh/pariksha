// Pure HTTP client for BYOK question drafting (Phase 12).
// Delegates to the extensible Provider Router with native fetch and zero external SDKs.

import type { QuestionType } from "@pariksha/core";
import { routeDraftRequest } from "./router.js";
import type { RouteDraftResult } from "./types.js";

export type AiProvider = "anthropic" | "openai" | "openrouter";

export interface AiDraftRequest {
  provider: AiProvider | string;
  apiKey: string;
  prompt: string;
  count: number;
  types?: QuestionType[] | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

export type AiDraftResponse = RouteDraftResult;

/**
 * Invokes AI question drafting by delegating to the extensible provider router.
 * Preserves backwards compatibility for existing callers.
 */
export async function invokeAiDrafting(req: AiDraftRequest): Promise<AiDraftResponse> {
  return routeDraftRequest(req.provider, {
    apiKey: req.apiKey,
    model: req.model ?? "",
    prompt: req.prompt,
    count: req.count,
    types: req.types,
    baseUrl: req.baseUrl,
  });
}
