import { describe, expect, it, vi } from "vitest";
import { fetchLiveOpenRouterModels } from "../../src/byok/models.js";

describe("BYOK Models & Timeouts (#279)", () => {
  it("fetches OpenRouter models with an AbortSignal timeout signal", async () => {
    let capturedSignal: AbortSignal | undefined = undefined;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [{ id: "test/model", name: "Test Model", pricing: { prompt: "0.000001", completion: "0.000002" } }] }),
      });
    });

    const models = await fetchLiveOpenRouterModels();
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("test/model");
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });
});
