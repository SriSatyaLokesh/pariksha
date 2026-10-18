import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The subrequest guard in apps/api/src/instrument.ts counts the four raw
// DbClient operations — exec, all, query and run — and is accurate only
// because the repository layer uses nothing else. A query issued through
// `db.drizzle` spends a D1 subrequest exactly the same and increments no
// counter, so a route looping through the query builder would pass its
// budget assertion and still blow the 50-subrequest ceiling in production:
// the one failure the guard exists to catch, with the alarm switched off.
//
// If a later phase genuinely needs the query builder, the move is to delete
// this test and instrument `drizzle` in countingDeps — not to work around it.

const repoDir = fileURLToPath(new URL("../../src/repo/", import.meta.url));

describe("the repository layer", () => {
  it("issues no query the budget guard cannot see", () => {
    // Enumerated from disk rather than from repo/index.ts's exports:
    // identity.ts sits outside the barrel by design (ADR 0006) and a walk
    // over the barrel would be as blind as the thing this test guards.
    const files = readdirSync(repoDir, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const name of files) {
      expect(readFileSync(join(repoDir, name), "utf8"), name).not.toMatch(/\.drizzle\b/);
    }
  });
});
