# Contributing Guide: AI Model Router & Additional Providers

Pariksha’s AI Question Drafting pipeline is built around zero external SDK dependencies, using standard native `fetch` and WebCrypto (`crypto.subtle`) for maximum performance, minimal bundle size, and universal runtime compatibility (Cloudflare Workers, Node.js, Docker).

This document explains how the **Provider Router** works and how community contributors can add support for new AI providers (e.g., Google Gemini, DeepSeek, Local Ollama, Mistral) or register new models.

---

## 1. Ready-to-Post GitHub Issue Template

You can copy and post this issue directly to GitHub to invite community contributors:

```markdown
### 🚀 Feature: Add Additional AI Providers to Pariksha BYOK Router (Gemini, DeepSeek, Local Ollama)

#### Description
Pariksha currently supports Bring-Your-Own-Key (BYOK) question drafting via **Anthropic**, **OpenAI**, and generic **OpenAI-Compatible / OpenRouter** endpoints using a zero-dependency native `fetch` provider router.

We would love community contributions to expand our AI model router with dedicated adapters for:
1. **Google Gemini** (`gemini-2.0-flash`, `gemini-1.5-pro`)
2. **DeepSeek** (`deepseek-chat`, `deepseek-reasoner`)
3. **Local Ollama / vLLM** (Self-hosted air-gapped LLMs)
4. **Mistral AI** (`mistral-large-2411`, `codestral`)

#### Architecture & Constraints
- **Zero External SDKs:** Do not import `@google/genai`, `openai`, or other third-party client SDKs. All requests must use standard `fetch` and WebCrypto.
- **ProviderAdapter Interface:** Implement the lightweight `ProviderAdapter` in `apps/api/src/byok/adapters/<name>.ts`.
- **Structured Output:** All adapters must return valid `pariksha/question@1` JSON matching the Pariksha question schema.
- **Unit Tests:** Add test suites with mocked responses in `apps/api/test/byok/`.

See the full implementation walkthrough in [`docs/contributing/ai-model-router.md`](https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/contributing/ai-model-router.md).

#### Getting Started
- Comment below to claim a provider!
- PRs should target the `main` branch.
- Label: `good first issue`, `help wanted`, `ai-router`
```

---

## 2. Architecture Overview

All AI providers implement the `ProviderAdapter` interface defined in `apps/api/src/byok/types.ts`:

```typescript
export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  pricing: {
    promptPerMillionCents: number;
    completionPerMillionCents: number;
  };
  recommended?: boolean;
}

export interface ProviderRequest {
  apiKey: string;
  model: string;
  prompt: string;
  count: number;
  types?: QuestionType[];
  baseUrl?: string;
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
```

---

## 3. Step-by-Step: Adding a New Provider Adapter

### Step 1: Create the Adapter File

Create `apps/api/src/byok/adapters/<provider>.ts`:

```typescript
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../types.js";
import { buildSystemPrompt, buildUserPrompt } from "../prompts.js";

export class GeminiAdapter implements ProviderAdapter {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly defaultModel = "gemini-2.0-flash";
  readonly supportsCustomModel = true;

  readonly models = [
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      provider: "gemini",
      pricing: { promptPerMillionCents: 10, completionPerMillionCents: 40 },
      recommended: true,
    },
    {
      id: "gemini-1.5-pro",
      name: "Gemini 1.5 Pro",
      provider: "gemini",
      pricing: { promptPerMillionCents: 125, completionPerMillionCents: 500 },
    },
  ];

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const systemPrompt = buildSystemPrompt(req.types);
    const userPrompt = buildUserPrompt(req.prompt, req.count);
    const model = req.model || this.defaultModel;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${req.apiKey}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.2,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Gemini API error (${res.status}): ${err || res.statusText}`);
    }

    const data = await res.json();
    const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    return { rawJson, promptTokens, completionTokens, model };
  }
}
```

### Step 2: Register the Adapter in the Router

In `apps/api/src/byok/router.ts`:

```typescript
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { GeminiAdapter } from "./adapters/gemini.js";

const ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
  openrouter: new OpenRouterAdapter(),
  gemini: new GeminiAdapter(),
};
```

### Step 3: Add Unit Tests

Create `apps/api/test/byok/gemini.test.ts` with mocked global `fetch`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiAdapter } from "../../src/byok/adapters/gemini.js";

describe("GeminiAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends properly formatted JSON request and extracts tokens", async () => {
    const adapter = new GeminiAdapter();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"questions":[]}' }] } }],
          usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 80 },
        }),
      }),
    );

    const res = await adapter.call({
      apiKey: "AIzaSyFakeKey",
      model: "gemini-2.0-flash",
      prompt: "Calculus limits",
      count: 2,
    });

    expect(res.rawJson).toBe('{"questions":[]}');
    expect(res.promptTokens).toBe(150);
    expect(res.completionTokens).toBe(80);
  });
});
```

### Step 4: Verify Tests & Parity

Run:
```bash
pnpm --filter @pariksha/api test
```

Ensure all existing tests pass and submit your pull request!
