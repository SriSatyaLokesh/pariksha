import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "vite";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  runPrerender,
  resolveSiteUrl,
  buildIslandScriptTag,
} from "../../../scripts/prerender.mjs";
import { hasIllegalColorLiteral } from "../../../scripts/tokens.mjs";

// Design contract §8 Wave 1 (T1, T2, T3, T5): runs a real `vite build` plus
// scripts/prerender.mjs into a throwaway temp outDir — never apps/web/dist,
// which other agents may be building into concurrently in this worktree —
// and asserts on the markup a non-JS crawler sees. T1 is "the single most
// important test in the suite" (§8): everything else here is garnish.
//
// T6, T7, T8, T9, T12 and T17 live here rather than in seo.test.ts for the
// same reason: scripts/prerender.mjs's injectHead() does string surgery on
// the built HTML (regex replace + tag insertion before </head>), and a test
// that only calls buildHead()/buildJsonLd() directly proves the *data* is
// right without ever proving that surgery landed in the artefact a crawler
// actually fetches. robots.txt/llms.txt/sitemap.xml have no such step —
// runPrerender writeFile()s their builder's return value verbatim — so
// those (T14-T16) stay as pure-function tests in seo.test.ts.

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const SITE_URL = "https://pariksha.example";

// Wrapped in its own describe (rather than file-scoped hooks) so that a
// throw in this beforeAll — currently expected, since the island entry and
// vite.config.ts's third Rollup input it depends on (design contract §2.7)
// are a different assignment's work — skips only the tests that genuinely
// need a full build, not resolveSiteUrl's and buildIslandScriptTag's
// pure-function tests below, which must stay provable on their own.
describe("the full build (vite build + prerender into a disposable outDir)", () => {
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

  it("T2: ships exactly one module script, from /assets/, deferred to the end of body, under the 10 KB island budget, and no inline script but the one ld+json block (v3 §5, I-1)", () => {
    const moduleScripts = [
      ...indexHtml.matchAll(/<script[^>]*\btype="module"[^>]*><\/script>/g),
    ];
    expect(moduleScripts).toHaveLength(1);

    const tag = moduleScripts[0]![0]!;
    const src = /\bsrc="(\/assets\/[^"]+)"/.exec(tag)?.[1];
    expect(src).toBeDefined();

    const assetPath = resolve(outDir, src!.slice(1));
    expect(existsSync(assetPath)).toBe(true);
    expect(statSync(assetPath).size).toBeLessThanOrEqual(10 * 1024);

    // type="module" is deferred by the HTML spec on its own; this also
    // checks it sits after <main>, i.e. at the end of body, never in <head>.
    expect(indexHtml.indexOf(tag)).toBeGreaterThan(indexHtml.indexOf("</main>"));
    expect(tag).not.toContain(" defer");
    expect(tag).not.toContain(" async");

    // I-1: no inline <script> other than the one application/ld+json block.
    const inlineScripts = [
      ...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g),
    ].filter((m) => !m[0].includes('type="module"'));
    expect(inlineScripts).toHaveLength(1);
    expect(inlineScripts[0]![0]).toContain('type="application/ld+json"');
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

describe("T6 — title and description in the artefact", () => {
  it("exactly one <title>, 15-60 characters, containing Pariksha", () => {
    const titles = [...indexHtml.matchAll(/<title>([^<]*)<\/title>/g)];
    expect(titles).toHaveLength(1);
    const title = titles[0]![1]!;
    expect(title.length).toBeGreaterThanOrEqual(15);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toContain("Pariksha");
  });

  it("exactly one description meta, 110-160 characters, containing pre-alpha and October 2026", () => {
    const metas = [
      ...indexHtml.matchAll(/<meta name="description" content="([^"]*)"\s*\/?>/g),
    ];
    expect(metas).toHaveLength(1);
    const description = metas[0]![1]!;
    expect(description.length).toBeGreaterThanOrEqual(110);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description.toLowerCase()).toContain("pre-alpha");
    expect(description).toContain("October 2026");
  });

  it("both theme-color metas are present with their media attributes", () => {
    const metas = [
      ...indexHtml.matchAll(
        /<meta name="theme-color" content="[^"]*" media="(\([^)]*\))"\s*\/?>/g,
      ),
    ];
    expect(metas).toHaveLength(2);
    const media = metas.map((m) => m[1]);
    expect(media).toContain("(prefers-color-scheme: light)");
    expect(media).toContain("(prefers-color-scheme: dark)");
  });
});

describe("T7 — canonical, Open Graph, Twitter card in the artefact", () => {
  it("exactly one canonical, absolute https, equal to SITE_URL + '/'", () => {
    const canonicals = [
      ...indexHtml.matchAll(/<link rel="canonical" href="([^"]*)"\s*\/?>/g),
    ];
    expect(canonicals).toHaveLength(1);
    expect(canonicals[0]![1]).toBe(`${SITE_URL}/`);
  });

  it("carries the Open Graph properties SEO-11 lists, og:url equal to canonical", () => {
    const required = [
      "og:type",
      "og:site_name",
      "og:title",
      "og:description",
      "og:url",
      "og:image",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
      "og:locale",
    ];
    for (const key of required) {
      expect(indexHtml).toMatch(
        new RegExp(`<meta property="${key}" content="[^"]+"\\s*/?>`),
      );
    }
    const canonical = indexHtml.match(
      /<link rel="canonical" href="([^"]*)"\s*\/?>/,
    )?.[1];
    const ogUrl = indexHtml.match(
      /<meta property="og:url" content="([^"]*)"\s*\/?>/,
    )?.[1];
    expect(ogUrl).toBe(canonical);
  });

  it("twitter card is summary_large_image with an absolute image", () => {
    expect(indexHtml).toMatch(
      /<meta name="twitter:card" content="summary_large_image"\s*\/?>/,
    );
    const image = indexHtml.match(
      /<meta name="twitter:image" content="([^"]*)"\s*\/?>/,
    )?.[1];
    expect(image).toMatch(/^https:\/\//);
  });
});

describe("T8 — language in the artefact", () => {
  it("dist/index.html matches <html lang=\"en-GB\"", () => {
    expect(indexHtml).toMatch(/<html lang="en-GB"/);
  });
});

describe("T9 — no stray https origin anywhere in dist/", () => {
  // Every file scripts/prerender.mjs actually writes — read from disk,
  // not four hand-picked, concatenated builder-return strings (which is
  // exactly what missed index.html's own injectHead() surgery before).
  // Deliberately excludes: the compiled JS/CSS asset bundles (third-party
  // library code — React's own react.dev links in its dev warnings, say —
  // not SEO content this invariant is about, and admin's bundle is kept out
  // of the prerender graph entirely by T4/T29 regardless); and committed
  // static assets under public/ such as the fonts' OFL licence text, which
  // is attribution copy, not a page claim.
  const PRERENDER_OUTPUTS = ["index.html", "404.html", "robots.txt", "llms.txt", "sitemap.xml"];

  it("every https:// origin in every prerender-emitted file is SITE_URL, github.com, or a schema.org/w3.org/apache namespace", async () => {
    const allowedHosts = new Set([
      new URL(SITE_URL).hostname,
      "github.com",
      "schema.org",
      "www.w3.org",
      "www.apache.org",
    ]);
    for (const name of PRERENDER_OUTPUTS) {
      const file = resolve(outDir, name);
      const content = await readFile(file, "utf8");
      for (const match of content.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
        const host = match[1]!.toLowerCase();
        expect(allowedHosts.has(host), `unexpected origin ${host} in ${file}`).toBe(
          true,
        );
      }
    }
  });
});

describe("T10 — favicons and og.png are real in the artefact", () => {
  it("og.png's IHDR chunk reads 1200x630", () => {
    const buf = readFileSync(resolve(WEB_ROOT, "public/og.png"));
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it("icon-512.png (Organization.logo) is 512x512 and exists in dist/", () => {
    const iconPath = resolve(outDir, "icon-512.png");
    expect(existsSync(iconPath)).toBe(true);
    const buf = readFileSync(iconPath);
    expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(512);
    expect(buf.readUInt32BE(20)).toBe(512);
  });

  it("every icon <link> in <head> resolves to a non-empty file in dist/", () => {
    const hrefs = [
      ...indexHtml.matchAll(
        /<link rel="(?:icon|alternate icon|apple-touch-icon)"[^>]*href="([^"]+)"/g,
      ),
    ].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const filePath = resolve(outDir, href.replace(/^\//, ""));
      expect(existsSync(filePath), `${href} missing from dist/`).toBe(true);
      expect(statSync(filePath).size).toBeGreaterThan(0);
    }
  });
});

describe("T12 — structured data in the artefact", () => {
  it("exactly one application/ld+json block, and it JSON.parses", () => {
    const blocks = [
      ...indexHtml.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      ),
    ];
    expect(blocks).toHaveLength(1);
    expect(() => JSON.parse(blocks[0]![1]!)).not.toThrow();
  });
});

describe("T17 — the literal string pre-alpha in the artefact", () => {
  it("appears in the meta description, in releaseNotes, and in dist/llms.txt", async () => {
    const description = indexHtml.match(
      /<meta name="description" content="([^"]*)"\s*\/?>/,
    )?.[1];
    expect(description).toContain("pre-alpha");

    const block = indexHtml.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )?.[1];
    const graph = JSON.parse(block ?? "{}") as {
      "@graph": { "@type": string; releaseNotes?: string }[];
    };
    const software = graph["@graph"].find(
      (n) => n["@type"] === "SoftwareApplication",
    );
    expect(software?.releaseNotes).toContain("pre-alpha");

    const llms = await readFile(resolve(outDir, "llms.txt"), "utf8");
    expect(llms).toContain("pre-alpha");
  });
});

describe("T32 — B2's definitional sentence, against the hero's byte ceiling (v3 §5: ratio -> absolute offset)", () => {
  // v3 amends this from a ratio (byteIndex / totalBytes < 0.30) to an
  // absolute offset: a ratio punishes every later deletion as the
  // denominator shrinks, which is the opposite of what a shorter page is
  // being asked to do. 13,500 is derived in §4.9 — head and nav measure
  // 6,632 and do not change, leaving 6,868 bytes for all of B1 (the hero)
  // against its own ~6,790-byte target. T32 is still the hero's byte
  // ceiling; it is just stated as one now instead of as a fraction of a
  // shrinking whole.
  it("byte index of the sentence is under 13,500 bytes into dist/index.html", () => {
    const needle = "Pariksha is a free, open-source exam platform";
    const index = indexHtml.indexOf(needle);
    expect(index).toBeGreaterThan(-1);
    const byteIndex = Buffer.byteLength(indexHtml.slice(0, index), "utf8");
    expect(byteIndex).toBeLessThan(13_500);
  });
});

describe("P2 / T43 — artefact size budget (v3 §4.9: amended 100 KB -> 46 KB)", () => {
  it("dist/index.html is under 46 KB uncompressed, with the byte count printed", () => {
    const bytes = Buffer.byteLength(indexHtml, "utf8");
    // T43: printed whether it passes or fails, so a PR that moves the
    // number shows it rather than only its verdict.
    console.log(`dist/index.html: ${bytes} bytes (${(bytes / 1024).toFixed(2)} KB)`);
    expect(bytes).toBeLessThan(46 * 1024);
  });
});

describe("I-2 — the island's own budget, as shipped in the artefact", () => {
  it("the module script dist/index.html references is ≤ 10 KB minified", () => {
    const src = indexHtml.match(
      /<script[^>]*\btype="module"[^>]*\bsrc="(\/assets\/[^"]+)"/,
    )?.[1];
    expect(src).toBeDefined();
    const size = statSync(resolve(outDir, src!.slice(1))).size;
    // Printed whether it passes or fails, per I-2 ("printed in the build
    // log, pass or fail").
    console.log(`exam-demo island: ${(size / 1024).toFixed(2)} KB`);
    expect(size).toBeLessThanOrEqual(10 * 1024);
  });
});

describe("dist/404.html", () => {
  it("T5: exists and is marked noindex", async () => {
    const page = await readFile(resolve(outDir, "404.html"), "utf8");
    expect(page).toMatch(/noindex/);
  });

  it("SEO-4: carries the same shell — its stylesheet link resolves in dist/", async () => {
    const page = await readFile(resolve(outDir, "404.html"), "utf8");
    const match = /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+)"/.exec(
      page,
    );
    expect(match).not.toBeNull();
    expect(existsSync(resolve(outDir, match![1]!.slice(1)))).toBe(true);
  });

  it("is brought inside the project's colour guard: no illegal colour literal", async () => {
    const page = await readFile(resolve(outDir, "404.html"), "utf8");
    expect(hasIllegalColorLiteral(page)).toBe(false);
  });
});

}); // end "the full build"

describe("buildIslandScriptTag — the manifest lookup, in isolation (design contract §2.7)", () => {
  // Exercises the lookup against a hand-built manifest rather than a real
  // `vite build`, so this test does not depend on apps/web/src/island/ or
  // vite.config.ts's third Rollup input existing yet — both owned by a
  // different assignment. The full-build T2 above is the integration proof
  // once those land.
  let tmpOutDir: string;

  beforeAll(async () => {
    tmpOutDir = await mkdtemp(join(tmpdir(), "pariksha-manifest-"));
  });

  afterAll(async () => {
    await rm(tmpOutDir, { recursive: true, force: true });
  });

  async function writeManifest(manifest: unknown) {
    await mkdir(resolve(tmpOutDir, ".vite"), { recursive: true });
    await writeFile(
      resolve(tmpOutDir, ".vite/manifest.json"),
      JSON.stringify(manifest),
    );
  }

  it("returns a module script tag pointing at the island entry's hashed file", async () => {
    await writeManifest({
      "src/island/exam-demo.ts": {
        file: "assets/exam-demo-abc123.js",
        name: "island",
        isEntry: true,
      },
      "index.html": { file: "assets/index-xyz.js", isEntry: true },
    });
    const tag = await buildIslandScriptTag(tmpOutDir);
    expect(tag).toBe(
      '<script type="module" src="/assets/exam-demo-abc123.js"></script>',
    );
  });

  it("throws when no entry is named \"island\"", async () => {
    await writeManifest({
      "index.html": { file: "assets/index-xyz.js", isEntry: true },
    });
    await expect(buildIslandScriptTag(tmpOutDir)).rejects.toThrow(/island/i);
  });

  it("throws when the manifest is missing entirely", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "pariksha-no-manifest-"));
    try {
      await expect(buildIslandScriptTag(emptyDir)).rejects.toThrow(
        /manifest/i,
      );
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
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
