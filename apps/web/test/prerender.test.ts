import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "vite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { runPrerender, resolveSiteUrl } from "../../../scripts/prerender.mjs";
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

describe("T32 — S2's definitional sentence lands within the first 30% of the artefact", () => {
  it("byte index of the sentence divided by dist/index.html's byte length is under 0.30", () => {
    const needle = "Pariksha is a free, open-source exam platform";
    const index = indexHtml.indexOf(needle);
    expect(index).toBeGreaterThan(-1);
    const byteIndex = Buffer.byteLength(indexHtml.slice(0, index), "utf8");
    const totalBytes = Buffer.byteLength(indexHtml, "utf8");
    expect(byteIndex / totalBytes).toBeLessThan(0.3);
  });
});

describe("P2 — artefact size budget", () => {
  it("dist/index.html is under 100 KB uncompressed", () => {
    expect(Buffer.byteLength(indexHtml, "utf8")).toBeLessThan(100 * 1024);
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
