// T-23's branding, over the real routes (#61, P5.8).
//
// The PRD splits it across two existing routes and this file drives both:
// `logo`, `primary_colour` and `footer_text` are *per workspace*, through
// `PATCH /workspaces/:id` behind `workspace.settings`; `start_message` and
// `finish_message` are *per test*, through `PATCH .../draft` behind
// `tests.edit`. That split is what keeps an Author out of workspace
// branding, and the 403 below is the assertion that it does.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { CREAM, contrastRatio } from "@pariksha/core";
import { createApp } from "../src/app.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let ownerCookie = "";
let adminCookie = "";
let authorCookie = "";
let testId = "";

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function member(suffix: string, role: "admin" | "author"): Promise<string> {
  const id = await createUser(deps.db, {
    email: `${role}-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: id, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, id)).token);
}

const wsUrl = (): string => `/api/v1/workspaces/${workspaceId}`;
const draftUrl = (): string => `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`;

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `brand-${suffix}`, name: "Alpha" }),
  );
  workspaceId = (await created.json()).id;

  adminCookie = await member(suffix, "admin");
  authorCookie = await member(suffix, "author");

  const test = await app.request(
    `${wsUrl()}/tests`,
    send("POST", authorCookie, { name: "Midterm", slug: `midterm-${suffix}` }),
  );
  testId = (await test.json()).id;
});

it("a brand colour below 4.5:1 against cream is refused, with the measured ratio in the message", async () => {
  const res = await app.request(wsUrl(), send("PATCH", ownerCookie, { branding: { primary_colour: "#f59a6e" } }));

  expect(res.status).toBe(422);
  const { error } = await res.json();
  expect(error.message).toMatch(/2\.09:1 against cream/i);
  expect(error.message).toMatch(/at least 4\.5:1/i);
  // The number in the message is the one the shared function computes, not
  // a second opinion written into the route.
  expect(Math.round(contrastRatio("#f59a6e", CREAM) * 100) / 100).toBe(2.09);
});

it("a brand colour that passes against cream is accepted and stored", async () => {
  const res = await app.request(
    wsUrl(),
    send("PATCH", ownerCookie, { branding: { primary_colour: "#b63a10", footer_text: "Alpha College" } }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    branding: { primary_colour: "#b63a10", footer_text: "Alpha College" },
  });
});

// The plan's own rule was "below 4.5:1 against cream *and* ink". #f59a6e
// is 7.57:1 against ink, so under that rule it would be accepted — while
// being illegible on the cream page a candidate actually sees. The gate
// measures against cream alone, and this is the case that separates them.
it("a colour readable on ink but not on cream is still refused — cream is the candidate's ground", async () => {
  expect(contrastRatio("#f59a6e", "#231f1d")).toBeGreaterThan(4.5);
  expect(
    (await app.request(wsUrl(), send("PATCH", ownerCookie, { branding: { primary_colour: "#f59a6e" } }))).status,
  ).toBe(422);
});

it("something that is not a colour at all is refused before it is measured", async () => {
  for (const primary_colour of ["red", "#b63a1", "rgb(1,2,3)", "#b63a10 "]) {
    const res = await app.request(wsUrl(), send("PATCH", ownerCookie, { branding: { primary_colour } }));
    expect(res.status, primary_colour).toBe(422);
    expect((await res.json()).error.message).toMatch(/is not a colour/i);
  }
});

it("a refused colour stores nothing", async () => {
  await app.request(wsUrl(), send("PATCH", ownerCookie, { branding: { primary_colour: "#b63a10" } }));
  await app.request(wsUrl(), send("PATCH", ownerCookie, { branding: { primary_colour: "#f59a6e" } }));

  const after = await app.request(wsUrl(), send("GET", ownerCookie));
  expect((await after.json()).branding).toMatchObject({ primary_colour: "#b63a10" });
});

it("an Admin cannot set workspace branding — it is workspace.settings, which only an owner holds", async () => {
  const res = await app.request(wsUrl(), send("PATCH", adminCookie, { branding: { primary_colour: "#b63a10" } }));
  expect(res.status).toBe(403);
});

it("a per-test branding field cannot be smuggled into workspace branding", async () => {
  const res = await app.request(
    wsUrl(),
    send("PATCH", ownerCookie, { branding: { start_message: "Good luck" } }),
  );
  expect(res.status).toBe(400);
});

it("an Author can set the per-test start and finish messages, through the draft route", async () => {
  const res = await app.request(
    draftUrl(),
    send("PATCH", authorCookie, {
      settings: { branding: { start_message: "Read the instructions.", finish_message: "Thank you." } },
    }),
  );
  expect(res.status).toBe(200);
  expect((await res.json()).body).toMatchObject({
    settings: { branding: { start_message: "Read the instructions.", finish_message: "Thank you." } },
  });
});

// Found by writing the test above it. The document's own `branding`
// object carries all five keys, so `settings.branding.primary_colour` is
// a legal thing to PATCH — and the workspace route's gate never sees it.
// A contrast rule enforced on one of the two routes that can store the
// value is not a rule, so it runs on both.
it("an unreadable colour is refused through the draft route too, not only the workspace one", async () => {
  const res = await app.request(
    draftUrl(),
    send("PATCH", authorCookie, { settings: { branding: { primary_colour: "#f59a6e" } } }),
  );
  expect(res.status).toBe(422);
  expect((await res.json()).error.message).toMatch(/2\.09:1 against cream/i);

  const workspace = await app.request(wsUrl(), send("GET", ownerCookie));
  expect((await workspace.json()).branding).toBeNull();
});

it("a readable colour on a draft saves, and still never reaches workspace branding", async () => {
  const res = await app.request(
    draftUrl(),
    send("PATCH", authorCookie, { settings: { branding: { primary_colour: "#b63a10" } } }),
  );
  expect(res.status).toBe(200);
  expect((await res.json()).body).toMatchObject({ settings: { branding: { primary_colour: "#b63a10" } } });

  const workspace = await app.request(wsUrl(), send("GET", ownerCookie));
  expect((await workspace.json()).branding).toBeNull();
});
