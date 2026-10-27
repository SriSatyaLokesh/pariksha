import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { newId, createWorkspace, createBank, listQuestions } from "@pariksha/db";
import { createUser, addMembership } from "@pariksha/db";
import { createApp, type AppDeps } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import { testDeps, sessionCookie, FIXED_NOW } from "../deps.js";
import * as routerModule from "../../src/byok/router.js";

describe("BYOK HTTP Endpoints (Phase 12)", () => {
  let wspId: string;
  let bankId: string;
  let ownerUserId: string;
  let authorUserId: string;
  let viewerUserId: string;
  let ownerCookie: string;
  let authorCookie: string;
  let viewerCookie: string;
  let deps: AppDeps;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const fixture = await testDeps({ target: "node" });
    deps = fixture.deps;
    app = createApp(deps);

    wspId = newId("wsp");
    await createWorkspace(deps.db, wspId, { name: "Org Byok", slug: "org-byok" });
    bankId = await createBank(deps.db, wspId, { name: "Exam Bank" });

    // Setup Owner
    ownerUserId = await createUser(deps.db, {
      email: "owner@alpha.test",
      authProvider: "magic_link",
      now: FIXED_NOW,
    });
    await addMembership(deps.db, wspId, { userId: ownerUserId, role: "owner", now: FIXED_NOW });
    const ownerSession = await issueSession(deps, ownerUserId);
    ownerCookie = await sessionCookie(deps, ownerSession.token);

    // Setup Author
    authorUserId = await createUser(deps.db, {
      email: "author@alpha.test",
      authProvider: "magic_link",
      now: FIXED_NOW,
    });
    await addMembership(deps.db, wspId, { userId: authorUserId, role: "author", now: FIXED_NOW });
    const authorSession = await issueSession(deps, authorUserId);
    authorCookie = await sessionCookie(deps, authorSession.token);

    // Setup Viewer
    viewerUserId = await createUser(deps.db, {
      email: "viewer@alpha.test",
      authProvider: "magic_link",
      now: FIXED_NOW,
    });
    await addMembership(deps.db, wspId, { userId: viewerUserId, role: "viewer", now: FIXED_NOW });
    const viewerSession = await issueSession(deps, viewerUserId);
    viewerCookie = await sessionCookie(deps, viewerSession.token);
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

  it("Two-step drafting: POST /draft-ai previews without writing, POST /draft-ai/commit inserts with unique q_... IDs", async () => {
    // 1. Setup workspace BYOK key
    await app.request(`/api/v1/workspaces/${wspId}/byok/anthropic`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ apiKey: "sk-ant-test-key-0001" }),
    });

    const mockAiQuestions = [
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
    ];

    vi.spyOn(routerModule, "routeDraftRequest").mockResolvedValue({
      questions: mockAiQuestions as never,
      model: "claude-3-5-sonnet-20241022",
      usage: { promptTokens: 90, completionTokens: 40, estimatedCostCents: 1 },
    });

    // Step 1: Preview via Author (Author holds banks.edit)
    const draftRes = await app.request(`/api/v1/workspaces/${wspId}/banks/${bankId}/draft-ai`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: authorCookie },
      body: JSON.stringify({
        prompt: "Water boiling point",
        count: 1,
        provider: "anthropic",
      }),
    });

    expect(draftRes.status).toBe(200);
    const draftBody = (await draftRes.json()) as {
      questions: Array<{ prompt: string }>;
      validationIssues: unknown[];
      usage: { promptTokens: number; estimatedCostCents: number };
    };
    expect(draftBody.questions).toHaveLength(1);
    expect(draftBody.questions[0]?.prompt).toBe("What is the boiling point of water in Celsius?");
    expect(draftBody.validationIssues).toEqual([]);
    expect(draftBody.usage.promptTokens).toBe(90);
    expect(draftBody.usage.estimatedCostCents).toBe(1);

    // Verify question is NOT yet in the bank (strictly computational preview)
    const inBankAfterPreview = await listQuestions(deps.db, wspId, bankId);
    expect(inBankAfterPreview.rows.length).toBe(0);

    // Step 2: Commit approved questions
    const commitRes = await app.request(`/api/v1/workspaces/${wspId}/banks/${bankId}/draft-ai/commit`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: authorCookie },
      body: JSON.stringify({
        questions: draftBody.questions,
      }),
    });

    expect(commitRes.status).toBe(201);
    const commitBody = (await commitRes.json()) as { importedCount: number; bankId: string };
    expect(commitBody.importedCount).toBe(1);
    expect(commitBody.bankId).toBe(bankId);

    // Verify question is now in the bank with a unique q_... ID
    const inBankAfterCommit = await listQuestions(deps.db, wspId, bankId);
    expect(inBankAfterCommit.rows.length).toBe(1);
    expect(inBankAfterCommit.rows[0]?.refId.startsWith("q_")).toBe(true);
    expect(inBankAfterCommit.rows[0]?.document.prompt).toBe("What is the boiling point of water in Celsius?");
  });

  it("Enforces RBAC permissions: banks.edit for drafting/commit, keys.manage for credentials", async () => {
    // Author has banks.edit but not keys.manage
    const authorKeyRes = await app.request(`/api/v1/workspaces/${wspId}/byok`, {
      method: "GET",
      headers: { cookie: authorCookie },
    });
    expect(authorKeyRes.status).toBe(403);

    // Viewer has neither banks.edit nor keys.manage
    const viewerKeyRes = await app.request(`/api/v1/workspaces/${wspId}/byok`, {
      method: "GET",
      headers: { cookie: viewerCookie },
    });
    expect(viewerKeyRes.status).toBe(403);

    const viewerDraftRes = await app.request(`/api/v1/workspaces/${wspId}/banks/${bankId}/draft-ai`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie },
      body: JSON.stringify({ prompt: "Test prompt" }),
    });
    expect(viewerDraftRes.status).toBe(403);

    const viewerCommitRes = await app.request(`/api/v1/workspaces/${wspId}/banks/${bankId}/draft-ai/commit`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie },
      body: JSON.stringify({ questions: [] }),
    });
    expect(viewerCommitRes.status).toBe(403);
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
