// The draft itself (#55, P5.2): GET/PATCH .../tests/:testId/draft, over the
// real routes. Tasks 4 through 9 write through this same pair rather than
// adding routes of their own, so every test here drives it exactly the way
// the builder will — no mapper composed beside the route, per the plan's
// own "tests drive the production path" rule.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { validateTest } from "@pariksha/core";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../src/app.js";
import { draftSchema } from "../src/routes/tests.js";
import testSchema from "../../../schemas/test-1.json" with { type: "json" };
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let authorCookie = "";
let viewerCookie = "";
let testId = "";

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

const get = (cookie: string): RequestInit => send("GET", cookie);
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);
const patchReq = (body: unknown, cookie: string): RequestInit => send("PATCH", cookie, body);

async function newWorkspaceWithAuthor(suffix: string): Promise<{
  workspaceId: string;
  authorCookie: string;
  viewerCookie: string;
}> {
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `draft-${suffix}`, name: "Draft Co" }),
  );
  const id = (await created.json()).id;

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, id, { userId: authorId, role: "author", now: FIXED_NOW });
  const authorCk = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, id, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  const viewerCk = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

  return { workspaceId: id, authorCookie: authorCk, viewerCookie: viewerCk };
}

async function createBank(ws: string, cookie: string, name = "Bank"): Promise<string> {
  const res = await app.request(`/api/v1/workspaces/${ws}/banks`, post({ name }, cookie));
  return (await res.json()).id;
}

async function createQuestion(
  ws: string,
  bankId: string,
  cookie: string,
  doc: { id: string; type?: string; prompt?: string; points?: number; tags?: string[] },
): Promise<string> {
  const res = await app.request(
    `/api/v1/workspaces/${ws}/banks/${bankId}/questions`,
    post(
      {
        id: doc.id,
        type: doc.type ?? "true_false",
        prompt: doc.prompt ?? "True or false?",
        key: true,
        tags: doc.tags,
        ...(doc.points !== undefined && { scoring: { points: doc.points } }),
      },
      cookie,
    ),
  );
  expect(res.status, `creating question ${doc.id}`).toBe(201);
  return (await res.json()).id;
}

function draftUrl(ws: string, tid: string): string {
  return `/api/v1/workspaces/${ws}/tests/${tid}/draft`;
}

async function draft(ws: string, tid: string, cookie: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(draftUrl(ws, tid), get(cookie));
  return { status: res.status, body: await res.json() };
}

async function patchDraft(
  ws: string,
  tid: string,
  cookie: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(draftUrl(ws, tid), patchReq(body, cookie));
  return { status: res.status, body: await res.json() };
}

/** A fresh workspace, Author and Viewer, and a fresh test with its empty
 * draft version 1 — so no test here depends on another. */
beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const seeded = await newWorkspaceWithAuthor(suffix);
  workspaceId = seeded.workspaceId;
  authorCookie = seeded.authorCookie;
  viewerCookie = seeded.viewerCookie;

  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Midterm", slug: `midterm-${suffix}` }, authorCookie),
  );
  testId = (await created.json()).id;
});

it("GET .../draft answers the empty draft createTest already seeded", async () => {
  const { status, body } = await draft(workspaceId, testId, authorCookie);
  expect(status).toBe(200);
  expect(body).toMatchObject({
    version: 1,
    publishedAt: null,
    body: { settings: {}, sections: [] },
    draw: {},
    setPoints: {},
  });
});

it("a Viewer cannot read the draft (there is no tests.view)", async () => {
  expect((await draft(workspaceId, testId, viewerCookie)).status).toBe(403);
});

it("a draft in another workspace is 404, not 403", async () => {
  const other = await newWorkspaceWithAuthor(`${Math.random().toString(36).slice(2, 10)}-b`);
  expect((await draft(other.workspaceId, testId, other.authorCookie)).status).toBe(404);
});

it("UX-13: a section with no questions saves in Draft", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "s1", title: "Section 1", source: { kind: "fixed", questions: [] } }],
  });
  expect(status).toBe(200);
  expect(body.body).toMatchObject({ sections: [{ id: "s1", source: { kind: "fixed", questions: [] } }] });
});

// Task 3 re-review: `draftSchema()` dropped three publish-time floors and
// missed a fourth of exactly the same class — the root
// `properties.sections.minItems: 1`. `createTest` seeds `sections: []`, so
// empty is already a legal stored state; an author who adds one section and
// then deletes it sends `[]` back and used to get a 422 ("A section is not
// shaped correctly"), with the optimistic state rolling back and the
// section refusing to go away. "At least one section" is Task 11's publish
// gate, not a save-time rule.
it("task 3 re-review: deleting the last section saves — an empty sections array is a legal draft", async () => {
  const added = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "s1", title: "Section 1", source: { kind: "fixed", questions: [] } }],
  });
  expect(added.status).toBe(200);

  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, { sections: [] });
  expect(status).toBe(200);
  expect(body.body).toMatchObject({ sections: [] });
  expect((await draft(workspaceId, testId, authorCookie)).body.body).toMatchObject({ sections: [] });
});

it("a section whose source kind changes is replaced, not merged", async () => {
  const bankId = await createBank(workspaceId, authorCookie);
  const q1 = await createQuestion(workspaceId, bankId, authorCookie, { id: "Q1" });
  const q2 = await createQuestion(workspaceId, bankId, authorCookie, { id: "Q2" });

  await patchDraft(workspaceId, testId, authorCookie, {
    sections: [
      {
        id: "s1",
        title: "Section 1",
        source: {
          kind: "sets",
          assignment: "round_robin",
          sets: [
            { set: "A", questions: [q1] },
            { set: "B", questions: [q2] },
          ],
        },
      },
    ],
  });

  await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "s1", title: "Section 1", source: { kind: "pool", bank: bankId, count: 4 } }],
  });

  const { body } = await draft(workspaceId, testId, authorCookie);
  // A naive merge (Object.assign over the previous `source`, or over the
  // whole section by id) would leave `assignment`/`sets` sitting underneath
  // the new `pool` source, since the second patch never mentions them —
  // exactly Review Focus item 3's "merges where it must replace". A whole
  // top-level replace of `sections` has nothing of the old source left to
  // leak through.
  expect(JSON.stringify(body.body)).not.toContain("round_robin");
  expect(JSON.stringify(body.body)).not.toContain("sets");
  expect(body.body).toMatchObject({ sections: [{ id: "s1", source: { kind: "pool", bank: bankId, count: 4 } }] });
});

it("patching one settings block leaves the others untouched", async () => {
  await patchDraft(workspaceId, testId, authorCookie, {
    settings: { timing: { duration_minutes: 45 }, access: { mode: "link_code", access_code: "OLD1" } },
  });

  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "invite_only" } },
  });

  expect(status).toBe(200);
  expect(body.body).toMatchObject({
    settings: {
      timing: { duration_minutes: 45 },
      access: { mode: "invite_only" },
    },
  });
  // Review Focus item 3's own example (the proof is Task 8's export
  // assertion; this is the save-time half) — switching away from
  // "link_code" must not leave its access_code sitting under the new mode.
  expect(JSON.stringify((body.body as { settings: unknown }).settings)).not.toContain("OLD1");
});

it("a fixed source naming a question in another workspace is 422 with the field named", async () => {
  const other = await newWorkspaceWithAuthor(`${Math.random().toString(36).slice(2, 10)}-c`);
  const foreignBank = await createBank(other.workspaceId, other.authorCookie);
  const foreignQuestion = await createQuestion(other.workspaceId, foreignBank, other.authorCookie, { id: "F1" });

  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "s1", title: "Section 1", source: { kind: "fixed", questions: [foreignQuestion] } }],
  });

  expect(status).toBe(422);
  const issues = (body as { error: { details: { issues: { field: string }[] } } }).error.details.issues;
  expect(issues).toEqual([expect.objectContaining({ field: expect.stringContaining("source.questions") })]);
});

it("a pool source naming a bank in another workspace is 422", async () => {
  const other = await newWorkspaceWithAuthor(`${Math.random().toString(36).slice(2, 10)}-d`);
  const foreignBank = await createBank(other.workspaceId, other.authorCookie);

  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "s1", title: "Section 1", source: { kind: "pool", bank: foreignBank, count: 1 } }],
  });
  expect(status).toBe(422);
});

it("fix round (task 3 review, C1): a fixed source missing `questions` is 422, not a 500", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "s1", title: "Section 1", source: { kind: "fixed" } }],
  });
  expect(status).toBe(422);
  expect(JSON.stringify(body)).toContain("questions");
});

it("fix round (task 3 review, C1): a sets source missing `sets` is 422, not a 500", async () => {
  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "s1", title: "Section 1", source: { kind: "sets" } }],
  });
  expect(status).toBe(422);
});

it("fix round (task 3 review, C2): a settings key the schema does not know is 422", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { nonsense_key: 1 },
  });
  expect(status).toBe(422);
  expect(JSON.stringify(body)).toContain("nonsense_key");
});

it("fix round (task 3 review, C2): access.mode outside its enum is 422", async () => {
  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "banana" } },
  });
  expect(status).toBe(422);
});

it("fix round (task 3 review, I1): two sections sharing one id is 422", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [
      { id: "dup", title: "A", source: { kind: "fixed", questions: [] } },
      { id: "dup", title: "B", source: { kind: "fixed", questions: [] } },
    ],
  });
  expect(status).toBe(422);
  expect(JSON.stringify(body)).toContain("dup");
});

it("fix round (task 3 review, I1): a section id outside the schema's pattern is 422", async () => {
  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [{ id: "NOT VALID!!", title: "A", source: { kind: "fixed", questions: [] } }],
  });
  expect(status).toBe(422);
});

it("a pool source carrying a stale field from a different source kind is 422", async () => {
  // The structural half of Review Focus item 3: a hand-built body that
  // already has the bug a naive merge would introduce, so the save-time
  // guard is proven on its own, independent of the merge test above.
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    sections: [
      { id: "s1", title: "Section 1", source: { kind: "pool", count: 4, sets: [{ set: "A", questions: ["x"] }] } },
    ],
  });
  expect(status).toBe(422);
  expect(JSON.stringify(body)).toContain("sets");
});

it("UX-15: the draft reports the live draw per pool section", async () => {
  const bankId = await createBank(workspaceId, authorCookie);
  for (let i = 0; i < 14; i++) {
    await createQuestion(workspaceId, bankId, authorCookie, { id: `M${i}`, tags: ["quant"] });
  }
  for (let i = 0; i < 3; i++) {
    await createQuestion(workspaceId, bankId, authorCookie, { id: `N${i}`, tags: ["verbal"] });
  }

  await patchDraft(workspaceId, testId, authorCookie, {
    sections: [
      {
        id: "quant",
        title: "Quant",
        source: { kind: "pool", bank: bankId, count: 10, filter: { tags: ["quant"] } },
      },
    ],
  });

  const { body } = await draft(workspaceId, testId, authorCookie);
  expect(body.draw).toEqual({ quant: { matching: 14, wanted: 10 } });
});

it("UX-16: the draft reports each set's total points", async () => {
  const bankId = await createBank(workspaceId, authorCookie);
  const a = await createQuestion(workspaceId, bankId, authorCookie, { id: "A1", points: 8 });
  const b = await createQuestion(workspaceId, bankId, authorCookie, { id: "B1", points: 8 });

  await patchDraft(workspaceId, testId, authorCookie, {
    sections: [
      {
        id: "reasoning",
        title: "Reasoning",
        source: {
          kind: "sets",
          assignment: "round_robin",
          sets: [
            { set: "A", questions: [a] },
            { set: "B", questions: [b] },
          ],
        },
      },
    ],
  });

  const { body } = await draft(workspaceId, testId, authorCookie);
  expect(body.setPoints).toEqual({
    reasoning: [
      { set: "A", points: 8 },
      { set: "B", points: 8 },
    ],
  });
});

it("UX-12: the draft reports each section's points as a range, for all three source kinds", async () => {
  const bankId = await createBank(workspaceId, authorCookie);
  const f1 = await createQuestion(workspaceId, bankId, authorCookie, { id: "F1", points: 3 });
  const f2 = await createQuestion(workspaceId, bankId, authorCookie, { id: "F2", points: 5 });
  // Fix round (task 3 review, I3): three matching questions of *differing*
  // points (2, 4, 10), drawing 2 of them — a pool in a real bank usually
  // looks like this, not the all-equal fixture the plan's own test used,
  // which could not tell a range apart from a single estimate.
  await createQuestion(workspaceId, bankId, authorCookie, { id: "P1", points: 2, tags: ["x"] });
  await createQuestion(workspaceId, bankId, authorCookie, { id: "P2", points: 10, tags: ["x"] });
  await createQuestion(workspaceId, bankId, authorCookie, { id: "P3", points: 4, tags: ["x"] });

  await patchDraft(workspaceId, testId, authorCookie, {
    sections: [
      { id: "fixed1", title: "Fixed", source: { kind: "fixed", questions: [f1, f2] } },
      { id: "pool1", title: "Pool", source: { kind: "pool", bank: bankId, count: 2, filter: { tags: ["x"] } } },
    ],
  });

  const { body } = await draft(workspaceId, testId, authorCookie);
  // fixed: exact sum (3 + 5), min === max. pool: the cheapest 2-of-3 (2 + 4)
  // and the dearest 2-of-3 (4 + 10) — a real range, not a single figure.
  expect(body.points).toMatchObject({ fixed1: { min: 8, max: 8 }, pool1: { min: 6, max: 14 } });
});

it("the draw costs one query however many pool sections there are", async () => {
  const bankId = await createBank(workspaceId, authorCookie);
  await createQuestion(workspaceId, bankId, authorCookie, { id: "P1", tags: ["x"] });

  const sections = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`,
    title: `Section ${i}`,
    source: { kind: "pool", bank: bankId, count: 1, filter: { tags: ["x"] } },
  }));
  await patchDraft(workspaceId, testId, authorCookie, { sections });

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(draftUrl(workspaceId, testId), get(authorCookie));
  expect(res.status).toBe(200);
  expect(Object.keys((await res.json()).draw)).toHaveLength(10);
  // GET's own real cost (4 — see the budget test below and app.ts's own
  // comment), not the path's shared `ROUTE_BUDGETS` ceiling, which PATCH's
  // heavier shape sets: `workspaceQuestionSummaries` is one query
  // regardless of section count, so ten pool sections cost the same as one.
  expect(counting.counts().total).toBe(4);
});

it("measures the real subrequest cost of GET and PATCH draft", async () => {
  const bankId = await createBank(workspaceId, authorCookie);
  const q = await createQuestion(workspaceId, bankId, authorCookie, { id: "Q1" });

  const getCounting = countingDeps(deps);
  const getRes = await createApp(getCounting.deps).request(draftUrl(workspaceId, testId), get(authorCookie));
  expect(getRes.status).toBe(200);
  const getCost = getCounting.counts().total;

  const settingsOnlyCounting = countingDeps(deps);
  const settingsRes = await createApp(settingsOnlyCounting.deps).request(
    draftUrl(workspaceId, testId),
    patchReq({ settings: { timing: { duration_minutes: 30 } } }, authorCookie),
  );
  expect(settingsRes.status).toBe(200);
  const settingsOnlyCost = settingsOnlyCounting.counts().total;

  const withSectionsCounting = countingDeps(deps);
  const sectionsRes = await createApp(withSectionsCounting.deps).request(
    draftUrl(workspaceId, testId),
    patchReq({ sections: [{ id: "s1", title: "S1", source: { kind: "fixed", questions: [q] } }] }, authorCookie),
  );
  expect(sectionsRes.status).toBe(200);
  const withSectionsCost = withSectionsCounting.counts().total;

  // GET: auth (2) + `getDraftVersion` (1) + `workspaceQuestionSummaries` (1).
  expect(getCost, "GET .../draft").toBe(4);
  // PATCH, settings only: auth (2) + `getDraftVersion` (1, the merge base) +
  // `putDraftVersion`'s own read-then-write (2) + `appendAudit` (1) — no
  // `existingRowIds` call at all, since a settings-only patch names no row.
  expect(settingsOnlyCost, "PATCH .../draft (settings only)").toBe(6);
  // PATCH, with sections: one more statement, `existingRowIds`'s single
  // `UNION ALL`, flat regardless of how many ids the patch names — the
  // heavier of the two PATCH shapes, and `ROUTE_BUDGETS`'s own number for
  // this path (the higher of every method sharing it, same rule every other
  // budget here follows).
  expect(withSectionsCost, "PATCH .../draft (with sections)").toBe(7);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/draft"]).toBe(7);
});

// --- Task 5 (#57, P5.4): the registration form through the same one pair ---

it("a registration form saves through the draft route, with no route of its own", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: {
      registration_form: {
        title: "Before you start",
        fields: [
          { id: "full_name", type: "short_text", label: "Full name", required: true },
          { id: "degree", type: "dropdown", label: "Degree", options: ["B.Tech", "B.Sc"] },
        ],
      },
    },
  });
  expect(status).toBe(200);
  expect((body.body as { settings: { registration_form: unknown } }).settings.registration_form).toMatchObject({
    title: "Before you start",
    fields: [{ id: "full_name" }, { id: "degree", options: ["B.Tech", "B.Sc"] }],
  });
});

it("a field type the schema does not know is 422, so the gate is still the schema", async () => {
  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { registration_form: { fields: [{ id: "x", type: "signature", label: "Sign" }] } },
  });
  expect(status).toBe(422);
});

it("a field id outside the schema's pattern is 422 — a value floor, not an emptiness one", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { registration_form: { fields: [{ id: "Full Name", type: "short_text", label: "Full name" }] } },
  });
  expect(status).toBe(422);
  expect(JSON.stringify(body)).toContain("registration_form.fields[0].id");
});

it("a key $defs/validation does not know is 422 (link_text belongs to the field, not to validation)", async () => {
  // The plan's own Interfaces block put `link_text`/`link_target` inside
  // `FieldValidation`; the schema puts them on the field and
  // `$defs/validation` carries `additionalProperties: false`, so modelling
  // them there would have made every consent field a 422 on save. This is
  // the assertion that would have caught it.
  expect(
    (
      await patchDraft(workspaceId, testId, authorCookie, {
        settings: {
          registration_form: {
            fields: [{ id: "consent", type: "consent", label: "I agree", validation: { link_text: "Why" } }],
          },
        },
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await patchDraft(workspaceId, testId, authorCookie, {
        settings: {
          registration_form: {
            fields: [{ id: "consent", type: "consent", label: "I agree", link_text: "Why", link_target: "consent" }],
          },
        },
      })
    ).status,
  ).toBe(200);
});

// UX-13 for the registration form, the same rule `draftSchema()` already
// applies to sections: an emptiness floor says "not filled in yet", which
// is what a Draft is. Each case below is a state the builder reaches between
// two keystrokes, and each one used to be a 422 with the author's optimistic
// state rolling back under them.
it.each([
  ["a form with no fields yet", { fields: [] }],
  ["a field whose label is being retyped", { fields: [{ id: "a", type: "short_text", label: "" }] }],
  ["a choice field whose options are still being typed", { fields: [{ id: "b", type: "dropdown", label: "Degree", options: ["B.Tech"] }] }],
  ["a choice field with no options at all yet", { fields: [{ id: "b", type: "radio", label: "Stream", options: [] }] }],
  ["an option cleared to be retyped", { fields: [{ id: "b", type: "checkbox", label: "Needs", options: ["", "Extra time"] }] }],
])("UX-13: %s saves in Draft", async (_name, registration_form) => {
  expect((await patchDraft(workspaceId, testId, authorCookie, { settings: { registration_form } })).status).toBe(200);
});

// Task 8 (#60, P5.7) reverses this one, deliberately. Task 5 read
// `$defs/formField`'s `if`/`then` ("a dropdown requires options") as a
// *shape* rule rather than an emptiness one and kept it at save, relying
// on `FormBuilder.newField` to give a new choice field `options: []` from
// birth. Task 8 then hit the identical keyword one block over —
// `$defs/access`'s "link_code requires access_code" — where no amount of
// care in the panel helps, because the organiser has to type the code and
// cannot do it in the same keystroke as picking the mode.
//
// A conditional `required` is a presence floor with a condition on it, and
// the phase has learnt twice now that naming these one at a time is how
// the next one gets shipped. So `draftSchema()` strips all three, and all
// three have their publish-time twin in `validateTest` — including this
// one, whose twin ("a dropdown needs at least two options") fires on an
// absent `options` key exactly as it does on an empty list, asserted
// below. Nothing goes unenforced; it is enforced where the document is
// whole.
it("a choice field with no options key at all saves in Draft, and is still caught at publish", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { registration_form: { fields: [{ id: "b", type: "dropdown", label: "Degree" }] } },
  });
  expect(status).toBe(200);
  expect(body.body).toMatchObject({ settings: { registration_form: { fields: [{ id: "b" }] } } });

  // The twin, on the real published-document gate.
  const publish = validateTest(
    {
      format: "pariksha/test@1",
      name: "Midterm",
      slug: "midterm",
      sections: [],
      registration_form: { fields: [{ id: "b", type: "dropdown", label: "Degree" }] },
    },
    [],
  );
  expect(publish.ok).toBe(false);
  if (publish.ok) throw new Error("expected failure");
  expect(publish.issues[0]?.message).toMatch(/needs at least two options/);
});

// The other two conditionals, which is what sent Task 8 looking.
it.each([
  ["link_code with the code not typed yet", { access: { mode: "link_code" } }],
  ["on_date with the date not chosen yet", { release: { when: "on_date" } }],
])("UX-13: %s saves in Draft", async (_name, settings) => {
  expect((await patchDraft(workspaceId, testId, authorCookie, { settings })).status).toBe(200);
});

it("UX-13: a section whose title is being retyped saves in Draft", async () => {
  // Live on the branch before Task 5 and caught by generalising the floor
  // rather than naming the ninth one: `$defs/section.title` has
  // `minLength: 1` and `SectionList.addSection()` creates `title: ""`, so
  // "Add section" answered 422 on its own very next debounced save.
  expect(
    (
      await patchDraft(workspaceId, testId, authorCookie, {
        sections: [{ id: "s1", title: "", source: { kind: "fixed", questions: [] } }],
      })
    ).status,
  ).toBe(200);
});

it("patching the registration form leaves every other settings block untouched", async () => {
  await patchDraft(workspaceId, testId, authorCookie, { settings: { access: { mode: "sso" } } });
  await patchDraft(workspaceId, testId, authorCookie, {
    settings: { registration_form: { fields: [{ id: "a", type: "email", label: "Email" }] } },
  });
  const { body } = await draft(workspaceId, testId, authorCookie);
  expect((body.body as { settings: Record<string, unknown> }).settings).toMatchObject({
    access: { mode: "sso" },
    registration_form: { fields: [{ id: "a" }] },
  });
});

it("the registration form replaces whole, so a deleted field does not survive underneath", async () => {
  await patchDraft(workspaceId, testId, authorCookie, {
    settings: {
      registration_form: {
        fields: [
          { id: "a", type: "email", label: "Email" },
          { id: "b", type: "phone", label: "Phone" },
        ],
      },
    },
  });
  await patchDraft(workspaceId, testId, authorCookie, {
    settings: { registration_form: { fields: [{ id: "a", type: "email", label: "Email" }] } },
  });
  const { body } = await draft(workspaceId, testId, authorCookie);
  expect(JSON.stringify(body.body)).not.toContain('"b"');
});

it("GET and PATCH .../draft are both guarded by tests.edit", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/draft"]).toBe("tests.edit");
  expect(ROUTE_ACTIONS["PATCH /api/v1/workspaces/:id/tests/:testId/draft"]).toBe("tests.edit");
});

// --- Task 8 (#60, P5.7): access modes and allowlists --------------------

/** The issues a 422 carries, as `{ field, message }`. */
function issuesOf(body: Record<string, unknown>): { field: string; message: string }[] {
  return (body.error as { details: { issues: { field: string; message: string }[] } }).details.issues;
}

// Review Focus 3. `access_code` is a legal property of `access` under
// every mode, so a stale one survives a merge, passes the schema, passes
// `validateTest` (whose rule fires only *when* the mode is `link_code`),
// and leaves the workspace inside an exported file.
//
// The plan asks for this proof on the *exported* document. This one is
// made one step earlier, on the stored draft read back through
// `GET .../draft` — the document export is a pure function of, and not the
// thing the plan warned against (reading back the PATCH *response*, which
// would pass either way because it echoes what was sent). **The export
// assertion itself now exists**, re-run against `exportTest` in
// `apps/api/test/export/test-round-trip.test.ts` once Task 12 built it;
// this one stays as the cheaper, narrower check of the same merge.
it("switching access.mode away from link_code drops the access code from the stored document", async () => {
  await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "link_code", access_code: "APTI-2026" } },
  });
  await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "sso", allow_email_domains: ["*.ac.in"] } },
  });

  const { body } = await draft(workspaceId, testId, authorCookie);
  expect(JSON.stringify(body.body)).not.toContain("APTI-2026");
  expect((body.body as { settings: { access: unknown } }).settings.access).toEqual({
    mode: "sso",
    allow_email_domains: ["*.ac.in"],
  });
});

it("a malformed CIDR is refused at save with the field named", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "sso", allow_ip_ranges: ["10.0.0.0/64"] } },
  });
  expect(status).toBe(422);
  expect(issuesOf(body)[0]).toMatchObject({ field: "access.allow_ip_ranges" });
  expect(issuesOf(body)[0]?.message).toMatch(/for example 10\.0\.0\.0\/24/);
});

it("a malformed email-domain glob is refused at save", async () => {
  const { status, body } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "sso", allow_email_domains: ["*"] } },
  });
  expect(status).toBe(422);
  expect(issuesOf(body)[0]).toMatchObject({ field: "access.allow_email_domains" });
});

it("a refused allowlist stores nothing — the whole patch is rejected, not the bad entry", async () => {
  await patchDraft(workspaceId, testId, authorCookie, { settings: { access: { mode: "sso" } } });
  await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "sso", allow_ip_ranges: ["10.0.0.0/24", "10.0.0.0/64"] } },
  });

  const { body } = await draft(workspaceId, testId, authorCookie);
  expect((body.body as { settings: { access: unknown } }).settings.access).toEqual({ mode: "sso" });
});

// task 7/8/10 review, m4: validated lower-cased, so stored lower-cased —
// otherwise Phase 6's matcher has to remember the fold and an entry that
// never matches looks exactly like one that does.
it("an allowlist entry is stored folded to lower case, however it was typed", async () => {
  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "sso", allow_email_domains: ["Example.COM"], allow_ip_ranges: ["2001:DB8::/32"] } },
  });
  expect(status).toBe(200);

  const { body } = await draft(workspaceId, testId, authorCookie);
  expect((body.body as { settings: { access: unknown } }).settings.access).toEqual({
    mode: "sso",
    allow_email_domains: ["example.com"],
    allow_ip_ranges: ["2001:db8::/32"],
  });
});

it("a well-formed allowlist saves even when it can match nothing — that is publish-time", async () => {
  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { access: { mode: "sso", allow_email_domains: ["nobody.example"], allow_ip_ranges: ["203.0.113.0/32"] } },
  });
  expect(status).toBe(200);
});

// The standing ruling, applied to this block: the write path enforces only
// what must never reach storage. Both of these are ordinary mid-build
// states and `validateTest` carries them for publish instead.
it("link_code with no access code yet saves, and so does a half-typed one — both caught at publish", async () => {
  expect(
    (await patchDraft(workspaceId, testId, authorCookie, { settings: { access: { mode: "link_code" } } })).status,
  ).toBe(200);
  expect(
    (await patchDraft(workspaceId, testId, authorCookie, { settings: { access: { mode: "link_code", access_code: "AP" } } }))
      .status,
  ).toBe(200);

  // Task 5/6 review, M4: `draftSchema()` strips `access_code`'s
  // `minLength: 4` along with every other `minLength`, so the save path
  // cannot be what keeps a one-character code out of a published test.
  const stored = { format: "pariksha/test@1", name: "M", slug: "m", sections: [] };
  for (const access_code of ["", "AP"]) {
    const r = validateTest({ ...stored, access: { mode: "link_code", access_code } }, []);
    expect(r.ok, `access_code "${access_code}"`).toBe(false);
  }
});

// --- The pin on `draftSchema()` (task 7/8/10 review, M9) ---------------
//
// The save gate drops every emptiness floor in schemas/test-1.json by
// keyword, and the invariant that makes that defensible — *every floor it
// drops has a publish-time rule that replaces it* — lived in a forty-line
// docblock checked by nobody. Three widenings in, eight floors were
// through with no twin and the next person to add a `minLength` got no
// signal at all. A rule with no enforcement is a comment, and this repo
// has shipped the same class of bug three times by trusting prose.
//
// So the invariant is a test. Add a floor to the schema and this fails
// until its twin exists and is named below; take one away and it fails
// until the entry goes. Entries marked UNTWINNED are the honest answer to
// "what does the gate now accept", each with the reason it is left alone
// and, where it has one, the task that owes it a rule.

/** Every keyword path `draftSchema()` removes, as `#.a.b.keyword`.
 *
 * Diffed from the function's own output rather than from a second copy of
 * the walk, so the pin cannot drift from the strip — a change to
 * `stripDraftFloors` moves both sides at once. */
function removedPaths(full: unknown, draft: unknown, path = "#"): string[] {
  if (Array.isArray(full)) {
    if (!Array.isArray(draft)) return [path];
    return full.flatMap((entry, i) => removedPaths(entry, draft[i], `${path}[${i}]`));
  }
  if (typeof full !== "object" || full === null) return [];
  const kept = (typeof draft === "object" && draft !== null ? draft : {}) as Record<string, unknown>;
  return Object.entries(full as Record<string, unknown>).flatMap(([key, value]) =>
    key in kept ? removedPaths(value, kept[key], `${path}.${key}`) : [`${path}.${key}`],
  );
}

const DRAFT_FLOOR_TWINS: Readonly<Record<string, string>> = {
  // Not an *emptiness* floor: the root `required` goes for its own reason,
  // which is that `settings` is not a whole document. Three of its five
  // entries live on the test row or are never stored (`format`, `name`,
  // `slug`); the other two are presence floors that do need twins, and
  // Task 11 (#62) added both as blocking checklist rows.
  "#.required":
    "format/name/slug live on the test row; `timing` is buildChecklist's `timing_missing` blocking row and `sections` its `no_sections` — both also enforced on import, which validates the unstripped schema",

  // --- twinned ---------------------------------------------------------
  "#.$defs.access.allOf[0].then.required":
    "validateTest: `access mode \"link_code\" requires an access_code`",
  "#.$defs.access.properties.access_code.minLength":
    "validateTest: the same rule, `code.trim().length < 4`",
  "#.$defs.release.allOf[0].then.required":
    "validateTest: `release \"on_date\" requires an \"at\" timestamp`",
  "#.$defs.formField.allOf[0].then.required":
    "validateTest: `is a ${type} field and needs at least two options`",
  "#.$defs.formField.properties.options.minItems":
    "validateTest: the same rule, `(field.options?.length ?? 0) < 2`",
  "#.$defs.formField.properties.label.minLength":
    "validateTest: `has no label, so a candidate using a screen reader meets an unnamed box`",
  "#.$defs.formField.properties.options.items.minLength":
    "validateTest: `has a blank option at position N`",
  "#.properties.name.minLength":
    "apps/api/src/routes/tests.ts, `name: z.string().min(1)` on POST and PATCH /tests — and unreachable from here anyway, since `settings` has no `name`",

  // --- UNTWINNED: deliberate, nothing is lost --------------------------
  "#.$defs.form.properties.fields.minItems":
    "UNTWINNED, deliberate: a `fields: []` form has exactly the effect of no `registration_form` key at all, which is legal and ordinary",
  "#.properties.tags.items.minLength":
    "UNTWINNED, deliberate: a blank tag matches no filter and is never shown to a candidate",
  "#.$defs.sourceSets.properties.sets.items.properties.set.minLength":
    "UNTWINNED, deliberate: the set label is the key of `draw`/`setPoints`, never rendered to a candidate",
  "#.properties.consent.properties.text.minLength":
    "UNTWINNED, unreachable: no editor writes `consent` in Phase 5 and import runs the unstripped schema, so only a hand-written PATCH can blank it",

  // --- twinned by Task 11's publish checklist --------------------------
  // UX-13's own words: "a section may be empty in Draft … the publish
  // checklist is where emptiness becomes an error rather than a nag".
  // These are that sentence, and `buildChecklist`
  // (apps/api/src/publish/checklist.ts) is where they land — a blocking
  // row, not a `validateTest` rule, because import runs the *unstripped*
  // schema and so already refuses every one of them.
  "#.$defs.sourceFixed.properties.questions.minItems":
    "buildChecklist: `section \"<title>\" has no questions` (section_empty, blocking)",
  "#.$defs.sourceSets.properties.sets.minItems":
    "buildChecklist: the same `section_empty` row — a sets source with no sets draws nothing",
  "#.$defs.sourceSets.properties.sets.items.properties.questions.minItems":
    "buildChecklist: the same `section_empty` row — a set with no questions draws nothing",
  "#.properties.sections.minItems":
    "buildChecklist: `this test has no sections, so there is nothing for a candidate to answer` (no_sections, blocking)",
  "#.$defs.section.properties.title.minLength":
    "buildChecklist: `section \"<id>\" has no title, so it has no name on the candidate's screen` (section_untitled, blocking)",
};

it("every floor draftSchema() removes is listed, with its publish-time twin or the reason it has none", () => {
  expect(removedPaths(testSchema, draftSchema()).sort()).toEqual(Object.keys(DRAFT_FLOOR_TWINS).sort());
});

it("the twinned entries are the ones validateTest actually refuses", () => {
  const base = { format: "pariksha/test@1", name: "M", slug: "m", sections: [] };
  const refusals: [string, Record<string, unknown>][] = [
    ["#.$defs.access.properties.access_code.minLength", { access: { mode: "link_code", access_code: "AP" } }],
    ["#.$defs.release.allOf[0].then.required", { release: { when: "on_date" } }],
    [
      "#.$defs.formField.properties.options.minItems",
      { registration_form: { fields: [{ id: "a", type: "radio", label: "A", options: ["only"] }] } },
    ],
    [
      "#.$defs.formField.properties.label.minLength",
      { registration_form: { fields: [{ id: "a", type: "short_text", label: " " }] } },
    ],
    [
      "#.$defs.formField.properties.options.items.minLength",
      { registration_form: { fields: [{ id: "a", type: "radio", label: "A", options: ["yes", ""] }] } },
    ],
  ];
  for (const [path, settings] of refusals) {
    expect(DRAFT_FLOOR_TWINS[path], path).not.toMatch(/^UNTWINNED/);
    expect(validateTest({ ...base, ...settings }, []).ok, path).toBe(false);
  }
});

it("a floor the gate strips still saves in Draft — the pin does not turn the list back into a save-time gate", async () => {
  const { status } = await patchDraft(workspaceId, testId, authorCookie, {
    settings: { registration_form: { fields: [{ id: "a", type: "radio", label: "", options: [""] }] } },
  });
  expect(status).toBe(200);
});
