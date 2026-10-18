// The media proxy: content-addressed uploads, served back as bytes.

import { afterAll, beforeEach, expect, it } from "vitest";
import { closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

// A one-pixel PNG. Its content is irrelevant — only its bytes feed the hash.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

let workspaceId = "";
let authorCookie = "";
let bankId = "";

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@media.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    {
      method: "POST",
      headers: { cookie: authorCookie, "content-type": "application/json" },
      body: JSON.stringify({ slug: `media-${suffix}`, name: "Media Co" }),
    },
  );
  workspaceId = (await created.json()).id;

  const bank = await app.request(`/api/v1/workspaces/${workspaceId}/banks`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Bank" }),
  });
  bankId = (await bank.json()).id;
});

function upload(bytes: Uint8Array): Promise<Response> {
  return app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/media`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "image/png" },
    body: bytes,
  });
}

it("GET /media/:key returns the bytes itself and never a redirect to storage", async () => {
  const { key } = await (await upload(PNG)).json();

  const res = await app.request(`/api/v1/workspaces/${workspaceId}/media/${key}`, {
    headers: { cookie: authorCookie },
  });

  expect(res.status).toBe(200);
  expect(res.headers.get("location")).toBeNull();
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
});

it("finding 8: Cache-Control is private, not public — this is an authenticated response", async () => {
  const { key } = await (await upload(PNG)).json();
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/media/${key}`, {
    headers: { cookie: authorCookie },
  });
  const cacheControl = res.headers.get("cache-control") ?? "";
  expect(cacheControl).toContain("private");
  expect(cacheControl).toContain("immutable");
  expect(cacheControl).not.toContain("public");
});

it("media uploaded twice gets one content-addressed key", async () => {
  const first = await (await upload(PNG)).json();
  const second = await (await upload(PNG)).json();
  expect(first.key).toBe(second.key);
});

it("refuses a content type that is not one of the allowed image types", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/media`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "application/pdf" },
    body: PNG,
  });
  expect(res.status).toBe(400);
});

it("finding 11: refuses image/svg+xml — stored-SVG XSS has no CSP sandbox here", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/media`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "image/svg+xml" },
    body: new TextEncoder().encode("<svg onload='alert(1)'></svg>"),
  });
  expect(res.status).toBe(400);
});

it("finding 7: refuses an upload over the size cap without buffering all of it", async () => {
  const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/banks/${bankId}/media`, {
    method: "POST",
    headers: { cookie: authorCookie, "content-type": "image/png" },
    body: oversized,
  });
  expect(res.status).toBe(413);
});

// Fixture-review finding 3: measured, not guessed — same pattern as
// apps/api/test/banks.test.ts's equivalent test.
it("measures the real subrequest cost of the media routes against ROUTE_BUDGETS", async () => {
  const uploadRoute = "/api/v1/workspaces/:id/banks/:bankId/media";
  const uploadCounting = countingDeps(deps);
  const uploadRes = await createApp(uploadCounting.deps).request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/media`,
    { method: "POST", headers: { cookie: authorCookie, "content-type": "image/png" }, body: PNG },
  );
  expect(uploadRes.status).toBe(201);
  expect(uploadCounting.counts().total, uploadRoute).toBeLessThanOrEqual(ROUTE_BUDGETS[uploadRoute]!);
  const { key } = await uploadRes.json();

  const fetchRoute = "/api/v1/workspaces/:id/media/:key";
  const fetchCounting = countingDeps(deps);
  const fetchRes = await createApp(fetchCounting.deps).request(`/api/v1/workspaces/${workspaceId}/media/${key}`, {
    headers: { cookie: authorCookie },
  });
  expect(fetchRes.status).toBe(200);
  expect(fetchCounting.counts().total, fetchRoute).toBeLessThanOrEqual(ROUTE_BUDGETS[fetchRoute]!);
});
