// Every failure leaves through here, in one shape:
// `{ "error": { "code", "message", "details"? } }`. A client parses `code`;
// `message` is for a person. Hono's own 404 is plain text, which would make
// the envelope a convention routes could forget rather than a guarantee.

import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppBindings } from "../app.js";
import { ApiError } from "../errors.js";

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function envelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    error:
      details === undefined ? { code, message } : { code, message, details },
  };
}

/**
 * PRD S-09: a resource in another workspace is 404, never 403 — so "not
 * found" is also what a route that refuses to confirm existence throws, and
 * the two are indistinguishable from outside.
 */
export const notFoundEnvelope: NotFoundHandler = (c) =>
  c.json(envelope("not_found", "No such resource."), 404);

export const errorEnvelope: ErrorHandler<AppBindings> = (
  err,
  c,
) => {
  if (err instanceof ApiError) {
    return c.json(
      envelope(err.code, err.message, err.details),
      err.status as ContentfulStatusCode,
    );
  }

  // Something below Hono rejected the request — a malformed body, a method
  // that does not exist. Its message is Hono's, not ours, and says nothing
  // about the inside of the application.
  if (err instanceof HTTPException) {
    return c.json(envelope("bad_request", err.message), err.status);
  }

  // Anything else is a bug. The client gets a request ID and a sentence; the
  // stack and the thrown message — which can carry a connection string or a
  // row of data — go to the server log and no further.
  const requestId = c.get("requestId");
  console.error(
    JSON.stringify({
      requestId,
      level: "error",
      route: c.req.routePath,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return c.json(
    envelope("internal_error", "The request could not be completed.", {
      requestId,
    }),
    500,
  );
};
