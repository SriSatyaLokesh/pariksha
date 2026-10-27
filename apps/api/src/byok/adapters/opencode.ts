// OpenCode Provider Adapter (Phase 12).
// Direct native fetch calls to OpenCode inference or local OpenAI-compatible endpoint without external SDKs.

import { OPENCODE_MODELS } from "../models.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompts.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../types.js";

function sanitizeErrorMessage(message: string, apiKey: string): string {
  if (apiKey && apiKey.length > 4) {
    return message.replaceAll(apiKey, "[REDACTED]");
  }
  return message;
}

export class OpenCodeAdapter implements ProviderAdapter {
  readonly id = "opencode";
  readonly name = "OpenCode";
  readonly defaultModel = "deepseek-v4.1-flash-free";
  readonly models = OPENCODE_MODELS;
  readonly supportsCustomModel = true;

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const resolvedModel = req.model || this.defaultModel;
    let url: string;
    if (req.baseUrl) {
      const trimmed = req.baseUrl.replace(/\/+$/, "");
      url = trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
    } else {
      url = "https://opencode.ai/inference/openai/v1/chat/completions";
    }

    const apiKey = req.apiKey?.trim() || "public";
    const systemPrompt = buildSystemPrompt(req.types);
    const userPrompt = buildUserPrompt(req.prompt, req.count);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      const rawMessage = `OpenCode API error (${res.status}): ${errText || res.statusText}`;
      throw new Error(sanitizeErrorMessage(rawMessage, apiKey));
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
