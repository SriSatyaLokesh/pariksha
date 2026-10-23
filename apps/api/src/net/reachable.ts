// T-19's server-side reachability check, and its refusals (#58, P5.5).
//
// **This is the one place in the product that fetches a URL a user typed**,
// which makes Review Focus item 6 its whole shape rather than a later pass:
// on Workers the same code runs with the platform's network, and on Docker
// (Phase 11) it runs inside someone's own, where `http://169.254.169.254/`
// is a credential endpoint and `http://10.0.0.7:5432/` is a database. An
// outbound `fetch` is also one subrequest against the same 50 the database
// shares (ADR 0002), which is why `countingDeps` counts `deps.http` too.
//
// Nothing here blocks anything. The result is advisory: `POST
// …/check-url` answers 200 with it even when the result is `refused`, the
// field never stores it, and no rule from this file appears in the publish
// checklist. T-19's "flag it as unverified" is a thing the organiser sees,
// not a thing the server enforces.
//
// What it refuses, and why each one:
//
// | Input                                   | Result                          |
// | --------------------------------------- | ------------------------------- |
// | anything `new URL()` cannot parse        | `refused`                       |
// | a scheme other than `http:` / `https:`   | `refused` — `file:`, `gopher:`  |
// | a userinfo component (`user:pw@host`)    | `refused` — parser confusion    |
// | a port other than 80 / 443               | `refused` — this is the port    |
// |                                          |   scanner, and a resume link    |
// |                                          |   never needs one               |
// | a host that is an IP literal, v4 or v6   | `refused` — link-local, loopback|
// | a single-label host (`intranet`)         | `refused` — only ever internal  |
// | any of the above with a trailing `.`     | `refused` — the root label is   |
// |   (`localhost.`, `metadata.`)            |   stripped before comparing     |
// | `localhost`, `*.localhost`, `*.internal`,| `refused`                       |
// |   `*.local`                              |                                 |
// | anything else                            | one `HEAD`, `redirect: manual`, |
// |                                          |   `AbortSignal.timeout(5000)`   |
//
// A redirect is never *followed*, so the "a URL that looked fine redirects
// to 169.254.169.254" half of Review Focus 6 is closed by not following
// rather than by re-checking the target. The body is never read at all —
// not a byte — so "bounded response read" is bounded at zero.
//
// ponytail: the refusals are on the URL as written, not on what it
// resolves to — a DNS lookup is not available on Workers and is not
// attempted. **Two classes are therefore out of scope and reach the
// fetch**, and the second was missing from this note until the
// whole-branch security review named it:
//
//   1. a *public* hostname with an `A` record pointing at `10.0.0.7`;
//   2. a **multi-label private name** — `redis.prod`, `db.svc`,
//      `host.lan`, `foo.corp`. Each has a dot, so the single-label rule
//      does not catch it; none matches an `INTERNAL_SUFFIX`; none is an
//      IP literal. All are fetched.
//
// On Workers both are moot: only the public resolver is reachable, which
// is what makes the limit acceptable today. **On the Docker target this
// file's own header calls out, where `http://10.0.0.7:5432/` is a
// database, class 2 is live.** Upgrade path, and it is a condition on
// Phase 11 rather than a nice-to-have: resolve the host and re-check the
// address at the Node entry, where `dns.lookup` exists, *with* that
// entry and not after it. The refusals below stay as the first gate
// either way.

// Phase 8d Task 1: the refusal table itself (ports, IP literals, internal
// suffixes, the FQDN-root-label strip) moved to `@pariksha/db`'s
// `urlRefusal` (`packages/db/src/net.ts`) so `repo/webhooks.ts`'s
// `createWebhook` can reuse it. Not `@pariksha/core`: that package is a
// pure leaf with no DOM/Node `lib` and hand-parses URLs for that reason
// (`registration.ts`'s `hostOf`); `packages/db` already carries Node types
// and the global `URL` they provide. Imported here, not reimplemented, so
// the two can never drift apart.
import { urlRefusal as refusal } from "@pariksha/db";

export type ReachState = "reachable" | "unverified" | "timeout" | "refused";

export interface ReachResult {
  state: ReachState;
  /** The HTTP status, where there was one. Never a transport-level detail:
   * "connection refused" and "no such host" are the same `unverified` with
   * `status: null`, so this cannot answer "is something listening there".
   *
   * One channel survives that, and it is timing rather than content: every
   * refusal and every transport failure returns promptly, while only a host
   * that accepts the connection and then stalls costs the full
   * `REACH_TIMEOUT_MS` — so `timeout` still separates "filtered, dropping
   * packets" from "refusing, or not resolving". Small (an authenticated
   * Author, a public name, a web port, no body read) but real, and the one
   * thing the indistinguishable-`unverified` design above does not close.
   * Folding `timeout` into `unverified` would close it and take away the
   * retry #58 requires, so it is named here instead (task 5/6 review, m1). */
  status: number | null;
  /** Why it was refused. Present only on `refused` — a sentence for the
   * organiser, never an error from the network. */
  reason?: string;
  checkedAt: number;
}

/** Per *call*, not per check: a `HEAD` that answers 405 is retried once
 * with `GET` and each carries its own `AbortSignal.timeout`, so the real
 * worst case for one `POST .../check-url` is two subrequests and 10 s
 * (whole-branch security review, L4 — the declared ceiling was a
 * single-fetch number). `ROUTE_BUDGETS` is pinned to that path. */
export const REACH_TIMEOUT_MS = 5000;

export async function checkReachable(
  http: typeof globalThis.fetch,
  url: string,
  now: () => number,
): Promise<ReachResult> {
  const reason = refusal(url);
  if (reason !== null) return { state: "refused", status: null, reason, checkedAt: now() };

  // `HEAD` first — a reachability check has no use for the body, and a
  // resume PDF is megabytes. A server that rejects `HEAD` with 405 gets one
  // `GET`, and the response body is still never read.
  const send = (method: "HEAD" | "GET"): Promise<Response> =>
    http(url, { method, redirect: "manual", signal: AbortSignal.timeout(REACH_TIMEOUT_MS) });

  try {
    let response = await send("HEAD");
    if (response.status === 405) response = await send("GET");

    if (response.status === 200) return { state: "reachable", status: 200, checkedAt: now() };
    // Everything else, a 3xx included (`redirect: "manual"` means it was
    // not followed), is unverified rather than an error: the organiser is
    // told the link did not answer 200, which is all T-19 claims.
    return { state: "unverified", status: response.status, checkedAt: now() };
  } catch (err) {
    // `AbortSignal.timeout` rejects with a `TimeoutError`; an explicit
    // abort would be an `AbortError`. Either is a timeout to the organiser,
    // reported as a timeout with a retry and never as unreachable.
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { state: "timeout", status: null, checkedAt: now() };
    }
    // Any other transport failure — DNS, TCP, TLS — is `unverified` with no
    // status and no detail. Reporting *which* one it was would turn this
    // route into a probe that answers "is something listening on that
    // host", which is the thing the refusals above exist to prevent.
    return { state: "unverified", status: null, checkedAt: now() };
  }
}
