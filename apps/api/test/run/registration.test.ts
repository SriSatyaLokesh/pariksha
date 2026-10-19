// Consent and registration, through the real app (#67, P6.3).
//
// Every assertion goes through `app.request()` on a real `createApp(deps)`,
// because the standing decision for this phase is that the server decides
// and the browser displays: a rule proved against the function the route
// happens to call is a rule the route can stop calling.

import { afterAll, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  closeClient,
  getCandidateByExternalId,
  listCandidates,
  replaceCandidateList,
  addMembership,
  createUser,
  insertAuthToken,
  resolvePublishedTest,
} from "@pariksha/db";
import { validateRegistration } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { LIMITS } from "../../src/run/limit.js";
import { POW_DIFFICULTY_BITS } from "../../src/run/pow.js";
import { matchBounded } from "../../src/run/bounded.js";
import { entryHash, readEntryToken, REFUSALS } from "../../src/run/entry.js";
import { sha256Hex } from "../../src/auth/tokens.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import {
  CONSENT,
  INVITED_CANDIDATES,
  ROSTER_CANDIDATES,
  ROSTER_FORM,
  seedPublishedTest,
} from "./fixtures.js";

const T = FIXED_NOW;
let clock = T;

const { deps } = await testDeps({ now: () => clock, env: { APP_URL: "https://pariksha.test" } });
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);

afterAll(() => closeClient(deps.db));

const json = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify(body),
});

const post = (path: string, body: unknown, token?: string): Promise<Response> =>
  app.request(path, json(body, token));

/** One trip through the access gate, which is where an entry token comes
 *  from. A listed test needs the identifier at the gate; a public one
 *  does not. */
async function gate(slug: string, identifier?: string): Promise<string> {
  const res = await post(`/api/v1/run/alpha/${slug}/access`, {
    code: "OPENSESAME",
    ...(identifier === undefined ? {} : { identifier }),
  });
  const body = (await res.json()) as { entryToken?: string };
  if (res.status !== 200 || body.entryToken === undefined) {
    throw new Error(`gate ${slug} answered ${String(res.status)}`);
  }
  return body.entryToken;
}

const form = (slug: string, token?: string): Promise<Response> =>
  app.request(
    `/api/v1/run/alpha/${slug}/form`,
    token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } },
  );

/**
 * A registration, with Task 4's proof of work paid (ADR 0009).
 *
 * The solve is folded into the helper rather than spread over forty call
 * sites, and a challenge this token cannot be issued (spent, expired,
 * earned at another test) falls through with a placeholder — so the
 * route still answers the refusal the test is about, which happens
 * before the bot check, instead of the helper throwing.
 */
const register = async (
  slug: string,
  token: string,
  values: Record<string, unknown>,
): Promise<Response> => {
  const challenged = await app.request(`/api/v1/run/alpha/${slug}/challenge`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const solution =
    challenged.status === 200
      ? solvePow(((await challenged.json()) as { challenge: string }).challenge)
      : "unsolved";
  return post(`/api/v1/run/alpha/${slug}/register`, { values, solution }, token);
};

/** Node's synchronous SHA-256, so forty registrations do not spend forty
 *  bursts of WebCrypto promises. Same arithmetic as `verifyPow`. */
function solvePow(challenge: string): string {
  const prefix = "0".repeat(POW_DIFFICULTY_BITS >> 2);
  for (let i = 0; ; i++) {
    if (createHash("sha256").update(`${challenge}:${String(i)}`).digest("hex").startsWith(prefix)) {
      return String(i);
    }
  }
}

const VALID = {
  roll: "21CS0147",
  email: "ananya@vce.ac.in",
  full_name: "Ananya",
  cgpa: 9.1,
  consent: true,
};

const testIdOf = async (slug: string): Promise<string> => {
  const test = await resolvePublishedTest(deps.db, "alpha", slug, clock);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  return test.testId;
};

const versionOf = async (slug: string): Promise<string> => {
  const test = await resolvePublishedTest(deps.db, "alpha", slug, clock);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  return test.testVersionId;
};

const registeredRows = async (slug: string): Promise<number> =>
  (await listCandidates(deps.db, workspaceId, await testIdOf(slug))).filter(
    (row) => row.registeredAt !== null,
  ).length;

const claimRows = async (slug: string): Promise<{ field_id: string; value_hash: string }[]> =>
  deps.db.query<{ field_id: string; value_hash: string }>(
    "SELECT field_id, value_hash FROM candidate_unique WHERE test_id = ?",
    [await testIdOf(slug)],
  );

const errorOf = async (res: Response): Promise<{ code: string; message: string; details?: unknown }> =>
  ((await res.json()) as { error: { code: string; message: string; details?: unknown } }).error;

const issuesOf = async (res: Response): Promise<{ field: string; code: string; message: string }[]> =>
  ((await errorOf(res)).details as { issues: { field: string; code: string; message: string }[] })
    .issues;

/** Every registration test starts from a clean slate: the candidate
 *  tables, the tokens the gate minted, and the rate-limit buckets. */
beforeEach(async () => {
  clock = T;
  await deps.db.run("DELETE FROM candidate_unique", []);
  await deps.db.run("DELETE FROM auth_token", []);
  await deps.db.run("DELETE FROM rate_limit", []);
  for (const slug of ["signup", "roster"]) {
    await deps.db.run("DELETE FROM candidate WHERE test_id = ?", [await testIdOf(slug)]);
  }
  await replaceCandidateList(
    deps.db,
    workspaceId,
    await testIdOf("roster"),
    ROSTER_CANDIDATES,
    T,
  );
});

// --- the gate in front of both routes ----------------------------------

it("the form route answers only behind a live entry token", async () => {
  expect((await form("signup")).status).toBe(401);
  expect((await form("signup", "a".repeat(43))).status).toBe(410);
});

it("T2-I-1: the entry row is keyed by the token salted with its test version", async () => {
  // The salt and `asClaim`'s comparison are belt and braces, and each
  // hides the other from an end-to-end probe — so the salt is pinned
  // here, against the digest actually stored. Without it the row is
  // findable at every test on the instance, and only the claim check
  // stands between a `link_code` candidate and an `invite_only` paper.
  const token = await gate("signup");
  const version = await versionOf("signup");
  const stored = await deps.db.query<{ token_hash: string }>(
    "SELECT token_hash FROM auth_token WHERE kind = 'run_entry'",
    [],
  );
  expect(stored.map((row) => row.token_hash)).toEqual([await entryHash(version, token)]);
  expect(stored[0]?.token_hash).not.toBe(await sha256Hex(token));
});

it("T2-I-1: a live row whose claim names another test version is still refused", async () => {
  // The other half, pinned where the salt cannot reach it: the row is
  // written under this test's own salt, so it is found — and refused
  // anyway, because the claim inside it is for somewhere else.
  const token = "b".repeat(43);
  const version = await versionOf("signup");
  await insertAuthToken(deps.db, {
    tokenHash: await entryHash(version, token),
    kind: "run_entry",
    payload: { testVersionId: await versionOf("roster"), workspaceId },
    now: T,
    expiresAt: T + 60_000,
  });
  expect(await readEntryToken(deps, version, token)).toBeNull();
  expect((await form("signup", token)).status).toBe(410);
});

it("T2-I-1: an entry token earned at one test is refused at another", async () => {
  // The digest is salted with the test version and `asClaim` compares it,
  // so a candidate who passed any open `link_code` test holds nothing at
  // the gated one. Without the salt this answered 200.
  const elsewhere = await gate("signup");
  expect((await form("roster", elsewhere)).status).toBe(410);
  expect((await register("roster", elsewhere, VALID)).status).toBe(410);
});

it("the entry token is single use and cannot be replayed at registration", async () => {
  const token = await gate("signup");
  expect((await register("signup", token, VALID)).status).toBe(201);
  expect((await register("signup", token, VALID)).status).toBe(410);
});

it("a refused registration does not burn the entry token", async () => {
  const token = await gate("signup");
  expect((await register("signup", token, { ...VALID, cgpa: 11 })).status).toBe(422);
  // The candidate fixes the typo in the same tab rather than being sent
  // back through the access gate.
  expect((await register("signup", token, VALID)).status).toBe(201);
});

it("S-10: the form route carries no access code and no question", async () => {
  const text = await (await form("signup", await gate("signup"))).text();
  for (const leak of ["OPENSESAME", "qst_"]) expect(text, leak).not.toContain(leak);
});

it("S-12: the form route is where the consent text and its version arrive", async () => {
  const body = (await (await form("signup", await gate("signup"))).json()) as {
    consent: { version: string; text: string };
    form: { fields: { id: string }[] };
  };
  expect(body.consent).toEqual(CONSENT);
  expect(body.form.fields.map((f) => f.id)).toEqual(ROSTER_FORM.fields.map((f) => f.id));
});

// --- AC-12: the server decides -----------------------------------------

it("AC-12: an invalid submission is 422, names every bad field, writes no candidate", async () => {
  const res = await register("signup", await gate("signup"), {
    ...VALID,
    email: "nope",
    cgpa: 11,
  });
  expect(res.status).toBe(422);
  expect((await issuesOf(res)).map((i) => i.field).sort()).toEqual(["cgpa", "email"]);
  expect(await registeredRows("signup")).toBe(0);
  expect(await claimRows("signup")).toEqual([]);
});

it("AC-12: the server refuses a rule the browser was patched to skip", async () => {
  const res = await register("signup", await gate("signup"), { ...VALID, roll: "not-a-roll" });
  expect(res.status).toBe(422);
  expect((await issuesOf(res))[0]).toMatchObject({ field: "roll", code: "pattern" });
});

it("AC-12: the message the server answers with is the one the browser would have shown", async () => {
  const res = await register("signup", await gate("signup"), { ...VALID, roll: "x" });
  const server = (await issuesOf(res))[0];
  // The browser's copy: the same function, with the browser's matcher.
  const browser = validateRegistration(ROSTER_FORM, { ...VALID, roll: "x" })[0];
  expect(server?.message).toBe(browser?.message);
  expect(server?.message).toBe("Format: 21CS0147");
});

it("S-12: registering without accepting the consent is refused on the consent field", async () => {
  const res = await register("signup", await gate("signup"), { ...VALID, consent: false });
  expect(res.status).toBe(422);
  expect((await issuesOf(res)).map((i) => i.field)).toContain("consent");
  expect(await registeredRows("signup")).toBe(0);
});

it("S-12: the consent version and the acceptance time are stored per candidate", async () => {
  clock = T + 60_000;
  expect((await register("signup", await gate("signup"), VALID)).status).toBe(201);
  const rows = await listCandidates(deps.db, workspaceId, await testIdOf("signup"));
  expect(rows[0]).toMatchObject({
    consentVersion: CONSENT.version,
    registeredAt: T + 60_000,
    source: "registration",
  });
});

it("S-11: a value the form never asked for is dropped rather than stored", async () => {
  await register("signup", await gate("signup"), { ...VALID, secret: "x", admin: true });
  const rows = await listCandidates(deps.db, workspaceId, await testIdOf("signup"));
  expect(Object.keys(rows[0]?.formValues ?? {}).sort()).toEqual([
    "cgpa",
    "email",
    "full_name",
    "roll",
  ]);
});

it("#129: an organiser's unsafe pattern lets the candidate through, and a too-long value does not", () => {
  // The candidate is never punished for the author's regex — that is what
  // `unsatisfiableValidation` tells the organiser at publish.
  expect(matchBounded("([a-z]+)+$", "aaaaaaaaaaaaaaaaaaaaaaaaaaa!")).toBe(true);
  expect(matchBounded("^a+$", "aaa")).toBe(true);
  expect(matchBounded("^a+$", "b")).toBe(false);
});

it("#129: a value longer than the matcher's ceiling is a positioned 422, never a 500", async () => {
  const res = await register("signup", await gate("signup"), {
    ...VALID,
    roll: "a".repeat(501),
  });
  expect(res.status).toBe(422);
  expect((await issuesOf(res))[0]).toMatchObject({ field: "roll", code: "too_long" });
});

// --- T-17: unique fields ------------------------------------------------

it("AC-12: a repeat of a unique field is refused and the field is named", async () => {
  expect((await register("signup", await gate("signup"), VALID)).status).toBe(201);
  const res = await register("signup", await gate("signup"), {
    ...VALID,
    roll: "21CS9999",
    full_name: "Someone Else",
  });
  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({ details: { fields: ["email"] } });
});

it("a refused duplicate leaves no second candidate row and no partial claim", async () => {
  await register("signup", await gate("signup"), VALID);
  await register("signup", await gate("signup"), { ...VALID, roll: "21CS9999" });
  expect(await registeredRows("signup")).toBe(1);
  expect((await claimRows("signup")).filter((row) => row.field_id === "roll")).toHaveLength(1);
});

it("two registrations racing on the same unique value: exactly one candidate exists", async () => {
  const [a, b] = await Promise.all([
    register("signup", await gate("signup"), VALID),
    register("signup", await gate("signup"), { ...VALID, full_name: "Also Ananya" }),
  ]);
  // One writes the row; the other finds every one of its unique values
  // already held by that same candidate, which is re-entry (`T-14`), not
  // an impostor. Either way there is exactly one candidate.
  expect([a.status, b.status].sort()).toEqual([200, 201]);
  expect(await registeredRows("signup")).toBe(1);
});

it("S-15: the unique table stores a hash, never the value", async () => {
  await register("signup", await gate("signup"), VALID);
  const rows = await claimRows("signup");
  expect(rows).toHaveLength(2);
  expect(JSON.stringify(rows)).not.toContain("ananya@vce.ac.in");
  expect(JSON.stringify(rows)).not.toContain("21CS0147");
  for (const row of rows) expect(row.value_hash).toMatch(/^[0-9a-f]{64}$/);
});

it("a unique value is matched after normalisation, so case and spacing are not a second identity", async () => {
  await register("signup", await gate("signup"), VALID);
  const res = await register("signup", await gate("signup"), {
    ...VALID,
    roll: "21CS9999",
    email: "  Ananya@VCE.ac.in  ",
    full_name: "Someone Else",
  });
  expect(res.status).toBe(409);
});

// --- T-14: re-entry -----------------------------------------------------

it("T-14: the same candidate coming back is recognised, not refused", async () => {
  expect((await register("signup", await gate("signup"), VALID)).status).toBe(201);
  const again = await register("signup", await gate("signup"), VALID);
  expect(again.status).toBe(200);
  expect(((await again.json()) as { registrationToken: string }).registrationToken).toMatch(/\w/);
  expect(await registeredRows("signup")).toBe(1);
});

// --- T-21: a registration reconciles with the list row ------------------

it("a self-registration writes its own external_id, so the backstop exists on a public test", async () => {
  // `(test_id, external_id)` is the race backstop the 409 rests on. A
  // registration that left the column null would leave a public test
  // with no backstop at all — only uploads would ever fill it.
  await register("signup", await gate("signup"), VALID);
  const row = await getCandidateByExternalId(
    deps.db,
    workspaceId,
    await testIdOf("signup"),
    "21CS0147",
  );
  expect(row).toMatchObject({ source: "registration", externalId: "21CS0147" });
});

it("a candidate admitted as one listed identity cannot register as another", async () => {
  // The gate said who this is. Re-entry by matching unique values is the
  // bare `link_code` path only — here it would hand `21CS0148` the
  // registration token of `21CS0147`, whose attempt is already running.
  await register("roster", await gate("roster", "21CS0147"), VALID);
  const res = await register("roster", await gate("roster", "21CS0148"), VALID);
  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({ details: { fields: ["email", "roll"] } });
});

it("a listed candidate's registration fills their own row rather than inserting beside it", async () => {
  const token = await gate("roster", "21CS0147");
  expect((await register("roster", token, VALID)).status).toBe(201);

  const rows = await listCandidates(deps.db, workspaceId, await testIdOf("roster"));
  expect(rows).toHaveLength(2);
  const row = rows.find((one) => one.externalId === "21CS0147");
  expect(row).toMatchObject({
    // `source` stays "list": it is the provenance of the row, and
    // `consent_at` is what says they registered.
    source: "list",
    // T-09: the set survives, or Task 5's `assignSet` loses its listValue.
    setLabel: "A",
    registeredAt: T,
  });
  expect(row?.formValues).toMatchObject({ full_name: "Ananya", email: "ananya@vce.ac.in" });
});

it("a registered listed candidate is recognised at the form, and the form is skipped", async () => {
  await register("roster", await gate("roster", "21CS0147"), VALID);
  const res = await form("roster", await gate("roster", "21CS0147"));
  expect(res.status).toBe(200);
  expect((await res.json()) as { registered?: boolean }).toMatchObject({ registered: true });
});

it("a second person presenting a registered identifier cannot overwrite what the first typed", async () => {
  await register("roster", await gate("roster", "21CS0147"), VALID);
  const before = await getCandidateByExternalId(
    deps.db,
    workspaceId,
    await testIdOf("roster"),
    "21CS0147",
  );

  const res = await register("roster", await gate("roster", "21CS0147"), {
    ...VALID,
    email: "impostor@vce.ac.in",
    full_name: "Impostor",
  });
  // Re-entry rather than a refusal — the gate's own list check is the
  // barrier, and `T-14` needs this path — but it writes nothing.
  expect(res.status).toBe(200);
  expect(
    await getCandidateByExternalId(deps.db, workspaceId, await testIdOf("roster"), "21CS0147"),
  ).toEqual(before);
});

it("B3: an invite survives a list re-upload, because it keys on the identity not the row id", async () => {
  // `alpha/invited` is the `invite_only` test over a candidate list — the
  // one mode where the link is the whole credential, and therefore the
  // one where a dead link is a locked-out cohort.
  const testId = await testIdOf("invited");
  const minted = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/invites`, {
    ...json({ identifiers: ["21CS0147"] }),
    headers: await invitesHeaders(),
  });
  expect(minted.status, await minted.clone().text()).toBe(200);
  const { invites } = (await minted.json()) as { invites: { url?: string }[] };
  const url = invites[0]?.url ?? "";
  expect(url).not.toBe("");

  // The organiser fixes a typo and uploads the identical list again:
  // every unregistered row is deleted and re-inserted with a fresh
  // `cnd_` id, while the invite's `external_id` is unchanged. Keying the
  // payload on the row id would have killed every link in the cohort.
  const before = await getCandidateByExternalId(deps.db, workspaceId, testId, "21CS0147");
  await replaceCandidateList(deps.db, workspaceId, testId, INVITED_CANDIDATES, T + 1);
  const after = await getCandidateByExternalId(deps.db, workspaceId, testId, "21CS0147");
  expect(after?.id).not.toBe(before?.id);

  const invite = new URL(url).searchParams.get("invite") ?? "";
  const redeemed = await post("/api/v1/run/alpha/invited/access", { invite });
  expect(redeemed.status, await redeemed.clone().text()).toBe(200);

  // And the entry it mints is bound to the row that exists *now*. The
  // payload's own `candidateId` is the id the row had at mint time and
  // is already stale; trusting it would give Task 5 a `listRef` pointing
  // at nothing, so the set label and the prefill would both be lost.
  const { entryToken } = (await redeemed.json()) as { entryToken: string };
  expect(await readEntryToken(deps, await versionOf("invited"), entryToken)).toMatchObject({
    listRef: after?.id,
  });
});

// --- S-07: the limiter --------------------------------------------------

/** Fills a bucket to the brim without spending a thousand requests on it.
 *  The row is exactly what `takeRateToken` would have written. */
async function fillBucket(kind: keyof typeof LIMITS, key: string): Promise<void> {
  await deps.db.run("INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, ?)", [
    `${kind}:${key}`,
    clock,
    LIMITS[kind].limit,
  ]);
}

it("S-07: registrations past the window's ceiling are refused", async () => {
  await fillBucket("test_register", await versionOf("signup"));
  const res = await register("signup", await gate("signup"), VALID);
  expect(res.status).toBe(429);
  expect((await errorOf(res)).code).toBe("too_many_attempts");
});

it("S-07: the access gate counts refusals and never successes", async () => {
  const bucket = `test_access:${await versionOf("signup")}`;
  const count = async (): Promise<number> =>
    Number(
      (
        await deps.db.query<{ count: number }>("SELECT count FROM rate_limit WHERE bucket = ?", [
          bucket,
        ])
      )[0]?.count ?? 0,
    );

  // 500 candidates typing the right code cost the bucket nothing, which
  // is the whole point: a counted success is a lockout on test day.
  await gate("signup");
  expect(await count()).toBe(0);

  expect((await post("/api/v1/run/alpha/signup/access", { code: "nope" })).status).toBe(403);
  expect(await count()).toBe(1);
});

it("S-07: a malformed request is not a guess at the secret, so it is not charged", async () => {
  const bucket = `test_access:${await versionOf("signup")}`;
  // An empty body answers 400 `invalid_request`. Charging it would mean
  // the `public` reachability probes in `route-authority.test.ts` wrote
  // rate-limit rows, and a broken client could lock out a whole hall.
  expect((await post("/api/v1/run/alpha/signup/access", {})).status).toBe(400);
  expect(
    await deps.db.query("SELECT bucket FROM rate_limit WHERE bucket = ?", [bucket]),
  ).toEqual([]);
});

it("#129: an unsafe organiser pattern is never compiled on the server", async () => {
  // `(a+)+$` against forty `a`s and one character that cannot match is
  // 2^40 backtracking paths for a plain `RegExp.test`, which is what the
  // browser's matcher is — the organiser's defect, and one the candidate
  // must not pay for. The server injects `matchBounded`, which refuses
  // to compile an unsafe pattern at all and lets the value through: this
  // answers in milliseconds, and a server that forgot to inject the
  // bounded matcher never answers at all.
  const token = await gate("unsafe");
  const res = await register("unsafe", token, { roll: `${"a".repeat(40)}!`, consent: true });
  expect(res.status).toBe(201);
});

it("S-07: once the refusal bucket is empty the gate says to wait, and the code is not tried", async () => {
  await fillBucket("test_access", await versionOf("signup"));
  const res = await post("/api/v1/run/alpha/signup/access", { code: "nope" });
  expect(res.status).toBe(429);
  expect((await errorOf(res)).code).toBe("too_many_attempts");
  // A right code is still a right code: successes are not charged, so the
  // honest candidate in the same hall is unaffected.
  expect((await post("/api/v1/run/alpha/signup/access", { code: "OPENSESAME" })).status).toBe(200);
});

it("S-07: the window starts again once it has passed", async () => {
  await fillBucket("test_access", await versionOf("signup"));
  clock = T + LIMITS.test_access.windowMs;
  expect((await post("/api/v1/run/alpha/signup/access", { code: "nope" })).status).toBe(403);
});

it("C-02: too_many_attempts tells the candidate what to do next", () => {
  expect(REFUSALS.too_many_attempts.message).toMatch(/\bwait\b/i);
  expect(REFUSALS.too_many_attempts.status).toBe(429);
});

// --- measured budgets ---------------------------------------------------

/** The proof of work for one entry token, off the real `/challenge`
 *  route — the budget below measures `/register` alone, so the solve
 *  happens outside the counted app. */
async function solutionFor(slug: string, token: string): Promise<string> {
  const res = await app.request(`/api/v1/run/alpha/${slug}/challenge`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return solvePow(((await res.json()) as { challenge: string }).challenge);
}

const measure = async (run: (request: typeof app.request) => Promise<unknown>): Promise<number> => {
  const counting = countingDeps(deps);
  const scoped = createApp(counting.deps);
  await run((...args) => scoped.request(...args));
  return counting.counts().total;
};

it("GET /form stays within its measured budget", async () => {
  // The most expensive path: a listed candidate who has already
  // registered, so the row is read and a replacement registration token
  // is minted.
  await register("roster", await gate("roster", "21CS0147"), VALID);
  const token = await gate("roster", "21CS0147");
  const spent = await measure(async (request) => {
    const res = await request(`/api/v1/run/alpha/roster/form`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
  expect(spent).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/form"]);
});

it("POST /register stays within its measured budget", async () => {
  // The most expensive path: a listed candidate (so the list row is
  // read) whose email is already held by someone else — the batch fails
  // and the claims are read once to name the field.
  await register("roster", await gate("roster", "21CS0147"), VALID);
  const token = await gate("roster", "21CS0148");
  const solution = await solutionFor("roster", token);
  const spent = await measure(async (request) => {
    const res = await request(
      `/api/v1/run/alpha/roster/register`,
      json({ values: { ...VALID, roll: "21CS0148" }, solution }, token),
    );
    expect(res.status).toBe(409);
  });
  expect(spent).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/register"]);
});

it("T-14 re-entry costs no more than a refusal, so neither path exceeds the budget", async () => {
  await register("signup", await gate("signup"), VALID);
  const token = await gate("signup");
  const solution = await solutionFor("signup", token);
  const spent = await measure(async (request) => {
    const res = await request(
      `/api/v1/run/alpha/signup/register`,
      json({ values: VALID, solution }, token),
    );
    expect(res.status).toBe(200);
  });
  expect(spent).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/register"]);
});

it("the access gate's budget is unchanged by the limiter, because a success is not charged", async () => {
  const spent = await measure(async (request) => {
    const res = await request(
      "/api/v1/run/alpha/gauntlet/access",
      json({ email: "ananya@vce.ac.in", otp: "000000", identifier: "21CS0147" }),
    );
    // A wrong OTP, so this one *is* charged — the measurement that
    // matters is the success below.
    expect(res.status).toBe(401);
  });
  expect(spent).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/access"]);
});

// --- helpers that need a session ---------------------------------------

/** The invites route is the one organiser route this phase mounts, and
 *  minting one is how the re-upload assertion above gets a link. */
async function invitesHeaders(): Promise<Record<string, string>> {
  return {
    "content-type": "application/json",
    cookie: await ownerCookie(),
  };
}

let cachedCookie = "";
async function ownerCookie(): Promise<string> {
  if (cachedCookie !== "") return cachedCookie;
  const userId = await createUser(deps.db, {
    email: "registration-owner@alpha.test",
    authProvider: "magic_link",
    now: T,
  });
  await addMembership(deps.db, workspaceId, { userId, role: "owner", now: T });
  cachedCookie = await sessionCookie(deps, (await issueSession(deps, userId)).token);
  return cachedCookie;
}
