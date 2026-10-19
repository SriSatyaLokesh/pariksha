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
// attempted, so a public hostname with an `A` record pointing at
// `10.0.0.7` is out of scope and reaches the fetch. Upgrade path: resolve
// the host and re-check the address at the Node entry (Phase 11), where
// `dns.lookup` exists; the refusals below stay as the first gate either
// way.

export type ReachState = "reachable" | "unverified" | "timeout" | "refused";

export interface ReachResult {
  state: ReachState;
  /** The HTTP status, where there was one. Never a transport-level detail:
   * "connection refused" and "no such host" are the same `unverified` with
   * `status: null`, so this cannot answer "is something listening there". */
  status: number | null;
  /** Why it was refused. Present only on `refused` — a sentence for the
   * organiser, never an error from the network. */
  reason?: string;
  checkedAt: number;
}

export const REACH_TIMEOUT_MS = 5000;

/** The ports a web link is served on. A check of `:22`, `:5432` or `:6379`
 * is a port scan with a form field for a console, whoever the target is. */
const WEB_PORTS = new Set(["", "80", "443"]);

/** Dotted-quad IPv4. The WHATWG URL parser already normalises the decimal,
 * octal and hex spellings (`http://2130706433/`, `http://0177.0.0.1/`) into
 * this one, so matching it matches all of them. */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Host suffixes that only ever name something inside the deployment. */
const INTERNAL_SUFFIX = [".localhost", ".internal", ".local"];

const SCHEME_REFUSAL = "only http and https links can be checked";
const ADDRESS_REFUSAL = "a link to a network address cannot be checked";

/** `null` when the URL may be fetched, or the sentence saying why not. */
function refusal(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return SCHEME_REFUSAL;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return SCHEME_REFUSAL;
  if (parsed.username !== "" || parsed.password !== "") {
    return "a link carrying a username or password cannot be checked";
  }
  if (!WEB_PORTS.has(parsed.port)) return "only links on the standard web ports can be checked";

  // The FQDN root label is dropped before any comparison below (task 5/6
  // review, C1). `URL.hostname` keeps a trailing dot — `http://localhost./`
  // parses to `"localhost."` — so every string comparison here used to miss
  // it, and `http://metadata./` even satisfied the single-label check
  // because `"metadata."` contains a dot. `http://127.0.0.1./` was never
  // affected (the IPv4 parser drops the empty part), which is exactly why
  // the literal half of the table above looked correct while this gap sat
  // underneath it. The WHATWG parser already folds the full-width stops
  // (U+3002, U+FF0E) into ".", so one strip covers those spellings too.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  // `new URL("http://[::1]/").hostname` is `"[::1]"` — every IPv6 literal
  // keeps its brackets, which is the whole test.
  if (host.startsWith("[") || IPV4.test(host)) return ADDRESS_REFUSAL;
  if (host === "localhost" || INTERNAL_SUFFIX.some((suffix) => host.endsWith(suffix))) return ADDRESS_REFUSAL;
  // A host with no dot is a name only the deployment's own resolver knows:
  // `intranet`, `metadata`, `db`. A real resume link always has one.
  if (!host.includes(".")) return ADDRESS_REFUSAL;

  return null;
}

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
