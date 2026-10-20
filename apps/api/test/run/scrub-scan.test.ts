// `AC-22`'s gate: nothing a candidate can reach may carry an answer key, a
// correct answer, an explanation, rubric, model answer, accepted pattern,
// tolerance, access code or another candidate's data — in any response, on
// any route, in any state.
//
// **The scan, not the suite.** A sentinel fixture (`fixtures/run/sentinel-
// bank.json`) carries one unmistakable string per secret field, across all
// twelve question types. It is played through a real candidate (and a
// second, so cross-candidate leakage has something to be wrong about) over
// every endpoint `ROUTE_AUTH` marks `attempt`, `entry` or a `public` route
// under `/run/` — every endpoint a candidate can reach holding nothing more
// than the credential their own journey minted. The list is derived from
// `ROUTE_AUTH` at run time, not written by hand: a route Phase 7 or 8 mounts
// without a line here either has no test replaying it (the coverage
// assertion below fails) or is scanned for the same sentinels automatically.
//
// This deliberately widens past the plan sketch's `attempt | public`
// filter to include `entry` as well. `entry`-authority routes (`/form`,
// `/register`, `/challenge`, `/start`) are reachable by anyone holding only
// the token the access gate just handed them — no workspace membership, no
// attempt yet — which is exactly the candidate-reachable surface `AC-22`
// is about. Excluding them would leave the registration form and the
// paper's own minting unscanned.
//
// One by-design exception to the internal-identifier check: `qst_` is not
// scanned for. `CandidateQuestion.id` **is** the stored row id (see
// `scrub.ts`'s doc comment) — opaque, random, naming no bank and no test —
// and a candidate must get it back to submit an answer against it. Scanning
// for it would fail every response in this file including the ones the
// product requires to work.

import { afterAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  closeClient,
  createBank,
  replaceCandidateList,
  resolvePublishedTest,
  upsertQuestions,
  type NewCandidate,
} from "@pariksha/db";
import { QUESTION_TYPES, type Question } from "@pariksha/core";
import { createApp, ROUTE_AUTH, type RouteAuthority } from "../../src/app.js";
import type { EmailMessage } from "../../src/email/adapter.js";
import { forCandidate, type CandidateQuestion } from "../../src/run/scrub.js";
import { POW_DIFFICULTY_BITS } from "../../src/run/pow.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { CONSENT, DAY, iso, seedTest, seedWorkspace } from "./fixtures.js";
import { startAttemptFor } from "./paper-fixtures.js";
import sentinelDocsJson from "../fixtures/run/sentinel-bank.json" with { type: "json" };

const sentinelDocs = sentinelDocsJson as unknown as Question[];

const T = FIXED_NOW;
let clock = T;

// --- the secrets --------------------------------------------------------

/**
 * Secrets that may **never** appear in any candidate response, in any
 * state — including a released `full_review`. `S-10` keeps a manual
 * question's model answer and rubric out of a candidate's hands even
 * once the test is fully reviewable: `answerKeyOf` (`release.ts`) answers
 * `null` for `short_answer`/`long_answer` for exactly this reason, so
 * these four and the access code are absolute.
 */
const ABSOLUTE_SECRETS = ["__MODELANS_SHORT__", "__MODELANS_LONG__", "__RUBRIC_SHORT__", "__RUBRIC_LONG__", "__ACCESS_CODE__"];

/**
 * Secrets that are withheld everywhere **except** the one response a
 * released `full_review` legitimately builds for the candidate it belongs
 * to, at the moment it is released (`T-22`). `EXEMPT_BODIES` below is
 * exactly that one response, by exact string identity — not by endpoint —
 * so every other reply through the same route is still held to the full
 * list.
 */
const CONDITIONAL_SECRETS = [
  "__EXPL_SINGLE__",
  "__EXPL_MULTIPLE__",
  "__EXPL_SELECTK__",
  "__EXPL_TRUEFALSE__",
  "__EXPL_ASSERTION__",
  "__EXPL_MATCHING__",
  "__EXPL_MULTIMATCH__",
  "__EXPL_ORDERING__",
  "__EXPL_FILLBLANK__",
  "__EXPL_NUMERIC__",
  "__EXPL_SHORT__",
  "__EXPL_LONG__",
  "__ACCEPT_FILLBLANK__",
];

const SECRETS = [...ABSOLUTE_SECRETS, ...CONDITIONAL_SECRETS];

/** Internal row-id prefixes a candidate response must never carry.
 *  `qst_` is deliberately excluded — see the header. */
const INTERNAL = ["wsp_", "bnk_", "ver_", "usr_"];

/** Filled in once the release-variant replays have run: the exact bodies
 *  of the one case `AC-22` carves out — `full_review`, released, to the
 *  candidate it belongs to. Checked by reference to the string itself, so
 *  a body that happens to equal it by coincidence is (rightly) exempted
 *  too, and nothing else ever is. */
const EXEMPT_BODIES = new Set<string>();

/** Fails loudly, naming the endpoint and the string, rather than silently
 *  passing on an empty body — the property the self-check below proves. */
function assertNoSecrets(endpoint: string, body: string): void {
  const secrets = EXEMPT_BODIES.has(body) ? ABSOLUTE_SECRETS : SECRETS;
  for (const s of secrets) {
    expect(body, `${endpoint} leaked ${s}`).not.toContain(s);
  }
  for (const p of INTERNAL) {
    expect(body, `${endpoint} leaked internal id ${p}`).not.toContain(p);
  }
}

// --- the route set, derived from ROUTE_AUTH, never hand-written ---------

const isCandidateReachable = ([endpoint, authority]: [string, RouteAuthority]): boolean =>
  authority === "attempt" || authority === "entry" || (authority === "public" && endpoint.includes("/run/"));

const CANDIDATE_ENDPOINTS = Object.entries(ROUTE_AUTH).filter(isCandidateReachable) as [
  string,
  RouteAuthority,
][];

// --- fixtures -------------------------------------------------------------

const { deps } = await testDeps({ now: () => clock });
const sent: EmailMessage[] = [];
deps.email = {
  send: async (message) => {
    sent.push(message);
    await Promise.resolve();
  },
};
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const workspaceId = await seedWorkspace(deps, "alpha", "Sentinel Co");
const bankId = await createBank(deps.db, workspaceId, { name: "Sentinel bank", now: T });
const { ids: sentinelIds } = await upsertQuestions(deps.db, workspaceId, bankId, sentinelDocs, T);
/** Logical ref (`SNT-SINGLE`, ...) to the `qst_` row id. */
const q: Record<string, string> = {};
sentinelDocs.forEach((doc, i) => {
  q[doc.id] = sentinelIds[i] as string;
});

const openWindow = { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) };
const SENTINEL_FORM = {
  fields: [
    { id: "roll", type: "short_text" as const, label: "Roll number", required: true, unique: true },
    { id: "email", type: "email" as const, label: "Email address", required: true },
    { id: "full_name", type: "short_text" as const, label: "Full name", required: true },
  ],
};
const SENTINEL_LIST: NewCandidate[] = [
  { externalId: "SNT-A", setLabel: null, formValues: {} },
  // Every one of B's identity values is a sentinel, not just their name:
  // a leak of another candidate's roll number or registered address is
  // exactly the leak this control exists to catch, and until the final
  // review only `full_name` carried a string the scan could see.
  { externalId: "__OTHERROLL__", setLabel: null, formValues: {} },
];

// `full`: every type, a candidate list of two, linear navigation (so a
// back-navigation refusal has something to refuse), release on submit.
await seedTest(deps, workspaceId, {
  name: "Full",
  slug: "full",
  body: {
    settings: {
      timing: { ...openWindow, navigation: "linear" as const },
      access: { mode: "link_code", access_code: "__ACCESS_CODE__", candidate_list: "list.csv" },
      consent: CONSENT,
      registration_form: SENTINEL_FORM,
      release: { when: "on_submit", show: "score_and_sections" },
    },
    sections: [
      {
        id: "every",
        title: "Every type",
        shuffle_questions: false,
        source: { kind: "fixed", questions: sentinelDocs.map((d) => q[d.id] as string) },
      },
    ],
  },
});
async function testIdOf(slug: string): Promise<string> {
  const test = await resolvePublishedTest(deps.db, "alpha", slug, T);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  return test.testId;
}
await replaceCandidateList(deps.db, workspaceId, await testIdOf("full"), SENTINEL_LIST, T);

// Release variants — two scored questions each, free navigation so the
// release gate is the only thing under test.
const RELEASE_SECTIONS = [
  { id: "s", title: "Scored", shuffle_questions: false, source: { kind: "fixed" as const, questions: [q["SNT-SINGLE"] as string, q["SNT-SHORT"] as string] } },
];
const RELEASES: { slug: string; release: Record<string, unknown>; attempts?: number }[] = [
  { slug: "rel-review", release: { when: "on_submit", show: "full_review" } },
  { slug: "rel-review-retake", release: { when: "on_submit", show: "full_review" }, attempts: 2 },
  { slug: "rel-later", release: { when: "on_date", at: iso(T + DAY), show: "full_review" } },
];
for (const r of RELEASES) {
  await seedTest(deps, workspaceId, {
    name: r.slug,
    slug: r.slug,
    body: {
      settings: {
        timing: { ...openWindow, navigation: "free", ...(r.attempts ? { attempts_allowed: r.attempts } : {}) },
        access: { mode: "link_code", access_code: "OPEN2" },
        registration_form: { fields: [{ id: "roll", type: "short_text" as const, label: "Roll", required: true, unique: true }] },
        release: r.release,
      },
      sections: RELEASE_SECTIONS,
    },
  });
}

// One tiny, fast-expiring test for the deadline refusal.
await seedTest(deps, workspaceId, {
  name: "Timeout",
  slug: "timeout",
  body: {
    settings: {
      timing: { ...openWindow, duration_minutes: 1, navigation: "free" as const },
      access: { mode: "link_code", access_code: "OPEN2" },
      registration_form: { fields: [{ id: "roll", type: "short_text" as const, label: "Roll", required: true, unique: true }] },
    },
    sections: [{ id: "only", title: "Only", shuffle_questions: false, source: { kind: "fixed", questions: [q["SNT-SINGLE"] as string] } }],
  },
});

// --- recording every reply ------------------------------------------------

/** Every response body recorded, keyed by the exact `ROUTE_AUTH` string it
 *  answers for — the coverage assertion checks this set against
 *  `CANDIDATE_ENDPOINTS` directly. */
const seen = new Map<string, string[]>();
function record(endpoint: string, body: string): void {
  const list = seen.get(endpoint) ?? [];
  list.push(body);
  seen.set(endpoint, list);
}
async function recordJson(endpoint: string, res: Response): Promise<unknown> {
  const text = await res.clone().text();
  record(endpoint, text);
  return text.length > 0 ? (JSON.parse(text) as unknown) : null;
}

const json = (body: unknown, token?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

/** Node's synchronous SHA-256 — same arithmetic as `verifyPow`, borrowed
 *  from `registration.test.ts` so forty solves do not spend forty bursts of
 *  WebCrypto promises. */
function solvePow(challenge: string): string {
  const prefix = "0".repeat(POW_DIFFICULTY_BITS >> 2);
  for (let i = 0; ; i++) {
    if (createHash("sha256").update(`${challenge}:${String(i)}`).digest("hex").startsWith(prefix)) {
      return String(i);
    }
  }
}

interface CandidateFlow {
  attemptId: string;
  candidateId: string;
  cookie: string;
  paper: AttemptPaper;
}

/** The whole candidate journey, through the real routes: landing, the
 *  access gate, the registration form, the proof-of-work challenge,
 *  registration itself, and `/start` — every `entry`- and candidate-
 *  `public`-authority route this phase mounts, recorded as it goes. */
async function fullJourney(identifier: string, fullName: string, email: string): Promise<CandidateFlow> {
  record("GET /api/v1/run/:workspaceSlug/:testSlug", await (await app.request("/api/v1/run/alpha/full")).clone().text());

  const accessRes = await app.request(
    "/api/v1/run/alpha/full/access",
    json({ code: "__ACCESS_CODE__", identifier }),
  );
  const accessBody = (await recordJson("POST /api/v1/run/:workspaceSlug/:testSlug/access", accessRes)) as {
    entryToken: string;
  };
  const entryToken = accessBody.entryToken;

  // `email-code` and `sso/start` do not apply to this access mode; both
  // still answer (a refusal, not a leak) and both are scanned.
  record(
    "POST /api/v1/run/:workspaceSlug/:testSlug/email-code",
    await (await app.request("/api/v1/run/alpha/full/email-code", json({ email }))).clone().text(),
  );
  record(
    "GET /api/v1/run/:workspaceSlug/:testSlug/sso/start",
    await (await app.request("/api/v1/run/alpha/full/sso/start")).clone().text(),
  );
  record(
    "GET /api/v1/run/:workspaceSlug/:testSlug/sso/callback",
    await (await app.request("/api/v1/run/alpha/full/sso/callback")).clone().text(),
  );

  record(
    "GET /api/v1/run/:workspaceSlug/:testSlug/form",
    await (
      await app.request("/api/v1/run/alpha/full/form", { headers: { authorization: `Bearer ${entryToken}` } })
    ).clone().text(),
  );

  const challengeRes = await app.request("/api/v1/run/alpha/full/challenge", {
    headers: { authorization: `Bearer ${entryToken}` },
  });
  const challengeBody = (await recordJson(
    "GET /api/v1/run/:workspaceSlug/:testSlug/challenge",
    challengeRes,
  )) as { challenge: string };
  const solution = solvePow(challengeBody.challenge);

  const registerRes = await app.request(
    "/api/v1/run/alpha/full/register",
    json({ values: { roll: identifier, email, full_name: fullName, consent: true }, solution }, entryToken),
  );
  const registerBody = (await recordJson(
    "POST /api/v1/run/:workspaceSlug/:testSlug/register",
    registerRes,
  )) as { registrationToken: string };

  const startRes = await app.request("/api/v1/run/alpha/full/start", {
    method: "POST",
    headers: { authorization: `Bearer ${registerBody.registrationToken}` },
  });
  const paper = (await recordJson("POST /api/v1/run/:workspaceSlug/:testSlug/start", startRes)) as AttemptPaper;
  const cookie = (startRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  const rows = await deps.db.query<{ candidate_id: string }>(
    "SELECT candidate_id FROM attempt WHERE id = ?",
    [paper.attemptId],
  );
  return { attemptId: paper.attemptId, candidateId: rows[0]!.candidate_id, cookie, paper };
}

const answer = (cookie: string, questionId: string, value: unknown, clientSeq: number): Promise<Response> =>
  app.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ questionId, value, clientSeq }),
  });

// --- candidate A: the main flow over every type --------------------------

const A = await fullJourney("SNT-A", "Ananya Sentinel", "ananya@uni.ac.in");

// Forward is always allowed under `linear`; answer the *last* question
// first so `max_index` advances past every earlier one, then prove a
// write back into an earlier question is refused — `AC-15`, scanned.
const lastId = A.paper.sections[0]!.questions.at(-1)!.id;
const firstId = A.paper.sections[0]!.questions[0]!.id;
record(
  "PUT /api/v1/run/attempt/answer",
  await (await answer(A.cookie, lastId, { kind: "text", text: "An answer." }, 1)).clone().text(),
);
record(
  "PUT /api/v1/run/attempt/answer",
  await (await answer(A.cookie, firstId, { kind: "option", option: "a" }, 2)).clone().text(),
);

record("GET /api/v1/run/attempt", await (await app.request("/api/v1/run/attempt", { headers: { cookie: A.cookie } })).clone().text());

// The media on A's own paper, and a key outside it.
const mediaKey = A.paper.sections[0]!.questions[0]!.media?.[0]?.src ?? "";
await deps.storage.put(`media/${workspaceId}/sentinel-diagram.png`, new TextEncoder().encode("PNG"), {
  contentType: "image/png",
});
record(
  "GET /api/v1/run/attempt/media/:key",
  await (
    await app.request(`/api/v1/run/attempt/media/${mediaKey.slice(mediaKey.lastIndexOf("/") + 1)}`, {
      headers: { cookie: A.cookie },
    })
  ).clone().text(),
);
record(
  "GET /api/v1/run/attempt/media/:key",
  await (
    await app.request("/api/v1/run/attempt/media/not-on-my-paper.png", { headers: { cookie: A.cookie } })
  ).clone().text(),
);

const submitARes = await app.request("/api/v1/run/attempt/submit", { method: "POST", headers: { cookie: A.cookie } });
await recordJson("POST /api/v1/run/attempt/submit", submitARes);
// The second read is the same idempotent submit, which is the whole
// reason `GET /attempt/result` could go: it answered a strict subset.
await recordJson(
  "POST /api/v1/run/attempt/submit",
  await app.request("/api/v1/run/attempt/submit", { method: "POST", headers: { cookie: A.cookie } }),
);

const codeRes = await app.request("/api/v1/run/result/code", json({ attemptRef: A.attemptId, email: "ananya@uni.ac.in" }));
record("POST /api/v1/run/result/code", await codeRes.clone().text());
const code = /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "")?.[1] ?? "";
record(
  "POST /api/v1/run/result/verify",
  await (
    await app.request("/api/v1/run/result/verify", json({ attemptRef: A.attemptId, email: "ananya@uni.ac.in", code }))
  ).clone().text(),
);

// --- candidate B: the cross-candidate control -----------------------------

const B = await fullJourney("__OTHERROLL__", "__OTHERCANDIDATE__", "__OTHEREMAIL__@uni.ac.in");
await answer(B.cookie, B.paper.sections[0]!.questions[0]!.id, { kind: "option", option: "a" }, 1);
const submitBRes = await app.request("/api/v1/run/attempt/submit", { method: "POST", headers: { cookie: B.cookie } });
await recordJson("POST /api/v1/run/attempt/submit", submitBRes);
await recordJson(
  "POST /api/v1/run/attempt/submit",
  await app.request("/api/v1/run/attempt/submit", { method: "POST", headers: { cookie: B.cookie } }),
);

// --- the three release variants -------------------------------------------

async function sit(slug: string, roll: string) {
  const started = await startAttemptFor(deps, app, slug, { roll });
  const paper = started.paper as AttemptPaper;
  const first = paper.sections[0]!.questions[0]!;
  await app.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie: started.cookie, "content-type": "application/json" },
    body: JSON.stringify({ questionId: first.id, value: { kind: "option", option: "a" }, clientSeq: 1 }),
  });
  const submitRes = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: started.cookie },
  });
  const submitText = await submitRes.clone().text();
  record("POST /api/v1/run/attempt/submit", submitText);
  // Read again through the idempotent submit — the release gate's second
  // answer, which is where `GET /attempt/result` used to be.
  const againRes = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: started.cookie },
  });
  const resultText = await againRes.clone().text();
  record("POST /api/v1/run/attempt/submit", resultText);
  return { submitText, resultText };
}

const reviewImmediate = await sit("rel-review", "R1");
const reviewRetakeFirst = await sit("rel-review-retake", "R2");
const later = await sit("rel-later", "R3");

// The one legitimate exception `AC-22` carves out: `rel-review`'s
// `attempts_allowed` is 1, so there is nothing left to retake and
// `full_review` opens immediately. Every other recorded body — including
// `rel-review-retake`'s identical setting with a retake pending — stays
// held to the full list.
EXEMPT_BODIES.add(reviewImmediate.submitText);
EXEMPT_BODIES.add(reviewImmediate.resultText);

// --- the deadline refusal --------------------------------------------------

const deadline = await startAttemptFor(deps, app, "timeout", { roll: "TO1" });
clock = T + 60_000 + 30_000 + 1; // duration + default grace + 1ms
record(
  "PUT /api/v1/run/attempt/answer",
  await (
    await answer(deadline.cookie, (deadline.paper as AttemptPaper).sections[0]!.questions[0]!.id, { kind: "option", option: "a" }, 1)
  ).clone().text(),
);
clock = T;

// =========================================================================
// Assertions
// =========================================================================

it("AC-22: every candidate-reachable endpoint is covered by this scan", () => {
  // Bumped deliberately. A route `ROUTE_AUTH` later marks `attempt`,
  // `entry`, or candidate-`public` grows this number; the fixed literal is
  // what makes that growth a visible diff instead of a silent pass.
  // 16 until `GET /attempt/result` was deleted (final review, drift
  // Important): a strict subset of `POST /attempt/submit`'s answer,
  // behind a second release-gate read, with no client.
  expect(CANDIDATE_ENDPOINTS.length).toBe(15);
  expect(new Set(seen.keys())).toEqual(new Set(CANDIDATE_ENDPOINTS.map(([e]) => e)));
});

it.each(CANDIDATE_ENDPOINTS)("AC-22/S-09: %s leaks no key, explanation or internal id", (endpoint) => {
  const bodies = seen.get(endpoint);
  expect(bodies, `${endpoint} was never replayed`).toBeDefined();
  for (const body of bodies ?? []) assertNoSecrets(endpoint, body);
});

it("AC-22: the scan would catch a leak — a deliberately unscrubbed response fails it", () => {
  // The self-check: without it, a scan whose fixture never produced a
  // leak would pass even if `assertNoSecrets` were a no-op. Here is the
  // raw stored document a regression in `forCandidate` would have shipped
  // verbatim — it contains the explanation this candidate must never see.
  const leaky = JSON.stringify(sentinelDocs.find((d) => d.id === "SNT-SINGLE"));
  expect(leaky).toContain("__EXPL_SINGLE__");
  expect(() => assertNoSecrets("mutated-route", leaky)).toThrow(/__EXPL_SINGLE__/);
});

it("T-22: full_review carries the explanation and the auto-graded key once released, and only then", () => {
  expect(reviewImmediate.submitText).toContain("__EXPL_SINGLE__");
  expect(reviewImmediate.submitText).toContain("__EXPL_SHORT__");
  expect(reviewImmediate.resultText).toContain("__EXPL_SINGLE__");
  // `SNT-SINGLE`'s key, `"a"`, is also one of its own option ids — present
  // on every candidate's paper regardless of release. What proves the key
  // itself was released is the `correct` field naming it.
  expect(JSON.parse(reviewImmediate.submitText).released.review).toContainEqual(
    expect.objectContaining({ correct: "a" }),
  );
});

it("S-10: a manual question's model answer and rubric never appear, not even at a released full_review", () => {
  expect(reviewImmediate.submitText).not.toContain("__MODELANS_SHORT__");
  expect(reviewImmediate.submitText).not.toContain("__RUBRIC_SHORT__");
  expect(reviewImmediate.resultText).not.toContain("__MODELANS_SHORT__");
});

it("T-22: full_review degrades to score_and_sections while an attempt remains", () => {
  expect(reviewRetakeFirst.submitText).not.toContain("__EXPL_SINGLE__");
  expect(reviewRetakeFirst.submitText).not.toContain("__MODELANS_SHORT__");
  expect(reviewRetakeFirst.resultText).not.toContain("__EXPL_SINGLE__");
});

it("AC-16: on_date carries nothing before `at`", () => {
  expect(JSON.parse(later.submitText).released).toBeNull();
  expect(later.resultText).not.toContain("__EXPL_SINGLE__");
});

it("a candidate's own attempt and candidate ids are present; another candidate's are not", async () => {
  const mine = await (await app.request("/api/v1/run/attempt", { headers: { cookie: A.cookie } })).text();
  expect(mine).toContain(A.attemptId);
  expect(mine).not.toContain(B.attemptId);
  expect(mine).not.toContain(B.candidateId);
  for (const sentinel of ["__OTHERCANDIDATE__", "__OTHERROLL__", "__OTHEREMAIL__"]) {
    expect(mine, sentinel).not.toContain(sentinel);
  }
});

it("the access code and the full registration form values never ride a response", () => {
  for (const bodies of seen.values()) {
    for (const body of bodies) {
      expect(body).not.toContain("__ACCESS_CODE__");
      for (const sentinel of ["__OTHERCANDIDATE__", "__OTHERROLL__", "__OTHEREMAIL__"]) {
        expect(body, sentinel).not.toContain(sentinel);
      }
    }
  }
});

it.each(QUESTION_TYPES)("forCandidate builds %s field by field, so a new stored field cannot leak", (type) => {
  const stored = sentinelDocs.find((d) => d.type === type);
  if (!stored) throw new Error(`no sentinel fixture of type ${type}`);
  const mutated = { ...stored, __future_secret__: "__LEAK__" } as unknown as Question;
  const built: CandidateQuestion = forCandidate(mutated, { mediaBase: "" });
  expect(JSON.stringify(built)).not.toContain("__LEAK__");
});

it("the submitted answer out of order was refused, and the deadline save was refused", () => {
  const answers = seen.get("PUT /api/v1/run/attempt/answer") ?? [];
  const statuses = answers.map((b) => (JSON.parse(b) as { outcome?: string; error?: { code: string } }));
  expect(statuses.some((s) => s.error?.code === "navigation_locked")).toBe(true);
  expect(statuses.some((s) => s.error?.code === "time_up")).toBe(true);
  expect(statuses.some((s) => s.outcome === "accepted")).toBe(true);
});
