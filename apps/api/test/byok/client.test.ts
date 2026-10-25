import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invokeAiDrafting } from "../../src/byok/client.js";

describe("BYOK AI Drafting Client (Phase 12)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls Anthropic API and parses JSON question response with token usage", async () => {
    const mockResponseText = JSON.stringify({
      questions: [
        {
          id: "Q1",
          type: "single",
          prompt: "What is the capital of France?",
          options: [
            { id: "a", text: "Paris" },
            { id: "b", text: "London" },
          ],
          key: "a",
          difficulty: "easy",
          scoring: { mode: "all_or_nothing", points: 1 },
        },
      ],
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: mockResponseText }],
        usage: { input_tokens: 150, output_tokens: 80 },
      }),
    });

    const result = await invokeAiDrafting({
      provider: "anthropic",
      apiKey: "sk-ant-test-key",
      prompt: "Geography quiz",
      count: 1,
      types: ["single"],
    });

    expect(result.questions.length).toBe(1);
    expect(result.questions[0]?.prompt).toBe("What is the capital of France?");
    expect(result.usage.promptTokens).toBe(150);
    expect(result.usage.completionTokens).toBe(80);
    expect(result.usage.estimatedCostCents).toBeGreaterThan(0);

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://api.anthropic.com/v1/messages");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test-key");
  });

  it("calls OpenAI API and parses JSON question response with token usage", async () => {
    const mockResponseText = JSON.stringify({
      questions: [
        {
          id: "Q1",
          type: "true_false",
          prompt: "Water boils at 100 degrees Celsius at standard pressure.",
          key: true,
          difficulty: "easy",
          scoring: { mode: "all_or_nothing", points: 1 },
        },
      ],
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: mockResponseText } }],
        usage: { prompt_tokens: 200, completion_tokens: 60 },
      }),
    });

    const result = await invokeAiDrafting({
      provider: "openai",
      apiKey: "sk-proj-test-key",
      prompt: "Science trivia",
      count: 1,
      types: ["true_false"],
    });

    expect(result.questions.length).toBe(1);
    expect(result.questions[0]?.type).toBe("true_false");
    expect(result.usage.promptTokens).toBe(200);
    expect(result.usage.completionTokens).toBe(60);

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-proj-test-key");
  });

  it("extracts JSON content enclosed in markdown code fences", async () => {
    const fenced = "```json\n" + JSON.stringify({
      questions: [
        {
          id: "Q1",
          type: "numeric",
          prompt: "What is 2 + 2?",
          key: { value: 4, tolerance: 0, tolerance_type: "absolute" },
          scoring: { mode: "all_or_nothing", points: 2 },
        },
      ],
    }) + "\n```";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: fenced } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    });

    const result = await invokeAiDrafting({
      provider: "openai",
      apiKey: "sk-proj-test-key",
      prompt: "Math simple",
      count: 1,
    });

    expect(result.questions.length).toBe(1);
    expect(result.questions[0]?.type).toBe("numeric");
  });

  it("translates upstream 401 error into sanitised message without exposing the key", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid API key provided",
    });

    await expect(
      invokeAiDrafting({
        provider: "anthropic",
        apiKey: "sk-ant-bad-secret-key-12345",
        prompt: "Math",
        count: 1,
      }),
    ).rejects.toThrow(/invalid.*api key|unauthorized/i);
  });
});
