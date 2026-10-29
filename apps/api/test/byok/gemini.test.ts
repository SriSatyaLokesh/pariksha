import { describe, expect, it, vi, afterEach } from "vitest";
import { GeminiAdapter } from "../../src/byok/adapters/gemini.js";
import { routeDraftRequest } from "../../src/byok/router.js";

describe("Google Gemini BYOK Adapter (Phase 12)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls Google Generative Language API with correct headers and payload", async () => {
    const adapter = new GeminiAdapter();
    expect(adapter.id).toBe("gemini");
    expect(adapter.defaultModel).toBe("gemini-2.5-flash");

    const mockQuestions = [
      {
        id: "Q_GEMINI_1",
        type: "single",
        prompt: "What is the atomic number of Carbon?",
        options: [
          { id: "a", text: "6" },
          { id: "b", text: "12" },
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
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ questions: mockQuestions }) }],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 150,
          candidatesTokenCount: 75,
        },
      }),
    });

    const result = await routeDraftRequest("gemini", {
      apiKey: "AIzaSyTestSecretKey9876",
      model: "gemini-2.5-flash",
      prompt: "Carbon chemistry",
      count: 1,
      types: ["single"],
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.prompt).toBe("What is the atomic number of Carbon?");
    expect(result.usage.promptTokens).toBe(150);
    expect(result.usage.completionTokens).toBe(75);

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("AIzaSyTestSecretKey9876");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(call?.[1]?.body as string) as {
      generationConfig?: { responseMimeType?: string };
      contents?: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(body.generationConfig?.responseMimeType).toBe("application/json");
    expect(body.contents?.[0]?.role).toBe("user");
  });

  it("redacts API key when Gemini API returns an error", async () => {
    const rawKey = "AIzaSySecretApiKeyToRedact";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => `API key ${rawKey} is invalid.`,
    });

    await expect(
      routeDraftRequest("gemini", {
        apiKey: rawKey,
        model: "gemini-2.5-flash",
        prompt: "Test prompt",
        count: 1,
      }),
    ).rejects.toThrowError(/\[REDACTED\]/);
  });

  it("supports custom baseUrl when specified", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ questions: [] }) }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 10,
        },
      }),
    });

    await routeDraftRequest("gemini", {
      apiKey: "AIzaKey",
      model: "gemini-2.5-pro",
      prompt: "Test",
      count: 1,
      baseUrl: "https://custom-gateway.example.com/v1beta",
    });

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(call?.[0]).toBe("https://custom-gateway.example.com/v1beta/models/gemini-2.5-pro:generateContent");
  });
});
