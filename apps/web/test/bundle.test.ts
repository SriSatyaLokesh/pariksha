import { describe, it, expect, beforeAll } from "vitest";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Design contract §8, T4 and T29. Admin markup must never reach the public
// page. Before the prerender, that guard watched the two-HTML module graph;
// now that the shipped HTML comes from src/entry-prerender.tsx's SSR bundle
// instead, the guard is re-pointed at THAT graph — a stronger guard, not a
// weaker one, because a fat admin-free client bundle was never the risk;
// admin markup leaking into the page a crawler reads is.

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

// T29: widened so both src/routes/admin* and a top-level src/admin-main.tsx
// (or a src/components/AdminNav.tsx, etc.) are caught.
const ADMIN_PATH_RE = /src[\\/](routes[\\/])?admin/i;

async function buildChunks(overrides: Parameters<typeof build>[0]): Promise<BuildOutputChunk[]> {
  const result: unknown = await build({
    root: ROOT,
    configFile: resolve(ROOT, "vite.config.ts"),
    logLevel: "silent",
    ...overrides,
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!isBuildOutput(output)) {
    throw new Error("Unexpected vite build() return shape");
  }
  return output.output.filter(
    (item): item is BuildOutputChunk => item.type === "chunk",
  );
}

let prerenderChunks: BuildOutputChunk[];
let twoEntryChunks: BuildOutputChunk[];

beforeAll(async () => {
  prerenderChunks = await buildChunks({
    build: { ssr: "src/entry-prerender.tsx", write: false },
  });
  twoEntryChunks = await buildChunks({ build: { write: false } });
}, 60_000);

describe("the prerender's SSR bundle excludes admin code (T4, T29)", () => {
  it("no module in src/entry-prerender.tsx's graph matches src/(routes/)?admin", () => {
    const moduleIds = prerenderChunks.flatMap((chunk) =>
      Object.keys(chunk.modules ?? {}),
    );
    expect(moduleIds.length).toBeGreaterThan(0);
    for (const moduleId of moduleIds) {
      expect(moduleId).not.toMatch(ADMIN_PATH_RE);
    }
  });
});

describe("the candidate and admin bundles are separate Vite entries", () => {
  // SEO-2/P1: index.html carries no module script, so the two-HTML build emits
  // a JS entry chunk for admin only. The guard is that admin's chunk still
  // exists and separately that `/` gets no JS entry chunk at all.
  it("emits an admin entry chunk and none for index.html (T4, SEO-2)", () => {
    const entryChunks = twoEntryChunks.filter((chunk) => chunk.isEntry);
    const adminChunk = entryChunks.find((chunk) => chunk.name === "admin");
    expect(adminChunk).toBeDefined();
    expect(entryChunks.find((chunk) => chunk.name === "index")).toBeUndefined();
  });
});
