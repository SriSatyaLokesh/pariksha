import { afterAll, expect, it } from "vitest";
import {
  closeClient,
  createWorkspace,
  getWorkspace,
  newId,
  seedDemoWorkspace,
  type DbClient,
} from "@pariksha/db";
import { testDeps, FIXED_NOW } from "../deps.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { demoCleanupJob, demoSweep } from "../../src/retention/demo-sweep.js";

const { deps } = await testDeps();

afterAll(() => closeClient(deps.db));

async function countTable(db: DbClient, table: string, workspaceId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM "${table}" WHERE workspace_id = ?`,
    [workspaceId],
  );
  return Number(rows[0]?.n ?? 0);
}

it("demoCleanupJob has the expected shape and declared metadata", () => {
  expect(demoCleanupJob.name).toBe("demo.sweep");
  expect(demoCleanupJob.cron).toBe("17 3 * * *");
  expect(demoCleanupJob.maxSubrequests).toBeLessThanOrEqual(10);
});

it("purges expired demo workspaces and their cascaded child rows", async () => {
  const now = FIXED_NOW;

  // 1. Seed an expired demo workspace (expired 1 hour ago)
  const expiredWspId = newId("wsp");
  await seedDemoWorkspace(deps.db, expiredWspId, {
    now: now - 7200_000, // created 2h ago, expired 1h ago
  });

  // 2. Seed an active demo workspace (expires in 1 hour)
  const activeWspId = newId("wsp");
  await seedDemoWorkspace(deps.db, activeWspId, {
    now, // created now, expires in 1h
  });

  // 3. Seed a regular non-demo workspace
  const regularWspId = newId("wsp");
  await createWorkspace(deps.db, regularWspId, {
    slug: "alpha-corp",
    name: "Alpha Corp",
    now,
  });

  // Verify initial state
  expect(await getWorkspace(deps.db, expiredWspId)).not.toBeNull();
  expect(await countTable(deps.db, "question", expiredWspId)).toBeGreaterThan(0);
  expect(await countTable(deps.db, "test", expiredWspId)).toBeGreaterThan(0);
  expect(await countTable(deps.db, "attempt", expiredWspId)).toBeGreaterThan(0);

  expect(await getWorkspace(deps.db, activeWspId)).not.toBeNull();
  expect(await getWorkspace(deps.db, regularWspId)).not.toBeNull();

  // Run the sweep
  const result = await demoSweep(deps);
  expect(result.deletedWorkspaces).toBeGreaterThanOrEqual(1);

  // Assert expired demo workspace and all child rows are gone
  expect(await getWorkspace(deps.db, expiredWspId)).toBeNull();
  expect(await countTable(deps.db, "question", expiredWspId)).toBe(0);
  expect(await countTable(deps.db, "test", expiredWspId)).toBe(0);
  expect(await countTable(deps.db, "attempt", expiredWspId)).toBe(0);
  expect(await countTable(deps.db, "candidate", expiredWspId)).toBe(0);
  expect(await countTable(deps.db, "membership", expiredWspId)).toBe(0);

  // Assert active demo workspace and regular non-demo workspace remain intact
  expect(await getWorkspace(deps.db, activeWspId)).not.toBeNull();
  expect(await countTable(deps.db, "question", activeWspId)).toBeGreaterThan(0);

  expect(await getWorkspace(deps.db, regularWspId)).not.toBeNull();
});

it("the sweep job stays within the subrequest ceiling", async () => {
  const counting = countingDeps(deps);
  const jobResult = await demoCleanupJob.run(counting.deps);

  expect(jobResult.summary).toContain("demo");
  expect(counting.counts().total).toBeLessThanOrEqual(demoCleanupJob.maxSubrequests);
  expect(counting.counts().total).toBeLessThan(SUBREQUEST_LIMIT);
});
