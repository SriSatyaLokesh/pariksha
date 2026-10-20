// The bot protection this product actually ships: a same-origin proof of
// work on registration (`S-07`, ADR 0009).
//
// The PRD names Cloudflare Turnstile in three places and `S-11` forbids
// third-party scripts in one. ADR 0009 resolves that in favour of `S-11`,
// so this file is what stands in front of `POST .../register` on every
// default deployment, and `captcha.ts` is the seam for an operator who
// decides otherwise on their own instance.
//
// **The challenge is derived, not minted.** It is a digest of the
// single-use `run_entry` token the access gate already handed this
// candidate (advisor D10), which buys four properties for no storage at
// all:
//
//   * **Unpredictable** — the entry token is 256 bits of CSPRNG, so a
//     farm cannot precompute solutions before passing the gate.
//   * **Single use** — the registration consumes the entry token in the
//     same batch as the write, so replaying a solution is replaying the
//     entry token, which is already a 410.
//   * **Bound to the test** — `entryHash` salts an entry row with its
//     test version, so a token earned at one test matches no row at
//     another and its solution buys nothing there.
//   * **Expiring** — the entry token's own 30-minute TTL is the
//     challenge's.
//
// So there is no challenge table, no `POW_TTL_MS`, no HMAC and no second
// replay check: each would be a second copy of a lifetime the entry token
// already has, and two copies of a lifetime is how one of them goes stale.
//
// Cost to a candidate is one short burst of SHA-256 in the page. Cost to
// a farm is the same burst per fake registration, which is the whole
// point: it does not stop a determined attacker with real CPU, it makes
// volume cost something. ADR 0009 says so out loud rather than claiming
// parity with a hosted captcha.

import { sha256Hex } from "../auth/tokens.js";

/**
 * How many leading zero **bits** a solution's digest must have.
 *
 * 16, which is ~65k digests: tens of milliseconds on a laptop and well
 * under a second on a budget phone, both of which are inside what a
 * candidate will sit through before a timed exam. Raising it is the first
 * response if a real deployment is overrun (ADR 0009's "to watch"), and
 * the browser is **told** the number by `GET .../challenge` rather than
 * compiling it in, so raising it is an API deploy and not a web one.
 */
export const POW_DIFFICULTY_BITS = 16;

/**
 * The challenge for one entry token. Prefixed, so this digest can never
 * collide with `entryHash`'s — which is the digest the `auth_token` row
 * is *keyed* on, and handing a candidate that value would hand them a
 * lookup key for their own credential.
 */
export const powChallenge = (entryToken: string): Promise<string> =>
  sha256Hex(`pow:${entryToken}`);

/**
 * Whether `solution` is a preimage whose digest over the challenge starts
 * with `POW_DIFFICULTY_BITS` zero bits.
 *
 * Throws nothing: a missing, malformed or simply wrong solution is
 * `false`, because every one of them is the same answer to the candidate
 * and the route says it once.
 */
export async function verifyPow(
  entryToken: string,
  solution: string | undefined,
): Promise<boolean> {
  // Nothing else to reject up front: an empty or absurd solution simply
  // fails the difficulty like any other wrong answer, and the route's
  // schema already caps the field's length. A guard here that changed no
  // outcome would be a line no test could ever fail against.
  if (typeof solution !== "string") return false;
  const digest = await sha256Hex(`${await powChallenge(entryToken)}:${solution}`);
  return meetsDifficulty(digest, POW_DIFFICULTY_BITS);
}

/**
 * Bits, not hex characters. At 16 the two happen to agree, and that is
 * exactly why it is worth writing properly: the day someone raises the
 * difficulty to 18 to answer an abusive deployment, a nibble-counting
 * check would quietly keep charging for 16.
 */
export function meetsDifficulty(digestHex: string, bits: number): boolean {
  const nibbles = bits >> 2;
  if (digestHex.slice(0, nibbles) !== "0".repeat(nibbles)) return false;
  const spare = bits & 3;
  return spare === 0 || Number.parseInt(digestHex[nibbles] ?? "f", 16) < 1 << (4 - spare);
}
