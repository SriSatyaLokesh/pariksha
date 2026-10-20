// `C-09`: the candidate who comes back a week later (#75, P6.11).
//
// The attempt cookie is gone — it outlives the deadline by an hour and
// not by a week — so the candidate holds two things: the `att_` reference
// printed on their receipt, and the email address they registered with.
// Neither is a credential on its own. The reference is printed on a piece
// of paper and the address is not a secret, so what actually opens the
// result is the **third** thing: a six-digit code sent to that address,
// good once and for ten minutes.
//
// Three properties hold the whole design up:
//
//   * **One gate.** `resultFor` is the same function the finish page and
//     `GET /attempt/result` call. A second copy of the `show` ladder here
//     is exactly how a review leaks into a level that may not carry one.
//   * **The two routes answer the same bytes whatever is behind them.** A
//     reference that names nothing, a reference belonging to somebody
//     else, and a right reference with the wrong address all answer
//     `202 {"status":"sent"}` and send nothing — so neither route
//     enumerates attempts or confirms that an address sat a test. "The
//     same bytes" and not "identically": only the real pair pays
//     `insertAuthToken` and `email.send`, so the two differ in *time*.
//     Inherent to the shape, and the same shape `/email-code` already
//     has — closing it would mean doing the work on a miss too.
//   * **Both are rate-limited before they read anything**, by the
//     reference *and* by the address: the first bounds guessing, the
//     second bounds using this as a mailbomb aimed at a third party.

import { z } from "zod";
import { Hono } from "hono";
import {
  consumeAuthToken,
  findAttemptByReference,
  insertAuthToken,
  type AttemptReference,
} from "@pariksha/db";
import { normaliseEmail, type RegistrationFormSpec } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { sha256Hex } from "../auth/tokens.js";
import { emailSender } from "../email/adapter.js";
import { emailOf } from "../import/candidates.js";
import { sameSecret, sixDigitCode } from "./entry.js";
import { limitOrThrow } from "./limit.js";
import { resultFor } from "./submit.js";
import type { PinnedLayout } from "./attempt.js";

/** The `auth_token.kind` for a result code. In `consumeAuthToken`'s
 *  `WHERE`, so an entry code cannot be redeemed as a result code. */
export const RESULT_KIND = "run_result";

/** Ten minutes — the same lifetime as the access code, and the window the
 *  address rate limiter is sized to. */
export const RESULT_CODE_TTL_MS = 10 * 60_000;

const codeRequest = z.object({
  attemptRef: z.string().min(1).max(100),
  email: z.string().min(3).max(320),
});

const verifyRequest = codeRequest.extend({ code: z.string().min(1).max(20) });

/**
 * Salted with the reference **and** the address, so a code minted for one
 * attempt cannot open another and a code minted for one address cannot be
 * redeemed by a second. Both are normalised exactly as they are compared.
 */
const resultCodeHash = (attemptRef: string, email: string, code: string): Promise<string> =>
  sha256Hex(`${RESULT_KIND}:${attemptRef}:${normaliseEmail(email)}:${code.trim()}`);

/**
 * Whether `email` is the address this attempt's candidate registered
 * with. Compared in memory and in constant time rather than in the
 * `WHERE` clause: the address lives inside `form_values_json` under a
 * field id the test's own form decides, which no portable SQL can reach —
 * and comparing here is what lets the route answer the same bytes whether
 * the reference existed or not.
 */
async function addressMatches(found: AttemptReference, email: string): Promise<boolean> {
  const form = (found.settings as { registration_form?: RegistrationFormSpec }).registration_form;
  const registered = emailOf({ externalId: found.externalId, formValues: found.formValues }, form);
  if (registered === null) return false;
  return sameSecret(normaliseEmail(email), normaliseEmail(registered));
}

/** A malformed request, which is not a refusal: "you sent nothing" says
 *  nothing about the secret, so it may be said plainly — and it is what
 *  the `public` reachability probes answer, which must not write a row. */
const incomplete = (message: string): ApiError =>
  new ApiError(400, "invalid_request", message);

export function resultRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/result/code", async (c) => {
    const parsed = codeRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw incomplete("Enter the reference from your receipt and the email address you registered with.");
    }
    const { attemptRef, email } = parsed.data;
    const now = deps.now();

    // Charged **before** the read, and on every request rather than on
    // misses alone: here the request *is* the cost, the way
    // `/email-code`'s is. The reference bucket bounds guessing an
    // address for one receipt; the address bucket bounds bombing one
    // inbox, and is keyed by a digest so no address is written in the
    // clear (`S-15`).
    await limitOrThrow(deps, "result_code", attemptRef);
    await limitOrThrow(deps, "email_code_address", await sha256Hex(normaliseEmail(email)));

    const found = await findAttemptByReference(deps.db, attemptRef);
    // Unknown reference, an attempt that was never submitted, and the
    // wrong address are **one answer**, and it is the same answer a real
    // one gets. Only the real one sends a message.
    if (found !== null && found.submittedAt !== null && (await addressMatches(found, email))) {
      const code = sixDigitCode();
      await insertAuthToken(deps.db, {
        tokenHash: await resultCodeHash(attemptRef, email, code),
        kind: RESULT_KIND,
        payload: { attemptId: found.attemptId },
        now,
        expiresAt: now + RESULT_CODE_TTL_MS,
      });
      await (deps.email ?? emailSender(deps.env)).send({
        to: email.trim(),
        subject: "Your result code",
        text:
          `Your code for result ${attemptRef} is ${code}\n\n` +
          `The code works once and expires in ${String(RESULT_CODE_TTL_MS / 60_000)} minutes. ` +
          "If you did not ask for it, nothing has happened and you can ignore this message.",
      });
    }
    return c.json({ status: "sent" }, 202);
  });

  routes.post("/result/verify", async (c) => {
    const parsed = verifyRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw incomplete("Enter the code we sent you.");
    const { attemptRef, email, code } = parsed.data;
    const now = deps.now();

    await limitOrThrow(deps, "result_code", attemptRef);

    const payload = (await consumeAuthToken(
      deps.db,
      await resultCodeHash(attemptRef, email, code),
      RESULT_KIND,
      now,
    )) as { attemptId?: string } | null;
    // Unknown, expired, already spent, and minted against another
    // reference or address are one answer: the hash is salted with both,
    // so none of them can be told apart from the outside and telling them
    // apart would say whether a code ever existed.
    if (!payload || typeof payload.attemptId !== "string") {
      throw new ApiError(
        410,
        "code_expired",
        "That code has been used or has expired. Ask for a new one.",
      );
    }

    const found = await findAttemptByReference(deps.db, payload.attemptId);
    if (found === null || found.submittedAt === null) {
      throw new ApiError(404, "not_found", "No such resource.");
    }
    return c.json(
      await resultFor(
        deps,
        { ...found, layout: found.layout as PinnedLayout },
        now,
      ),
    );
  });

  return routes;
}
