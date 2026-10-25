import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeClient, type DbClient } from "@pariksha/db";
import { parseEnv } from "../src/env.js";
import { createStaticHandler, startNodeServer } from "../src/node.js";

describe("Node server and static assets (Phase 10 Task 4)", () => {
  let tempDir: string;
  let staticDir: string;
  let activeDb: DbClient | null = null;
  let closeServer: (() => Promise<void>) | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pariksha-node-test-"));
    staticDir = path.join(tempDir, "dist");
    const assetsDir = path.join(staticDir, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });

    // Seed mock built assets
    fs.writeFileSync(path.join(staticDir, "index.html"), "<html><body>Landing</body></html>");
    fs.writeFileSync(path.join(staticDir, "admin.html"), "<html><body>Admin</body></html>");
    fs.writeFileSync(path.join(staticDir, "exam.html"), "<html><body>Exam</body></html>");
    fs.writeFileSync(path.join(assetsDir, "bundle.js"), "console.log('pariksha');");
    fs.writeFileSync(path.join(staticDir, "robots.txt"), "User-agent: *\nDisallow:");
  });

  afterEach(async () => {
    if (closeServer) {
      await closeServer();
      closeServer = null;
    }
    if (activeDb) {
      closeClient(activeDb);
      activeDb = null;
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("createStaticHandler serves static assets, rewritten pages, and SPA fallbacks", async () => {
    const handler = createStaticHandler(staticDir);

    // 1. Direct file
    const assetRes = await handler(new Request("http://localhost:8787/assets/bundle.js"));
    expect(assetRes).not.toBeNull();
    expect(assetRes?.status).toBe(200);
    expect(assetRes?.headers.get("content-type")).toContain("application/javascript");
    expect(assetRes?.headers.get("cache-control")).toContain("immutable");
    expect(await assetRes?.text()).toBe("console.log('pariksha');");

    // 2. Candidate exam URL
    const examRes = await handler(new Request("http://localhost:8787/acme-corp/frontend-eval"));
    expect(examRes).not.toBeNull();
    expect(examRes?.status).toBe(200);
    expect(await examRes?.text()).toContain("Exam");

    // 3. Admin routes
    const adminRes = await handler(new Request("http://localhost:8787/admin/tests"));
    expect(adminRes).not.toBeNull();
    expect(adminRes?.status).toBe(200);
    expect(await adminRes?.text()).toContain("Admin");

    // 4. SPA fallback
    const spaRes = await handler(new Request("http://localhost:8787/signin"));
    expect(spaRes).not.toBeNull();
    expect(spaRes?.status).toBe(200);
    expect(await spaRes?.text()).toContain("Landing");

    // 5. Missing asset with extension returns null (falls through to API router)
    const missingAsset = await handler(new Request("http://localhost:8787/assets/nonexistent.png"));
    expect(missingAsset).toBeNull();
  });

  it("startNodeServer boots with SQLite and serves both API and static files", async () => {
    const dbPath = path.join(tempDir, "test.db");
    const env = parseEnv(
      {
        SESSION_SECRET: "mock-session-secret-at-least-32-chars",
        DATABASE_URL: dbPath,
        STORAGE_DIR: path.join(tempDir, "storage"),
        PUBLIC_URL: "http://127.0.0.1:8788",
        PORT: "8788",
        STATIC_DIR: staticDir,
      },
      "node",
    );

    const serverInstance = await startNodeServer({ env, enableScheduler: false });
    closeServer = serverInstance.close;
    activeDb = serverInstance.deps.db;

    // Test API route
    const apiRes = await fetch("http://127.0.0.1:8788/api/v1/setup/status");
    expect(apiRes.status).toBe(200);
    const apiBody = (await apiRes.json()) as { providers: unknown[]; needed: boolean };
    expect(Array.isArray(apiBody.providers)).toBe(true);
    expect(apiBody.needed).toBe(true);

    // Test static route through HTTP
    const staticRes = await fetch("http://127.0.0.1:8788/assets/bundle.js");
    expect(staticRes.status).toBe(200);
    expect(await staticRes.text()).toBe("console.log('pariksha');");

    // Test exam URL rewrite through HTTP
    const candidateRes = await fetch("http://127.0.0.1:8788/acme/sample-test");
    expect(candidateRes.status).toBe(200);
    expect(await candidateRes.text()).toContain("Exam");
  });

  it("parseEnv parses S3 options correctly when provided", () => {
    const env = parseEnv(
      {
        SESSION_SECRET: "secret",
        DATABASE_URL: ":memory:",
        PUBLIC_URL: "http://localhost:8787",
        S3_ENDPOINT: "http://localhost:9000",
        S3_BUCKET: "pariksha",
        S3_ACCESS_KEY: "minioadmin",
        S3_SECRET_KEY: "minioadmin",
        S3_REGION: "us-east-1",
      },
      "node",
    );

    if (env.target !== "node") throw new Error("Expected node");
    expect(env.s3).toEqual({
      endpoint: "http://localhost:9000",
      bucket: "pariksha",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      region: "us-east-1",
    });
  });
});
