/**
 * BYOK Speech Evaluation Service (Issue #209 / Phase 8.5 / PRD P-06).
 *
 * Evaluates candidate ephemeral audio clips using the organisation's own
 * BYOK AI credentials (OpenAI Whisper or Google Gemini Multimodal Audio).
 *
 * Strict Compliance:
 * - ADR 0012: Zero audio retention. Audio bytes are processed in memory and never stored.
 * - AG1: Fail-open. Missing keys, network errors, or provider downtime never disrupt candidate exams.
 * - S-15: Tenant-isolated field-level decryption using workspace session secrets.
 */

import { listByokCredentials, getByokCredential } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { decryptApiKey } from "./crypto.js";
import type { ByokAudioResult } from "./types.js";

/**
 * Evaluates an ephemeral audio clip using an active workspace BYOK provider.
 */
export async function evaluateByokAudio(
  deps: AppDeps,
  workspaceId: string,
  audioBytes: Uint8Array,
  mimeType = "audio/webm",
): Promise<ByokAudioResult> {
  try {
    const openAiCred = await getByokCredential(deps.db, workspaceId, "openai");
    const geminiCred = await getByokCredential(deps.db, workspaceId, "gemini");

    const secretKey = deps.env.sessionSecret;

    // Preference: OpenAI Whisper, then Gemini Audio
    if (openAiCred && openAiCred.status === "active") {
      return await evaluateWithOpenAi(deps, workspaceId, openAiCred.encryptedKey, secretKey, audioBytes, mimeType);
    } else if (geminiCred && geminiCred.status === "active") {
      return await evaluateWithGemini(deps, workspaceId, geminiCred.encryptedKey, secretKey, audioBytes, mimeType);
    }

    return {
      hasSpeech: false,
      transcript: "",
      provider: "none",
    };
  } catch {
    // AG1: Fail-open backstop
    return {
      hasSpeech: false,
      transcript: "",
      provider: "none",
    };
  }
}

async function evaluateWithOpenAi(
  _deps: AppDeps,
  _workspaceId: string,
  encryptedKey: string,
  secretKey: string,
  audioBytes: Uint8Array,
  mimeType: string,
): Promise<ByokAudioResult> {
  try {
    const apiKey = await decryptApiKey(encryptedKey, secretKey);
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "wav";
    const formData = new FormData();
    const blob = new Blob([audioBytes as unknown as BlobPart], { type: mimeType });
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", "whisper-1");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      return { hasSpeech: false, transcript: "", provider: "openai" };
    }

    const data = (await res.json()) as { text?: string };
    const transcript = (data.text ?? "").trim();

    return {
      hasSpeech: transcript.length > 0,
      transcript,
      provider: "openai",
      model: "whisper-1",
    };
  } catch {
    return { hasSpeech: false, transcript: "", provider: "openai" };
  }
}

async function evaluateWithGemini(
  _deps: AppDeps,
  _workspaceId: string,
  encryptedKey: string,
  secretKey: string,
  audioBytes: Uint8Array,
  mimeType: string,
): Promise<ByokAudioResult> {
  try {
    const apiKey = await decryptApiKey(encryptedKey, secretKey);
    const base64Audio = Buffer.from(audioBytes).toString("base64");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || "audio/webm",
                data: base64Audio,
              },
            },
            {
              text: "Transcribe any human speech heard in this audio clip. If no speech is present, return empty text.",
            },
          ],
        },
      ],
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { hasSpeech: false, transcript: "", provider: "gemini" };
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return {
      hasSpeech: text.length > 0,
      transcript: text,
      provider: "gemini",
      model: "gemini-2.5-flash",
    };
  } catch {
    return { hasSpeech: false, transcript: "", provider: "gemini" };
  }
}
