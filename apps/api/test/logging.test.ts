import { afterAll, expect, it, vi } from "vitest";
import { closeClient } from "@pariksha/db";
import { createApp } from "../src/app.js";
import { testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

// A log line is the easiest place for a candidate's name or answer to leave
// the system, so the guarantee is the absence of fields, not the care of
// whoever adds the next route.
it("logs one JSON line per request carrying only id, route, status and duration", async () => {
  const written = vi.spyOn(console, "log").mockImplementation(() => undefined);

  const res = await app.request("/api/v1/health?candidate=ada&answer=42", {
    headers: { cookie: "session=secret", "user-agent": "ada" },
  });

  expect(written).toHaveBeenCalledTimes(1);
  const line: unknown = JSON.parse(String(written.mock.calls[0]?.[0]));
  written.mockRestore();

  expect(Object.keys(line as object).sort()).toEqual([
    "durationMs",
    "requestId",
    "route",
    "status",
  ]);
  expect(line).toMatchObject({
    route: "/api/v1/health",
    status: 200,
    requestId: res.headers.get("x-request-id"),
  });
});
