import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDeps } from "../deps.js";
import { closeClient, newId, createWorkspace } from "@pariksha/db";
import { setByokCredential } from "@pariksha/db";
import { encryptApiKey } from "../../src/byok/crypto.js";
import { evaluateByokAudio } from "../../src/byok/audio.js";

const { deps } = await testDeps();
const workspaceId = newId("wsp");
await createWorkspace(deps.db, workspaceId, { name: "BYOK Audio Test Org", slug: "byok-audio-test" });

afterAll(() => closeClient(deps.db));

const secret = deps.env.sessionSecret;
const dummyAudio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]); // webm header fixture

describe("BYOK Audio Evaluation (apps/api/src/byok/audio.ts)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    globalThis.fetch = originalFetch;
    await deps.db.run("DELETE FROM byok_credential WHERE workspace_id = ?", [workspaceId]);
    vi.restoreAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns none provider when no BYOK key is configured (fail-open)", async () => {
    const result = await evaluateByokAudio(deps, workspaceId, dummyAudio, "audio/webm");
    expect(result).toEqual({
      hasSpeech: false,
      transcript: "",
      provider: "none",
    });
  });

  it("calls OpenAI Whisper endpoint when OpenAI key is active and transcribes speech", async () => {
    const encKey = await encryptApiKey("sk-openai-test-key-12345", secret);
    await setByokCredential(
      deps.db,
      workspaceId,
      "openai",
      encKey,
      "sk-...12345",
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "The candidate answered question four." }),
    });
    globalThis.fetch = mockFetch as any;

    const result = await evaluateByokAudio(deps, workspaceId, dummyAudio, "audio/webm");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-openai-test-key-12345");

    expect(result).toEqual({
      hasSpeech: true,
      transcript: "The candidate answered question four.",
      provider: "openai",
      model: "whisper-1",
    });
  });

  it("calls Google Gemini endpoint when Gemini key is active", async () => {
    const encKey = await encryptApiKey("AIzaSy-gemini-test-key-789", secret);
    await setByokCredential(
      deps.db,
      workspaceId,
      "gemini",
      encKey,
      "AIza...-789",
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "Can you hear me clearly?" }],
            },
          },
        ],
      }),
    });
    globalThis.fetch = mockFetch as any;

    const result = await evaluateByokAudio(deps, workspaceId, dummyAudio, "audio/webm");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(url).toContain("key=AIzaSy-gemini-test-key-789");
    expect(init.method).toBe("POST");

    expect(result).toEqual({
      hasSpeech: true,
      transcript: "Can you hear me clearly?",
      provider: "gemini",
      model: "gemini-2.5-flash",
    });
  });

  it("fails open and does not throw when provider returns 500 error (AG1)", async () => {
    const encKey = await encryptApiKey("sk-openai-test-key-12345", secret);
    await setByokCredential(
      deps.db,
      workspaceId,
      "openai",
      encKey,
      "sk-...12345",
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    globalThis.fetch = mockFetch as any;

    const result = await evaluateByokAudio(deps, workspaceId, dummyAudio, "audio/webm");
    expect(result).toEqual({
      hasSpeech: false,
      transcript: "",
      provider: "openai",
    });
  });
});
