// OpenRouter / OpenAI-Compatible Provider Adapter (Phase 12).
// Direct native fetch calls to OpenRouter API without external SDKs.

import { OPENROUTER_MODELS } from "../models.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompts.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../types.js";

function sanitizeErrorMessage(message: string, apiKey: string): string {
  if (apiKey && apiKey.length > 4) {
    return message.replaceAll(apiKey, "[REDACTED]");
  }
  return message;
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = "openrouter";
  readonly name = "OpenRouter";
  readonly defaultModel = "deepseek/deepseek-chat";
  readonly models = OPENROUTER_MODELS;
  readonly supportsCustomModel = true;

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const resolvedModel = req.model || this.defaultModel;
    const url = req.baseUrl
      ? `${req.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`
      : "https://openrouter.ai/api/v1/chat/completions";

    const systemPrompt = buildSystemPrompt(req.types);
    const userPrompt = buildUserPrompt(req.prompt, req.count);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        "HTTP-Referer": "https://pariksha.io",
        "X-Title": "Pariksha Assessment Platform",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const rawMessage = `OpenRouter API error (${res.status}): ${errText || res.statusText}`;
      throw new Error(sanitizeErrorMessage(rawMessage, req.apiKey));
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const rawJson = data.choices?.[0]?.message?.content ?? "";
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;

    return {
      rawJson,
      promptTokens,
      completionTokens,
      model: resolvedModel,
    };
  }
}
