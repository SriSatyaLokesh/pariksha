import { describe, expect, it } from "vitest";
import { sqliteClient } from "@pariksha/db";
import { migrate } from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { parseEnv } from "../../src/env.js";
import { memoryAdapter } from "@pariksha/storage";
import { generateTotp } from "../../src/auth/password.js";

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
  });

  return { app, db, env };
}

describe("Password and TOTP Authentication Routes (Phase 10)", () => {
  it("registers a user, signs in, sets up TOTP and logs in with 2FA", async () => {
    const { app, db } = setupTestApp();
    await migrate(db);

    // 1. Register first instance user with email and password
    const regRes = await app.request("/api/v1/auth/password/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@pariksha.org",
        password: "SuperSecretPassword123!",
      }),
    });

    expect(regRes.status).toBe(201);
    const regData = (await regRes.json()) as { status: string };
    expect(regData.status).toBe("registered");
    const cookie = regRes.headers.get("set-cookie");
    expect(cookie).toContain("pk_session=");

    // 2. Reject bad password sign in
    const badLoginRes = await app.request("/api/v1/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@pariksha.org",
        password: "WrongPassword!",
      }),
    });
    expect(badLoginRes.status).toBe(401);

    // 3. Successful password sign in without TOTP
    const loginRes = await app.request("/api/v1/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@pariksha.org",
        password: "SuperSecretPassword123!",
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = (await loginRes.json()) as { status: string };
    expect(loginData.status).toBe("signed_in");
    const sessionCookie = loginRes.headers.get("set-cookie")!;

    // 4. Setup TOTP 2FA (requires session)
    const totpSetupRes = await app.request("/api/v1/auth/password/totp/setup", {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    expect(totpSetupRes.status).toBe(200);
    const setupData = (await totpSetupRes.json()) as { secret: string; uri: string };
    expect(setupData.secret).toHaveLength(32);
    expect(setupData.uri).toContain("otpauth://totp/Pariksha:admin%40pariksha.org");

    // 5. Verify and enable TOTP with invalid code -> 400
    const failVerifyRes = await app.request("/api/v1/auth/password/totp/verify", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(failVerifyRes.status).toBe(400);

    // 6. Verify and enable TOTP with correct code -> 200
    const validCode = generateTotp(setupData.secret, 1700000000000);
    const verifyRes = await app.request("/api/v1/auth/password/totp/verify", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: validCode }),
    });
    expect(verifyRes.status).toBe(200);
    expect((await verifyRes.json()) as { status: string }).toEqual({ status: "enabled" });

    // 7. Login now requires TOTP code
    const prompt2FaRes = await app.request("/api/v1/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@pariksha.org",
        password: "SuperSecretPassword123!",
      }),
    });
    expect(prompt2FaRes.status).toBe(200);
    expect((await prompt2FaRes.json()) as { status: string }).toEqual({
      status: "totp_required",
    });

    // 8. Login with invalid TOTP code -> 400
    const invalid2FaRes = await app.request("/api/v1/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@pariksha.org",
        password: "SuperSecretPassword123!",
        totpCode: "123123",
      }),
    });
    expect(invalid2FaRes.status).toBe(400);

    // 9. Login with valid TOTP code -> 200 signed_in
    const success2FaRes = await app.request("/api/v1/auth/password/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@pariksha.org",
        password: "SuperSecretPassword123!",
        totpCode: validCode,
      }),
    });
    expect(success2FaRes.status).toBe(200);
    expect((await success2FaRes.json()) as { status: string }).toEqual({
      status: "signed_in",
      returnTo: "/",
    });

    // 10. Disable TOTP with bad password -> 401
    const failDisableRes = await app.request("/api/v1/auth/password/totp/disable", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(failDisableRes.status).toBe(401);

    // 11. Disable TOTP with correct password -> 200
    const disableRes = await app.request("/api/v1/auth/password/totp/disable", {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "SuperSecretPassword123!" }),
    });
    expect(disableRes.status).toBe(200);
    expect((await disableRes.json()) as { status: string }).toEqual({
      status: "disabled",
    });
  });
});
