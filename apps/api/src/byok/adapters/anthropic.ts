// Anthropic Provider Adapter (Phase 12).
// Direct native fetch calls to Anthropic Messages API without external SDKs.

import { ANTHROPIC_MODELS } from "../models.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompts.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../types.js";

function sanitizeErrorMessage(message: string, apiKey: string): string {
  if (apiKey && apiKey.length > 4) {
    return message.replaceAll(apiKey, "[REDACTED]");
  }
  return message;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = "anthropic";
  readonly name = "Anthropic";
  readonly defaultModel = "claude-3-5-sonnet-20241022";
  readonly models = ANTHROPIC_MODELS;
  readonly supportsCustomModel = true;

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const resolvedModel = req.model || this.defaultModel;
    const url = req.baseUrl
      ? `${req.baseUrl.replace(/\/+$/, "")}/v1/messages`
      : "https://api.anthropic.com/v1/messages";

    const systemPrompt = buildSystemPrompt(req.types);
    const userPrompt = buildUserPrompt(req.prompt, req.count);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const rawMessage = `Anthropic API error (${res.status}): ${errText || res.statusText}`;
      throw new Error(sanitizeErrorMessage(rawMessage, req.apiKey));
    }

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const rawJson = data.content?.[0]?.text ?? "";
    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    return {
      rawJson,
      promptTokens,
      completionTokens,
      model: resolvedModel,
    };
  }
}
