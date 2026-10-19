// The hosted-captcha seam: shipped, wired, and **off** (ADR 0009).
//
// `S-07` asks for Turnstile or hCaptcha; `S-11` promises no third-party
// scripts and the CSP is `'self'` in two files that must stay byte
// identical. ADR 0009 keeps the promise and makes the widget an
// operator's choice on their own instance: set `CAPTCHA_SECRET` and
// `CAPTCHA_VERIFY_URL`, add the three directives the widget needs to your
// own `_headers`, and accept that your instance no longer satisfies
// `S-11`. Nothing here changes the shipped CSP, which is the decision
// rather than an exception to it.
//
// **Unconfigured verifies true.** `AC-01` promises a working deployment
// in thirty minutes using no paid service, so an instance that was never
// given a provider must register candidates normally — the proof of work
// in `pow.ts` is what is actually standing guard there, and it runs
// either way.
//
// No provider SDK and no provider name: the endpoint is configuration,
// which is also what keeps `challenges.cloudflare.com` out of this
// repository's source entirely.

import type { TestAccess } from "@pariksha/core";
import type { AppDeps } from "../app.js";

/** Whether this instance has been given a provider at all. */
export const captchaConfigured = (deps: AppDeps): boolean => deps.env.captcha !== undefined;

/**
 * Whether this test's registration must carry a captcha token.
 *
 * Both halves: the instance has a provider, **and** the test did not turn
 * it off. `access.captcha` carries no default in the type and a stored
 * test may simply omit the key, so the `?? true` is applied here — the
 * builder's own default is a UI convenience and a server that trusted it
 * would read "absent" as "off" (reconciliation row 6).
 */
export const captchaRequired = (deps: AppDeps, access: TestAccess | undefined): boolean =>
  captchaConfigured(deps) && (access?.captcha ?? true);

/**
 * Verifies one token with the configured provider over `deps.http`, the
 * same seam the OIDC legs use — so this costs one subrequest when it is
 * on, and none at all when it is not.
 *
 * The secret goes in the body and never in a URL or a log line, and the
 * candidate's address is deliberately **not** sent: `S-07` says limits
 * are never per IP because a whole campus shares one, and handing the
 * provider the address would be the same disclosure by another route.
 *
 * Fails closed on a network error or an unreadable answer: a configured
 * provider that cannot be reached is an operator problem, and admitting
 * everyone while it is down is the one outcome turning it on was meant
 * to prevent.
 */
export async function verifyCaptcha(deps: AppDeps, token: string | undefined): Promise<boolean> {
  const captcha = deps.env.captcha;
  if (captcha === undefined) return true;
  if (token === undefined || token === "") return false;

  const http = deps.http ?? globalThis.fetch;
  try {
    const res = await http(captcha.verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: captcha.secret, response: token }).toString(),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}
