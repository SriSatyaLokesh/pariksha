// Pure HTTP client for Anthropic and OpenAI BYOK drafting (Phase 12).
// Uses native fetch with zero external SDK dependencies (ponytail style).

import type { Question, QuestionType } from "@pariksha/core";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";

export type AiProvider = "anthropic" | "openai";

export interface AiDraftRequest {
  provider: AiProvider;
  apiKey: string;
  prompt: string;
  count: number;
  types?: QuestionType[] | undefined;
  model?: string | undefined;
}

export interface AiDraftResponse {
  questions: Question[];
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    estimatedCostCents: number;
  };
}

/**
 * Strips markdown code fences (```json ... ```) if present.
 */
function cleanJsonOutput(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

/**
 * Estimates cost in USD cents based on standard model pricing.
 */
function estimateCostCents(
  provider: AiProvider,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  let promptRatePerMillion = 300; // in cents ($3.00)
  let completionRatePerMillion = 1500; // in cents ($15.00)

  if (provider === "openai") {
    if (model.includes("mini")) {
      promptRatePerMillion = 15;
      completionRatePerMillion = 60;
    } else {
      promptRatePerMillion = 250;
      completionRatePerMillion = 1000;
    }
  } else if (provider === "anthropic") {
    if (model.includes("haiku")) {
      promptRatePerMillion = 25;
      completionRatePerMillion = 125;
    } else {
      promptRatePerMillion = 300;
      completionRatePerMillion = 1500;
    }
  }

  const cost =
    (promptTokens * promptRatePerMillion + completionTokens * completionRatePerMillion) /
    1_000_000;

  // Round up to at least 1 cent if any tokens were used
  return promptTokens + completionTokens > 0 ? Math.max(1, Math.round(cost)) : 0;
}

export async function invokeAiDrafting(req: AiDraftRequest): Promise<AiDraftResponse> {
  const systemPrompt = buildSystemPrompt(req.types);
  const userPrompt = buildUserPrompt(req.prompt, req.count);

  let rawJson: string;
  let promptTokens: number;
  let completionTokens: number;
  let resolvedModel = req.model ?? "";

  if (req.provider === "anthropic") {
    resolvedModel = resolvedModel || "claude-3-5-sonnet-20241022";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
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
      throw new Error(`Anthropic API error (${res.status}): ${errText || res.statusText}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    rawJson = data.content?.[0]?.text ?? "";
    promptTokens = data.usage?.input_tokens ?? 0;
    completionTokens = data.usage?.output_tokens ?? 0;
  } else if (req.provider === "openai") {
    resolvedModel = resolvedModel || "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
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
      throw new Error(`OpenAI API error (${res.status}): ${errText || res.statusText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    rawJson = data.choices?.[0]?.message?.content ?? "";
    promptTokens = data.usage?.prompt_tokens ?? 0;
    completionTokens = data.usage?.completion_tokens ?? 0;
  } else {
    throw new Error(`Unsupported AI provider: ${String(req.provider)}`);
  }

  const cleaned = cleanJsonOutput(rawJson);
  let parsed: { questions?: Question[] };
  try {
    parsed = JSON.parse(cleaned) as { questions?: Question[] };
  } catch {
    throw new Error("AI provider returned invalid non-JSON output.");
  }

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error("AI provider JSON missing 'questions' array.");
  }

  const estimatedCostCents = estimateCostCents(
    req.provider,
    resolvedModel,
    promptTokens,
    completionTokens,
  );

  return {
    questions: parsed.questions,
    model: resolvedModel,
    usage: {
      promptTokens,
      completionTokens,
      estimatedCostCents,
    },
  };
}
