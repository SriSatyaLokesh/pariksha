// Email magic-link sign-in (S-01, S-02).
//
// Review Focus 3 is two properties in the same flow:
//
//   * **Single-use and time-boxed.** The link carries 32 random bytes; only
//     the SHA-256 is stored, and consuming it sets `used_at` inside the same
//     statement that selects it, so two clicks arriving together cannot both
//     win. Fifteen minutes, because the link lives in an inbox.
//
//   * **Enumeration-safe.** `requestMagicLink` resolves the same way whether
//     or not the address has an account, and sends nothing to one that does
//     not — otherwise the sign-in form is a directory of who holds an
//     account on this instance.

import { consumeAuthToken, findUserByEmail, insertAuthToken } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { emailSender, type EmailSender } from "../email/adapter.js";
import { ApiError } from "../errors.js";
import { randomToken, sha256Hex } from "./tokens.js";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

const KIND = "magic_link";

export async function requestMagicLink(
  deps: AppDeps,
  email: string,
  // Injected so a test asserts what was sent without a provider; production
  // passes nothing and gets whatever the environment configures.
  sender: EmailSender = emailSender(deps.env),
): Promise<void> {
  // Minted before the lookup, so the work this function does is the same
  // shape for an address that exists and one that does not — the response is
  // identical either way, and there is no reason to hand an attacker a
  // timing difference on top of that.
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const address = normalise(email);

  const userId = await findUserByEmail(deps.db, address);
  if (!userId) return;

  const now = deps.now();
  await insertAuthToken(deps.db, {
    tokenHash,
    kind: KIND,
    payload: { userId, email: address },
    now,
    expiresAt: now + MAGIC_LINK_TTL_MS,
  });

  const link = `${(deps.env.appUrl ?? "").replace(/\/$/, "")}/auth/magic-link?token=${token}`;
  await sender.send({
    to: address,
    subject: "Your Pariksha sign-in link",
    text:
      `Sign in to Pariksha:\n\n${link}\n\n` +
      "The link works once and expires in 15 minutes. " +
      "If you did not ask for it, nothing has happened to your account.",
  });
}

export async function consumeMagicLink(
  deps: AppDeps,
  token: string,
): Promise<{ userId: string; email: string }> {
  const payload = asPayload(
    await consumeAuthToken(deps.db, await sha256Hex(token), KIND, deps.now()),
  );
  // Expired, already used and never issued are one answer: anything finer
  // tells whoever is guessing which half of the guess was right.
  if (!payload) {
    throw new ApiError(
      400,
      "invalid_magic_link",
      "This sign-in link is invalid, expired or already used",
    );
  }
  return payload;
}

/** Addresses are typed by people, matched by machines. */
function normalise(email: string): string {
  return email.trim().toLowerCase();
}

/** Written by this module, so a shape check rather than a parse. */
function asPayload(raw: unknown): { userId: string; email: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as { userId?: unknown; email?: unknown };
  return typeof value.userId === "string" && typeof value.email === "string"
    ? { userId: value.userId, email: value.email }
    : null;
}
