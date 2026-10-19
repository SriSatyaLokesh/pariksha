// Set assignment and shuffling (#56, P5.3) — AC-09, AC-10, AC-11, T-10.
//
// Task 4 adds no route: assignment and shuffling are fields of a section's
// `source` and of `settings.scoring`, written through Task 3's single
// `PATCH …/tests/:testId/draft`. So every case here drives the real path —
// the draft is built through that route, published through
// `publishTestVersion`, read back through `getTestVersion`, and the
// sections that come out are handed to `assignSet` / `layoutForAttempt`
// unmodified. Nothing is composed beside the production call site; the only
// thing missing versus Phase 6 is the attempt row, which does not exist
// yet (plan, Global Constraints: "the test reads the published version back
// through `getTestVersion` and hands it to `layoutForAttempt` / `assignSet`
// — the real composition, missing only the attempt row").

import { afterAll, beforeAll, expect, it } from "vitest";
import { assignSet, layoutForAttempt, type Question, type Section } from "@pariksha/core";
import { closeClient, createUser, getTestVersion, listQuestions, publishTestVersion } from "@pariksha/db";
import { createApp } from "../src/app.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

/** The four options every `single` question below carries. `o4` is the
 * "all of the above" case `shuffleOptions` pins. */
function options(): { id: string; text: string; pinned?: boolean }[] {
  return [
    { id: "o1", text: "One" },
    { id: "o2", text: "Two" },
    { id: "o3", text: "Three" },
    { id: "o4", text: "All of the above", pinned: true },
  ];
}

const AUTHORED_OPTION_IDS = options().map((o) => o.id);

let workspaceId = "";
let cookie = "";
let testId = "";
let bankId = "";
/** `refId` (the bank file's own id, e.g. `SQL-00`) → the `qst_` row id the
 * stored section actually names. */
const rowId = new Map<string, string>();
/** The published sections, straight out of `getTestVersion`. */
let sections: Section[] = [];
/** Every question in the workspace as the engine will see it: the stored
 * document with its row id, which is what a section's source names. */
let bank: Question[] = [];

const POOL = "pool_sql";
const SETS = "sets_five";
const AUTHORED = "authored_order";
const SET_LABELS = ["A", "B", "C", "D", "E"];

async function createQuestion(doc: Record<string, unknown>): Promise<void> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    send("POST", cookie, doc),
  );
  expect(res.status, `creating question ${String(doc.id)}`).toBe(201);
  rowId.set(String(doc.id), (await res.json()).id);
}

beforeAll(async () => {
  const ownerId = await createUser(deps.db, {
    email: "owner@selection.test",
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  cookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", cookie, { slug: "selection", name: "Selection Co" }),
  );
  workspaceId = (await created.json()).id;

  bankId = (
    await (await app.request(`/api/v1/workspaces/${workspaceId}/banks`, send("POST", cookie, { name: "Bank" }))).json()
  ).id;

  // 20 that match AC-10's filter ("10 from pool, tag sql, medium")…
  for (let i = 0; i < 20; i += 1) {
    await createQuestion({
      id: `SQL-${String(i).padStart(2, "0")}`,
      type: "single",
      prompt: `SQL question ${i}`,
      options: options(),
      key: "o1",
      tags: ["sql"],
      difficulty: "medium",
      scoring: { points: 2 },
    });
  }
  // …and 6 that do not, so a draw that ignored the filter would be caught.
  for (let i = 0; i < 6; i += 1) {
    await createQuestion({
      id: `JAVA-${String(i).padStart(2, "0")}`,
      type: "single",
      prompt: `Java question ${i}`,
      options: options(),
      key: "o1",
      tags: ["java"],
      difficulty: "easy",
      scoring: { points: 2 },
    });
  }
  // One question that refuses option shuffling outright (AC-11's second half).
  await createQuestion({
    id: "FIXED-OPTS",
    type: "single",
    prompt: "Options in the authored order, always",
    options: options(),
    key: "o1",
    shuffle_options: false,
    tags: ["sql"],
    difficulty: "medium",
    scoring: { points: 2 },
  });

  const id = (name: string): string => {
    const value = rowId.get(name);
    if (value === undefined) throw new Error(`no row id for ${name}`);
    return value;
  };
  const sql = (from: number, to: number): string[] =>
    Array.from({ length: to - from }, (_, i) => id(`SQL-${String(from + i).padStart(2, "0")}`));

  const testRes = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    send("POST", cookie, { name: "Selection", slug: "selection-test" }),
  );
  testId = (await testRes.json()).id;

  const draftSections = [
    {
      id: POOL,
      title: "SQL pool",
      source: { kind: "pool", bank: bankId, count: 10, filter: { tags: ["sql"], difficulty: ["medium"] } },
    },
    {
      id: SETS,
      title: "Five sets",
      source: {
        kind: "sets",
        assignment: "round_robin",
        // Set A carries FIXED-OPTS, so AC-11's pinned-order case is reached
        // through the same published section the rest of the sets use.
        sets: SET_LABELS.map((set, i) => ({
          set,
          questions: i === 0 ? [id("FIXED-OPTS"), ...sql(0, 3)] : sql(i * 4, i * 4 + 4),
        })),
      },
    },
    {
      id: AUTHORED,
      title: "Authored order",
      shuffle_questions: false,
      source: { kind: "fixed", questions: sql(0, 6) },
    },
  ];

  const saved = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", cookie, { sections: draftSections }),
  );
  expect(saved.status, await saved.clone().text()).toBe(200);
  const savedBody = await saved.json();

  // Task 11 owns the lifecycle route; the repository function it will call
  // already exists, so this is the published version the engine will read.
  // Version 2, not 1: `publishTestVersion` INSERTs its own row and
  // `(test_id, version)` is unique, while `createTest`'s seeded draft
  // already holds version 1. Stamping the draft in place and starting the
  // next number is Task 11's own transition, not something to anticipate
  // here.
  const versionId = await publishTestVersion(deps.db, workspaceId, {
    testId,
    version: 2,
    settings: savedBody.body.settings,
    sections: savedBody.body.sections,
    now: FIXED_NOW,
  });
  const version = await getTestVersion(deps.db, workspaceId, versionId);
  if (!version) throw new Error("the version just published could not be read back");
  sections = version.sections as Section[];

  const { rows } = await listQuestions(deps.db, workspaceId, bankId, { limit: 200 });
  // The engine reads row ids, because that is what a stored section names.
  bank = rows.map((row) => ({ ...row.document, id: row.id }) as Question);
});

function sectionNamed(id: string): Section {
  const section = sections.find((s) => s.id === id);
  if (!section) throw new Error(`no section ${id} in the published version`);
  return section;
}

function setsOf(id: string): string[] {
  const source = sectionNamed(id).source;
  if (source.kind !== "sets") throw new Error(`section ${id} is not a sets source`);
  return source.sets.map((s) => s.set);
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function questionIds(seed: string, setNo: string, sectionId: string): string[] {
  const layout = layoutForAttempt({ sections, bank, seed, setNo });
  const section = layout.sections.find((s) => s.sectionId === sectionId);
  if (!section) throw new Error(`no section ${sectionId} in the layout`);
  return section.questionIds;
}

function optionOrder(seed: string, setNo: string, sectionId: string): Record<string, string[]> {
  const layout = layoutForAttempt({ sections, bank, seed, setNo });
  const section = layout.sections.find((s) => s.sectionId === sectionId);
  if (!section) throw new Error(`no section ${sectionId} in the layout`);
  return section.optionOrder;
}

it("AC-09: 5 sets, round robin, 50 registrations — 10 each, and no two consecutive the same", () => {
  const sets = setsOf(SETS);
  expect(sets).toEqual(SET_LABELS);

  const got = Array.from({ length: 50 }, (_, i) =>
    assignSet({ sets, assignment: "round_robin", registrationIndex: i, candidateId: `cnd_${i}` }),
  );

  expect(countBy(got)).toEqual({ A: 10, B: 10, C: 10, D: 10, E: 10 });
  expect(got.some((set, i) => i > 0 && set === got[i - 1])).toBe(false);
});

it("hash assignment is stable across attempts for one candidate", () => {
  const sets = setsOf(SETS);
  // The same candidate, two different registrations — a second attempt, a
  // re-registration. An implementation that mixed `registrationIndex` into
  // the seed (as `random` deliberately does) would drift between these.
  const first = assignSet({ sets, assignment: "hash", registrationIndex: 0, candidateId: "cnd_steady" });
  const second = assignSet({ sets, assignment: "hash", registrationIndex: 37, candidateId: "cnd_steady" });
  expect(second).toBe(first);

  // …and it is not simply a constant: other candidates land elsewhere.
  const spread = new Set(
    Array.from({ length: 40 }, (_, i) =>
      assignSet({ sets, assignment: "hash", registrationIndex: 0, candidateId: `cnd_${i}` }),
    ),
  );
  expect(spread.size).toBeGreaterThan(1);
});

it("from_candidate_list uses the listValue and throws without one", () => {
  const sets = setsOf(SETS);
  expect(
    assignSet({ sets, assignment: "from_candidate_list", registrationIndex: 0, candidateId: "cnd_1", listValue: "D" }),
  ).toBe("D");
  expect(() =>
    assignSet({ sets, assignment: "from_candidate_list", registrationIndex: 0, candidateId: "cnd_1" }),
  ).toThrow(/requires a listValue/i);
});

it("AC-10: a pool section draws `count` distinct questions matching the filter, per candidate", () => {
  const byId = new Map(bank.map((q) => [q.id, q]));

  for (const seed of ["cnd_1", "cnd_2"]) {
    const drawn = questionIds(seed, "A", POOL);
    expect(drawn).toHaveLength(10);
    expect(new Set(drawn).size).toBe(10);
    for (const id of drawn) {
      const question = byId.get(id);
      expect(question, `drew ${id}, which is not in this workspace's bank`).toBeDefined();
      expect(question?.tags).toContain("sql");
      expect(question?.difficulty).toBe("medium");
    }
  }

  // Different candidates get different draws — the pool is 21 deep and the
  // draw is seeded per candidate, so two identical draws would mean the
  // seed is being ignored.
  expect(questionIds("cnd_1", "A", POOL)).not.toEqual(questionIds("cnd_2", "A", POOL));
});

it("AC-11: two candidates on the same set get different question and option orders", () => {
  const a = questionIds("cnd_a", "B", SETS);
  const b = questionIds("cnd_b", "B", SETS);

  // Same set: the same four questions, in a different order.
  expect(new Set(a)).toEqual(new Set(b));
  expect(a).not.toEqual(b);

  // Checked independently of the question order, so this cannot pass with
  // option shuffling turned into a no-op.
  const ordersA = optionOrder("cnd_a", "B", SETS);
  const ordersB = optionOrder("cnd_b", "B", SETS);
  expect(Object.keys(ordersA).sort()).toEqual(Object.keys(ordersB).sort());
  expect(Object.values(ordersA)).not.toEqual(
    Object.keys(ordersA).map((id) => ordersB[id]),
  );
});

it("AC-11: a question with shuffle_options false keeps the authored order for both candidates", () => {
  const pinned = rowId.get("FIXED-OPTS");
  expect(pinned).toBeDefined();

  for (const seed of ["cnd_a", "cnd_b"]) {
    expect(optionOrder(seed, "A", SETS)[pinned!]).toEqual(AUTHORED_OPTION_IDS);
  }
});

it("AC-11: 'All of the above' stays last even where options do shuffle", () => {
  for (const seed of ["cnd_a", "cnd_b"]) {
    const orders = optionOrder(seed, "B", SETS);
    for (const order of Object.values(orders)) {
      expect(order.at(-1)).toBe("o4");
    }
  }
});

it("T-10: shuffle_questions false keeps the authored order", () => {
  const authored = sectionNamed(AUTHORED).source;
  if (authored.kind !== "fixed") throw new Error("the authored-order section is not a fixed source");

  for (const seed of ["cnd_a", "cnd_b"]) {
    expect(questionIds(seed, "A", AUTHORED)).toEqual(authored.questions);
  }
  // The sibling sets section has no `shuffle_questions`, so the default
  // (true) still applies there — this test cannot pass by the engine simply
  // never shuffling anything.
  expect(questionIds("cnd_a", "B", SETS)).not.toEqual(questionIds("cnd_b", "B", SETS));
});

it("the draft route accepts scoring.set_points_tolerance, and still refuses a key the schema does not know", async () => {
  const ok = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", cookie, { settings: { scoring: { set_points_tolerance: 1 } } }),
  );
  expect(ok.status).toBe(200);
  expect((await ok.json()).body.settings).toMatchObject({ scoring: { set_points_tolerance: 1 } });

  const refused = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", cookie, { settings: { scoring: { set_points_wobble: 1 } } }),
  );
  expect(refused.status).toBe(422);

  const negative = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", cookie, { settings: { scoring: { set_points_tolerance: -1 } } }),
  );
  expect(negative.status).toBe(422);
});
