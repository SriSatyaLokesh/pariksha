// One set of real dependencies for every route test: an in-memory SQLite
// database and the in-memory storage adapter, so the whole API is exercised
// without a container, a network or a mock.

import { sqliteClient, migrate, type DbClient } from "@pariksha/db";
import { memoryAdapter } from "@pariksha/storage";
import { parseEnv } from "../src/env.js";
import type { AppDeps } from "../src/app.js";

/** Fixed, so a test asserting on a timestamp never races a real clock. */
export const FIXED_NOW = 1_760_000_000_000;

export async function testDeps(): Promise<{
  deps: AppDeps;
  migrations: number;
}> {
  const db: DbClient = sqliteClient(":memory:");
  const { applied } = await migrate(db);
  return {
    deps: {
      db,
      storage: memoryAdapter(),
      now: () => FIXED_NOW,
      env: parseEnv({ SESSION_SECRET: "test-session-secret" }, "workers"),
    },
    migrations: applied.length,
  };
}
