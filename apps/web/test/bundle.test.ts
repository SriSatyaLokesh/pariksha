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
//
// v3 design contract §5, T4 "Extended": a second real client entry now
// exists alongside admin's — the exam-demo island (src/island/exam-demo.ts,
// §2) — so the same admin-path guard is re-run against its module graph
// too. Admin code reachable from the island would be admin code shipped to
// every visitor by a different route than the one T4 already watched.

interface BuildOutputChunk {
  type: "chunk" | "asset";
  isEntry?: boolean;
  name?: string;
  fileName: string;
  modules?: Record<string, unknown>;
  // `imports` is the static graph and `dynamicImports` is not. ADR 0004
  // rests entirely on that distinction, so the two are kept apart here.
  imports?: string[];
  dynamicImports?: string[];
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
//
// P3.9: widened again. The organiser screens the plan names are
// src/routes/signin|setup|dashboard|organiser and src/lib/api — none of
// which contains the word "admin", so the guard above would have watched
// admin-main.tsx while the three screens it mounts leaked freely. The
// constraint is "no organiser code in the public bundle", so the pattern
// now names the organiser module graph, not just the entry file.
const ADMIN_PATH_RE =
  /src[\\/](routes[\\/])?admin|src[\\/]routes[\\/](signin|setup|dashboard|organiser)|src[\\/]lib[\\/]api/i;

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
// Phase 6 Task 1 (#65): renamed from `twoEntryChunks`, which had been stale
// since the island landed and is now wrong by two — the real config carries
// `index`, `admin`, `island` and, from this task, `exam`.
let entryChunks: BuildOutputChunk[];
let rendererChunks: BuildOutputChunk[];

beforeAll(async () => {
  prerenderChunks = await buildChunks({
    build: { ssr: "src/entry-prerender.tsx", write: false },
  });
  entryChunks = await buildChunks({ build: { write: false } });
  // The real entries plus the shared renderer as one of its own. Until a
  // screen imports it (Task 2) no production entry reaches the renderer at
  // all, and a guard that walks only admin and the island would be green
  // whatever markdown.ts imported — true today and vacuous, which is the
  // worst thing this particular test could be. Building it as an entry
  // makes the guard load-bearing now; when the editor screens land, admin's
  // own graph is already covered by the same loop.
  rendererChunks = await buildChunks({
    build: {
      write: false,
      rollupOptions: {
        input: { render: resolve(ROOT, "src/render/markdown.ts") },
        // Vite's application build sets `preserveEntrySignatures: false`,
        // which drops an entry's exports as unused. For a library-shaped
        // entry that deletes `renderMarkdown` and with it the dynamic
        // import, and the katex assertions below would pass against a
        // module that had been shaken down to nothing.
        preserveEntrySignatures: "strict",
      },
    },
  });
}, 120_000);

/** Every module reachable from `entryName` by static `import` alone. */
function staticModules(chunks: BuildOutputChunk[], entryName: string): string[] {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === entryName);
  expect(entry, entryName).toBeDefined();

  const seen = new Set<string>();
  const queue = [entry?.fileName ?? ""];
  while (queue.length > 0) {
    const file = queue.pop() ?? "";
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of byFile.get(file)?.imports ?? []) queue.push(next);
  }
  return [...seen].flatMap((file) => Object.keys(byFile.get(file)?.modules ?? {}));
}

const hasKatex = (chunk: BuildOutputChunk) =>
  Object.keys(chunk.modules ?? {}).some((id) => id.includes("katex"));

describe("KaTeX is lazy and stays lazy (ADR 0004, Review Focus 1)", () => {
  // The failure this exists for is silent: one static `import "katex"` —
  // a convenience re-export, a component importing the plugin only to type
  // a prop — moves 76 KB gzipped into the initial chunk and every rendering
  // test still passes. Nothing else in the suite measures it.
  const entries = () =>
    rendererChunks
      .filter((chunk) => chunk.isEntry)
      .map((chunk) => chunk.name ?? chunk.fileName);

  it("no entry can reach katex or its markdown-it plugin by static import", () => {
    expect(entries()).toContain("render");
    for (const entry of entries()) {
      const modules = staticModules(rendererChunks, entry).join("\n");
      for (const lazy of ["katex", "@vscode/markdown-it-katex"]) {
        expect(modules, `${lazy} is statically reachable from ${entry}`).not.toContain(
          lazy,
        );
      }
    }
  });

  it("markdown-it is static, so the guard above is about loading and not about bundling", () => {
    // The positive control. Were both libraries behind dynamic imports the
    // assertion above would hold for a renderer that renders nothing.
    expect(staticModules(rendererChunks, "render").join("\n")).toContain("markdown-it");
  });

  it("katex is in the build, in chunks no entry statically reaches", () => {
    const katexChunks = rendererChunks.filter(hasKatex);
    expect(katexChunks.length).toBeGreaterThan(0);
    expect(katexChunks.every((chunk) => !chunk.isEntry)).toBe(true);
  });

  it("the renderer's chunk names katex as a dynamic import", () => {
    const renderEntry = rendererChunks.find(
      (chunk) => chunk.isEntry && chunk.name === "render",
    );
    expect(renderEntry, "render").toBeDefined();
    const byFile = new Map(rendererChunks.map((chunk) => [chunk.fileName, chunk]));

    // Fix round (whole-branch review, C1): now that `admin` also reaches
    // this same renderer (QuestionEditor -> PreviewPane -> markdown.ts, by
    // way of the bank/question screens C1 wired up), this isolated build
    // merges `render`'s input with the config file's `admin`/`island`
    // entries (vite's `build()` merges `rollupOptions.input`, it does not
    // replace it) — two entries now share the renderer module, so Rollup is
    // free to hoist the dynamic `import("katex")` edge onto a shared chunk
    // reached from `render` only by a *static* import, rather than keeping
    // it on the entry chunk itself. Which file holds the edge is Rollup's
    // business; that it is still a dynamic edge somewhere in the graph
    // `render` statically reaches is the actual guarantee this test checks
    // — so the search now walks every chunk reachable by static import from
    // `render`, unioning their dynamic imports, instead of reading only the
    // entry chunk's own.
    const seen = new Set<string>();
    const queue = [renderEntry?.fileName ?? ""];
    const dynamicTargets = new Set<string>();
    while (queue.length > 0) {
      const file = queue.pop() ?? "";
      if (seen.has(file)) continue;
      seen.add(file);
      const chunk = byFile.get(file);
      for (const next of chunk?.imports ?? []) queue.push(next);
      for (const dyn of chunk?.dynamicImports ?? []) dynamicTargets.add(dyn);
    }
    const dynamic = [...dynamicTargets].map((file) => byFile.get(file));
    expect(dynamic.some((chunk) => chunk !== undefined && hasKatex(chunk))).toBe(true);
  });
});

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
  // SEO-2/P1: index.html carries no module script of its own (the island's
  // tag is injected by scripts/prerender.mjs from the manifest, never left
  // in index.html's source — §2.7), so this build emits a JS entry chunk
  // for admin and, once it exists, the island — never one named "index".
  it("emits an admin entry chunk and none for index.html (T4, SEO-2)", () => {
    const entries = entryChunks.filter((chunk) => chunk.isEntry);
    expect(entries.find((chunk) => chunk.name === "admin")).toBeDefined();
    expect(entries.find((chunk) => chunk.name === "index")).toBeUndefined();
  });

  // Phase 6 Task 1 (#65): exam.html is the FOURTH Rollup input, and `exam`
  // is a different entry from `island` — which is the landing page's
  // exam-*demo*, not the candidate runtime, despite the name.
  it("emits an exam entry chunk, separate from the island's (P6.1)", () => {
    const entries = entryChunks.filter((chunk) => chunk.isEntry);
    const exam = entries.find((chunk) => chunk.name === "exam");
    const island = entries.find((chunk) => chunk.name === "island");
    expect(exam).toBeDefined();
    expect(island).toBeDefined();
    expect(exam?.fileName).not.toBe(island?.fileName);
  });

  // v3 §5, T4 extended. No island entry yet (vite.config.ts's third Rollup
  // input — §2.7 — is a different assignment's work) means this is
  // intentionally unproven until it lands; once it does, this is the test
  // that would catch admin code reaching the public bundle through it.
  it("no module in the island's bundle matches src/(routes/)?admin, once an island entry exists", () => {
    const islandChunk = entryChunks.find(
      (chunk) => chunk.isEntry && chunk.name === "island",
    );
    expect(islandChunk).toBeDefined();
    const moduleIds = Object.keys(islandChunk?.modules ?? {});
    expect(moduleIds.length).toBeGreaterThan(0);
    for (const moduleId of moduleIds) {
      expect(moduleId).not.toMatch(ADMIN_PATH_RE);
    }
  });
});

// Phase 5 Task 2 (#54): `qrcode-generator` renders T-02's short-link QR code
// (apps/web/src/components/QrCode.tsx) — an organiser's own tool, reached
// only from the test list (apps/web/src/routes/tests.tsx) through
// organiser.tsx, never from the island. Candidate bundle budget is 300 KB
// gzipped and Phase 5 adds nothing to it (Global Constraints) — a library an
// exam-taker never needs is the easiest way to spend some of it by accident.
describe("the QR generator is in the admin entry only (T-02)", () => {
  it("the island cannot reach qrcode-generator by static import", () => {
    expect(staticModules(entryChunks, "island").join("\n")).not.toContain("qrcode-generator");
  });

  it("the admin entry does reach qrcode-generator", () => {
    expect(staticModules(entryChunks, "admin").join("\n")).toContain("qrcode-generator");
  });
});

// Phase 5 Task 3 (#55, P5.2): SectionList, QuestionPickerDrawer and the
// builder shell (apps/web/src/{components/testbuilder,routes/test.tsx}) are
// an organiser's own tools, reached only through organiser.tsx — an
// exam-taker's island has no path to any of them. Global Constraints: the
// candidate budget is 300 KB gzipped and Phase 5 adds nothing to it, the
// same rule the QR generator check above enforces for its own dependency.
describe("the test builder screens are in the admin entry only (#55, P5.2)", () => {
  it("the island cannot reach src/components/testbuilder by static import", () => {
    expect(staticModules(entryChunks, "island").join("\n")).not.toMatch(/src[\\/]components[\\/]testbuilder/);
  });

  it("the admin entry does reach src/components/testbuilder", () => {
    expect(staticModules(entryChunks, "admin").join("\n")).toMatch(/src[\\/]components[\\/]testbuilder/);
  });
});

// Phase 6 Task 1 (#65, P6.1): the candidate's own entry. The PRD's
// non-functional table budgets a candidate at 300 KB gzipped and Phase 4
// already spent 41 KB of it on markdown-it, so the structural guard is the
// one that matters: no organiser code may be statically reachable from the
// exam entry, and KaTeX stays behind its dynamic import (ADR 0004).
describe("the candidate runtime's exam entry (#65, P6.1)", () => {
  it("no organiser code is statically reachable from the exam entry", () => {
    expect(staticModules(entryChunks, "exam").filter((m) => ADMIN_PATH_RE.test(m))).toEqual([]);
  });

  it("KaTeX is not in the exam entry's static graph either (ADR 0004)", () => {
    const modules = staticModules(entryChunks, "exam").join("\n");
    for (const lazy of ["katex", "@vscode/markdown-it-katex"]) {
      expect(modules, lazy).not.toContain(lazy);
    }
  });

  it("the exam entry cannot reach the test builder or the QR generator", () => {
    const modules = staticModules(entryChunks, "exam").join("\n");
    expect(modules).not.toContain("qrcode-generator");
    expect(modules).not.toMatch(/src[\\/]components[\\/]testbuilder/);
  });

  // Phase 6 Task 7 (#71). The candidate side legitimately shares three
  // Phase 4 modules -- RenderedHtml, ReorderableList and the renderer
  // behind them -- but NOT the three answer EDITORS beside them.
  // Measured, not assumed: importing one constant out of
  // authoring/answer/Choice.tsx put all 10 KB of the option editor into
  // this graph, because Rollup keeps a module whole, and the three such
  // imports together cost 35 KB raw of organiser-only code an exam-taker
  // downloads and never runs. The shared values moved to
  // src/components/answer-common.ts; this is what stops the next one.
  // ADMIN_PATH_RE never covered src/components/authoring, so nothing
  // else in this file would have noticed.
  it("no authoring EDITOR is statically reachable from the exam entry", () => {
    const modules = staticModules(entryChunks, "exam");
    expect(
      modules.filter((id) => /src[\\/]components[\\/]authoring[\\/]answer/.test(id)),
    ).toEqual([]);
    expect(
      modules.filter((id) =>
        /src[\\/]components[\\/]authoring[\\/](QuestionEditor|PromptEditor|GroupEditor|ImportDialog|PreviewPane|TypePicker|ScoringRow)/.test(
          id,
        ),
      ),
    ).toEqual([]);
  });

  // The positive control for the assertion above: the Phase 4 modules the
  // candidate DOES share are reached, so "no authoring code at all" would
  // be a different and wrong guard.
  it("the exam entry does reach the shared renderer and the reorderable list", () => {
    const modules = staticModules(entryChunks, "exam").join("\n");
    expect(modules).toMatch(/src[\\/]components[\\/]authoring[\\/]RenderedHtml/);
    expect(modules).toMatch(/src[\\/]components[\\/]authoring[\\/]ReorderableList/);
    expect(modules).toContain("markdown-it");
  });

  // The positive control: without it the three assertions above would hold
  // for an entry that reached nothing at all.
  it("the exam entry does reach the candidate screens", () => {
    expect(staticModules(entryChunks, "exam").join("\n")).toMatch(/src[\\/]routes[\\/]exam/);
  });
});
