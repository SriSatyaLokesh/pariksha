// The default bot protection: a same-origin proof of work on registration
// (#68, P6.4, ADR 0009).
//
// Everything here goes through `app.request()` on a real `createApp(deps)`,
// because the only copy of this check that counts is the server's — a
// browser that skips the solve is exactly the caller this exists to stop.
//
// The challenge is **derived from the entry token**, not minted and
// stored: the nonce is a digest of the single-use `run_entry` token the
// access gate handed out, so issuing one costs no row, verifying one
// costs no read, and "the same solution replayed" is the same thing as
// "the same entry token replayed" — already a 410, already tested, and no
// second table (advisor D10).

import { afterAll, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { closeClient, listCandidates, replaceCandidateList, resolvePublishedTest } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import {
  meetsDifficulty,
  POW_DIFFICULTY_BITS,
  powChallenge,
  verifyPow,
} from "../../src/run/pow.js";
import { sha256Hex } from "../../src/auth/tokens.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { CONSENT, ROSTER_CANDIDATES, seedPublishedTest } from "./fixtures.js";

const T = FIXED_NOW;
let clock = T;

const { deps } = await testDeps({ now: () => clock });
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);

afterAll(() => closeClient(deps.db));

const VALID = {
  roll: "21CS0147",
  email: "ananya@vce.ac.in",
  full_name: "Ananya",
  cgpa: 9.1,
  consent: true,
};

/**
 * The same search the browser runs, in Node's synchronous SHA-256 so the
 * suite does not spend a second of WebCrypto promises per test. Identical
 * arithmetic: the digest of `${challenge}:${solution}` must begin with
 * `POW_DIFFICULTY_BITS` zero bits.
 */
function solve(challenge: string, bits = POW_DIFFICULTY_BITS): string {
  const prefix = "0".repeat(bits >> 2);
  const rest = bits & 3;
  for (let i = 0; ; i++) {
    const hex = createHash("sha256").update(`${challenge}:${String(i)}`).digest("hex");
    if (!hex.startsWith(prefix)) continue;
    if (rest === 0 || Number.parseInt(hex[bits >> 2] ?? "f", 16) < 1 << (4 - rest)) {
      return String(i);
    }
  }
}

const gate = async (slug: string, identifier?: string): Promise<string> => {
  const res = await app.request(`/api/v1/run/alpha/${slug}/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "OPENSESAME", ...(identifier === undefined ? {} : { identifier }) }),
  });
  const body = (await res.json()) as { entryToken?: string };
  if (res.status !== 200 || !body.entryToken) throw new Error(`gate ${slug}: ${String(res.status)}`);
  return body.entryToken;
};

const challengeOf = async (slug: string, token: string): Promise<{ challenge: string; bits: number }> => {
  const res = await app.request(`/api/v1/run/alpha/${slug}/challenge`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { challenge: string; bits: number };
};

const register = (
  slug: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  app.request(`/api/v1/run/alpha/${slug}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

/** A whole registration, solved. */
async function solvedRegister(slug: string, identifier?: string, values = VALID): Promise<Response> {
  const token = await gate(slug, identifier);
  const { challenge, bits } = await challengeOf(slug, token);
  return register(slug, token, { values, solution: solve(challenge, bits) });
}

const testIdOf = async (slug: string): Promise<string> => {
  const test = await resolvePublishedTest(deps.db, "alpha", slug, clock);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  return test.testId;
};

const countCandidates = async (slug: string): Promise<number> =>
  (await listCandidates(deps.db, workspaceId, await testIdOf(slug))).filter(
    (row) => row.registeredAt !== null,
  ).length;

beforeEach(async () => {
  clock = T;
  await deps.db.run("DELETE FROM candidate_unique", []);
  await deps.db.run("DELETE FROM auth_token", []);
  await deps.db.run("DELETE FROM rate_limit", []);
  for (const slug of ["signup", "unsafe", "roster"]) {
    await deps.db.run("DELETE FROM candidate WHERE test_id = ?", [await testIdOf(slug)]);
  }
  await replaceCandidateList(deps.db, workspaceId, await testIdOf("roster"), ROSTER_CANDIDATES, T);
});

// --- the default control -----------------------------------------------

it("S-07: registering without a proof of work is 403 and writes no candidate", async () => {
  const res = await register("signup", await gate("signup"), { values: VALID });
  expect(res.status).toBe(403);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bot_check_failed");
  expect(await countCandidates("signup")).toBe(0);
});

it("S-07: a solution that does not meet the difficulty is 403 and writes no candidate", async () => {
  const token = await gate("signup");
  const { challenge } = await challengeOf("signup", token);
  // A real preimage of the challenge, just not one whose digest is small
  // enough — so this fails on the difficulty and nothing else.
  const weak = solve(challenge, 4);
  const stronger = createHash("sha256").update(`${challenge}:${weak}`).digest("hex");
  expect(stronger.startsWith("0".repeat(POW_DIFFICULTY_BITS >> 2))).toBe(false);

  const res = await register("signup", token, { values: VALID, solution: weak });
  expect(res.status).toBe(403);
  expect(await countCandidates("signup")).toBe(0);
});

it("S-07: a valid solution registers, and replaying it is refused", async () => {
  const token = await gate("signup");
  const { challenge, bits } = await challengeOf("signup", token);
  const solution = solve(challenge, bits);

  expect((await register("signup", token, { values: VALID, solution })).status).toBe(201);

  // The replay. Single use comes from the entry token the challenge is
  // derived from, which the registration consumed in the same batch — so
  // the second attempt never reaches the proof of work at all.
  const replay = await register("signup", token, {
    values: { ...VALID, roll: "21CS9999", email: "other@vce.ac.in" },
    solution,
  });
  expect(replay.status).toBe(410);
  expect(((await replay.json()) as { error: { code: string } }).error.code).toBe("entry_expired");
  expect(await countCandidates("signup")).toBe(1);
});

it("S-07: a solution earned at another test is refused, because the challenge is not the same one", async () => {
  const mine = await gate("signup");
  const theirs = await gate("unsafe");
  const { challenge, bits } = await challengeOf("unsafe", theirs);
  const solution = solve(challenge, bits);

  const res = await register("signup", mine, { values: VALID, solution });
  expect(res.status).toBe(403);
  expect(await countCandidates("signup")).toBe(0);
});

it("S-07: an expired challenge is refused, because the entry token it was cut from has expired", async () => {
  const token = await gate("signup");
  const { challenge, bits } = await challengeOf("signup", token);
  const solution = solve(challenge, bits);

  clock = T + 31 * 60_000;
  const res = await register("signup", token, { values: VALID, solution });
  expect(res.status).toBe(410);
  expect(await countCandidates("signup")).toBe(0);
});

it("the challenge is bound to the candidate's own entry token, so two candidates never share one", async () => {
  const a = await gate("signup");
  const b = await gate("signup");
  expect((await challengeOf("signup", a)).challenge).not.toBe(
    (await challengeOf("signup", b)).challenge,
  );
  // And it is a digest of the token, never the token itself: the page
  // puts the challenge in a `<script>`-reachable variable and the entry
  // token is a credential.
  expect((await challengeOf("signup", a)).challenge).not.toContain(a);
  // Pinned to the construction, not to `powChallenge`'s own output —
  // the second would be the same assertion on both sides of the equals
  // sign and would pass however the digest was built. The `pow:` prefix
  // is the domain separation that keeps this value from ever being a
  // lookup key for some other digest of the same token.
  expect((await challengeOf("signup", a)).challenge).toBe(await sha256Hex(`pow:${a}`));
  expect((await challengeOf("signup", a)).challenge).not.toBe(await sha256Hex(a));
});

it("the server states the difficulty, so raising it needs no new web build", async () => {
  const { bits } = await challengeOf("signup", await gate("signup"));
  expect(bits).toBe(POW_DIFFICULTY_BITS);
  // The ruling: 16, and the response is where it is published.
  expect(POW_DIFFICULTY_BITS).toBe(16);
});

it("GET /challenge needs the entry token: a caller with none is 401", async () => {
  expect((await app.request("/api/v1/run/alpha/signup/challenge")).status).toBe(401);
});

it("GET /challenge refuses a spent entry token rather than issuing a challenge for it", async () => {
  const token = await gate("signup");
  const { challenge, bits } = await challengeOf("signup", token);
  expect((await register("signup", token, { values: VALID, solution: solve(challenge, bits) })).status).toBe(201);
  expect(
    (await app.request("/api/v1/run/alpha/signup/challenge", {
      headers: { authorization: `Bearer ${token}` },
    })).status,
  ).toBe(410);
});

it("issuing a challenge writes no row — it is a digest, not a table", async () => {
  const token = await gate("signup");
  const before = await deps.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM auth_token", []);
  await challengeOf("signup", token);
  const after = await deps.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM auth_token", []);
  expect(after[0]?.n).toBe(before[0]?.n);
  expect(await deps.db.query("SELECT bucket FROM rate_limit", [])).toEqual([]);
});

it("GET /challenge stays within its measured budget", async () => {
  const token = await gate("signup");
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request("/api/v1/run/alpha/signup/challenge", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  // `openTest` (1) + the entry token read (1). The challenge itself is a
  // digest of the token already in hand and costs nothing.
  expect(counting.counts().total).toBe(2);
  expect(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/challenge"]).toBe(2);
});

it("POST /register's budget is unchanged by the proof of work — it is arithmetic, not a read", async () => {
  const token = await gate("signup");
  const { challenge, bits } = await challengeOf("signup", token);
  const solution = solve(challenge, bits);
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request("/api/v1/run/alpha/signup/register", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ values: VALID, solution }),
  });
  expect(res.status).toBe(201);
  expect(counting.counts().total).toBeLessThanOrEqual(
    ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/register"] as number,
  );
});

it("a listed candidate registers the same way — the control is on the route, not on the mode", async () => {
  expect((await solvedRegister("roster", "21CS0147")).status).toBe(201);
  expect(await countCandidates("roster")).toBe(1);
});

it("S-12: consent is still required with a valid solution — the proof of work replaces no rule", async () => {
  const token = await gate("signup");
  const { challenge, bits } = await challengeOf("signup", token);
  const res = await register("signup", token, {
    values: { ...VALID, consent: false },
    solution: solve(challenge, bits),
  });
  expect(res.status).toBe(422);
  expect(CONSENT.version).not.toBe("");
});

// --- the unit the route leans on ---------------------------------------

it("verifyPow is false for a missing, empty, over-long or wrong solution", async () => {
  const challenge = await powChallenge("tok");
  expect(await verifyPow("tok", undefined)).toBe(false);
  expect(await verifyPow("tok", "")).toBe(false);
  expect(await verifyPow("tok", "x".repeat(300))).toBe(false);
  expect(await verifyPow("tok", "1")).toBe(false);
  expect(await verifyPow("tok", solve(challenge))).toBe(true);
});

it("the difficulty is bits, so raising it to one that is not a multiple of four still costs more", () => {
  // At the shipped 16 this branch never runs, which is exactly why it is
  // worth pinning: the operational answer to an overrun deployment is to
  // raise `POW_DIFFICULTY_BITS`, and 18 must really cost four times 16
  // rather than quietly costing the same as it.
  //
  // `0x30…` is `0011 0000…`: two leading zero bits and no more.
  expect(meetsDifficulty("30000000", 2)).toBe(true);
  expect(meetsDifficulty("30000000", 3)).toBe(false);
  expect(meetsDifficulty("0000c000", 16)).toBe(true);
  expect(meetsDifficulty("0000c000", 17)).toBe(false);
  // `0x0000 3…` is seventeen zero bits followed by a one: 17 yes, 18 no.
  expect(meetsDifficulty("00003000", 17)).toBe(true);
  expect(meetsDifficulty("00003000", 18)).toBe(true);
  expect(meetsDifficulty("00003000", 19)).toBe(false);
});

it("S-11: the difficulty really is the stated number of bits, not a prefix of hex characters", async () => {
  // 16 bits is four hex zeros exactly. A digest with three zeros and a
  // non-zero fourth nibble must fail, or the control is a quarter as
  // expensive as it claims.
  const challenge = await powChallenge("tok");
  let threeOnly = "";
  for (let i = 0; threeOnly === ""; i++) {
    const hex = createHash("sha256").update(`${challenge}:${String(i)}`).digest("hex");
    if (hex.startsWith("000") && !hex.startsWith("0000")) threeOnly = String(i);
  }
  expect(await verifyPow("tok", threeOnly)).toBe(false);
});
