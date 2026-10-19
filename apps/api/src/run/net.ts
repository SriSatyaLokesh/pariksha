// The two allowlist matchers, and where the candidate's address comes from.
//
// `@pariksha/core` already owns the *save-time* half of both rules —
// `invalidCidr` and `invalidDomainGlob` tell an organiser why a value is
// not a range or a domain. This is the *match-time* half, which is a
// different question and belongs on the server that answers a candidate.
// Written here rather than taken from a dependency because the Worker
// bundle is size-constrained and the input is two well-defined notations.
//
// Three rules hold throughout, because all three are the ways an allowlist
// fails open:
//
//   * **Nothing malformed matches.** Every parse failure is `false`, never
//     a throw and never a pass. A `/0` is refused outright for the same
//     reason `invalidCidr` refuses it at save: it reads as a restriction
//     and is not one.
//   * **Case folds on the candidate's side.** `foldAllowlistCase`
//     (`packages/db/src/repo/test-document.ts`) lower-cases what is
//     stored, so the value arriving from the edge is the one that has to
//     be folded here, or `*.AC.in` saved as `*.ac.in` never matches an
//     address typed in capitals.
//   * **Families never cross.** A v4 address is not inside a v6 range,
//     and `::ffff:10.0.0.1` is refused rather than folded to `10.0.0.1`:
//     two spellings of one address is a matcher bypass waiting to happen,
//     which is the same reason `invalidCidr`'s `isIpv6` refuses it.

import type { Context } from "hono";
import type { AppBindings } from "../app.js";

interface Address {
  value: bigint;
  /** 32 for v4, 128 for v6 — the comparison is only ever within a family. */
  size: 32 | 128;
}

const V4_OCTET = /^(0|[1-9]\d{0,2})$/;
const V6_GROUP = /^[0-9a-f]{1,4}$/;
/** A prefix length: a plain number with no leading zero, the same spelling
 *  `invalidCidr` accepts. */
const PREFIX = /^(0|[1-9]\d{0,2})$/;
/** One domain label: letters, digits and inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function parseIpv4(raw: string): bigint | null {
  const octets = raw.split(".");
  if (octets.length !== 4) return null;
  let value = 0n;
  for (const octet of octets) {
    if (!V4_OCTET.test(octet)) return null;
    const number = Number(octet);
    if (number > 255) return null;
    value = (value << 8n) | BigInt(number);
  }
  return value;
}

function parseIpv6(raw: string): bigint | null {
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const split = (part: string): string[] => (part === "" ? [] : part.split(":"));
  const head = split(halves[0] ?? "");
  const tail = halves.length === 2 ? split(halves[1] ?? "") : [];

  // A `::` stands for *at least one* zero group, so eight named groups
  // beside one is a different address from eight on their own.
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail]
      : head;
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!V6_GROUP.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

/** An address of either family, or `null` for anything that is not one. */
function parseIp(raw: string): Address | null {
  const text = raw.toLowerCase();
  if (text !== raw.trim().toLowerCase()) return null;
  if (text.includes(":")) {
    const value = parseIpv6(text);
    return value === null ? null : { value, size: 128 };
  }
  const value = parseIpv4(text);
  return value === null ? null : { value, size: 32 };
}

/**
 * Whether `ip` falls inside any of `cidrs`. An empty list allows nobody —
 * "no ranges configured" is the caller's question, not this one's, and a
 * matcher that answered `true` for an empty list would turn a cleared
 * allowlist into an open door.
 */
export function ipInRanges(ip: string, cidrs: readonly string[]): boolean {
  const address = parseIp(ip);
  if (address === null) return false;

  return cidrs.some((cidr) => {
    const slash = cidr.indexOf("/");
    if (slash === -1 || cidr.indexOf("/", slash + 1) !== -1) return false;
    const prefix = cidr.slice(slash + 1);
    if (!PREFIX.test(prefix)) return false;

    const network = parseIp(cidr.slice(0, slash));
    if (network === null || network.size !== address.size) return false;

    const bits = Number(prefix);
    // `/0` matches every address there is, which is not an allowlist —
    // the same value `invalidCidr` refuses at save time, refused again
    // here so a row written before that rule cannot open the door.
    if (bits === 0 || bits > network.size) return false;

    const shift = BigInt(network.size - bits);
    return address.value >> shift === network.value >> shift;
  });
}

/**
 * Whether `email`'s domain matches any of `globs`. `*.ac.in` covers
 * `ac.in` and anything below it; anything without a leading `*.` is exact.
 *
 * An address with more than one `@` is refused outright. It has two
 * readings — `a@evil.test?x=@iit.ac.in` is `evil.test?x=` to a parser that
 * splits on the first and `iit.ac.in` to one that splits on the last — and
 * whichever this picked, the other would be the bypass. One `@` or no
 * answer.
 */
export function emailInDomains(email: string, globs: readonly string[]): boolean {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts as [string, string];
  if (local === "" || domain === "") return false;
  // The domain has to be a domain, or a candidate who types `*.ac.in` as
  // their address matches the glob `*.ac.in` by string equality.
  if (!domain.split(".").every((label) => LABEL.test(label))) return false;

  return globs.some((raw) => {
    const glob = raw.trim().toLowerCase();
    if (!glob.startsWith("*.")) return domain === glob;
    const base = glob.slice(2);
    // The suffix must break on a label boundary, or `notac.in` is inside
    // `*.ac.in`.
    return domain === base || domain.endsWith(`.${base}`);
  });
}

/**
 * The candidate's own address, or `null` when the request carries none.
 *
 * Cloudflare's header first: on the deployment that has it, it is set by
 * the edge and a client cannot forge it. `X-Forwarded-For` is the fallback
 * for Phase 11's Docker target, left-most entry, which is the client — and
 * forgeable, which is why the caller refuses rather than admits when this
 * returns `null` and makes an operator who trusts it say so by putting a
 * proxy in front.
 */
export function clientIp(c: Context<AppBindings>): string | null {
  const direct = c.req.header("CF-Connecting-IP")?.trim();
  if (direct !== undefined && direct !== "") return direct;
  const forwarded = c.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwarded === undefined || forwarded === "" ? null : forwarded;
}
