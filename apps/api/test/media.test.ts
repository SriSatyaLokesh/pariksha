// The media proxy: content-addressed uploads, served back as bytes.

import { afterAll, beforeEach, expect, it } from "vitest";
import { closeClient, createUser } from "@pariksha/db";
import { createApp } from "../src/app.js";
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
  expect(res.headers.get("cache-control")).toContain("immutable");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
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
