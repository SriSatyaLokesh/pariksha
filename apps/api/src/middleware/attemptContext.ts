// The attempt token, as a request authority (`#69`, P6.5, ADR 0008).
//
// A candidate holds one 256-bit token in an `HttpOnly` cookie. This
// middleware turns it into the attempt row every route behind it reads,
// in one statement, and answers 401 when it names nothing live.
//
// It registers itself the way `guard()` registers in `GUARDS`, so
// `routeAuthorities()` reads the authority off the **mounted**
// middleware rather than off the declaration in `app.ts`. Declaring
// `attempt` over a route that mounts no context then fails
// `route-authority.test.ts`, and so does mounting one without declaring
// it.

import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { readAttemptByTokenHash, type AttemptRecord } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { sha256Hex } from "../auth/tokens.js";
import type { PinnedLayout } from "../run/attempt.js";

/**
 * The attempt token's cookie. `HttpOnly` because the runner renders
 * author-written Markdown, and a `Max-Age` cookie rather than
 * `sessionStorage` because `C-06` requires a browser restart to resume
 * the same attempt.
 *
 * Declared in the module that *reads* it, and re-exported from
 * `run/attempt.ts` where the brief names it: the only other edge
 * between these two files is a type, so there is no import cycle.
 */
export const ATTEMPT_COOKIE = "pk_attempt";

export type AttemptContextVar = AttemptRecord & { layout: PinnedLayout };

const CONTEXTS = new WeakSet<object>();

/** Whether `handler` is an attempt context — the reader half of the
 *  registration, used by `routeAuthorities`. */
export const isAttemptContext = (handler: unknown): boolean =>
  typeof handler === "function" && CONTEXTS.has(handler);

/**
 * No cookie, a junk cookie and a cookie for an attempt that no longer
 * exists are one answer, for the reason every refusal in this runtime is
 * one answer: the holder cannot tell them apart and a server that could
 * would say whether a token ever existed.
 *
 * A **submitted** attempt resolves. The receipt (`C-08`) and the result
 * are read through this same cookie after `submitted_at` is stamped;
 * refusing here would log a candidate out of their own result page.
 * Whether a *write* is still allowed is the answer route's question, and
 * `submittedAt` is on the record so it can ask it.
 */
export function attemptContext(deps: AppDeps): MiddlewareHandler<AppBindings> {
  const handler: MiddlewareHandler<AppBindings> = async (c, next) => {
    const token = getCookie(c, ATTEMPT_COOKIE) ?? "";
    const record =
      token === "" ? null : await readAttemptByTokenHash(deps.db, await sha256Hex(token));
    if (!record) {
      throw new ApiError(
        401,
        "attempt_required",
        "This test is not open in this browser. Go back to the test page and start again.",
      );
    }
    c.set("attempt", { ...record, layout: record.layout as PinnedLayout });
    await next();
  };

  CONTEXTS.add(handler);
  return handler;
}
