import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — the bundler is plain ESM with no type declarations; it
// is a build script, not part of the package's typed surface.
import { buildModule, OUTPUT_PATH, MIGRATIONS_DIR } from "../scripts/bundle-migrations.mjs";
import { sqliteMigrations, pgMigrations } from "../src/migrations.generated.js";

// The same contract the design tokens have: the generated file is committed
// so a clone builds without running the generator, and this fails if anyone
// edits it by hand or forgets to re-run the generator after drizzle-kit.
describe("the committed migration bundle", () => {
  it("is exactly what the generator produces from the .sql files", () => {
    expect(readFileSync(OUTPUT_PATH as string, "utf8")).toBe(buildModule());
  });

  it("carries every migration file on disk, for both dialects", () => {
    for (const [dialect, bundled] of [
      ["sqlite", sqliteMigrations],
      ["pg", pgMigrations],
    ] as const) {
      const onDisk = readdirSync(join(MIGRATIONS_DIR as string, dialect))
        .filter((name) => name.endsWith(".sql"))
        .sort();
      expect(bundled.map((m) => m.name)).toEqual(onDisk);
      expect(bundled.every((m) => m.statements.length > 0)).toBe(true);
    }
  });
});
