// One structured line per request. Request ID, route, status and duration and
// nothing else: no path parameters, no query, no headers, no body. A log line
// is the easiest place for a candidate's name or answer to escape the system,
// and the only reliable defence is for the line to have no field it could
// land in. `c.req.routePath` is the matched pattern, not the requested URL,
// so an ID in the path never reaches the log either.

import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

export function logging(
  now: () => number,
): MiddlewareHandler<{ Variables: RequestIdVariables }> {
  return async (c, next) => {
    const started = now();
    await next();
    console.log(
      JSON.stringify({
        requestId: c.get("requestId"),
        route: c.req.routePath,
        status: c.res.status,
        durationMs: now() - started,
      }),
    );
  };
}
