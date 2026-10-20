// The two allowlist matchers and the client-IP reader, as pure functions.
//
// They are tested here rather than only through the access route because
// the route can only ever reach one branch per request, and the whole
// point of `ipInRanges` is the branches: v4 against a v6 range, a prefix
// length nobody validated, an empty list. `access.test.ts` then proves the
// route actually calls them.

import { expect, it } from "vitest";
import { Hono } from "hono";
import { clientIp, emailInDomains, ipInRanges } from "../../src/run/net.js";
import type { AppBindings } from "../../src/app.js";

it.each([
  ["10.0.0.5", ["10.0.0.0/8"], true],
  ["11.0.0.5", ["10.0.0.0/8"], false],
  ["192.168.1.1", ["192.168.1.0/24"], true],
  ["192.168.2.1", ["192.168.1.0/24"], false],
  ["2001:db8::1", ["2001:db8::/32"], true],
  ["2001:dba::1", ["2001:db8::/32"], false],
  ["10.0.0.5", [], false], // an empty list allows nobody
])("ipInRanges(%j, %j) is %s", (ip, cidrs, expected) => {
  expect(ipInRanges(ip, cidrs)).toBe(expected);
});

it.each([
  // A /32 and a /128 are one host, and the boundary of a /24 is the case a
  // shift-by-the-wrong-amount gets wrong in exactly one direction.
  ["203.0.113.7", ["203.0.113.7/32"], true],
  ["203.0.113.8", ["203.0.113.7/32"], false],
  ["192.168.1.255", ["192.168.1.0/24"], true],
  ["192.168.0.255", ["192.168.1.0/24"], false],
  ["2001:db8::1", ["2001:db8::1/128"], true],
  ["2001:db8::2", ["2001:db8::1/128"], false],
  // `::` in the middle, at the front and at the back all have to expand to
  // the same 128 bits.
  ["2001:db8:0:0:0:0:0:1", ["2001:db8::1/128"], true],
  ["::1", ["::1/128"], true],
  ["fe80::", ["fe80::/10"], true],
  // Case: `2001:DB8::/32` is stored lower-cased by `foldAllowlistCase`,
  // but a candidate's own address arrives however the edge spelled it.
  ["2001:DB8::1", ["2001:db8::/32"], true],
  // Families never cross. A v4 address is not inside a v6 range however
  // wide, and the IPv4-mapped spelling is refused rather than folded —
  // two spellings of one address is a matcher bypass.
  ["10.0.0.5", ["::/1"], false],
  ["::ffff:10.0.0.5", ["10.0.0.0/8"], false],
  ["2001:db8::1", ["10.0.0.0/8"], false],
  // Nothing malformed may ever match: a missing prefix, a prefix that is
  // not a number, one too wide for the family, and an address that is not
  // one are all "no", never "yes" and never a throw.
  ["10.0.0.5", ["10.0.0.0"], false],
  ["10.0.0.5", ["10.0.0.0/"], false],
  ["10.0.0.5", ["10.0.0.0/x"], false],
  ["10.0.0.5", ["10.0.0.0/33"], false],
  ["2001:db8::1", ["2001:db8::/129"], false],
  ["10.0.0.5", ["10.0.0.0/08"], false],
  ["not-an-ip", ["10.0.0.0/8"], false],
  ["10.0.0.256", ["10.0.0.0/8"], false],
  ["010.0.0.5", ["10.0.0.0/8"], false],
  ["10.0.0.5 ", ["10.0.0.0/8"], false],
  ["", ["10.0.0.0/8"], false],
  // A later range still matches when an earlier one does not.
  ["10.0.0.5", ["192.168.0.0/16", "10.0.0.0/8"], true],
])("ipInRanges(%j, %j) is %s — the edges", (ip, cidrs, expected) => {
  expect(ipInRanges(ip, cidrs)).toBe(expected);
});

it("a /0 range is refused rather than matching everything", () => {
  // `invalidCidr` already refuses `/0` at save time ("matches every
  // address, which is not an allowlist"). The matcher refuses it too, so a
  // row written before that rule existed, or imported round a route, is
  // not an open door.
  expect(ipInRanges("203.0.113.9", ["0.0.0.0/0"])).toBe(false);
  expect(ipInRanges("2001:db8::1", ["::/0"])).toBe(false);
});

it.each([
  ["a@iit.ac.in", ["*.ac.in"], true],
  ["a@acme.in", ["*.ac.in"], false],
  // The domain follows the LAST `@` — so a value with two of them has two
  // readings, and the only safe answer is neither. Taking the last would
  // admit this address on an `*.ac.in` test; taking the first would admit
  // the mirror image.
  ["a@evil.test?x=@iit.ac.in", ["*.ac.in"], false],
])("emailInDomains(%j, %j) is %s", (email, globs, expected) => {
  expect(emailInDomains(email, globs)).toBe(expected);
});

it.each([
  // An exact domain is exact: `*.` is the only wildcard there is.
  ["a@ac.in", ["ac.in"], true],
  ["a@x.ac.in", ["ac.in"], false],
  // `*.ac.in` covers any depth below it, and the bare domain too — an
  // organiser who writes `*.ac.in` means "this institution".
  ["a@ac.in", ["*.ac.in"], true],
  ["a@cse.iit.ac.in", ["*.ac.in"], true],
  // The suffix has to break on a label boundary, or `notac.in` is inside
  // `*.ac.in`.
  ["a@notac.in", ["*.ac.in"], false],
  // Case folds on both sides: the stored list is lower-cased by
  // `foldAllowlistCase`, the typed address is not.
  ["A@IIT.AC.IN", ["*.ac.in"], true],
  ["a@iit.ac.in", ["*.AC.in"], true],
  // Trailing dot, trailing space, no domain, no local part, a bare `*`
  // typed as an address: all refused.
  ["a@iit.ac.in.", ["*.ac.in"], false],
  ["a@iit.ac.in ", ["*.ac.in"], true],
  ["a@", ["*.ac.in"], false],
  ["@iit.ac.in", ["*.ac.in"], false],
  ["a@*.ac.in", ["*.ac.in"], false],
  ["iit.ac.in", ["*.ac.in"], false],
  ["", ["*.ac.in"], false],
  // An empty list allows nobody, the same as `ipInRanges`.
  ["a@iit.ac.in", [], false],
  ["a@b.test", ["*.ac.in", "b.test"], true],
])("emailInDomains(%j, %j) is %s — the edges", (email, globs, expected) => {
  expect(emailInDomains(email, globs)).toBe(expected);
});

/** The header reader, over a real Hono context rather than a cast. */
async function ipOf(headers: Record<string, string>): Promise<string | null> {
  let seen: string | null = "unset";
  const app = new Hono<AppBindings>();
  app.get("/", (c) => {
    seen = clientIp(c);
    return c.body(null, 204);
  });
  await app.request("/", { headers });
  return seen;
}

it("the client IP is Cloudflare's header first, then the left-most X-Forwarded-For", async () => {
  expect(await ipOf({ "CF-Connecting-IP": "203.0.113.9" })).toBe("203.0.113.9");
  // The left-most entry is the client; everything after it is a proxy.
  expect(await ipOf({ "X-Forwarded-For": "203.0.113.9, 70.41.3.18" })).toBe("203.0.113.9");
  expect(await ipOf({ "X-Forwarded-For": " 203.0.113.9 " })).toBe("203.0.113.9");
  // Cloudflare's wins, because on the deployment that has it, it is the
  // one header the edge sets itself and a client cannot forge.
  expect(
    await ipOf({ "CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "10.0.0.1" }),
  ).toBe("203.0.113.9");
});

it("no header, and an empty one, are null rather than the empty string", async () => {
  // The whole of the allowlist bug is failing open: a route that treats ""
  // as an address would hand it to `ipInRanges`, get false, and refuse —
  // but a route that treats "" as "present" would skip the check.
  expect(await ipOf({})).toBeNull();
  expect(await ipOf({ "X-Forwarded-For": "" })).toBeNull();
  expect(await ipOf({ "X-Forwarded-For": " , 10.0.0.1" })).toBeNull();
});
