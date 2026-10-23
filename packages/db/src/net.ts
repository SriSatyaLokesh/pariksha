// The SSRF refusal rules, as pure data with no fetch.
//
// Moved here from `apps/api/src/net/reachable.ts` (T-19, #58/P5.5) so
// `repo/webhooks.ts`'s `createWebhook` (Phase 8d Task 1) can refuse the
// same private-address URLs at write time, reusing the exact rules
// `reachable.ts` already enforces for the registration form's URL field
// rather than growing a second allowlist. Lives in `packages/db`, not
// `packages/core`: `packages/core` is a pure leaf with no DOM/Node `lib`
// and hand-parses URLs for that reason (see `registration.ts`'s
// `hostOf`), while `packages/db` already carries `"types": ["node"]` and
// the global `URL` it provides. `reachable.ts` imports this rather than
// keeping its own copy, so the two can never drift apart.
//
// Deliberately outside `repo/index.ts`: not a `scoped()` repository
// function, the same reason `ids.ts` sits here instead (`index.ts`'s own
// header).

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

/**
 * `null` when the URL may be fetched, or the sentence saying why not.
 * ponytail: resolves nothing — a DNS lookup is not attempted — so a public
 * hostname whose `A` record points at a private address is out of scope
 * here exactly as it is in `reachable.ts`; see that file's header for the
 * upgrade path on the Docker target.
 */
export function urlRefusal(url: string): string | null {
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

  // The FQDN root label is dropped before any comparison below — see
  // `reachable.ts`'s header (task 5/6 review, C1) for why.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  // `new URL("http://[::1]/").hostname` is `"[::1]"` — every IPv6 literal
  // keeps its brackets, which is the whole test.
  if (host.startsWith("[") || IPV4.test(host)) return ADDRESS_REFUSAL;
  if (host === "localhost" || INTERNAL_SUFFIX.some((suffix) => host.endsWith(suffix))) return ADDRESS_REFUSAL;
  // A host with no dot is a name only the deployment's own resolver knows:
  // `intranet`, `metadata`, `db`. A real webhook or resume link always has
  // one.
  if (!host.includes(".")) return ADDRESS_REFUSAL;

  return null;
}
