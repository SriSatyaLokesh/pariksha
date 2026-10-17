import { afterAll, expect, it } from "vitest";
import { closeClient } from "@pariksha/db";
import { createApp } from "../src/app.js";
import { testDeps } from "./deps.js";

const { deps, migrations } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

it("GET /api/v1/health reports ok, the dialect and the migration count", async () => {
  const res = await app.request("/api/v1/health");

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    status: "ok",
    dialect: "sqlite",
    migrations,
  });
});

it("every response carries the security headers the PRD requires", async () => {
  const h = (await app.request("/api/v1/health")).headers;

  expect(h.get("content-security-policy")).toContain("default-src 'self'");
  expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(h.get("x-content-type-options")).toBe("nosniff");
  expect(h.get("referrer-policy")).toBe("no-referrer");
  expect(h.get("permissions-policy")).toContain("microphone=()");
  expect(h.get("strict-transport-security")).toBe(
    "max-age=31536000; includeSubDomains",
  );
});

it("every response carries the request ID it was logged under", async () => {
  expect(
    (await app.request("/api/v1/health")).headers.get("x-request-id"),
  ).toMatch(/\S/);
});
