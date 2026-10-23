// One set of real dependencies for every route test: an in-memory SQLite
// database and the in-memory storage adapter, so the whole API is exercised
// without a container, a network or a mock.

import { Hono } from "hono";
import { sqliteClient, migrate, type DbClient } from "@pariksha/db";
import { memoryAdapter } from "@pariksha/storage";
import { parseEnv } from "../src/env.js";
import type { AppDeps } from "../src/app.js";
import { setSessionCookie } from "../src/middleware/authenticate.js";

/** Fixed, so a test asserting on a timestamp never races a real clock. */
export const FIXED_NOW = 1_760_000_000_000;

export async function testDeps(
  // Expiry tests need one database read through several points in time, which
  // an injected clock covers and a second `testDeps()` would not: a new call
  // is a new, empty database.
  options: {
    now?: () => number;
    env?: Record<string, unknown>;
    /** `KG8` (Phase 8e Task 3, #102): the one existing caller of this
     *  function that needs a `node`-target app at all. Defaults to
     *  `"workers"`, every other call's only target before this task. */
    target?: "workers" | "node";
  } = {},
): Promise<{
  deps: AppDeps;
  migrations: number;
}> {
  const db: DbClient = sqliteClient(":memory:");
  const { applied } = await migrate(db);
  const target = options.target ?? "workers";
  return {
    deps: {
      db,
      storage: memoryAdapter(),
      now: options.now ?? (() => FIXED_NOW),
      env: parseEnv(
        {
          SESSION_SECRET: "test-session-secret",
          ...(target === "node"
            ? {
                DATABASE_URL: ":memory:",
                STORAGE_DIR: "/tmp/pariksha-test-storage",
                PUBLIC_URL: "https://pariksha.test",
              }
            : {}),
          ...options.env,
        },
        target,
      ),
    },
    migrations: applied.length,
  };
}

/**
 * A `Cookie` header carrying `token`, signed the way the API signs it —
 * through the production function, so a test can never hold a cookie the
 * server would reject.
 */
export async function sessionCookie(
  deps: AppDeps,
  token: string,
): Promise<string> {
  const issuer = new Hono();
  issuer.get("/", async (c) => {
    await setSessionCookie(c, deps, token);
    return c.body(null, 204);
  });
  const header = (await issuer.request("/")).headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}
