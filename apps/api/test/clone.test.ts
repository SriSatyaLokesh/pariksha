// Clone (#63, P5.10) — AC-04's "duplicate a test" half, over the real route.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser, getDraftVersion, getPublishedVersion } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let authorCookie = "";
let adminCookie = "";
let testId = "";
let questionId = "";
let suffix = 0;

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);

async function member(role: "admin" | "author", tag: string): Promise<string> {
  const userId = await createUser(deps.db, {
    email: `${role}-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

beforeEach(async () => {
  suffix += 1;
  const tag = `cl${suffix}`;

  const ownerId = await createUser(deps.db, {
    email: `owner-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  workspaceId = (
    await (await app.request("/api/v1/workspaces", send("POST", ownerCookie, { slug: `cl-${tag}`, name: "Cl Co" }))).json()
  ).id;

  authorCookie = await member("author", tag);
  adminCookie = await member("admin", tag);

  const bankId = (
    await (await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie))).json()
  ).id;
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
        post({ name: "Midterm", slug: "midterm" }, authorCookie),
      )
    ).json()
  ).id;

  const saved = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", authorCookie, {
      settings: { timing: { duration_minutes: 60 }, access: { mode: "link_code", access_code: "APTI-2026" } },
      sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: [questionId] } }],
    }),
  );
  expect(saved.status, await saved.clone().text()).toBe(200);
});

const cloneUrl = (id = testId): string => `/api/v1/workspaces/${workspaceId}/tests/${id}/clone`;

async function clone(id = testId): Promise<Record<string, unknown>> {
  const res = await app.request(cloneUrl(id), post({}, authorCookie));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

async function publishOriginal(): Promise<void> {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, post({}, adminCookie));
  expect(res.status, await res.clone().text()).toBe(200);
}

it("AC-04: a clone has the same settings and sections and a new id, slug and short code", async () => {
  const original = await (
    await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}`, send("GET", authorCookie))
  ).json();
  const copy = await clone();

  expect(copy.id).not.toBe(original.id);
  expect(copy.slug).toBe("midterm-copy");
  expect(copy.shortCode).not.toBe(original.shortCode);
  expect(copy.name).toBe("Midterm (copy)");

  const from = await getDraftVersion(deps.db, workspaceId, testId);
  const to = await getDraftVersion(deps.db, workspaceId, copy.id as string);
  expect(to?.body).toEqual(from?.body);
});

it("a clone starts in Draft at version 1 with no published version", async () => {
  // The original is published first, so the clone is made from a test that
  // has a version history — the case where "does not copy it" means
  // something.
  await publishOriginal();

  const copy = await clone();
  expect(copy).toMatchObject({ state: "draft", currentVersion: null, draftVersion: 1 });
  expect((await getDraftVersion(deps.db, workspaceId, copy.id as string))?.version).toBe(1);
  expect(await getPublishedVersion(deps.db, workspaceId, copy.id as string)).toBeNull();
});

it("a clone copies the editable head, which after a publish is the newest draft", async () => {
  await publishOriginal();
  await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", authorCookie, {
      sections: [{ id: "s1", title: "Renamed", source: { kind: "fixed", questions: [questionId] } }],
    }),
  );

  const copy = await clone();
  const to = await getDraftVersion(deps.db, workspaceId, copy.id as string);
  expect(to?.body.sections[0]?.title).toBe("Renamed");
});

it("a clone does not copy review_requested", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}`,
    send("PATCH", authorCookie, { reviewRequested: true }),
  );
  expect((await clone()).reviewRequested).toBe(false);
});

it("cloning twice gives midterm-copy and midterm-copy-2", async () => {
  expect((await clone()).slug).toBe("midterm-copy");
  expect((await clone()).slug).toBe("midterm-copy-2");
  expect((await clone()).slug).toBe("midterm-copy-3");
});

it("a clone of a clone keeps going rather than colliding", async () => {
  const first = await clone();
  expect((await clone(first.id as string)).slug).toBe("midterm-copy-copy");
});

it("cloning a test that is not in this workspace is a 404, not a 403", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/tst_doesnotexist000/clone`,
    post({}, authorCookie),
  );
  expect(res.status).toBe(404);
});

it("clone is guarded by tests.edit and writes one audit entry", async () => {
  expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/:testId/clone"]).toBe("tests.edit");
  const copy = await clone();
  const rows = await deps.db.query<{ action: string }>(
    "SELECT action FROM audit_log WHERE workspace_id = ? AND target = ?",
    [workspaceId, copy.id],
  );
  expect(rows.map((r) => r.action)).toContain("test.clone");
});

it("measures the real subrequest cost of clone", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(cloneUrl(), post({}, authorCookie));
  expect(res.status, await res.clone().text()).toBe(201);
  // Whole-branch test-honesty review, §4. The measurement alone is one
  // lock: it catches a regression that adds a query. The literal is the
  // second: without it, a one-character edit to `app.ts` makes the
  // measurement agree with itself again and both go green. Standing
  // decision 5's "update the pin and the table together" needs both.
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/clone"]);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/clone"]).toBe(8);
});
