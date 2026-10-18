// The same policy the static site serves from apps/web/public/_headers, byte
// for byte. Two documents disagreeing about one directive is how a CSP ends
// up weakened by whichever origin a browser happens to ask — so when one
// changes, the other changes with it.
//
// Written out rather than configured through hono/secure-headers because that
// middleware's Permissions-Policy directives are a closed union that has no
// `interest-cohort`, and a policy assembled from two sources is the drift
// this comment exists to prevent. PRD S-11: no third-party scripts, so every
// source is 'self'. Phase 7 adds `blob:` to img-src for camera frames and
// nothing else.

import type { MiddlewareHandler } from "hono";

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; " +
    "frame-ancestors 'none'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(name, value);
  }
  await next();
};
