import { afterAll, expect, it, vi } from "vitest";
import { closeClient } from "@pariksha/db";
import { createApp } from "../src/app.js";
import { ApiError } from "../src/errors.js";
import { parseEnv } from "../src/env.js";
import { testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

// Two routes that exist only here: `createApp` mounts no route that fails, and
// the envelope is the contract every later phase's routes rely on.
app.get("/api/v1/boom", () => {
  throw new Error("connection string postgres://user:hunter2@db/internal");
});
app.get("/api/v1/gone", () => {
  throw new ApiError(404, "not_found", "No such test");
});

afterAll(() => closeClient(deps.db));

it("an unknown route returns the error envelope, not Hono's default text", async () => {
  const res = await app.request("/api/v1/nope");

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: { code: "not_found", message: expect.any(String) },
  });
});

it("a thrown ApiError becomes its own status and code", async () => {
  const res = await app.request("/api/v1/gone");

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: { code: "not_found", message: "No such test" },
  });
});

it("an unhandled throw becomes a 500 envelope with a request ID and no stack trace", async () => {
  // Captured rather than printed: the point of the test is that the detail
  // reaches the server log and stops there.
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const res = await app.request("/api/v1/boom");
  const body = (await res.json()) as {
    error: { details: { requestId: string } };
  };

  expect(String(logged.mock.calls[0]?.[0])).toContain("hunter2");
  logged.mockRestore();

  expect(res.status).toBe(500);
  expect(body).toMatchObject({
    error: {
      code: "internal_error",
      message: expect.any(String),
      details: { requestId: res.headers.get("x-request-id") },
    },
  });
  expect(body.error.details.requestId).toMatch(/\S/);
  // Neither the stack nor anything the thrown error carried reaches a client.
  expect(JSON.stringify(body)).not.toMatch(/hunter2|at .*errors\.test/);
});

it("parseEnv rejects a missing required secret by name", () => {
  expect(() => parseEnv({}, "workers")).toThrow(/SESSION_SECRET/);
});

it("parseEnv names the Node-only settings the Workers target does not need", () => {
  expect(() => parseEnv({ SESSION_SECRET: "s" }, "node")).toThrow(
    /DATABASE_URL/,
  );
  expect(parseEnv({ SESSION_SECRET: "s" }, "workers")).toEqual({
    target: "workers",
    sessionSecret: "s",
  });
});
