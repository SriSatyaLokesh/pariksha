import { afterAll, expect, it } from "vitest";
import {
  closeClient,
  getWorkspace,
  listBanks,
  listTests,
  getPublishedVersion,
  type DbClient,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";
import { createUser, addMembership, issueSession } from "@pariksha/db";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

function post(path: string, body: unknown = {}, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

it("provisions a demo workspace with owner session cookie and expected response", async () => {
  const res = await app.request("/api/v1/demo/provision", post("/api/v1/demo/provision", {}, {
    "x-forwarded-for": "10.0.0.1",
  }));

  expect(res.status).toBeLessThan(400);
  const data = (await res.json()) as {
    ok: boolean;
    workspace: { id: string; slug: string; isDemo: boolean };
  };

  expect(data.ok).toBe(true);
  expect(data.workspace.id).toMatch(/^wsp_/);
  expect(data.workspace.slug).toMatch(/^demo-/);
  expect(data.workspace.isDemo).toBe(true);

  // Checks session cookie is set
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  expect(setCookie).toContain("pk_session=");

  // Inspect database directly for workspace properties
  const ws = await getWorkspace(deps.db, data.workspace.id);
  expect(ws).not.toBeNull();
  expect(ws!.slug).toMatch(/^demo-/);
  const settings = ws!.settings as { is_demo?: boolean; expires_at?: number } | null;
  expect(settings?.is_demo).toBe(true);
  expect(settings?.expires_at).toBeGreaterThan(FIXED_NOW);
});

it("seeds sample question bank, published test with 3 sections, and 5 attempt rows with realistic flags", async () => {
  const res = await app.request("/api/v1/demo/provision", post("/api/v1/demo/provision", {}, {
    "x-forwarded-for": "10.0.0.2",
  }));
  expect(res.status).toBeLessThan(400);
  const { workspace } = (await res.json()) as {
    workspace: { id: string; slug: string; isDemo: boolean };
  };

  // 1. Question bank
  const banks = await listBanks(deps.db, workspace.id);
  expect(banks.length).toBeGreaterThanOrEqual(1);

  // 2. Published test with 3 sections
  const tests = await listTests(deps.db, workspace.id);
  expect(tests.length).toBeGreaterThanOrEqual(1);
  const publishedTest = tests.find((t) => t.status === "published");
  expect(publishedTest).toBeDefined();

  const version = await getPublishedVersion(deps.db, workspace.id, publishedTest!.id);
  expect(version).not.toBeNull();
  expect(version!.body.sections).toHaveLength(3);

  // 3. 5 attempts with clean, review, scoring_blocked flags
  const attempts = await deps.db.query<{
    id: string;
    flag: string;
    score_json: unknown;
  }>("SELECT id, flag, score_json FROM attempt WHERE workspace_id = ?", [workspace.id]);

  expect(attempts).toHaveLength(5);
  const flags = new Set(attempts.map((a) => a.flag));
  expect(flags.has("clean")).toBe(true);
  expect(flags.has("review")).toBe(true);
  expect(flags.has("scoring_blocked")).toBe(true);
});

it("the provision route stays within its declared budget (<= 12 subrequests)", async () => {
  const declaredBudget = ROUTE_BUDGETS["/api/v1/demo/provision"];
  expect(declaredBudget).toBeDefined();
  expect(declaredBudget).toBeLessThanOrEqual(12);

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    "/api/v1/demo/provision",
    post("/api/v1/demo/provision", {}, { "x-forwarded-for": "10.0.0.3" }),
  );
  expect(res.status).toBeLessThan(400);
  expect(counting.counts().total).toBeLessThanOrEqual(declaredBudget);
  expect(counting.counts().total).toBeLessThanOrEqual(12);
});

it("enforces rate limit of 5 requests per IP per hour", async () => {
  const ip = "192.168.1.100";
  // First 5 should succeed
  for (let i = 0; i < 5; i++) {
    const res = await app.request(
      "/api/v1/demo/provision",
      post("/api/v1/demo/provision", {}, { "x-forwarded-for": ip }),
    );
    expect(res.status, `Request ${i + 1} should succeed`).toBeLessThan(400);
  }

  // 6th request from same IP should be rate-limited (429)
  const res6 = await app.request(
    "/api/v1/demo/provision",
    post("/api/v1/demo/provision", {}, { "x-forwarded-for": ip }),
  );
  expect(res6.status).toBe(429);
  const body = (await res6.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("too_many_requests");

  // Request from another IP should still succeed
  const resOther = await app.request(
    "/api/v1/demo/provision",
    post("/api/v1/demo/provision", {}, { "x-forwarded-for": "192.168.1.101" }),
  );
  expect(resOther.status).toBeLessThan(400);
});

it("session cookie allows the evaluator to access the demo workspace as Owner", async () => {
  const res = await app.request(
    "/api/v1/demo/provision",
    post("/api/v1/demo/provision", {}, { "x-forwarded-for": "10.0.0.4" }),
  );
  expect(res.status).toBeLessThan(400);
  const { workspace } = (await res.json()) as {
    workspace: { id: string; slug: string; isDemo: boolean };
  };

  const cookieHeader = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  expect(cookieHeader).toContain("pk_session=");

  // Read workspace details
  const wsRes = await app.request(`/api/v1/workspaces/${workspace.id}`, {
    headers: { cookie: cookieHeader },
  });
  expect(wsRes.status).toBe(200);
  const wsBody = (await wsRes.json()) as { id: string; slug: string };
  expect(wsBody.id).toBe(workspace.id);
});

it("demo workspaces are blocked from registering webhooks (return 403)", async () => {
  // Provision a demo workspace
  const res = await app.request(
    "/api/v1/demo/provision",
    post("/api/v1/demo/provision", {}, { "x-forwarded-for": "10.0.0.5" }),
  );
  expect(res.status).toBeLessThan(400);
  const { workspace } = (await res.json()) as {
    workspace: { id: string; slug: string; isDemo: boolean };
  };
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";

  // Attempt to register a webhook in demo workspace
  const webhookRes = await app.request(
    `/api/v1/workspaces/${workspace.id}/webhooks`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://example.test/webhook",
        events: ["attempt.submitted"],
      }),
    },
  );

  expect(webhookRes.status).toBe(403);
  const webhookBody = (await webhookRes.json()) as { error?: { code?: string } };
  expect(webhookBody.error?.code).toBe("forbidden");
});
