// Type definitions for BYOK Provider Router and Model Registry (Phase 12).
// Standardized interfaces for multi-provider question drafting without external AI SDKs.

import type { Question, QuestionType, ModelPricing, ModelMetadata, ByokProvider } from "@pariksha/core";

export type { ModelPricing, ModelMetadata, ByokProvider };

export interface ProviderRequest {
  apiKey: string;
  model: string;
  prompt: string;
  count: number;
  types?: QuestionType[] | undefined;
  baseUrl?: string | undefined;
}

export interface ProviderResponse {
  rawJson: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  readonly models: ModelMetadata[];
  readonly supportsCustomModel?: boolean;
  call(req: ProviderRequest): Promise<ProviderResponse>;
}

export interface RouteDraftResult {
  questions: Question[];
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    estimatedCostCents: number;
  };
}

export interface ByokAudioResult {
  hasSpeech: boolean;
  transcript: string;
  provider: "openai" | "gemini" | "none";
  model?: string;
}
