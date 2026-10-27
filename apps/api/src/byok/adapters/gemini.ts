// Google Gemini Provider Adapter (Phase 12).
// Direct native fetch calls to Google Generative Language REST API without external SDKs.

import { GEMINI_MODELS } from "../models.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompts.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../types.js";

function sanitizeErrorMessage(message: string, apiKey: string): string {
  if (apiKey && apiKey.length > 4) {
    return message.replaceAll(apiKey, "[REDACTED]");
  }
  return message;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly defaultModel = "gemini-2.5-flash";
  readonly models = GEMINI_MODELS;
  readonly supportsCustomModel = true;

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const resolvedModel = req.model || this.defaultModel;
    const url = req.baseUrl
      ? `${req.baseUrl.replace(/\/+$/, "")}/models/${resolvedModel}:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`;

    const systemPrompt = buildSystemPrompt(req.types);
    const userPrompt = buildUserPrompt(req.prompt, req.count);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": req.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const rawMessage = `Google Gemini API error (${res.status}): ${errText || res.statusText}`;
      throw new Error(sanitizeErrorMessage(rawMessage, req.apiKey));
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      rawJson,
      promptTokens,
      completionTokens,
      model: resolvedModel,
    };
  }
}
