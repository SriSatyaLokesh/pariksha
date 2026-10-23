// Minting the attempt, through the real app (#69, P6.5).
//
// `/start` is the one request that decides what paper a candidate sits.
// Every assertion here goes through `app.request()` on a real
// `createApp(deps)`: a rule proved against `startAttempt` directly is a
// rule the route can stop calling.

import { afterAll, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  closeClient,
  createBank,
  createCandidate,
  getDraftVersion,
  insertAuthToken,
  listCandidates,
  newId,
  publishDraftVersion,
  putDraftVersion,
  resolvePublishedTest,
  upsertQuestions,
  type Question,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { POW_DIFFICULTY_BITS } from "../../src/run/pow.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import type { AttemptPaper, PinnedLayout } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedPublishedTest, seedTest } from "./fixtures.js";
import { ALL_TYPES, seedAllTypes, seedAttemptTests } from "./paper-fixtures.js";

const T = FIXED_NOW;
let clock = T;

const { deps } = await testDeps({ now: () => clock });
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
const q = await seedAttemptTests(deps, workspaceId);
const types = await seedAllTypes(deps, workspaceId);

afterAll(() => closeClient(deps.db));

// --- helpers -----------------------------------------------------------

const versionOf = async (slug: string): Promise<{ testId: string; testVersionId: string }> => {
  const test = await resolvePublishedTest(deps.db, "alpha", slug, clock);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  return { testId: test.testId, testVersionId: test.testVersionId };
};

/** A candidate row of this test's own, so each start is a fresh person.
 *  `/register` is Task 3's and is proved there; the one journey that runs
 *  the whole chain is the last test in this file. */
async function candidateFor(slug: string, roll = `R${String(serial++)}`): Promise<string> {
  const { testId } = await versionOf(slug);
  return createCandidate(deps.db, workspaceId, {
    testId,
    formValues: { roll },
    consentVersion: "2026-10-01",
    now: clock,
  });
}
let serial = 1;

/** The `run_registration` token `POST .../register` hands back, minted
 *  the way that route mints it — same kind, same salted digest, same
 *  payload — so `/start` cannot tell this apart from the real thing. */
async function tokenFor(slug: string, candidateId: string): Promise<string> {
  const { testVersionId } = await versionOf(slug);
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId, testVersionId, candidateId },
    now: clock,
    expiresAt: clock + REGISTRATION_TTL_MS,
  });
  return token;
}

const start = (slug: string, token?: string, on = app): Promise<Response> =>
  on.request(`/api/v1/run/alpha/${slug}/start`, {
    method: "POST",
    ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
  });

/** Gate, register, start — one candidate who has never been here. */
async function startFresh(slug: string, roll?: string): Promise<Response> {
  const candidateId = await candidateFor(slug, roll);
  return start(slug, await tokenFor(slug, candidateId));
}

const paperOf = async (res: Response): Promise<AttemptPaper> => (await res.json()) as AttemptPaper;

const errorOf = async (res: Response): Promise<{ code: string; message: string; details?: unknown }> =>
  ((await res.json()) as { error: { code: string; message: string; details?: unknown } }).error;

const cookieOf = (res: Response): string => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

const tokenFromCookie = (res: Response): string => cookieOf(res).slice("pk_attempt=".length);

const resume = (cookie: string): Promise<Response> =>
  app.request("/api/v1/run/attempt", { headers: { cookie } });

const order = (paper: AttemptPaper): string[] =>
  paper.sections.flatMap((section) => section.questions.map((question) => question.id));

const optionIds = (paper: AttemptPaper, questionId: string): string[] =>
  paper.sections
    .flatMap((section) => section.questions)
    .find((question) => question.id === questionId)
    ?.options?.map((option) => option.id) ?? [];

const attemptRows = (): Promise<Record<string, unknown>[]> =>
  deps.db.query<Record<string, unknown>>("SELECT * FROM attempt", []);

const attemptRow = async (attemptId: string): Promise<Record<string, unknown>> => {
  const rows = await deps.db.query<Record<string, unknown>>("SELECT * FROM attempt WHERE id = ?", [attemptId]);
  if (!rows[0]) throw new Error(`no attempt ${attemptId}`);
  return rows[0];
};

const layoutOf = async (attemptId: string): Promise<PinnedLayout> =>
  JSON.parse(String((await attemptRow(attemptId)).layout_json)) as PinnedLayout;

const auditDetail = async (): Promise<Record<string, unknown>> =>
  JSON.parse(String((await auditRows())[0]?.detail_json ?? "{}")) as Record<string, unknown>;

const auditRows = (): Promise<{ action: string; detail_json: string | null }[]> =>
  deps.db.query<{ action: string; detail_json: string | null }>(
    "SELECT action, detail_json FROM audit_log WHERE actor = 'candidate'",
    [],
  );

beforeEach(async () => {
  clock = T;
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM audit_log", []);
  await deps.db.run("DELETE FROM auth_token", []);
  await deps.db.run("DELETE FROM rate_limit", []);
});

// --- the token --------------------------------------------------------

it("S-06: the attempt token is 256 bits, arrives as an HttpOnly cookie, and is stored only as a hash", async () => {
  const res = await startFresh("paper");
  expect(res.status).toBe(201);

  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/pk_attempt=/);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/api/v1/run");
  // Past the deadline by the late-sync grace plus the receipt window, so
  // a candidate can still read their result.
  expect(cookie).toContain(`Max-Age=${String(45 * 60 + 30 + 60 * 60)}`);

  // 32 bytes, base64url: 43 characters and no padding.
  const token = tokenFromCookie(res);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Nowhere in the row, and nowhere in the body.
  expect(JSON.stringify(await attemptRows())).not.toContain(token);
  expect(JSON.stringify(await res.json())).not.toContain(token);
  // The digest is what is stored, and it is the one the cookie hashes to.
  const expected = createHash("sha256").update(token).digest("hex");
  expect(String((await attemptRows())[0]?.token_hash)).toBe(expected);
});

it("no Authorization header is 401 before a single read — the candidate floor is 0", async () => {
  const counting = countingDeps(deps);
  const res = await start("paper", undefined, createApp(counting.deps));
  expect(res.status).toBe(401);
  const body = await res.text();
  expect(JSON.parse(body)).toMatchObject({ error: { code: "registration_required" } });
  // Refused above `openTest`: a caller with no credential costs nothing,
  // which is the floor the whole candidate budget model rests on. The
  // same 401 whether the slug pair exists or not, so nothing leaks.
  expect(counting.counts().total).toBe(0);
  const unknown = await start("no-such-test", undefined, createApp(counting.deps));
  expect(unknown.status).toBe(401);
  expect(await unknown.text()).toBe(body);
});

it("no Authorization header is 401, and a spent registration token is 410", async () => {
  expect((await start("paper")).status).toBe(401);

  const token = await tokenFor("paper", await candidateFor("paper"));
  expect((await start("paper", token)).status).toBe(201);
  const second = await start("paper", token);
  expect(second.status).toBe(410);
  expect((await errorOf(second)).code).toBe("entry_expired");
  // And the spent token minted nothing the second time.
  expect(await attemptRows()).toHaveLength(1);
});

it("a registration token minted for another test is refused here, and is not spent by the refusal", async () => {
  const token = await tokenFor("sets5", await candidateFor("sets5"));
  expect((await start("paper", token)).status).toBe(410);
  // Still live where it belongs.
  expect((await start("sets5", token)).status).toBe(201);
});

it("a row written under this test's salt but carrying another test's claim is refused", async () => {
  // Belt and braces, and each half hides the other from an end-to-end
  // probe: the salted digest means a token minted elsewhere matches no
  // row at all, and the payload comparison means a row found some other
  // way is still checked against the test that is answering. This forges
  // the state the salt makes unreachable, so the comparison is pinned on
  // its own (Task 3's M9/M10 lesson).
  const here = await versionOf("paper");
  const elsewhere = await versionOf("sets5");
  const token = `forged-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(here.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: {
      workspaceId,
      testVersionId: elsewhere.testVersionId,
      candidateId: await candidateFor("sets5"),
    },
    now: clock,
    expiresAt: clock + REGISTRATION_TTL_MS,
  });

  expect((await start("paper", token)).status).toBe(410);
  expect(await attemptRows()).toHaveLength(0);
});

// --- pinning ----------------------------------------------------------

it("AC-03: the attempt pins the version it started on; publishing v2 does not move it", async () => {
  // Its own test, so republishing it disturbs nothing else.
  const body = (refs: string[]) => ({
    settings: {
      timing: { duration_minutes: 30, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code" as const, access_code: "OPENSESAME" },
    },
    sections: [{ id: "logic", title: "Logic", source: { kind: "fixed" as const, questions: refs } }],
  });
  const testId = await seedTest(deps, workspaceId, {
    name: "Versioned",
    slug: "versioned",
    body: body([q["LOG-001"] as string]),
  });

  const res = await startFresh("versioned");
  const attemptId = (await paperOf(res)).attemptId;
  const cookie = cookieOf(res);
  const before = (await attemptRow(attemptId)).test_version_id;

  // Publish a version 2 whose fixed section names a different question.
  const draft = await getDraftVersion(deps.db, workspaceId, testId);
  await putDraftVersion(deps.db, workspaceId, draft!, body([q["LOG-002"] as string]), T);
  await publishDraftVersion(deps.db, workspaceId, testId, T);

  expect((await attemptRow(attemptId)).test_version_id).toBe(before);
  const resumed = await paperOf(await resume(cookie));
  expect(resumed.sections[0]?.questions[0]?.id).toBe(q["LOG-001"]);
  // And a candidate arriving now really does get version 2, so what was
  // asserted above is the pin and not a republish that did nothing.
  const fresh = await paperOf(await startFresh("versioned"));
  expect(fresh.sections[0]?.questions[0]?.id).toBe(q["LOG-002"]);
});

it("AC-11: two candidates on the same test see different question and option orders", async () => {
  const a = await paperOf(await startFresh("paper"));
  const b = await paperOf(await startFresh("paper"));
  // Different pool draws, different question order, or both.
  expect(order(a)).not.toEqual(order(b));
});

it("AC-11: a refresh keeps each order, and pinned options stay in place", async () => {
  const res = await startFresh("paper");
  const paper = await paperOf(res);
  const cookie = cookieOf(res);

  expect(order(await paperOf(await resume(cookie)))).toEqual(order(paper));
  // `LOG-001` sets `shuffle_options: false`, so its stored order survives
  // — and "None of the above" stays last rather than being shuffled into
  // the middle of the choices.
  const ids = optionIds(await paperOf(await resume(cookie)), q["LOG-001"] as string);
  expect(ids).toEqual(["a", "b", "c", "none-of-the-above"]);
});

it("a shuffled question's options are pinned too — the same order on every read", async () => {
  const res = await startFresh("paper");
  const paper = await paperOf(res);
  const shuffled = paper.sections
    .flatMap((section) => section.questions)
    .find((question) => question.id !== q["LOG-001"] && question.options !== undefined);
  expect(shuffled).toBeDefined();
  expect(optionIds(await paperOf(await resume(cookieOf(res))), shuffled!.id)).toEqual(
    shuffled!.options?.map((option) => option.id),
  );
});

// --- sets --------------------------------------------------------------

const setOf = async (res: Response): Promise<string | undefined> => (await paperOf(res)).setNo;

it("T-09: from_candidate_list takes the set from the list row's set_label, not from the order", async () => {
  const rows = await listCandidates(deps.db, workspaceId, (await versionOf("by-list")).testId);
  const ananya = rows.find((row) => row.externalId === "21CS0147");
  const res = await start("by-list", await tokenFor("by-list", ananya!.id));

  // Round robin would have given the first starter "A".
  expect(await setOf(res)).toBe("B");
  const paper = await paperOf(await resume(cookieOf(res)));
  expect(paper.sections[0]?.questions.map((one) => one.id).sort()).toEqual(
    [q["SET-B1"] as string, q["SET-B2"] as string].sort(),
  );
});

it("T-09: the column holds the index into the first sets section and the layout holds the label", async () => {
  const rows = await listCandidates(deps.db, workspaceId, (await versionOf("by-list")).testId);
  const ananya = rows.find((row) => row.externalId === "21CS0147");
  const res = await start("by-list", await tokenFor("by-list", ananya!.id));
  const attemptId = (await paperOf(res)).attemptId;

  // "B" is index 1 of ["A", "B", "C"].
  expect(Number((await attemptRow(attemptId)).set_no)).toBe(1);
  expect((await layoutOf(attemptId)).setNo).toBe("B");
});

it("a null set_label falls back to round robin, and the list row stays null", async () => {
  const rows = await listCandidates(deps.db, workspaceId, (await versionOf("by-list")).testId);
  const bharat = rows.find((row) => row.externalId === "21CS0148");
  const res = await start("by-list", await tokenFor("by-list", bharat!.id));

  expect(res.status).toBe(201);
  // The first attempt on this version, so round robin's index 0.
  expect(await setOf(res)).toBe("A");
  const after = await listCandidates(deps.db, workspaceId, (await versionOf("by-list")).testId);
  expect(after.find((row) => row.externalId === "21CS0148")?.setLabel).toBeNull();
});

it("a set label the published version does not carry is 409 set_unknown, audited, never a 500", async () => {
  const rows = await listCandidates(deps.db, workspaceId, (await versionOf("by-list")).testId);
  const chetan = rows.find((row) => row.externalId === "21CS0149");
  const res = await start("by-list", await tokenFor("by-list", chetan!.id));

  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({
    code: "set_unknown",
    details: { section: "verbal", set: "Z" },
  });
  expect(await attemptRows()).toHaveLength(0);
  const audit = await auditRows();
  expect(audit.map((row) => row.action)).toEqual(["attempt.set_unknown"]);
  expect(String(audit[0]?.detail_json)).toContain("Z");
});

it("AC-09: five sets, round robin, 50 starts split 10 each with no two neighbours alike", async () => {
  const drawn: string[] = [];
  for (let i = 0; i < 50; i++) {
    drawn.push((await setOf(await startFresh("sets5"))) as string);
  }
  const counted = drawn.reduce<Record<string, number>>((all, set) => {
    all[set] = (all[set] ?? 0) + 1;
    return all;
  }, {});
  expect(counted).toEqual({ A: 10, B: 10, C: 10, D: 10, E: 10 });
  expect(drawn.some((set, i) => i > 0 && set === drawn[i - 1])).toBe(false);
});

// --- the paper ---------------------------------------------------------

it("AC-10: a pool of 10 gives 10 distinct questions, all matching the filter", async () => {
  const paper = await paperOf(await startFresh("paper"));
  const quant = paper.sections.find((section) => section.id === "quant");
  expect(quant?.questions).toHaveLength(10);
  expect(new Set(quant?.questions.map((one) => one.id)).size).toBe(10);
  // Every one of them is a `QNT-` question, which is what the tag filter
  // was asked for — and none of them is a `SET-` or `LOG-` one.
  const quantIds = new Set(
    Object.entries(q)
      .filter(([ref]) => ref.startsWith("QNT-"))
      .map(([, id]) => id),
  );
  expect(quant?.questions.every((one) => quantIds.has(one.id))).toBe(true);
});

it("the paper carries the section's own instructions and time limit", async () => {
  const paper = await paperOf(await startFresh("paper"));
  expect(paper.sections[0]).toMatchObject({
    id: "logic",
    title: "Logic",
    instructions: "Answer every question.",
    timeLimitMinutes: 15,
  });
  expect(paper.sections[1]).toMatchObject({ id: "quant", instructions: null, timeLimitMinutes: null });
});

it("a passage question carries its passage, resolved from the bank that owns the group", async () => {
  const paper = await paperOf(await startFresh("paper"));
  const comprehension = paper.sections
    .flatMap((section) => section.questions)
    .find((one) => one.id === q["CMP-1"]);
  expect(comprehension?.group).toEqual({
    id: "passage-1",
    passage: "The monsoon arrives in June.\n\nIt leaves in September.",
  });
});

it("the layout pins every media key the selected questions reference, and nothing else", async () => {
  const res = await startFresh("paper");
  const paper = await paperOf(res);
  const layout = await layoutOf(paper.attemptId);

  const selected = new Set(paper.sections.flatMap((section) => section.questions.map((one) => one.id)));
  const expected = new Set<string>(["log2-diagram.png"]);
  for (const [ref, id] of Object.entries(q)) {
    if (ref.startsWith("QNT-") && selected.has(id)) expected.add(`${ref.toLowerCase()}.png`);
  }
  expect(new Set(layout.media)).toEqual(expected);

  // The two pool questions this candidate did not draw are the control:
  // their keys exist in the bank and must not be in this candidate's
  // array, or Task 7's media route would serve somebody else's paper.
  const undrawn = Object.entries(q).filter(([ref, id]) => ref.startsWith("QNT-") && !selected.has(id));
  expect(undrawn.length).toBeGreaterThan(0);
  for (const [ref] of undrawn) {
    expect(layout.media).not.toContain(`${ref.toLowerCase()}.png`);
  }
});

it("S-10: the paper carries no key, explanation, rubric, model answer or accepted spelling", async () => {
  const text = JSON.stringify(await paperOf(await startFresh("paper")));
  for (const leak of ["explanation", "rubric", "model_answer", "accept", "wsp_", "bnk_", "Because "]) {
    expect(text, leak).not.toContain(leak);
  }
  // `"key"` as a JSON field, not the letters inside another word.
  expect(text).not.toContain('"key"');
  // The row id *is* candidate-facing — it is what `response.question_id`
  // stores — so `qst_` is deliberately not on the list above.
  expect(text).toContain("qst_");
});

it("the stored layout carries no key or explanation either", async () => {
  const res = await startFresh("paper");
  const text = JSON.stringify(await layoutOf((await paperOf(res)).attemptId));
  expect(text).not.toContain("explanation");
  expect(text).not.toContain('"key"');
});

it("a fill_blank question carries the blanks' ids and not what they accept", async () => {
  const paper = await paperOf(await startFresh("paper"));
  const blanks = paper.sections.flatMap((s) => s.questions).find((one) => one.id === q["LOG-004"]);
  expect(blanks).toMatchObject({ type: "fill_blank", blanks: [{ id: "b1" }], points: 1 });
  expect(JSON.stringify(blanks)).not.toContain("Delhi");
});

it("a short_answer question carries its length cap and not its model answer", async () => {
  const paper = await paperOf(await startFresh("paper"));
  const short = paper.sections.flatMap((s) => s.questions).find((one) => one.id === q["LOG-003"]);
  expect(short).toMatchObject({ type: "short_answer", maxLength: 400, points: 3 });
  expect(JSON.stringify(short)).not.toContain("circular");
});

it("every one of the twelve question types reaches the candidate in its own scrubbed shape", async () => {
  const paper = await paperOf(await startFresh("alltypes"));
  const by = new Map(paper.sections[0]?.questions.map((one) => [one.id, one]));
  const shown = (ref: string) => by.get(types[ref] as string);

  expect(by.size).toBe(12);
  expect(shown("T-single")).toMatchObject({ type: "single", points: 1 });
  expect(shown("T-single")?.options?.map((o) => o.id).sort()).toEqual(["a", "b"]);
  expect(shown("T-multiple")?.options).toHaveLength(2);
  expect(shown("T-selectk")).toMatchObject({ k: 2 });
  // No options, no k, no key: a true/false question is its prompt.
  expect(Object.keys(shown("T-truefalse") ?? {}).sort()).toEqual(["id", "points", "prompt", "type"]);
  expect(shown("T-assertion")).toMatchObject({
    assertion: "The sky is blue.",
    reason: "Rayleigh scattering.",
  });
  expect(shown("T-matching")).toMatchObject({ left: ["L1", "L2"], right: ["R1", "R2"] });
  expect(shown("T-multimatching")).toMatchObject({ left: ["L1"], right: ["R1", "R2"] });
  expect(shown("T-ordering")).toMatchObject({ items: ["one", "two"] });
  expect(shown("T-fillblank")).toMatchObject({ blanks: [{ id: "b1" }] });
  // The unit is on the paper; the value and the tolerance are the key,
  // and a tolerance is half the answer on a numeric question.
  expect(shown("T-numeric")).toMatchObject({ unit: "kg" });
  // The id is excluded from the haystack, and that is not a loosening.
  //
  // `id` is server-minted, random, and deliberately candidate-facing — the
  // S-10 test below says so outright, because `response.question_id` stores
  // it. It is also the only part of this object the scrub cannot be about.
  // Leave it in and the needle "42" is matched by any id that happens to
  // contain those two digits, which a base36 id does roughly one run in a
  // hundred: a deploy of `main` failed on exactly that, with
  // `expected '{"id":"qst_1z9cc42adtww","type":"nume…' not to contain '42'`.
  //
  // This is the only scrub assertion in the file whose needle is bare
  // digits; every other one ("SECRET", `"key"`, "explanation") cannot
  // collide with a lowercase-alphanumeric id.
  const { id: _candidateFacingId, ...numericWithoutId } = shown("T-numeric") ?? {};
  expect(JSON.stringify(numericWithoutId), "the answer and its tolerance").not.toContain("42");
  // The control: the key really does carry 42, so the assertion above is
  // about scrubbing rather than about a value that was never there.
  expect(JSON.stringify(ALL_TYPES)).toContain("42");
  expect(shown("T-short")).toMatchObject({ maxLength: 200 });
  expect(shown("T-long")).toMatchObject({ maxLength: 2000 });

  // Every stored document carries the word SECRET in a field only the
  // marker may see, and the published paper carries it nowhere.
  expect(JSON.stringify(ALL_TYPES)).toContain("SECRET");
  expect(JSON.stringify(paper)).not.toContain("SECRET");
  expect(JSON.stringify(paper)).not.toContain('"key"');
});

// --- timing -------------------------------------------------------------

it("AC-13: deadline_at is started_at plus the duration, from the server clock, not the request", async () => {
  const paper = await paperOf(await startFresh("paper"));
  const row = await attemptRow(paper.attemptId);
  expect(Number(row.started_at)).toBe(T);
  expect(Number(row.deadline_at)).toBe(T + 45 * 60_000);
  expect(paper.remainingMs).toBe(45 * 60_000);
});

it("the deadline is not clipped to closes_at — latest_start_at is the organiser's hard close", async () => {
  const res = await startFresh("late");
  // The window shuts in ten minutes; the paper still runs forty-five.
  expect(Number((await attemptRow((await paperOf(res)).attemptId)).deadline_at)).toBe(T + 45 * 60_000);
});

it("T-12: starting after latest_start_at is refused and the window is named", async () => {
  const candidateId = await candidateFor("late");
  const token = await tokenFor("late", candidateId);
  clock = T + 6 * 60_000;
  const res = await start("late", token);
  expect(res.status).toBe(403);
  expect((await errorOf(res)).code).toBe("window_closed");
  expect(await attemptRows()).toHaveLength(0);
});

it("the paper carries the server's own timing defaults when the version declares none", async () => {
  const paper = await paperOf(await startFresh("bare"));
  expect(paper).toMatchObject({
    navigation: "free",
    warnAtMinutes: [10, 2],
    lateSyncGraceSeconds: 30,
    maxIndex: 0,
    sectionRemainingMs: null,
    serverNow: T,
    submittedAt: null,
  });
  expect(paper.responses).toEqual({});
});

it("the navigation rule on the paper is the version's, not the default", async () => {
  expect((await paperOf(await startFresh("paper"))).navigation).toBe("linear");
});

it("a timed first section's clock runs from the attempt's start", async () => {
  const paper = await paperOf(await startFresh("paper"));
  expect(paper.sectionRemainingMs).toBe(15 * 60_000);
});

it("allowCalculator comes from proctoring.overrides, in both directions", async () => {
  expect((await paperOf(await startFresh("sets5"))).allowCalculator).toBe(true);
  expect((await paperOf(await startFresh("paper"))).allowCalculator).toBe(false);
});

// Task 5 follow-up round: the bug this guards against is `proctoring`
// silently missing from `/start`'s payload, the way `violations` legitimately
// does. A bare `toBeDefined()` would pass against `{}`, so the control below
// is positive — `sets5`'s own `proctoring.overrides.allow_calculator: true`
// has to survive resolution into the object this route actually ships.
it("/start's payload carries proctoring, resolved from the version's settings", async () => {
  const paper = await paperOf(await startFresh("sets5"));
  expect(paper.proctoring.allowCalculator).toBe(true);
  // A just-minted attempt's count can only ever be zero (`GET /attempt`
  // is the one route that overrides it with a real one, on resume).
  expect(paper.violations).toBe(0);
});

// --- T-14: how many attempts, and when ---------------------------------

it("T-14: a second attempt on a one-attempt test is 409 before any layout is computed", async () => {
  const candidateId = await candidateFor("paper");
  expect((await start("paper", await tokenFor("paper", candidateId))).status).toBe(201);

  // Past the deadline and its grace, so the first attempt is finished
  // rather than live — `attempt_in_progress` is the earlier gate and
  // would otherwise answer this.
  clock = T + 50 * 60_000;
  const again = await tokenFor("paper", candidateId);
  const counting = countingDeps(deps);
  const res = await start("paper", again, createApp(counting.deps));

  expect(res.status).toBe(409);
  expect((await errorOf(res)).code).toBe("attempts_exhausted");
  expect(await attemptRows()).toHaveLength(1);
  // Refused before the bank was read, which is the whole point of
  // checking the count ahead of the layout.
  expect(counting.counts().total).toBeLessThan(
    ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/start"] as number,
  );
});

it("a live attempt is 409 attempt_in_progress — no second row and no token rotation", async () => {
  const candidateId = await candidateFor("twice");
  const first = await start("twice", await tokenFor("twice", candidateId));
  const firstHash = (await attemptRows())[0]?.token_hash;

  clock = T + 5 * 60_000; // inside the ten-minute paper
  const res = await start("twice", await tokenFor("twice", candidateId));

  expect(res.status).toBe(409);
  expect((await errorOf(res)).code).toBe("attempt_in_progress");
  expect(await attemptRows()).toHaveLength(1);
  // The tab that is still working keeps working.
  expect((await attemptRows())[0]?.token_hash).toBe(firstHash);
  expect((await resume(cookieOf(first))).status).toBe(200);
});

it("an attempt inside its late-sync grace is still live", async () => {
  const candidateId = await candidateFor("twice");
  await start("twice", await tokenFor("twice", candidateId));
  // The deadline passed twenty seconds ago; the grace is thirty.
  clock = T + 10 * 60_000 + 20_000;
  expect((await errorOf(await start("twice", await tokenFor("twice", candidateId)))).code).toBe(
    "attempt_in_progress",
  );
});

it("an abandoned attempt still counts, and the cooldown runs from its deadline", async () => {
  const candidateId = await candidateFor("twice");
  await start("twice", await tokenFor("twice", candidateId)); // never submitted

  // Ten-minute paper, thirty-minute cooldown: ready at T+40.
  clock = T + 30 * 60_000;
  const res = await start("twice", await tokenFor("twice", candidateId));
  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({
    code: "cooldown_active",
    details: { retryAfterSeconds: 10 * 60 },
  });
  expect(await attemptRows()).toHaveLength(1);
});

it("past the cooldown the second attempt starts, and attempt 1 is untouched", async () => {
  const candidateId = await candidateFor("twice");
  const first = await start("twice", await tokenFor("twice", candidateId));
  const firstPaper = await paperOf(first);
  // One answer saved against attempt 1, which the second start must not
  // disturb — a second row that stranded it is the bug this is about.
  await deps.db.run(
    "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
    [newId("rsp"), workspaceId, firstPaper.attemptId, q["LOG-001"], JSON.stringify({ kind: "choice", id: "a" }), T, 1],
  );
  const firstRow = await attemptRow(firstPaper.attemptId);

  clock = T + 41 * 60_000;
  const second = await start("twice", await tokenFor("twice", candidateId));
  expect(second.status).toBe(201);
  expect(await attemptRows()).toHaveLength(2);
  expect(await attemptRow(firstPaper.attemptId)).toEqual(firstRow);
  const answers = await deps.db.query<{ attempt_id: string }>("SELECT attempt_id FROM response", []);
  expect(answers.map((row) => row.attempt_id)).toEqual([firstPaper.attemptId]);

  // And a third is refused: `attempts_allowed` is 2.
  clock = T + 100 * 60_000;
  expect((await errorOf(await start("twice", await tokenFor("twice", candidateId)))).code).toBe(
    "attempts_exhausted",
  );
});

it("M2: a locked attempt whose deadline has passed refuses a fresh /start rather than minting an unlocked one", async () => {
  const candidateId = await candidateFor("twice");
  const first = await start("twice", await tokenFor("twice", candidateId));
  expect(first.status).toBe(201);
  const firstPaper = await paperOf(first);
  // The candidate was locked (violation limit, Task 3) rather than
  // submitted — the attempt just sits there, unresolved.
  await deps.db.run("UPDATE attempt SET locked_at = ? WHERE id = ?", [clock, firstPaper.attemptId]);

  // Past the ten-minute paper's own deadline: `liveDeadlineAt` goes null,
  // so the earlier `attempt_in_progress` gate no longer fires — the exact
  // state M2 is about.
  clock = T + 50 * 60_000;
  const res = await start("twice", await tokenFor("twice", candidateId));

  expect(res.status).toBe(409);
  expect((await errorOf(res)).code).toBe("attempt_locked");
  // No second, unlocked attempt was minted.
  expect(await attemptRows()).toHaveLength(1);
});

// --- a version that has gone stale -------------------------------------

/** A test of its own, over a bank of its own, so a deletion here cannot
 *  reach any other fixture. */
async function staleTest(
  slug: string,
  build: (ids: string[], bankId: string) => Parameters<typeof seedTest>[2]["body"],
): Promise<{ bankId: string; ids: string[] }> {
  const bankId = await createBank(deps.db, workspaceId, { name: slug, now: T });
  const docs: Question[] = [1, 2, 3].map((n) => ({
    id: `${slug.toUpperCase()}-${String(n)}`,
    type: "single",
    prompt: `Question ${String(n)}`,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    key: "a",
    tags: [slug],
    scoring: { points: 1 },
  }));
  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, docs, T);
  await seedTest(deps, workspaceId, { name: slug, slug, body: build(ids, bankId) });
  return { bankId, ids };
}

const openWindow = {
  duration_minutes: 30,
  opens_at: iso(T - DAY),
  closes_at: iso(T + DAY),
};
const code = { mode: "link_code" as const, access_code: "OPENSESAME" };

it("a stale published version whose pool no longer fills is a 409 naming the section", async () => {
  await staleTest("shortpool", () => ({
    settings: { timing: openWindow, access: code },
    sections: [
      { id: "quant", title: "Quant", source: { kind: "pool", count: 10, filter: { tags: ["shortpool"] } } },
    ],
  }));

  const res = await startFresh("shortpool");
  expect(res.status).toBe(409);
  const refusal = await errorOf(res);
  expect(refusal).toMatchObject({
    code: "pool_too_small",
    details: { section: "quant", wanted: 10, available: 3 },
  });
  expect(await attemptRows()).toHaveLength(0);
  expect((await auditRows()).map((row) => row.action)).toEqual(["attempt.pool_too_small"]);
  // The thrown message, on the organiser's row and not in the
  // candidate's body: this path never reaches `errorEnvelope`, so
  // without it the next genuine defect in the selection code arrives as
  // "tell your organiser" with nothing to act on.
  expect(String((await auditDetail()).reason)).toContain("PoolTooSmallError");
  expect(JSON.stringify(refusal)).not.toContain("PoolTooSmallError");
});

it("a fixed question deleted after publish is a 409 naming it, not a 500", async () => {
  const { ids } = await staleTest("gone", (refs) => ({
    settings: { timing: openWindow, access: code },
    sections: [{ id: "logic", title: "Logic", source: { kind: "fixed", questions: refs } }],
  }));
  // Written as SQL rather than through `deleteQuestion`, which refuses a
  // question a published test names. The state is still reachable — a
  // restore, a bank-level delete, a later writer — and the property under
  // test is that the candidate gets a 409 and the organiser gets an audit
  // row instead of a stack trace.
  await deps.db.run("DELETE FROM question WHERE id = ?", [ids[1]]);

  const res = await startFresh("gone");
  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({
    code: "paper_unavailable",
    details: { section: "logic", question: ids[1] },
  });
  expect(await attemptRows()).toHaveLength(0);
  expect((await auditRows()).map((row) => row.action)).toEqual(["attempt.paper_unavailable"]);
  // And the diagnosis, which is the half a 409 alone throws away.
  expect(String((await auditDetail()).reason)).toContain("not found in bank");
});

it("a sets question deleted after publish is the same 409, naming its section", async () => {
  const { ids } = await staleTest("goneset", (refs) => ({
    settings: { timing: openWindow, access: code },
    sections: [
      {
        id: "verbal",
        title: "Verbal",
        source: {
          kind: "sets",
          assignment: "round_robin",
          sets: [
            { set: "A", questions: [refs[0] as string] },
            { set: "B", questions: [refs[1] as string] },
          ],
        },
      },
    ],
  }));
  await deps.db.run("DELETE FROM question WHERE id = ?", [ids[0]]);

  const res = await startFresh("goneset");
  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({
    code: "paper_unavailable",
    details: { section: "verbal", question: ids[0] },
  });
});

it("a passage group removed after publish is a 409, not a question pinned with no passage", async () => {
  // The silent, permanent failure: without the guard this is a 201 whose
  // comprehension question carries no passage at all, and because the
  // paper is pinned that candidate can never be given one.
  const bankId = q["bank"] as string;
  const before = await deps.db.query<{ groups_json: string }>(
    "SELECT groups_json FROM question_bank WHERE id = ?",
    [bankId],
  );
  await deps.db.run("UPDATE question_bank SET groups_json = ? WHERE id = ?", ["[]", bankId]);
  try {
    const res = await startFresh("paper");
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({
      code: "paper_unavailable",
      details: { section: "logic", question: q["CMP-1"], group: "passage-1" },
    });
    expect(await attemptRows()).toHaveLength(0);
    expect((await auditRows()).map((row) => row.action)).toEqual(["attempt.paper_unavailable"]);
    expect(String((await auditDetail()).reason)).toContain("passage-1");
  } finally {
    await deps.db.run("UPDATE question_bank SET groups_json = ? WHERE id = ?", [
      before[0]?.groups_json ?? "[]",
      bankId,
    ]);
  }
  // The control: with the group back, the same start is a 201 carrying
  // the passage — so what refused above was the guard and not the
  // fixture.
  expect((await paperOf(await startFresh("paper"))).sections[0]?.questions.some((one) => one.group))
    .toBe(true);
});

it("a selected question whose options went null after publish is a 409, not a 500", async () => {
  // Low reachability — import and the draft route both validate — but it
  // is the same shape as the `select.ts` defect this task found, and it
  // is the second half of drawing the paper rather than the first.
  const { ids } = await staleTest("noopts", (refs) => ({
    settings: { timing: openWindow, access: code },
    sections: [{ id: "logic", title: "Logic", source: { kind: "fixed", questions: refs } }],
  }));
  await deps.db.run("UPDATE question SET options_json = NULL WHERE id = ?", [ids[0]]);

  const res = await startFresh("noopts");
  expect(res.status).toBe(409);
  expect((await errorOf(res)).code).toBe("paper_unavailable");
  expect(await attemptRows()).toHaveLength(0);
  expect(String((await auditDetail()).reason)).toMatch(/TypeError|Error/);
});

// --- budget -------------------------------------------------------------

it("the bank is read once, not once per question, and the start spends its declared budget", async () => {
  // The most expensive path: a `from_candidate_list` section whose row
  // carries no label (so the candidate row *and* the round-robin index
  // are both read) over a paper that also carries a passage group.
  const rows = await listCandidates(deps.db, workspaceId, (await versionOf("by-list")).testId);
  const bharat = rows.find((row) => row.externalId === "21CS0148");
  const token = await tokenFor("by-list", bharat!.id);

  const counting = countingDeps(deps);
  const res = await start("by-list", token, createApp(counting.deps));

  expect(res.status).toBe(201);
  expect(counting.counts().total).toBe(
    ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/start"] as number,
  );
});

it("the budget does not grow with the number of questions on the paper", async () => {
  // Fifteen questions over two sections against the one above's three.
  const counting = countingDeps(deps);
  const candidateId = await candidateFor("paper");
  await start("paper", await tokenFor("paper", candidateId), createApp(counting.deps));
  expect(counting.counts().total).toBeLessThanOrEqual(
    ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/start"] as number,
  );
});

// --- the whole chain ----------------------------------------------------

/** Node's synchronous SHA-256, the same arithmetic `verifyPow` uses. */
function solvePow(challenge: string): string {
  const prefix = "0".repeat(POW_DIFFICULTY_BITS >> 2);
  for (let i = 0; ; i++) {
    if (createHash("sha256").update(`${challenge}:${String(i)}`).digest("hex").startsWith(prefix)) {
      return String(i);
    }
  }
}

it("the whole chain works: gate, register, start — and the candidate comes from the token", async () => {
  const post = (path: string, body: unknown, token?: string): Promise<Response> =>
    app.request(`/api/v1/run/alpha/paper${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });

  const gated = (await (await post("/access", { code: "OPENSESAME" })).json()) as { entryToken: string };
  const challenged = (await (
    await app.request("/api/v1/run/alpha/paper/challenge", {
      headers: { authorization: `Bearer ${gated.entryToken}` },
    })
  ).json()) as { challenge: string };
  const registered = await post(
    "/register",
    { values: { roll: "21CS9999", full_name: "Journey", consent: true }, solution: solvePow(challenged.challenge) },
    gated.entryToken,
  );
  expect(registered.status).toBe(201);
  const { registrationToken } = (await registered.json()) as { registrationToken: string };

  const res = await start("paper", registrationToken);
  expect(res.status).toBe(201);

  // The attempt belongs to the candidate `/register` wrote, which is the
  // only identity in play: `/start` reads no body at all.
  const candidates = await listCandidates(deps.db, workspaceId, (await versionOf("paper")).testId);
  const registeredRow = candidates.find((row) => row.externalId === "21CS9999");
  expect(String((await attemptRows())[0]?.candidate_id)).toBe(registeredRow?.id);
});

it("a body naming another candidate changes nothing — /start reads no body", async () => {
  const mine = await candidateFor("paper");
  const theirs = await candidateFor("paper");
  const res = await app.request("/api/v1/run/alpha/paper/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await tokenFor("paper", mine)}`,
    },
    body: JSON.stringify({ candidateId: theirs, externalId: "21CS0147", email: "someone@else.ac.in" }),
  });

  expect(res.status).toBe(201);
  expect(String((await attemptRows())[0]?.candidate_id)).toBe(mine);
});
