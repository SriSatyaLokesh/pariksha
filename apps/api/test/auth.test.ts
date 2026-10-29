import { describe, expect, it } from "vitest";
import { sqliteClient, migrate } from "@pariksha/db";
import { memoryAdapter } from "@pariksha/storage";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/env.js";
import { sha256Hex } from "../src/auth/tokens.js";
import { normaliseEmail } from "@pariksha/core";

function setupTestApp() {
  const db = sqliteClient(":memory:");
  const env = parseEnv(
    {
      SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
      DATABASE_URL: ":memory:",
      STORAGE_DIR: "./tmp-storage",
      PUBLIC_URL: "http://localhost:8787",
      PORT: "8787",
    },
    "node",
  );

  const app = createApp({
    db,
    storage: memoryAdapter(),
    now: () => 1700000000000,
    env,
    email: {
      send: async () => {},
    },
  });

  return { app, db, env };
}

describe("Organiser Authentication Rate Limiting & Throttling (#278)", () => {
  it("throttles POST /magic-link to 5 requests per 10 minutes per address and hashes email key", async () => {
    const { app, db } = setupTestApp();
    await migrate(db);

    const email = "Organiser@Example.COM";

    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/v1/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      expect(res.status).toBe(202);
    }

    // 6th request should be rate limited (429)
    const rateLimitedRes = await app.request("/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(rateLimitedRes.status).toBe(429);
    const body = (await rateLimitedRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe("too_many_attempts");

    // Verify rate_limit table contains sha256Hex(normaliseEmail(email)) and NOT plaintext email
    const rows = await db.all<{ bucket: string }>("SELECT bucket FROM rate_limit");
    expect(rows.length).toBeGreaterThan(0);
    const expectedHash = await sha256Hex(normaliseEmail(email));
    for (const row of rows) {
      expect(row.bucket).not.toContain("Organiser");
      expect(row.bucket).not.toContain("example.com");
    }
    expect(rows.some((r) => r.bucket.includes(expectedHash))).toBe(true);
  });

  it("throttles failed password signin to 5 misses per 15 minutes, allows honest signin", async () => {
    const { app, db } = setupTestApp();
    await migrate(db);

    const email = "host@pariksha.org";
    const password = "CorrectPassword123!";

    // Register user
    const regRes = await app.request("/api/v1/auth/password/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(regRes.status).toBe(201);

    // 5 failed password attempts
    for (let i = 0; i < 5; i++) {
      const failRes = await app.request("/api/v1/auth/password/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "WrongPassword!" }),
      });
      expect(failRes.status).toBe(401);
    }

    // 6th attempt is throttled with 429
    const blockedRes = await app.request("/api/v1/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "WrongPassword!" }),
    });
    expect(blockedRes.status).toBe(429);
    const blockedBody = (await blockedRes.json()) as { error: { code: string } };
    expect(blockedBody.error.code).toBe("too_many_attempts");

    // Even correct password is now blocked by the bucket
    const honestBlockedRes = await app.request("/api/v1/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(honestBlockedRes.status).toBe(429);
  });

  it("does not charge rate limit on successful password signins", async () => {
    const { app, db } = setupTestApp();
    await migrate(db);

    const email = "honest@pariksha.org";
    const password = "ValidPassword123!";

    await app.request("/api/v1/auth/password/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    // 10 successful logins in a row without hitting rate limit
    for (let i = 0; i < 10; i++) {
      const okRes = await app.request("/api/v1/auth/password/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      expect(okRes.status).toBe(200);
    }
  });

  it("throttles failed TOTP verification attempts to 5 misses per 5 minutes", async () => {
    const { app, db } = setupTestApp();
    await migrate(db);

    const email = "totp-user@pariksha.org";
    const password = "StrongPassword123!";

    // Register
    const regRes = await app.request("/api/v1/auth/password/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = regRes.headers.get("set-cookie")!;

    // Setup TOTP
    const setupRes = await app.request("/api/v1/auth/password/totp/setup", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(setupRes.status).toBe(200);

    // 5 invalid TOTP attempts
    for (let i = 0; i < 5; i++) {
      const failRes = await app.request("/api/v1/auth/password/totp/verify", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ code: "000000" }),
      });
      expect(failRes.status).toBe(400);
    }

    // 6th invalid attempt is throttled with 429
    const blockedRes = await app.request("/api/v1/auth/password/totp/verify", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(blockedRes.status).toBe(429);
    const body = (await blockedRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe("too_many_attempts");
  });
});
