import { describe, it, expect, beforeAll } from "vitest";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Controller decision #5: there is no routes/dashboard to exclude yet (the
// dashboard is the next task). Instead assert that `vite build` produces
// separate entry chunks for index.html and admin.html, and that the
// candidate entry's module graph contains no module under src/routes/admin*.
//
// This uses Rollup's in-memory build output (write: false) rather than
// dist/.vite/manifest.json, per the controller's note that "a Rollup-level
// assertion is equally fine" — manifest.json only lists chunk-level src for
// entry modules, while the build output's per-chunk module map lists every
// source file folded into each chunk, which is what the module-graph claim
// needs. The output shape is duplicated locally (rather than imported from
// "rollup") because Vite's bundled output type isn't a published
// workspace dependency here.

interface BuildOutputChunk {
  type: "chunk" | "asset";
  isEntry?: boolean;
  name?: string;
  fileName: string;
  modules?: Record<string, unknown>;
  imports?: string[];
}

interface BuildOutput {
  output: BuildOutputChunk[];
}

function isBuildOutput(value: unknown): value is BuildOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { output?: unknown }).output)
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let chunks: BuildOutputChunk[];

beforeAll(async () => {
  const result: unknown = await build({
    root: ROOT,
    configFile: resolve(ROOT, "vite.config.ts"),
    logLevel: "silent",
    build: { write: false },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!isBuildOutput(output)) {
    throw new Error("Unexpected vite build() return shape");
  }
  chunks = output.output.filter(
    (item): item is BuildOutputChunk => item.type === "chunk",
  );
}, 60_000);

describe("the candidate and admin bundles are separate Vite entries", () => {
  it("produces separate entry chunks for index.html and admin.html", () => {
    const entryChunks = chunks.filter((chunk) => chunk.isEntry);
    const indexChunk = entryChunks.find((chunk) => chunk.name === "index");
    const adminChunk = entryChunks.find((chunk) => chunk.name === "admin");
    expect(indexChunk).toBeDefined();
    expect(adminChunk).toBeDefined();
    expect(indexChunk?.fileName).not.toBe(adminChunk?.fileName);
  });

  it("the candidate entry's module graph contains no module under src/routes/admin*", () => {
    const indexChunk = chunks.find(
      (chunk) => chunk.isEntry && chunk.name === "index",
    );
    expect(indexChunk).toBeDefined();

    // Walk every chunk the candidate entry imports (directly or
    // transitively) and collect every source module compiled into it.
    const visited = new Set<string>();
    const stack = indexChunk ? [indexChunk.fileName] : [];
    const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const moduleIds: string[] = [];
    while (stack.length > 0) {
      const fileName = stack.pop();
      if (!fileName || visited.has(fileName)) continue;
      visited.add(fileName);
      const chunk = byFileName.get(fileName);
      if (!chunk) continue;
      moduleIds.push(...Object.keys(chunk.modules ?? {}));
      for (const imported of chunk.imports ?? []) stack.push(imported);
    }

    expect(moduleIds.length).toBeGreaterThan(0);
    for (const moduleId of moduleIds) {
      expect(moduleId).not.toMatch(/src[\\/]routes[\\/]admin/);
    }
  });
});
