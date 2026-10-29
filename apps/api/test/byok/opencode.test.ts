import { describe, expect, it, vi, afterEach } from "vitest";
import { OpenCodeAdapter } from "../../src/byok/adapters/opencode.js";
import { routeDraftRequest } from "../../src/byok/router.js";

describe("OpenCode BYOK Adapter (Phase 12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls OpenCode inference API with default model and headers", async () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.id).toBe("opencode");
    expect(adapter.defaultModel).toBe("deepseek-v4.1-flash-free");

    const mockQuestions = [
      {
        id: "Q_OPENCODE_1",
        type: "single",
        prompt: "What is the capital of France?",
        options: [
          { id: "a", text: "Paris" },
          { id: "b", text: "Lyon" },
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
        choices: [
          {
            message: { content: JSON.stringify({ questions: mockQuestions }) },
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 60,
        },
      }),
    });

    const result = await routeDraftRequest("opencode", {
      apiKey: "public",
      model: "deepseek-v4.1-flash-free",
      prompt: "France geography",
      count: 1,
      types: ["single"],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.prompt).toBe("What is the capital of France?");
    expect(result.usage.promptTokens).toBe(120);
    expect(result.usage.completionTokens).toBe(60);

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://opencode.ai/inference/openai/v1/chat/completions");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer public");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(call?.[1]?.body as string) as {
      model?: string;
      response_format?: { type?: string };
    };
    expect(body.model).toBe("deepseek-v4.1-flash-free");
    expect(body.response_format?.type).toBe("json_object");
  });

  it("supports custom baseUrl for local OpenCode or Ollama instance", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: JSON.stringify({ questions: [] }) },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }),
    });

    await routeDraftRequest("opencode", {
      apiKey: "local-token",
      model: "glm-5.3-flash-free",
      prompt: "Test",
      count: 1,
      baseUrl: "https://custom-opencode.example.com/v1",
    });

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://custom-opencode.example.com/v1/chat/completions");
  });

  it("redacts API token when OpenCode API returns an error", async () => {
    const rawKey = "opencode-secret-token-to-hide";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => `Token ${rawKey} is expired.`,
    });

    await expect(
      routeDraftRequest("opencode", {
        apiKey: rawKey,
        model: "deepseek-v4.1-flash-free",
        prompt: "Test prompt",
        count: 1,
      }),
    ).rejects.toThrowError(/\[REDACTED\]/);
  });
});
