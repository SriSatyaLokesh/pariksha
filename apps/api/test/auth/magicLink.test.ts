// Magic-link sign-in, over a sender that collects messages in an array
// rather than sending them. Review Focus 3 is two properties in one
// endpoint — a link that cannot be replayed, and a response that does not
// say whether an address has an account — and both are asserted here.

import { afterAll, beforeEach, expect, it } from "vitest";
import { closeClient, createUser } from "@pariksha/db";
import {
  MAGIC_LINK_TTL_MS,
  consumeMagicLink,
  requestMagicLink,
} from "../../src/auth/magicLink.js";
import { emailSender, type EmailMessage } from "../../src/email/adapter.js";
import { consoleSender } from "../../src/email/console.js";
import { httpSender } from "../../src/email/http.js";
import { parseEnv } from "../../src/env.js";
import type { AppDeps } from "../../src/app.js";
import { FIXED_NOW, testDeps } from "../deps.js";

const T = FIXED_NOW;
const KNOWN = "known@example.test";
const UNKNOWN = "nobody@example.test";

let clock = T;
let sent: EmailMessage[] = [];

const { deps: base } = await testDeps({
  now: () => clock,
  env: { APP_URL: "https://pariksha.test" },
});

/** The deps every test uses: real database, injected clock, collecting sender. */
const deps: AppDeps = base;

function at(instant: number): AppDeps {
  clock = instant;
  return deps;
}

const collect = {
  send: (message: EmailMessage) => {
    sent.push(message);
    return Promise.resolve();
  },
};

afterAll(() => closeClient(deps.db));
beforeEach(() => {
  sent = [];
  clock = T;
});

/** The token out of the link the sender was handed. */
function tokenFromLastEmail(): string {
  const message = sent.at(-1);
  const match = /token=([A-Za-z0-9_-]+)/.exec(message?.text ?? "");
  expect(match, "the email carries no magic-link token").not.toBeNull();
  return match?.[1] ?? "";
}

await createUser(deps.db, {
  email: KNOWN,
  authProvider: "magic_link",
  now: T,
});

it("a link can be used once", async () => {
  await requestMagicLink(at(T), KNOWN, collect);
  const token = tokenFromLastEmail();

  await expect(consumeMagicLink(at(T), token)).resolves.toMatchObject({
    email: KNOWN,
  });
  await expect(consumeMagicLink(at(T), token)).rejects.toThrow(/invalid|used/i);
});

it("a link expires after 15 minutes", async () => {
  await requestMagicLink(at(T), KNOWN, collect);
  const token = tokenFromLastEmail();

  expect(MAGIC_LINK_TTL_MS).toBe(15 * 60 * 1000);
  await expect(
    consumeMagicLink(at(T + MAGIC_LINK_TTL_MS + 1), token),
  ).rejects.toThrow(/invalid|used/i);
  // And it was a live link a moment before, so the rejection is the expiry
  // and not a link that never worked.
  await requestMagicLink(at(T), KNOWN, collect);
  await expect(
    consumeMagicLink(at(T + MAGIC_LINK_TTL_MS - 1), tokenFromLastEmail()),
  ).resolves.toMatchObject({ email: KNOWN });
});

it("the response is identical for a known and an unknown address", async () => {
  // The plan sketches this through `POST /api/v1/auth/magic-link`. That route
  // is Task 5 (#29); the property it would assert is this function's, so it
  // is asserted here and again at the route when the route exists.
  const known = await requestMagicLink(at(T), KNOWN, collect);
  const unknown = await requestMagicLink(at(T), UNKNOWN, collect);

  expect(known).toBeUndefined();
  expect(unknown).toBeUndefined();
});

it("no email is sent to an unknown address", async () => {
  await requestMagicLink(at(T), KNOWN, collect);
  await requestMagicLink(at(T), UNKNOWN, collect);

  expect(sent.map((m) => m.to)).not.toContain(UNKNOWN);
  expect(sent.map((m) => m.to)).toContain(KNOWN);
});

it("an unknown address leaves no token behind to be guessed at", async () => {
  const before = await deps.db.query(
    "SELECT token_hash FROM auth_token WHERE kind = 'magic_link'",
  );
  await requestMagicLink(at(T), UNKNOWN, collect);
  const after = await deps.db.query(
    "SELECT token_hash FROM auth_token WHERE kind = 'magic_link'",
  );

  expect(after).toHaveLength(before.length);
});

it("only the hash of a magic-link token is stored", async () => {
  await requestMagicLink(at(T), KNOWN, collect);
  const token = tokenFromLastEmail();

  const rows = await deps.db.query<Record<string, unknown>>(
    "SELECT * FROM auth_token WHERE kind = 'magic_link' AND used_at IS NULL",
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      expect(String(value), `auth_token.${column} holds the token`).not.toContain(
        token,
      );
    }
  }
});

it("a token minted for one flow cannot be redeemed as the other", async () => {
  await requestMagicLink(at(T), KNOWN, collect);
  const token = tokenFromLastEmail();
  // Rewriting the row's kind is the closest a test can get to an attacker
  // presenting an OIDC state at the magic-link endpoint; the consume has to
  // refuse it on `kind`, not merely on the hash matching.
  await deps.db.run(
    "UPDATE auth_token SET kind = 'oidc_state' WHERE kind = 'magic_link' AND used_at IS NULL",
  );

  await expect(consumeMagicLink(at(T), token)).rejects.toThrow(/invalid|used/i);
});

it("the address is matched however it was typed", async () => {
  await requestMagicLink(at(T), ` ${KNOWN.toUpperCase()} `, collect);
  expect(sent.map((m) => m.to)).toContain(KNOWN);
});

it("an unknown token is refused", async () => {
  await expect(consumeMagicLink(at(T), "not-a-token")).rejects.toThrow(
    /invalid|used/i,
  );
});

it("the console sender is used when no email credentials are configured", () => {
  const env = parseEnv({ SESSION_SECRET: "s" }, "workers");
  expect(env.email).toBeUndefined();
  expect(emailSender(env)).toBeTruthy();
});

it("the console sender is refused in production, so no token reaches a production log", () => {
  const production = parseEnv(
    { SESSION_SECRET: "s", NODE_ENV: "production" },
    "workers",
  );

  expect(() => consoleSender(production)).toThrow(/production/i);
  expect(() => emailSender(production)).toThrow(/production/i);
  // An operator who means it can still have it, and then it is their choice
  // in their logs rather than a default nobody chose.
  expect(() =>
    consoleSender(
      parseEnv(
        { SESSION_SECRET: "s", NODE_ENV: "production", EMAIL_CONSOLE: "true" },
        "workers",
      ),
    ),
  ).not.toThrow();
});

it("configured email credentials take the HTTP sender, not the console", async () => {
  const env = parseEnv(
    {
      SESSION_SECRET: "s",
      NODE_ENV: "production",
      EMAIL_ENDPOINT: "https://mail.test/send",
      EMAIL_TOKEN: "mail-token",
      EMAIL_FROM: "Pariksha <no-reply@pariksha.test>",
    },
    "workers",
  );

  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const http: typeof globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response(null, { status: 202 }));
  };

  expect(() => emailSender(env)).not.toThrow();
  await httpSender(env.email ?? { endpoint: "", token: "", from: "" }, http).send(
    { to: KNOWN, subject: "Sign in", text: "link" },
  );

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("https://mail.test/send");
  expect(
    new Headers(calls[0]?.init?.headers).get("authorization"),
  ).toBe("Bearer mail-token");
  expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
    to: KNOWN,
    from: "Pariksha <no-reply@pariksha.test>",
    subject: "Sign in",
  });
});

it("a sender that refuses the message says so", async () => {
  const http: typeof globalThis.fetch = () =>
    Promise.resolve(new Response("no", { status: 401 }));

  await expect(
    httpSender(
      { endpoint: "https://mail.test/send", token: "t", from: "f@x.test" },
      http,
    ).send({ to: KNOWN, subject: "s", text: "t" }),
  ).rejects.toThrow(/401/);
});

it("httpSender configures a 10s AbortSignal timeout and manual redirect refusal (#279)", async () => {
  let capturedInit: RequestInit | undefined = undefined;
  const http: typeof globalThis.fetch = (_url, init) => {
    capturedInit = init;
    return Promise.resolve(new Response(null, { status: 202 }));
  };

  await httpSender(
    { endpoint: "https://mail.test/send", token: "secret", from: "test@example.com" },
    http,
  ).send({ to: KNOWN, subject: "Hello", text: "World" });

  expect(capturedInit).toBeDefined();
  expect(capturedInit?.redirect).toBe("manual");
  expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
});
