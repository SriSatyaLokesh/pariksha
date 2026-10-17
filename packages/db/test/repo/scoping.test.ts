import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import { REPO_FUNCTIONS } from "../../src/repo/guard.js";
import * as repo from "../../src/repo/index.js";

// The rule this file defends is the one a later phase will break by accident:
// a repository function added in Phase 7 by someone who never read this plan
// must still be impossible to call without a workspace. That is why the guard
// is a registry rather than a review habit.

const WORKSPACE_A = newId("wsp");
const WORKSPACE_B = newId("wsp");

let db: DbClient;
let testInA: string;
let testInB: string;

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);

  await repo.createWorkspace(db, WORKSPACE_A, { slug: "alpha", name: "Alpha" });
  await repo.createWorkspace(db, WORKSPACE_B, { slug: "beta", name: "Beta" });

  testInA = await repo.createTest(db, WORKSPACE_A, {
    slug: "aptitude",
    name: "Aptitude",
  });
  testInB = await repo.createTest(db, WORKSPACE_B, {
    slug: "aptitude",
    name: "Aptitude",
  });
});

afterAll(() => closeClient(db));

describe("S-09 / AC-23: a workspace cannot see another workspace's rows", () => {
  it("lists only its own tests", async () => {
    expect(await repo.listTests(db, WORKSPACE_A)).toHaveLength(1);
    expect(await repo.listTests(db, WORKSPACE_B)).toHaveLength(1);
  });

  it("returns null — not a 403 — for a test that belongs to another workspace", async () => {
    // 404-not-403: existence is not disclosed across a workspace boundary.
    expect(await repo.getTest(db, WORKSPACE_A, testInB)).toBeNull();
    expect(await repo.getTest(db, WORKSPACE_B, testInA)).toBeNull();
  });

  it("finds its own test by the same ID", async () => {
    expect(await repo.getTest(db, WORKSPACE_A, testInA)).toMatchObject({
      slug: "aptitude",
    });
  });

  it("lets two workspaces hold the same slug", async () => {
    // The unique constraint is (workspace_id, slug), not slug.
    expect(await repo.getTest(db, WORKSPACE_B, testInB)).toMatchObject({
      slug: "aptitude",
    });
  });
});

describe("the guard is structural", () => {
  it("registers every exported repository function", () => {
    const exported = Object.entries(repo)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);

    expect(exported.length).toBeGreaterThan(0);
    expect(new Set(exported)).toEqual(new Set(Object.keys(REPO_FUNCTIONS)));
  });

  it("refuses every registered function an empty workspace ID", async () => {
    for (const [name, fn] of Object.entries(REPO_FUNCTIONS)) {
      await expect(
        fn(db, ""),
        `${name} accepted an empty workspace ID`,
      ).rejects.toThrow(/workspace/i);
    }
  });

  it("refuses a workspace ID that is not a workspace ID", async () => {
    for (const [name, fn] of Object.entries(REPO_FUNCTIONS)) {
      // A test ID where a workspace ID belongs is the realistic slip: both are
      // strings of the same shape, and only the prefix says which is which.
      await expect(
        fn(db, newId("tst")),
        `${name} accepted a test ID as a workspace ID`,
      ).rejects.toThrow(/workspace/i);
    }
  });
});
