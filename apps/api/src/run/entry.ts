// The one currency all four access modes end in, and the words the gate
// refuses in.
//
// `link_code`, `invite_only`, `email_code` and `sso` are four different
// proofs of four different things, and the whole point of this module is
// that they stop being four as soon as they succeed: each mints a
// single-use `run_entry` token carrying the test version and, where the
// mode knows it, a verified email. Task 3 then has exactly one thing to
// check, and the four gates do not each grow their own session concept.
//
// The token is an `auth_token` row because `consumeAuthToken` is already
// the race-free single-use primitive all four need — one `UPDATE … WHERE
// used_at IS NULL AND expires_at > ? RETURNING`, with `kind` in the WHERE
// clause so a `run_invite` cannot be redeemed as a `run_entry`.
//
// Nothing here gives anyone a user row or a session cookie (ADR 0005).

import type { Context } from "hono";
import {
  consumeAuthToken,
  insertAuthToken,
  readAuthToken,
  resolvePublishedTest,
  type PublishedTest,
} from "@pariksha/db";
import { normaliseEmail } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";

/** Long enough to read the consent text and fill a registration form,
 *  short enough that a token left in a browser's history is dead. */
export const ENTRY_TTL_MS = 30 * 60_000;
/** `docs/test-format.md:69`. */
export const EMAIL_CODE_TTL_MS = 10 * 60_000;

export const ENTRY_KIND = "run_entry";
const OTP_KIND = "run_otp";
/** The token `/register` hands back and `/start` spends (Task 5). */
export const REGISTRATION_KIND = "run_registration";
/** Long enough to read a consent screen and press Start. */
export const REGISTRATION_TTL_MS = 30 * 60_000;

/**
 * An invite row's key: the token **salted with the test it was minted
 * for**.
 *
 * So a link minted for one test and presented at another matches no row
 * at all, and is refused *without* being spent — where a plain digest
 * would have been consumed by the failed attempt and the candidate it
 * belonged to would arrive to a dead link.
 */
export const inviteHash = (testId: string, token: string): Promise<string> =>
  sha256Hex(`${testId}:${token}`);

/**
 * An entry row's key: the token **salted with the test version it was
 * minted for**, exactly as `inviteHash` salts an invite with its test.
 *
 * Without it (Task 2 review, T2-I-1) a candidate who passed any open
 * `link_code` test held a row that matched at every other test on the
 * instance, and `asClaim` compared `testVersionId` to nothing — so the
 * gate on an `invite_only` or `sso` test became decorative the moment
 * anything consumed an entry token. Inert until this task; this task is
 * the first consumer.
 *
 * Belt and braces, deliberately: the salt means a token minted elsewhere
 * matches **no row at all** (so it is refused without being spent, and the
 * candidate it belongs to still has a live link), and the comparison in
 * `asClaim` means that even a row found some other way is checked against
 * the test that is answering.
 */
export const entryHash = (testVersionId: string, token: string): Promise<string> =>
  sha256Hex(`${testVersionId}:${token}`);

/** The same shape for the registration token `/start` spends. */
export const registrationHash = (testVersionId: string, token: string): Promise<string> =>
  sha256Hex(`${testVersionId}:${token}`);

export interface EntryClaim {
  testVersionId: string;
  workspaceId: string;
  /** Present when the mode verified one: `email_code` and `sso` always,
   *  `invite_only` when the list row's prefill carried one. */
  email?: string;
  /** The `candidate` row (`source: "list"`) this entry is already bound
   *  to, when the mode knew it. Task 3 reconciles the registration with
   *  that row rather than inserting beside it. */
  listRef?: string;
}

/**
 * The refusals the gate answers with, as data rather than as strings
 * scattered through a switch.
 *
 * `C-02` is "errors say what to do next", which is a property of a
 * sentence and therefore only testable if the sentences are enumerable —
 * so a refusal added without an actionable verb fails
 * `test/run/access.test.ts` rather than shipping.
 *
 * `code_wrong` is deliberately *also* what an identifier absent from the
 * candidate list gets, byte for byte. A gate that distinguished them
 * would answer "that identifier is not on the list" to anyone who types
 * one, which is an enumeration oracle over an organiser's roll numbers
 * (`S-10`).
 */
export const REFUSALS = {
  code_wrong: {
    status: 403,
    code: "code_wrong",
    message: "That did not work. Check the access code with your organiser and try again.",
  },
  code_expired: {
    status: 401,
    code: "code_expired",
    message: "That code is wrong or has expired. Ask for a new one, then try again.",
  },
  invite_used: {
    status: 410,
    code: "invite_used",
    message: "This invite link was already used. Contact the organiser.",
  },
  domain_not_allowed: {
    status: 403,
    code: "domain_not_allowed",
    message: "This test only accepts certain email addresses. Check which address to use with your organiser.",
  },
  ip_not_allowed: {
    status: 403,
    code: "ip_not_allowed",
    message: "This test can only be taken from the exam network. Ask your organiser which network to use.",
  },
  window_closed: {
    status: 403,
    code: "window_closed",
    message: "This test is not open right now. Check the start time with your organiser.",
  },
  /** `S-07`'s volume defence, answered in place of whatever the caller
   *  was actually refused for once the bucket is empty — which is why the
   *  sentence names the only thing that helps. */
  too_many_attempts: {
    status: 429,
    code: "too_many_attempts",
    message: "Too many attempts from this test just now. Wait a minute and try again.",
  },
  /** The `run_entry` token is single use and short-lived: a replayed
   *  registration, a reloaded tab an hour later, a link out of a browser
   *  history. All one answer, because none of them is distinguishable to
   *  the person holding it. */
  entry_expired: {
    status: 410,
    code: "entry_expired",
    message: "This registration link is no longer valid. Go back to the test page and try again.",
  },
} as const satisfies Record<string, { status: number; code: string; message: string }>;

export type RefusalCode = keyof typeof REFUSALS;

/**
 * One refusal as a thrown error. `extra` is appended to the message and is
 * never anything the candidate has not already proved they may know: the
 * domain rule is named because a candidate typed the address it refused,
 * and nothing else takes one.
 */
export function refuse(code: RefusalCode, extra = ""): ApiError {
  const refusal = REFUSALS[code];
  return new ApiError(refusal.status, refusal.code, refusal.message + extra);
}

/**
 * Whether two secrets are the same, without a comparison whose running
 * time depends on how much of the first one was right.
 *
 * Digest-then-compare rather than a hand-rolled XOR loop: both digests are
 * 64 hex characters whatever the inputs were, so `===` reads a fixed
 * length, and an early exit leaks a prefix of a SHA-256 rather than a
 * prefix of the code.
 */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return left === right;
}

export async function issueEntryToken(deps: AppDeps, claim: EntryClaim): Promise<string> {
  const token = randomToken();
  const now = deps.now();
  await insertAuthToken(deps.db, {
    tokenHash: await entryHash(claim.testVersionId, token),
    kind: ENTRY_KIND,
    payload: claim,
    now,
    expiresAt: now + ENTRY_TTL_MS,
  });
  return token;
}

/** Reads without consuming. Task 3 consumes it in the same batch as the
 *  write, so a refreshed registration page does not burn the token. */
export async function readEntryToken(
  deps: AppDeps,
  testVersionId: string,
  token: string,
): Promise<EntryClaim | null> {
  const raw = await readAuthToken(
    deps.db,
    await entryHash(testVersionId, token),
    ENTRY_KIND,
    deps.now(),
  );
  return asClaim(raw, testVersionId);
}

export async function consumeEntryToken(
  deps: AppDeps,
  testVersionId: string,
  token: string,
): Promise<EntryClaim | null> {
  const raw = await consumeAuthToken(
    deps.db,
    await entryHash(testVersionId, token),
    ENTRY_KIND,
    deps.now(),
  );
  return asClaim(raw, testVersionId);
}

/**
 * The email-code row's key, and the reason no six-digit string is ever
 * stored: the row is looked up *by* `sha256(testVersionId:email:code)`, so
 * a database dump holds a digest of a tuple the reader does not have and
 * cannot invert — there is no column a code could be read out of. The
 * address and the test version are inside the digest, which is also what
 * binds a code to the address it was sent to and the test it was asked
 * for: a code minted elsewhere simply hashes to a row that is not there.
 */
export function emailCodeHash(testVersionId: string, email: string, code: string): Promise<string> {
  // `normaliseEmail`, not `.toLowerCase()`, and this is the whole of Task
  // 2's review finding T2-I-2: issuing hashed the address **as typed**
  // while redeeming hashed it trimmed, so a candidate who pasted their
  // address with a trailing space was refused forever by a code that was
  // correct and no retry could fix it. The general form is that every
  // address reaching a digest goes through the one function
  // `normaliseUniqueValue` also delegates to — `.trim()` at one call site
  // would have been the instance.
  return sha256Hex(`${testVersionId}:${normaliseEmail(email)}:${code}`);
}

/** Six digits, uniformly, from the CSPRNG — not `Math.random()`, and not
 *  a modulo of one byte, which would make the leading digit uneven. */
export function sixDigitCode(): string {
  const bytes = new Uint32Array(1);
  do {
    crypto.getRandomValues(bytes);
    // 4_294_000_000 is the largest multiple of 1e6 below 2^32; a draw
    // above it is discarded rather than folded, so every code is equally
    // likely. One extra draw in roughly 1.5 million.
  } while ((bytes[0] ?? 0) >= 4_294_000_000);
  return String((bytes[0] ?? 0) % 1_000_000).padStart(6, "0");
}

export async function issueEmailCode(
  deps: AppDeps,
  input: { testVersionId: string; workspaceId: string; email: string },
): Promise<string> {
  const code = sixDigitCode();
  const now = deps.now();
  await insertAuthToken(deps.db, {
    tokenHash: await emailCodeHash(input.testVersionId, input.email, code),
    kind: OTP_KIND,
    // No code, and no address beyond the one already inside the hash —
    // the payload is what the gate needs after a successful redemption.
    payload: { workspaceId: input.workspaceId, email: input.email.toLowerCase() },
    now,
    expiresAt: now + EMAIL_CODE_TTL_MS,
  });
  return code;
}

/** Spends the code, or `null` for wrong, expired, already used and never
 *  issued alike — the four are one answer because a caller that could tell
 *  them apart could count how many codes an address has been sent. */
export async function consumeEmailCode(
  deps: AppDeps,
  input: { testVersionId: string; email: string; code: string },
): Promise<boolean> {
  const payload = await consumeAuthToken(
    deps.db,
    await emailCodeHash(input.testVersionId, input.email, input.code),
    OTP_KIND,
    deps.now(),
  );
  return payload !== null;
}

/** The row was written by this module, so this is a shape check, not a
 *  parse — the same posture `oidc.ts`'s `asStatePayload` takes. */
function asClaim(raw: unknown, testVersionId: string): EntryClaim | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<EntryClaim>;
  return value.testVersionId === testVersionId && typeof value.workspaceId === "string"
    ? (value as EntryClaim)
    : null;
}

/**
 * The published, currently open test the two slugs name — every candidate
 * route's shared precondition, stated once because three route modules
 * need exactly the same answer and a second copy would be a second
 * posture.
 *
 * Draft, archived and absent are one 404 — the landing route's own
 * posture, for the same reason: a candidate holds no credential that
 * could distinguish them. Scheduled and closed are a refusal rather than
 * a 404, because the landing page already told the candidate the window
 * and the gate must agree with it.
 */
export async function openTest(
  deps: AppDeps,
  c: Context<AppBindings>,
): Promise<PublishedTest> {
  const test = await resolvePublishedTest(
    deps.db,
    c.req.param("workspaceSlug") ?? "",
    c.req.param("testSlug") ?? "",
    deps.now(),
  );
  if (!test || test.state === "draft" || test.state === "archived") {
    throw new ApiError(404, "not_found", "No such resource.");
  }
  if (test.state !== "open") throw refuse("window_closed");
  return test;
}
