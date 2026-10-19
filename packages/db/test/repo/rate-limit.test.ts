// `S-07`'s counter (Phase 6 Task 3, #67).

import { afterAll, beforeAll, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import * as rateLimit from "../../src/repo/rate-limit.js";
import { takeRateToken } from "../../src/repo/rate-limit.js";
import * as repo from "../../src/repo/index.js";

const T = 1_700_000_000_000;
const MINUTE = 60_000;

let db: DbClient;

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);
});

afterAll(() => closeClient(db));

const functionNames = (mod: Record<string, unknown>): string[] =>
  Object.entries(mod)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);

it("is unscoped by design, and says so by being outside repo/index.ts", () => {
  expect(functionNames(rateLimit)).toEqual(["takeRateToken"]);
  // The barrel's rule is "every function here is scoped". A `/t/:code`
  // miss has no workspace, so this one cannot be, and the way it stays
  // honest is by never appearing there.
  expect(Object.keys(repo)).not.toContain("takeRateToken");
});

it("counts up within one window", async () => {
  expect(await takeRateToken(db, "a", MINUTE, T)).toBe(1);
  expect(await takeRateToken(db, "a", MINUTE, T + 1)).toBe(2);
  expect(await takeRateToken(db, "a", MINUTE, T + 2)).toBe(3);
});

it("each bucket counts on its own", async () => {
  expect(await takeRateToken(db, "b", MINUTE, T)).toBe(1);
  expect(await takeRateToken(db, "c", MINUTE, T)).toBe(1);
});

it("starts again once the window has passed", async () => {
  expect(await takeRateToken(db, "d", MINUTE, T)).toBe(1);
  expect(await takeRateToken(db, "d", MINUTE, T + MINUTE - 1)).toBe(2);
  // At exactly `window_start + windowMs` the window it was counting is
  // over: `window_start <= now - windowMs`.
  expect(await takeRateToken(db, "d", MINUTE, T + MINUTE)).toBe(1);
  expect(await takeRateToken(db, "d", MINUTE, T + MINUTE + 1)).toBe(2);
});

it("the reset moves the window to now, not to the old window plus one step", async () => {
  await takeRateToken(db, "e", MINUTE, T);
  await takeRateToken(db, "e", MINUTE, T + 10 * MINUTE);
  // If the reset had kept the stale `window_start`, this call would be a
  // second reset rather than the second token of the live window.
  expect(await takeRateToken(db, "e", MINUTE, T + 10 * MINUTE + 1)).toBe(2);
});
