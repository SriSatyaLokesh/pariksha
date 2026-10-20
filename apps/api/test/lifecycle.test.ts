// Lifecycle and numbered published versions (#62, P5.9) — T-04, AC-03,
// UX-11 and UX-18, over the real routes.
//
// Everything here drives `POST .../publish`, `.../close`, `.../archive` and
// `GET .../versions` through the mounted app, never `buildChecklist` or
// `publishDraftVersion` composed beside them: the whole point of Review
// Focus 4 is that the gate and the screen share one computation, and a test
// that calls the gate directly cannot see whether the route does.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser, getPublishedVersion } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const DAY = 86_400_000;
const past = new Date(FIXED_NOW - DAY).toISOString();
const future = new Date(FIXED_NOW + DAY).toISOString();
const later = new Date(FIXED_NOW + 2 * DAY).toISOString();

let workspaceId = "";
let adminCookie = "";
let authorCookie = "";
let testId = "";
let questionId = "";
let bankId = "";
let suffix = 0;

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const get = (cookie: string): RequestInit => send("GET", cookie);
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);

async function member(ws: string, role: "admin" | "author", tag: string): Promise<string> {
  const userId = await createUser(deps.db, {
    email: `${role}-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, ws, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

/** A whole publishable test: one bank, one question, a draft naming it,
 * a duration and a window that is still open. Every test below starts from
 * this and breaks exactly the one thing it is about. */
beforeEach(async () => {
  suffix += 1;
  const tag = `l${suffix}`;

  const ownerId = await createUser(deps.db, {
    email: `owner-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `life-${tag}`, name: "Life Co" }),
  );
  workspaceId = (await created.json()).id;

  adminCookie = await member(workspaceId, "admin", tag);
  authorCookie = await member(workspaceId, "author", tag);

  bankId = (await (await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie))).json()).id;
  questionId = (
    await (
      await app.request(
        `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
        post({ id: "Q1", type: "true_false", prompt: "The sky is blue.", key: true }, authorCookie),
      )
    ).json()
  ).id;

  testId = (
    await (
      await app.request(
        `/api/v1/workspaces/${workspaceId}/tests`,
        post({ name: "Midterm", slug: `midterm-${tag}` }, authorCookie),
      )
    ).json()
  ).id;

  await saveDraft({
    settings: { timing: { duration_minutes: 60, opens_at: past, closes_at: future } },
    sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: [questionId] } }],
  });
});

const patchDraft = (patch: unknown): Promise<Response> =>
  app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`, send("PATCH", authorCookie, patch));

async function saveDraft(patch: unknown): Promise<Response> {
  const res = await patchDraft(patch);
  expect(res.status, await res.clone().text()).toBe(200);
  return res;
}

const publishUrl = (): string => `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`;

async function publish(cookie = adminCookie): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(publishUrl(), post({}, cookie));
  return { status: res.status, body: await res.json() };
}

/** The ids of whichever envelope carries the rows — `GET …/checklist`
 * returns them at the top level, the 422 nests them under `error.details`.
 * One reader, so a test can say the same thing about the screen and the
 * gate. */
function rowIds(body: Record<string, unknown>): string[] {
  const rows =
    (body.rows as { id: string }[] | undefined) ??
    (body.error as { details: { rows: { id: string }[] } }).details.rows;
  return rows.map((r) => r.id);
}

/** The fields a 422 from the draft route names, which is the other shape
 * an error body comes in here. */
function issueFields(body: Record<string, unknown>): string[] {
  const details = (body.error as { details: { issues: { field: string }[] } }).details;
  return details.issues.map((i) => i.field);
}

async function getChecklist(id = testId): Promise<Record<string, unknown>> {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${id}/checklist`, get(authorCookie));
  expect(res.status, await res.clone().text()).toBe(200);
  return await res.json();
}

async function versionCount(): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM test_version WHERE workspace_id = ? AND test_id = ? AND published_at IS NOT NULL",
    [workspaceId, testId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function auditActions(): Promise<string[]> {
  const rows = await deps.db.query<{ action: string }>(
    "SELECT action FROM audit_log WHERE workspace_id = ? AND target = ? ORDER BY at",
    [workspaceId, testId],
  );
  return rows.map((r) => r.action);
}

// --- UX-11: who may publish --------------------------------------------

it("an Author gets 403 on publish and an Admin gets 200", async () => {
  expect((await publish(authorCookie)).status).toBe(403);
  expect(await versionCount()).toBe(0);

  const { status, body } = await publish();
  expect(status, JSON.stringify(body)).toBe(200);
  expect(await versionCount()).toBe(1);
});

it("the three transitions need tests.publish and the version history needs only tests.edit", () => {
  for (const path of ["publish", "close", "archive"]) {
    expect(ROUTE_ACTIONS[`POST /api/v1/workspaces/:id/tests/:testId/${path}`]).toBe("tests.publish");
  }
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/versions"]).toBe("tests.edit");
});

// --- T-04: the transition ----------------------------------------------

it("publishing freezes the draft head as version 1, not version 2", async () => {
  const { body } = await publish();
  expect(body).toMatchObject({ state: "open", currentVersion: 1, draftVersion: 2 });

  const published = await getPublishedVersion(deps.db, workspaceId, testId);
  expect(published?.version).toBe(1);
  expect(published?.publishedAt).toBe(FIXED_NOW);
});

it("Review Focus 2: a window in the future reads as Scheduled, never a stored 'open'", async () => {
  await saveDraft({ settings: { timing: { duration_minutes: 60, opens_at: future, closes_at: later } } });
  expect((await publish()).body.state).toBe("scheduled");

  const stored = await deps.db.query<{ status: string }>("SELECT status FROM test WHERE id = ?", [testId]);
  expect(stored[0]?.status).toBe("published");

  const listed = await (await app.request(`/api/v1/workspaces/${workspaceId}/tests`, get(authorCookie))).json();
  expect(listed.tests[0]).toMatchObject({ state: "scheduled" });
});

it("publish writes one audit entry naming the version", async () => {
  await publish();
  expect(await auditActions()).toContain("test.publish");

  const rows = await deps.db.query<{ detail_json: unknown }>(
    "SELECT detail_json FROM audit_log WHERE workspace_id = ? AND action = 'test.publish'",
    [workspaceId],
  );
  expect(deps.db.jsonValue(rows[0]?.detail_json)).toEqual({ version: 1 });
});

it("AC-03: the next publish is version 2 and version 1 keeps the body it was frozen with", async () => {
  await publish();
  const first = await getPublishedVersion(deps.db, workspaceId, testId, 1);

  await saveDraft({ sections: [{ id: "s1", title: "Renamed", source: { kind: "fixed", questions: [questionId] } }] });
  await publish();

  expect((await getPublishedVersion(deps.db, workspaceId, testId))?.version).toBe(2);
  expect((await getPublishedVersion(deps.db, workspaceId, testId, 1))?.body).toEqual(first?.body);
  expect((await getPublishedVersion(deps.db, workspaceId, testId, 1))?.body.sections[0]?.title).toBe("Section one");
});

// --- the blocking rows -------------------------------------------------

it("publish refuses on a blocking checklist row and writes no version", async () => {
  await saveDraft({ sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: [] } }] });

  const { status, body } = await publish();
  expect(status).toBe(422);
  expect(rowIds(body)).toContain("section_empty");
  expect(await versionCount()).toBe(0);
});

it.each([
  ["a test with no sections", { sections: [] }, "no_sections"],
  [
    "a section with a blank title",
    { sections: [{ id: "s1", title: "  ", source: { kind: "fixed", questions: ["QID"] } }] },
    "section_untitled",
  ],
  [
    "a pool section naming no bank",
    { sections: [{ id: "s1", title: "Pool", source: { kind: "pool", count: 1 } }] },
    "pool_no_bank",
  ],
  [
    "a set with no questions in it",
    {
      sections: [
        {
          id: "s1",
          title: "Sets",
          source: { kind: "sets", assignment: "round_robin", sets: [{ set: "A", questions: [] }] },
        },
      ],
    },
    "section_empty",
  ],
  [
    "a window that has already closed",
    { settings: { timing: { duration_minutes: 60, opens_at: past, closes_at: past } } },
    "window_past",
  ],
  [
    "link_code with no access code",
    { settings: { access: { mode: "link_code" } } },
    "access_code_missing",
  ],
  [
    "release on_date with no date",
    { settings: { release: { when: "on_date" } } },
    "release_at_missing",
  ],
] as const)("%s is refused at publish", async (_what, patch, id) => {
  // Every case here is a *legal save* — that is the point of the split: a
  // half-built draft is ordinary authoring and only publish is complete.
  const body = JSON.parse(JSON.stringify(patch).replaceAll('"QID"', JSON.stringify(questionId))) as unknown;
  await saveDraft(body);

  const result = await publish();
  expect(result.status, JSON.stringify(result.body)).toBe(422);
  expect(rowIds(result.body)).toContain(id);
  expect(await versionCount()).toBe(0);
});

// `timing` cannot be *removed* by a PATCH — a key the patch does not name
// is untouched (Review Focus 3's merge rule) — so the case is a test that
// never had one, which is every test `createTest` mints: it seeds
// `settings: {}`, `draftSchema()` drops the root `required` that would
// have demanded `timing`, and until this row existed nothing anywhere
// caught it. A test published with no duration gives every candidate
// unlimited time.
/** A second test that never got a timing block, with `sections` saved onto
 * it. The only route to a draft whose `settings.timing` is absent: a PATCH
 * cannot remove a key it does not name, and every other shape of missing
 * duration is refused at save (see the #179 block below). */
async function testWithoutTiming(sections: unknown): Promise<string> {
  const id = (
    await (
      await app.request(
        `/api/v1/workspaces/${workspaceId}/tests`,
        post({ name: "No timing", slug: `no-timing-${suffix}` }, authorCookie),
      )
    ).json()
  ).id;
  const saved = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${id}/draft`,
    send("PATCH", authorCookie, { sections }),
  );
  expect(saved.status, await saved.clone().text()).toBe(200);
  return id;
}

it("a test that never got a timing block is refused at publish", async () => {
  const other = await testWithoutTiming([
    { id: "s1", title: "Section one", source: { kind: "fixed", questions: [questionId] } },
  ]);

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${other}/publish`, post({}, adminCookie));
  expect(res.status).toBe(422);
  expect(rowIds(await res.json())).toContain("timing_missing");
});

// #179 — a test with no duration cannot be published.
//
// **These next two are save-gate tests, and must stay that way.** Three
// shapes of "no duration" exist in the *type* — `timing` absent (above),
// `timing` present and empty, and `duration_minutes: 0` — but only the
// first can ever reach `buildChecklist`. `draftSchema()`
// (`apps/api/src/routes/tests.ts`) drops only the **root** `required`, so
// `$defs/timing`'s own `required: ["duration_minutes"]` and its
// `minimum: 1` both survive into the save-time validator; the draft PATCH
// refuses those two bodies outright, and whole-test import runs the
// unstripped schema, so no write path admits them. They were written as
// publish-gate tests first and failed inside `saveDraft`, which is how the
// schema was found.
//
// So do not "fix" them back into `publish()` tests and conclude from the
// resulting 200 that the gate is untested: there would be nothing stored to
// publish. `buildChecklist`'s widened `timing_missing` condition is
// deliberate defence for *stored* bodies written before that schema — the
// gate judges a body, not a writer — and a stored body is reachable from
// this suite only through the absent-`timing` test above.

it("the draft route refuses to store a timing object with no duration", async () => {
  const res = await patchDraft({ settings: { timing: {} } });
  expect(res.status, await res.clone().text()).toBe(422);
  expect(issueFields(await res.json())).toContain("timing.duration_minutes");
});

it("the draft route refuses to store a duration of zero", async () => {
  const res = await patchDraft({ settings: { timing: { duration_minutes: 0 } } });
  expect(res.status, await res.clone().text()).toBe(422);
  expect(issueFields(await res.json())).toContain("timing.duration_minutes");
});

it("still publishes a draft with a positive duration", async () => {
  expect((await publish()).status).toBe(200);
});

// #179's other half, and the input class the row above does not cover: the
// sections exist, so `no_sections` stays quiet, but between them they hold
// no question at all. One `section_empty` per empty section is the whole
// answer — the organiser is told which ones, and publish is refused.
it("refuses to publish when every section is empty", async () => {
  await saveDraft({
    sections: [
      { id: "s1", title: "A", source: { kind: "fixed", questions: [] } },
      { id: "s2", title: "B", source: { kind: "sets", assignment: "round_robin", sets: [] } },
    ],
  });
  const { status, body } = await publish();
  expect(status).toBe(422);
  expect(rowIds(body).filter((id) => id === "section_empty")).toHaveLength(2);
  expect(await versionCount()).toBe(0);
});

it("reports the same rows on GET .../checklist as at the gate", async () => {
  const other = await testWithoutTiming([{ id: "s1", title: "A", source: { kind: "fixed", questions: [] } }]);
  const wanted = ["timing_missing", "section_empty"];
  expect(rowIds(await getChecklist(other))).toEqual(expect.arrayContaining(wanted));

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${other}/publish`, post({}, adminCookie));
  expect(res.status).toBe(422);
  expect(rowIds(await res.json())).toEqual(expect.arrayContaining(wanted));
});

it("every refusing row names a field a screen can navigate to", async () => {
  await saveDraft({ settings: {}, sections: [] });
  const { body } = await publish();
  const rows = (body.error as { details: { rows: { field: string; message: string }[] } }).details.rows;
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.field).not.toBe("");
    expect(row.message).not.toBe("");
  }
});

// --- Close and Archive --------------------------------------------------

it("close and archive each confirm through their own route and are audit-logged", async () => {
  await publish();

  const closed = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/close`, post({}, adminCookie));
  expect(closed.status).toBe(200);
  expect((await closed.json()).state).toBe("closed");

  const archived = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/archive`,
    post({}, adminCookie),
  );
  expect(archived.status).toBe(200);
  expect((await archived.json()).state).toBe("archived");

  expect(await auditActions()).toEqual(["test.create", "test.draft.update", "test.publish", "test.close", "test.archive"]);
});

it("archiving a draft is refused — Archived follows Closed", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/archive`, post({}, adminCookie));
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("cannot_archived");
});

it("closing a test that was never published is refused", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/close`, post({}, adminCookie));
  expect(res.status).toBe(409);
});

// --- UX-18: the version history ----------------------------------------

it("the version history names every version, the published ones with their time", async () => {
  await publish();
  await saveDraft({ sections: [{ id: "s1", title: "Two", source: { kind: "fixed", questions: [questionId] } }] });
  await publish();

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/versions`, get(authorCookie));
  expect(res.status).toBe(200);
  expect((await res.json()).versions).toEqual([
    { version: 3, publishedAt: null, attemptCount: 0 },
    { version: 2, publishedAt: FIXED_NOW, attemptCount: 0 },
    { version: 1, publishedAt: FIXED_NOW, attemptCount: 0 },
  ]);
});

// --- budgets ------------------------------------------------------------

it("measures the real subrequest cost of publish, close, archive and versions", async () => {
  const measure = async (path: string, init: RequestInit, expected: number): Promise<void> => {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(path, init);
    expect(res.status, `${path}: ${await res.clone().text()}`).toBe(expected);
    expect(counting.counts().total, path).toBe(ROUTE_BUDGETS[`/api/v1/workspaces/:id/tests/:testId/${path.split("/").pop()}`]!);
  };

  // Whole-branch test-honesty review, §4. The measurement alone is one
  // lock: it catches a regression that adds a query. The literal is the
  // second: without it, a one-character edit to `app.ts` makes the
  // measurement agree with itself again and both go green. Standing
  // decision 5's "update the pin and the table together" needs both.
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/publish"]).toBe(9);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/close"]).toBe(6);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/archive"]).toBe(6);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/versions"]).toBe(3);

  await measure(publishUrl(), post({}, adminCookie), 200);
  await measure(`/api/v1/workspaces/${workspaceId}/tests/${testId}/close`, post({}, adminCookie), 200);
  await measure(`/api/v1/workspaces/${workspaceId}/tests/${testId}/archive`, post({}, adminCookie), 200);
  await measure(`/api/v1/workspaces/${workspaceId}/tests/${testId}/versions`, get(authorCookie), 200);
});

it("the publish budget is flat in how many questions the workspace holds", async () => {
  for (let i = 0; i < 20; i += 1) {
    await app.request(
      `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
      post({ id: `F${i}`, type: "true_false", prompt: "Filler.", key: true }, authorCookie),
    );
  }

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(publishUrl(), post({}, adminCookie));
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/publish"]);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/publish"]).toBe(9);
});
