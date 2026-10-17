import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runPrerender, resolveSiteUrl } from "../../../scripts/prerender.mjs";

// Design contract §8 Wave 1 (T1, T2, T3, T5): runs a real `vite build` plus
// scripts/prerender.mjs into a throwaway temp outDir — never apps/web/dist,
// which other agents may be building into concurrently in this worktree —
// and asserts on the markup a non-JS crawler sees. T1 is "the single most
// important test in the suite" (§8): everything else here is garnish.

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const SITE_URL = "https://pariksha.example";

let outDir: string;
let indexHtml: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "pariksha-prerender-"));
  await build({
    root: WEB_ROOT,
    configFile: resolve(WEB_ROOT, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir, emptyOutDir: true },
  });
  await runPrerender({ webRoot: WEB_ROOT, outDir, siteUrl: SITE_URL });
  indexHtml = await readFile(resolve(outDir, "index.html"), "utf8");
}, 120_000);

afterAll(async () => {
  if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe("the prerendered dist/index.html", () => {
  it("T1: contains the h1 text, the word Pariksha, and at least one <section>", () => {
    expect(indexHtml).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    expect(indexHtml).toContain("Pariksha");
    expect(indexHtml).toMatch(/<section[\s>]/);
  });

  it("T2: ships no client JavaScript — no module script, no /assets/ script", () => {
    expect(indexHtml).not.toMatch(/<script[^>]*\btype="module"/);
    expect(indexHtml).not.toMatch(/<script[^>]*\bsrc="\/assets\//);
  });

  it("T3: links a stylesheet whose target exists in dist/ and is non-empty", async () => {
    const match = /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+)"/.exec(
      indexHtml,
    );
    expect(match).not.toBeNull();
    const assetPath = resolve(outDir, match![1]!.slice(1));
    expect(existsSync(assetPath)).toBe(true);
    const css = await readFile(assetPath, "utf8");
    expect(css.length).toBeGreaterThan(0);
  });
});

describe("dist/404.html", () => {
  it("T5: exists and is marked noindex", async () => {
    const page = await readFile(resolve(outDir, "404.html"), "utf8");
    expect(page).toMatch(/noindex/);
  });
});

describe("resolveSiteUrl (SEO-6 / OQ-1 — no placeholder fallback)", () => {
  it("throws when SITE_URL is unset", () => {
    expect(() => resolveSiteUrl(undefined)).toThrow(/SITE_URL/);
  });

  it("throws on a non-URL string", () => {
    expect(() => resolveSiteUrl("not a url")).toThrow();
  });

  it("throws on a non-https origin", () => {
    expect(() => resolveSiteUrl("http://pariksha.example")).toThrow(/https/);
  });

  it("throws when the origin carries a path, query or hash", () => {
    expect(() => resolveSiteUrl("https://pariksha.example/foo")).toThrow();
    expect(() => resolveSiteUrl("https://pariksha.example?x=1")).toThrow();
  });

  it("accepts a bare https origin and returns it with no trailing slash", () => {
    expect(resolveSiteUrl("https://pariksha.example")).toBe(
      "https://pariksha.example",
    );
    expect(resolveSiteUrl("https://pariksha.example/")).toBe(
      "https://pariksha.example",
    );
  });
});
