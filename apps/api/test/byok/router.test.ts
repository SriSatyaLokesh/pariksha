import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  routeDraftRequest,
  registerAdapter,
  getAdapter,
  listAdapters,
} from "../../src/byok/router.js";
import {
  getModelMetadata,
  getFallbackPricing,
  calculateCostCents,
  listModelsForProvider,
} from "../../src/byok/models.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../../src/byok/types.js";

describe("BYOK Model Registry & Pricing (Phase 12)", () => {
  it("resolves default models for Anthropic, OpenAI, and OpenRouter", () => {
    const anthropicAdapter = getAdapter("anthropic");
    const openaiAdapter = getAdapter("openai");
    const openrouterAdapter = getAdapter("openrouter");

    expect(anthropicAdapter?.defaultModel).toBe("claude-3-5-sonnet-20241022");
    expect(openaiAdapter?.defaultModel).toBe("gpt-4o-mini");
    expect(openrouterAdapter?.defaultModel).toBe("deepseek/deepseek-chat");
  });

  it("lists registered models for each provider", () => {
    const anthropicModels = listModelsForProvider("anthropic");
    expect(anthropicModels.some((m) => m.id === "claude-3-5-sonnet-20241022")).toBe(true);
    expect(anthropicModels.some((m) => m.id === "claude-3-5-haiku-20241022")).toBe(true);

    const openaiModels = listModelsForProvider("openai");
    expect(openaiModels.some((m) => m.id === "gpt-4o-mini")).toBe(true);
    expect(openaiModels.some((m) => m.id === "gpt-4o")).toBe(true);

    const openrouterModels = listModelsForProvider("openrouter");
    expect(openrouterModels.some((m) => m.id === "deepseek/deepseek-chat")).toBe(true);
  });

  it("resolves exact model metadata and pricing", () => {
    const sonnet = getModelMetadata("claude-3-5-sonnet-20241022");
    expect(sonnet).toBeDefined();
    expect(sonnet?.pricing.promptPerMillionCents).toBe(300);
    expect(sonnet?.pricing.completionPerMillionCents).toBe(1500);

    const mini = getModelMetadata("gpt-4o-mini");
    expect(mini).toBeDefined();
    expect(mini?.pricing.promptPerMillionCents).toBe(15);
    expect(mini?.pricing.completionPerMillionCents).toBe(60);
  });

  it("handles custom or unregistered model IDs with safe fallback pricing", () => {
    // Custom Anthropic model
    const customHaiku = getFallbackPricing("anthropic", "custom-claude-3-5-haiku-finetuned");
    expect(customHaiku.promptPerMillionCents).toBeLessThan(300);

    const customSonnet = getFallbackPricing("anthropic", "custom-claude-sonnet-v1");
    expect(customSonnet.promptPerMillionCents).toBe(300);

    // Custom OpenAI model
    const customMini = getFallbackPricing("openai", "ft:gpt-4o-mini:my-org:custom-1");
    expect(customMini.promptPerMillionCents).toBe(15);

    // Custom OpenRouter model
    const customOpenRouter = getFallbackPricing("openrouter", "nousresearch/hermes-3-llama-3.1-405b");
    expect(customOpenRouter.promptPerMillionCents).toBeGreaterThan(0);
    expect(customOpenRouter.completionPerMillionCents).toBeGreaterThan(0);
  });

  it("computes cost cents with minimum 1-cent floor for non-zero token usage", () => {
    const pricing = { promptPerMillionCents: 15, completionPerMillionCents: 60 };

    // 0 tokens -> 0 cents
    expect(calculateCostCents(pricing, 0, 0)).toBe(0);

    // Very few tokens (sub-cent cost) -> minimum 1 cent floor
    expect(calculateCostCents(pricing, 10, 5)).toBe(1);

    // Normal calculation: 100k prompt ($0.015 = 1.5c) + 100k completion ($0.06 = 6c) = 7.5c -> rounds to 8c
    expect(calculateCostCents(pricing, 100_000, 100_000)).toBe(8);
  });
});

describe("BYOK Provider Router (Phase 12)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes request to AnthropicAdapter with proper headers and payload", async () => {
    const mockQuestions = [
      {
        id: "Q1",
        type: "single",
        prompt: "What is 10 / 2?",
        options: [
          { id: "a", text: "5" },
          { id: "b", text: "2" },
        ],
        key: "a",
        difficulty: "easy",
        scoring: { mode: "all_or_nothing", points: 1 },
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({ questions: mockQuestions }) }],
        usage: { input_tokens: 120, output_tokens: 65 },
      }),
    });

    const result = await routeDraftRequest("anthropic", {
      apiKey: "sk-ant-test-router-key",
      model: "claude-3-5-sonnet-20241022",
      prompt: "Math basic",
      count: 1,
      types: ["single"],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.prompt).toBe("What is 10 / 2?");
    expect(result.model).toBe("claude-3-5-sonnet-20241022");
    expect(result.usage.promptTokens).toBe(120);
    expect(result.usage.completionTokens).toBe(65);
    expect(result.usage.estimatedCostCents).toBeGreaterThanOrEqual(1);

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://api.anthropic.com/v1/messages");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test-router-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const reqBody = JSON.parse(call?.[1]?.body as string);
    expect(reqBody.model).toBe("claude-3-5-sonnet-20241022");
    expect(reqBody.max_tokens).toBe(4096);
    expect(reqBody.system).toContain("pariksha/question@1");
  });

  it("routes request to OpenAIAdapter with json_object format and Bearer authorization", async () => {
    const mockQuestions = [
      {
        id: "Q2",
        type: "true_false",
        prompt: "The Earth revolves around the Sun.",
        key: true,
        difficulty: "easy",
        scoring: { mode: "all_or_nothing", points: 1 },
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ questions: mockQuestions }) } }],
        usage: { prompt_tokens: 180, completion_tokens: 70 },
      }),
    });

    const result = await routeDraftRequest("openai", {
      apiKey: "sk-proj-test-router-key",
      model: "gpt-4o-mini",
      prompt: "Solar system",
      count: 1,
      types: ["true_false"],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.usage.promptTokens).toBe(180);
    expect(result.usage.completionTokens).toBe(70);

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-proj-test-router-key");

    const reqBody = JSON.parse(call?.[1]?.body as string);
    expect(reqBody.response_format).toEqual({ type: "json_object" });
  });

  it("routes request to OpenRouterAdapter with HTTP-Referer and custom model", async () => {
    const mockQuestions = [
      {
        id: "Q3",
        type: "numeric",
        prompt: "Calculate 5 factorial.",
        key: { value: 120, tolerance: 0, tolerance_type: "absolute" },
        scoring: { mode: "all_or_nothing", points: 2 },
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ questions: mockQuestions }) } }],
        usage: { prompt_tokens: 90, completion_tokens: 45 },
      }),
    });

    const result = await routeDraftRequest("openrouter", {
      apiKey: "sk-or-v1-test-key",
      model: "meta-llama/llama-3.3-70b-instruct",
      prompt: "Math factorial",
      count: 1,
      types: ["numeric"],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.model).toBe("meta-llama/llama-3.3-70b-instruct");
    expect(result.usage.promptTokens).toBe(90);
    expect(result.usage.completionTokens).toBe(45);

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-or-v1-test-key");
    expect(headers["HTTP-Referer"]).toBe("https://pariksha.io");
    expect(headers["X-Title"]).toBe("Pariksha Assessment Platform");
  });

  it("supports custom baseUrl when specified in request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ questions: [] }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    });

    await routeDraftRequest("openai", {
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      prompt: "Test",
      count: 1,
      baseUrl: "https://my-custom-proxy.internal",
    });

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://my-custom-proxy.internal/v1/chat/completions");
  });

  it("extracts JSON content wrapped in markdown code blocks", async () => {
    const wrapped = "```json\n" + JSON.stringify({
      questions: [
        {
          id: "Q4",
          type: "short_answer",
          prompt: "What is the capital of Japan?",
          accepted: ["Tokyo"],
          match: "case_insensitive",
          scoring: { mode: "all_or_nothing", points: 2 },
        },
      ],
    }) + "\n```";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: wrapped } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    });

    const result = await routeDraftRequest("openai", {
      apiKey: "sk-proj-test",
      model: "gpt-4o-mini",
      prompt: "Geography",
      count: 1,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.type).toBe("short_answer");
  });

  it("throws clear error on malformed non-JSON output", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "I cannot generate questions for this topic." } }],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      }),
    });

    await expect(
      routeDraftRequest("openai", {
        apiKey: "sk-proj-test",
        model: "gpt-4o-mini",
        prompt: "Anything",
        count: 1,
      }),
    ).rejects.toThrow(/invalid non-JSON output/i);
  });

  it("throws clear error when JSON lacks 'questions' array", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ result: "no questions here" }) } }],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      }),
    });

    await expect(
      routeDraftRequest("openai", {
        apiKey: "sk-proj-test",
        model: "gpt-4o-mini",
        prompt: "Anything",
        count: 1,
      }),
    ).rejects.toThrow(/missing 'questions' array/i);
  });

  it("sanitises upstream errors to never leak the secret API key", async () => {
    const superSecretKey = "sk-super-secret-ultra-private-key-99999";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => `Error: Invalid API key ${superSecretKey} provided for project.`,
    });

    const promise = routeDraftRequest("anthropic", {
      apiKey: superSecretKey,
      model: "claude-3-5-sonnet-20241022",
      prompt: "Test",
      count: 1,
    });

    await expect(promise).rejects.toThrow(/Anthropic API error/i);
    await promise.catch((err: Error) => {
      expect(err.message).not.toContain(superSecretKey);
      expect(err.message).toContain("[REDACTED]");
    });
  });

  it("throws when requested provider is not supported", async () => {
    await expect(
      routeDraftRequest("unsupported-llm", {
        apiKey: "test",
        model: "model-1",
        prompt: "Test",
        count: 1,
      }),
    ).rejects.toThrow(/Unsupported AI provider: unsupported-llm/i);
  });

  it("allows registering and using custom third-party provider adapters", async () => {
    const customAdapter: ProviderAdapter = {
      id: "custom-ollama",
      name: "Custom Ollama",
      defaultModel: "llama3",
      models: [],
      supportsCustomModel: true,
      call: async (req: ProviderRequest): Promise<ProviderResponse> => ({
        rawJson: JSON.stringify({
          questions: [
            {
              id: "Q_CUSTOM",
              type: "true_false",
              prompt: "Local Ollama works.",
              key: true,
              difficulty: "easy",
              scoring: { mode: "all_or_nothing", points: 1 },
            },
          ],
        }),
        promptTokens: 42,
        completionTokens: 24,
        model: req.model || "llama3",
      }),
    };

    registerAdapter(customAdapter);
    expect(listAdapters().some((a) => a.id === "custom-ollama")).toBe(true);

    const result = await routeDraftRequest("custom-ollama", {
      apiKey: "none",
      model: "llama3",
      prompt: "Local prompt",
      count: 1,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.prompt).toBe("Local Ollama works.");
    expect(result.usage.promptTokens).toBe(42);
  });
});