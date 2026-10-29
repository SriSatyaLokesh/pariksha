import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testDeps, FIXED_NOW } from "../deps.js";
import { closeClient, newId } from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { setByokCredential } from "@pariksha/db";
import { encryptApiKey } from "../../src/byok/crypto.js";
import {
  seedTest,
  seedWorkspace,
  DAY,
  iso,
} from "./fixtures.js";
import { PAPER_FORM, seedBank } from "./paper-fixtures.js";
import {
  createCandidate,
  insertAuthToken,
  resolvePublishedTest,
  type AttemptPaper,
} from "@pariksha/db";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";

const T = FIXED_NOW;
const SLUG = { workspace: "audiocheck", test: "test-run" } as const;

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "AudioCheck Org");
const q = await seedBank(deps, workspaceId);

await seedTest(deps, workspaceId, {
  name: "Audio Check Test",
  slug: SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "strict" },
    },
    sections: [
      { id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

let serial = 1;
async function startAttempt(): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, SLUG.workspace, SLUG.test, T);
  if (!test) throw new Error("test not found");
  const candidateId = await createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: T,
  });
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: T,
    expiresAt: T + REGISTRATION_TTL_MS,
  });
  const res = await app.request(`/api/v1/run/${SLUG.workspace}/${SLUG.test}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start status ${res.status}`);
  const paper = (await res.json()) as AttemptPaper;
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    attemptId: paper.attemptId,
  };
}

const AUDIO_PATH = "/api/v1/run/attempt/audio-check";
const audioFixture = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);

describe("POST /api/v1/run/attempt/audio-check", () => {
  let attemptCookie = "";
  let attemptId = "";
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    globalThis.fetch = originalFetch;
    await deps.db.run("DELETE FROM byok_credential WHERE workspace_id = ?", [workspaceId]);
    await deps.db.run("DELETE FROM event", []);
    await deps.db.run("DELETE FROM attempt", []);
    const started = await startAttempt();
    attemptCookie = started.cookie;
    attemptId = started.attemptId;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses 401 when no attempt cookie is present", async () => {
    const res = await app.request(AUDIO_PATH, {
      method: "POST",
      headers: { "content-type": "audio/webm" },
      body: audioFixture,
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with provider none when no BYOK key is configured", async () => {
    const res = await app.request(AUDIO_PATH, {
      method: "POST",
      headers: {
        "content-type": "audio/webm",
        cookie: attemptCookie,
      },
      body: audioFixture,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      hasSpeech: false,
      transcript: "",
      provider: "none",
    });
  });

  it("evaluates audio using OpenAI Whisper and records speech_detected event", async () => {
    const encKey = await encryptApiKey("sk-openai-audio-key", deps.env.sessionSecret);
    await setByokCredential(deps.db, workspaceId, "openai", encKey, "sk-...audio");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "I need help with this question." }),
    });
    globalThis.fetch = mockFetch as any;

    const res = await app.request(AUDIO_PATH, {
      method: "POST",
      headers: {
        "content-type": "audio/webm",
        cookie: attemptCookie,
      },
      body: audioFixture,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      hasSpeech: true,
      transcript: "I need help with this question.",
      provider: "openai",
      model: "whisper-1",
    });

    // Verify event was recorded in DB
    const events = await deps.db.query<{ type: string; detail_json: string }>(
      "SELECT type, detail_json FROM event WHERE attempt_id = ?",
      [attemptId],
    );
    expect(events.length).toBeGreaterThan(0);
    const speechEvt = events.find((e) => e.type === "speech_detected");
    expect(speechEvt).toBeDefined();
    const detail = deps.db.jsonValue<{ transcript: string; source: string }>(speechEvt!.detail_json);
    expect(detail.transcript).toBe("I need help with this question.");
    expect(detail.source).toBe("byok");
  });

  it("refuses 413 when audio payload exceeds size limit", async () => {
    const bigPayload = new Uint8Array(600 * 1024); // 600 KB > 512 KB
    const res = await app.request(AUDIO_PATH, {
      method: "POST",
      headers: {
        "content-type": "audio/webm",
        cookie: attemptCookie,
      },
      body: bigPayload,
    });
    expect(res.status).toBe(413);
  });
});
