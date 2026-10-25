import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { newId, createWorkspace, createBank, listQuestions } from "@pariksha/db";
import { createUser, addMembership } from "@pariksha/db";
import { createApp, type AppDeps } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import { testDeps, sessionCookie, FIXED_NOW } from "../deps.js";
import * as clientModule from "../../src/byok/client.js";

describe("BYOK HTTP Endpoints (Phase 12)", () => {
  let wspId: string;
  let bankId: string;
  let userId: string;
  let ownerCookie: string;
  let deps: AppDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const fixture = await testDeps({ target: "node" });
    deps = fixture.deps;
    app = createApp(deps);

    wspId = newId("wsp");
    await createWorkspace(deps.db, wspId, { name: "Org Byok", slug: "org-byok" });
    bankId = await createBank(deps.db, wspId, { name: "Exam Bank" });

    userId = await createUser(deps.db, {
      email: "owner@alpha.test",
      authProvider: "magic_link",
      now: FIXED_NOW,
    });
    await addMembership(deps.db, wspId, { userId, role: "owner", now: FIXED_NOW });

    const session = await issueSession(deps, userId);
    ownerCookie = await sessionCookie(deps, session.token);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /byok returns empty credentials initially and 200", async () => {
    const res = await app.request(`/api/v1/workspaces/${wspId}/byok`, {
      method: "GET",
      headers: { cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: unknown[]; usage: unknown };
    expect(body.credentials).toEqual([]);
    expect(body.usage).toBeDefined();
  });

  it("PUT /byok/:provider sets key, masks hint, and never leaks raw key", async () => {
    const rawKey = "sk-ant-api03-abcdefghijklmnop-1234";
    const res = await app.request(`/api/v1/workspaces/${wspId}/byok/anthropic`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: ownerCookie,
      },
      body: JSON.stringify({
        apiKey: rawKey,
        spendLimitCents: 2500,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { credential: { keyHint: string; spendLimitCents: number } };
    expect(body.credential.keyHint).toBe("sk-ant-...1234");
    expect(body.credential.spendLimitCents).toBe(2500);

    // Assert the response never leaks the raw key or ciphertext
    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain(rawKey);
    expect(rawJson).not.toContain("encryptedKey");

    // Check GET verifies the stored hint
    const getRes = await app.request(`/api/v1/workspaces/${wspId}/byok`, {
      headers: { cookie: ownerCookie },
    });
    const getBody = (await getRes.json()) as { credentials: Array<{ provider: string; keyHint: string }> };
    expect(getBody.credentials.length).toBe(1);
    expect(getBody.credentials[0]?.provider).toBe("anthropic");
    expect(getBody.credentials[0]?.keyHint).toBe("sk-ant-...1234");
  });

  it("DELETE /byok/:provider removes key and returns 204", async () => {
    await app.request(`/api/v1/workspaces/${wspId}/byok/openai`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ apiKey: "sk-proj-openai-key-5678" }),
    });

    const delRes = await app.request(`/api/v1/workspaces/${wspId}/byok/openai`, {
      method: "DELETE",
      headers: { cookie: ownerCookie },
    });
    expect(delRes.status).toBe(204);

    const getRes = await app.request(`/api/v1/workspaces/${wspId}/byok`, {
      headers: { cookie: ownerCookie },
    });
    const getBody = (await getRes.json()) as { credentials: unknown[] };
    expect(getBody.credentials).toEqual([]);
  });

  it("POST /banks/:bankId/draft-ai invokes drafting and returns drafted questions", async () => {
    // Set active key first
    await app.request(`/api/v1/workspaces/${wspId}/byok/anthropic`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ apiKey: "sk-ant-test-key-0001" }),
    });

    vi.spyOn(clientModule, "invokeAiDrafting").mockResolvedValue({
      questions: [
        {
          id: "Q1",
          type: "single",
          prompt: "What is the boiling point of water in Celsius?",
          options: [
            { id: "a", text: "100" },
            { id: "b", text: "0" },
          ],
          key: "a",
          scoring: { mode: "all_or_nothing", points: 1 },
        },
      ] as never,
      model: "claude-3-5-sonnet",
      usage: { promptTokens: 90, completionTokens: 40, estimatedCostCents: 1 },
    });

    const res = await app.request(`/api/v1/workspaces/${wspId}/banks/${bankId}/draft-ai`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({
        prompt: "Water boiling point",
        count: 1,
        provider: "anthropic",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { questions: unknown[]; usage: { promptTokens: number } };
    expect(body.questions.length).toBe(1);
    expect(body.usage.promptTokens).toBe(90);

    // Verify question is now in the bank
    const inBank = await listQuestions(deps.db, wspId, bankId);
    expect(inBank.rows.length).toBe(1);
    expect(inBank.rows[0]?.document.prompt).toBe("What is the boiling point of water in Celsius?");
  });

  it("POST /banks/:bankId/draft-ai returns 400 when no BYOK key is configured", async () => {
    const res = await app.request(`/api/v1/workspaces/${wspId}/banks/${bankId}/draft-ai`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({
        prompt: "Quantum physics",
        count: 1,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("missing_byok_key");
  });

  it("refuses unauthorized requests with 401 without cookie", async () => {
    const res = await app.request(`/api/v1/workspaces/${wspId}/byok`, {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });
});
