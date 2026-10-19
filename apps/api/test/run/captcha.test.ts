// The hosted-captcha seam: shipped, wired, and off by default (#68, P6.4,
// ADR 0009).
//
// Two properties are load-bearing and pull in opposite directions, so
// both are asserted end to end rather than on the functions alone:
// an instance that configured nothing registers candidates normally
// (`AC-01` — thirty minutes, no paid service), and an instance that
// configured a provider refuses a registration the provider rejected.

import { afterAll, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { closeClient, listCandidates, resolvePublishedTest } from "@pariksha/db";
import { createApp, type AppDeps } from "../../src/app.js";
import { captchaConfigured, captchaRequired, verifyCaptcha } from "../../src/run/captcha.js";
import { POW_DIFFICULTY_BITS } from "../../src/run/pow.js";
import { parseEnv } from "../../src/env.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedPublishedTest } from "./fixtures.js";

const VERIFY_URL = "https://captcha.example/siteverify";
const SECRET = "cap-secret-value";
/** A site key is the *public* half. It must never leave the browser's
 *  side of the seam, so the verification body is asserted free of it. */
const SITE_KEY = "0x4AAAAAAApublicsitekey";

const { deps: plain } = await testDeps();
const workspaceId = await seedPublishedTest(plain);

afterAll(() => closeClient(plain.db));

/** The same database and clock, told about a provider. */
const withCaptcha = (http: typeof globalThis.fetch): AppDeps => ({
  ...plain,
  env: parseEnv(
    {
      SESSION_SECRET: "test-session-secret",
      CAPTCHA_SECRET: SECRET,
      CAPTCHA_VERIFY_URL: VERIFY_URL,
    },
    "workers",
  ),
  http,
});

const answers = (body: unknown, ok = true): typeof globalThis.fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status: ok ? 200 : 500 }))) as
    typeof globalThis.fetch;

const recorder = (
  body: unknown,
): { http: typeof globalThis.fetch; calls: { url: string; init: RequestInit }[] } => {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = ((url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as unknown as typeof globalThis.fetch;
  return { http, calls };
};

const testIdOf = async (slug: string): Promise<string> => {
  const test = await resolvePublishedTest(plain.db, "alpha", slug, FIXED_NOW);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  return test.testId;
};

const countCandidates = async (slug: string): Promise<number> =>
  (await listCandidates(plain.db, workspaceId, await testIdOf(slug))).filter(
    (row) => row.registeredAt !== null,
  ).length;

const VALID = {
  roll: "21CS0147",
  email: "ananya@vce.ac.in",
  full_name: "Ananya",
  cgpa: 9.1,
  consent: true,
};

function solve(challenge: string): string {
  const prefix = "0".repeat(POW_DIFFICULTY_BITS >> 2);
  for (let i = 0; ; i++) {
    if (createHash("sha256").update(`${challenge}:${String(i)}`).digest("hex").startsWith(prefix)) {
      return String(i);
    }
  }
}

/** Gate, challenge, solve and register — on whichever instance is given. */
async function registerOn(
  instance: AppDeps,
  body: Record<string, unknown> = {},
  withSolution = true,
): Promise<Response> {
  const app = createApp(instance);
  const gated = await app.request("/api/v1/run/alpha/signup/access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "OPENSESAME" }),
  });
  const { entryToken } = (await gated.json()) as { entryToken: string };
  const challenged = await app.request("/api/v1/run/alpha/signup/challenge", {
    headers: { authorization: `Bearer ${entryToken}` },
  });
  const { challenge } = (await challenged.json()) as { challenge: string };
  return app.request("/api/v1/run/alpha/signup/register", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${entryToken}` },
    body: JSON.stringify({
      values: VALID,
      ...(withSolution ? { solution: solve(challenge) } : {}),
      ...body,
    }),
  });
}

beforeEach(async () => {
  await plain.db.run("DELETE FROM candidate_unique", []);
  await plain.db.run("DELETE FROM auth_token", []);
  await plain.db.run("DELETE FROM rate_limit", []);
  await plain.db.run("DELETE FROM candidate WHERE test_id = ?", [await testIdOf("signup")]);
});

it("AC-01: an instance with no captcha configured registers normally", async () => {
  expect(captchaConfigured(plain)).toBe(false);
  expect((await registerOn(plain)).status).toBe(201);
  expect(await countCandidates("signup")).toBe(1);
});

it("AC-01: verifyCaptcha resolves true when nothing is configured, and reaches no network", async () => {
  const { http, calls } = recorder({ success: false });
  expect(await verifyCaptcha({ ...plain, http }, undefined)).toBe(true);
  expect(calls).toEqual([]);
});

it("with a secret configured, a failed token is 403 and writes no candidate", async () => {
  const res = await registerOn(withCaptcha(answers({ success: false })), { captchaToken: "x" });
  expect(res.status).toBe(403);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bot_check_failed");
  expect(await countCandidates("signup")).toBe(0);
});

it("with a secret configured, a missing token is 403 before any call is made", async () => {
  const { http, calls } = recorder({ success: true });
  const res = await registerOn(withCaptcha(http));
  expect(res.status).toBe(403);
  expect(calls).toEqual([]);
  expect(await countCandidates("signup")).toBe(0);
});

it("with a secret configured, a token the provider accepts registers", async () => {
  const res = await registerOn(withCaptcha(answers({ success: true })), { captchaToken: "ok" });
  expect(res.status).toBe(201);
  expect(await countCandidates("signup")).toBe(1);
});

it("the verification goes through deps.http and sends the secret, never the site key", async () => {
  const { http, calls } = recorder({ success: true });
  expect(await verifyCaptcha(withCaptcha(http), "tok")).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe(VERIFY_URL);
  expect(String(calls[0]?.init.body)).toContain(`secret=${SECRET}`);
  expect(String(calls[0]?.init.body)).toContain("response=tok");
  expect(String(calls[0]?.init.body)).not.toContain(SITE_KEY);
});

it("S-07: the candidate's IP is never sent to the provider — a whole campus shares one", async () => {
  const { http, calls } = recorder({ success: true });
  await verifyCaptcha(withCaptcha(http), "tok");
  expect(String(calls[0]?.init.body)).not.toContain("remoteip");
});

it("a provider that answers unreadably, errors or 500s fails closed", async () => {
  expect(await verifyCaptcha(withCaptcha(answers({ success: true }, false)), "tok")).toBe(false);
  expect(await verifyCaptcha(withCaptcha(answers({ ok: "yes" })), "tok")).toBe(false);
  const dead = (() => Promise.reject(new Error("offline"))) as unknown as typeof globalThis.fetch;
  expect(await verifyCaptcha(withCaptcha(dead), "tok")).toBe(false);
});

it("access.captcha=false turns it off for that test even when configured", () => {
  const configured = withCaptcha(answers({ success: true }));
  expect(captchaRequired(configured, { mode: "link_code", access_code: "x", captcha: false })).toBe(
    false,
  );
  // Absent means on, not off: the builder's `?? true` is a UI default and
  // a stored test may simply omit the key (reconciliation row 6).
  expect(captchaRequired(configured, { mode: "link_code", access_code: "x" })).toBe(true);
  expect(captchaRequired(configured, undefined)).toBe(true);
  // And never on an instance with no provider, whatever the test says.
  expect(captchaRequired(plain, { mode: "link_code", access_code: "x" })).toBe(false);
});

it("the proof of work still applies on an instance that also configured a captcha", async () => {
  const res = await registerOn(
    withCaptcha(answers({ success: true })),
    { captchaToken: "ok" },
    false,
  );
  expect(res.status).toBe(403);
  expect(await countCandidates("signup")).toBe(0);
});

it("S-11: configuring a provider is the only thing that names a third-party origin", () => {
  // The URL is configuration, so no provider hostname exists in the
  // shipped source at all — which is what keeps the default deployment's
  // CSP at `'self'` without an exception list.
  expect(plain.env.captcha).toBeUndefined();
  expect(withCaptcha(answers({ success: true })).env.captcha?.verifyUrl).toBe(VERIFY_URL);
});
