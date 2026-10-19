import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import viteConfig from "../vite.config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

describe("_headers", () => {
  const headers = readFileSync(resolve(ROOT, "public/_headers"), "utf8");

  it("sets a Content-Security-Policy with default-src 'self' on /*", () => {
    const blockStart = headers.indexOf("/*");
    const nextBlock = headers.indexOf("\n/", blockStart + 1);
    const block = headers.slice(
      blockStart,
      nextBlock === -1 ? undefined : nextBlock,
    );
    const csp = block.match(/Content-Security-Policy:\s*(.+)/)?.[1];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
  });

  it("never weakens the CSP and never points at a third-party origin", () => {
    expect(headers).not.toContain("'unsafe-inline'");
    expect(headers).not.toContain("'unsafe-eval'");
    expect(headers).not.toMatch(/https?:\/\//);
  });

  // I-6 (v3 design contract §2.9): the exam-demo island ships as a
  // same-origin `<script type="module" src="/assets/…">` and needs no
  // relaxation here — script-src 'self' already permits it, which is the
  // test that this construction (manifest-driven injection, §2.7) is the
  // right one. A design that needed a CSP change would be the wrong design.
  it("script-src 'self' already permits the same-origin island script, unchanged", () => {
    const blockStart = headers.indexOf("/*");
    const nextBlock = headers.indexOf("\n/", blockStart + 1);
    const block = headers.slice(
      blockStart,
      nextBlock === -1 ? undefined : nextBlock,
    );
    const csp = block.match(/Content-Security-Policy:\s*(.+)/)?.[1];
    expect(csp).toContain("script-src 'self'");
  });

  // T11
  it("gives /index.html a no-cache block, so a redeploy is visible", () => {
    const blockStart = headers.indexOf("/index.html");
    expect(blockStart).toBeGreaterThan(-1);
    const nextBlock = headers.indexOf("\n/", blockStart + 1);
    const block = headers.slice(
      blockStart,
      nextBlock === -1 ? undefined : nextBlock,
    );
    expect(block).toMatch(/Cache-Control:.*max-age=0/);
  });

  it("gives /admin.html an X-Robots-Tag: noindex block, keeping it out of the index", () => {
    const blockStart = headers.indexOf("/admin.html");
    expect(blockStart).toBeGreaterThan(-1);
    const nextBlock = headers.indexOf("\n/", blockStart + 1);
    const block = headers.slice(
      blockStart,
      nextBlock === -1 ? undefined : nextBlock,
    );
    expect(block).toMatch(/X-Robots-Tag:\s*noindex/);
  });

  it("no longer marks /fonts/* immutable (issue 137 — filenames are not content-hashed)", () => {
    const blockStart = headers.indexOf("/fonts/*");
    expect(blockStart).toBeGreaterThan(-1);
    const nextBlock = headers.indexOf("\n/", blockStart + 1);
    const block = headers.slice(
      blockStart,
      nextBlock === -1 ? undefined : nextBlock,
    );
    expect(block).not.toContain("immutable");
  });
});

describe("admin.html", () => {
  it("carries a noindex, nofollow robots meta tag", () => {
    const admin = readFileSync(resolve(ROOT, "admin.html"), "utf8");
    expect(admin).toMatch(/<meta\s+name="robots"\s+content="noindex,\s*nofollow"/);
  });
});

// Phase 6 Task 1 (#65, P6.1): the candidate runtime's own entry. A test's
// landing page carries an organiser's branding and a real candidate's
// window; it is not marketing and must not be indexed, the same reason
// admin.html is not.
describe("exam.html", () => {
  it("carries a noindex, nofollow robots meta tag", () => {
    const exam = readFileSync(resolve(ROOT, "exam.html"), "utf8");
    expect(exam).toMatch(/<meta\s+name="robots"\s+content="noindex,\s*nofollow"/);
  });

  it("is a Rollup input of its own, separate from the landing page's island", () => {
    const input = viteConfig.build?.rollupOptions?.input as Record<string, string>;
    expect(Object.keys(input).sort()).toEqual(["admin", "exam", "index", "island"]);
    expect(input.exam).toMatch(/exam\.html$/);
    // The island is the landing page's exam *demo*, not the candidate
    // runtime — two different entries that read alike.
    expect(input.island).not.toMatch(/exam\.html$/);
  });

  it("gets an X-Robots-Tag: noindex block in _headers, as admin.html does", () => {
    const headers = readFileSync(resolve(ROOT, "public/_headers"), "utf8");
    const blockStart = headers.indexOf("/exam.html");
    expect(blockStart).toBeGreaterThan(-1);
    const nextBlock = headers.indexOf("\n/", blockStart + 1);
    const block = headers.slice(blockStart, nextBlock === -1 ? undefined : nextBlock);
    expect(block).toMatch(/X-Robots-Tag:\s*noindex/);
  });
});

// T-02's candidate URL is `/<workspace-slug>/<test-slug>` — a path with no
// file behind it, so without a rewrite the asset router answers every
// candidate link with dist/404.html. `_headers` cannot express a rewrite
// (it sets headers), so the rule lives in `_redirects`, which Workers
// parses out of the same deployed asset directory. These tests exist for
// the ordering: the fallback matches ANY two-segment path, so a rule added
// below it would be dead and an asset prefix not claimed above it would be
// swallowed.
describe("_redirects", () => {
  const redirects = readFileSync(resolve(ROOT, "public/_redirects"), "utf8");
  const rules = redirects
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  it("rewrites the candidate slug pair onto exam.html with a 200, never a redirect", () => {
    // 200 and not 301/302: the address bar has to keep the slug pair,
    // because src/exam-main.tsx reads it to know which test to ask about.
    expect(rules).toContain("/:workspaceSlug/:testSlug  /exam.html  200");
  });

  it("puts the catch-all fallback last, so nothing below it is dead", () => {
    expect(rules.at(-1)).toMatch(/^\/:workspaceSlug\/:testSlug\b/);
  });

  it("claims every two-segment asset prefix above the fallback", () => {
    // /assets/index-abc123.js and /fonts/anek.woff2 are two-segment paths
    // and would otherwise match the fallback and serve the exam shell.
    const fallbackAt = rules.findIndex((rule) => rule.startsWith("/:workspaceSlug"));
    const above = rules.slice(0, fallbackAt).join("\n");
    for (const prefix of ["/assets/*", "/fonts/*"]) {
      expect(above, prefix).toContain(prefix);
    }
  });

  it("never points at a third-party origin (S-11), as _headers does not", () => {
    expect(redirects).not.toMatch(/https?:\/\//);
  });
});

// The site and the API ship as one Worker (see the header of the config
// itself), so its configuration no longer lives in this package — but these
// are still the web app's hosting guarantees, and they are still asserted
// here. The file is TOML rather than JSONC so it can carry the comments that
// explain the single-Worker decision; it is small and flat, so one regex for
// `key = "value"` beats a parser dependency.
describe("deploy/cloudflare/wrangler.toml", () => {
  const CONFIG = resolve(ROOT, "../../deploy/cloudflare/wrangler.toml");
  const toml = readFileSync(CONFIG, "utf8");
  const scalar = (key: string) =>
    new RegExp(`^${key} = "(.*)"$`, "m").exec(toml)?.[1];

  it("serves assets from the same directory Vite builds into", () => {
    const outDir = viteConfig.build?.outDir ?? "dist";
    expect(resolve(dirname(CONFIG), scalar("directory") ?? "")).toBe(
      resolve(ROOT, outDir),
    );
  });

  // Replaces "declares no main script": there is a script now, and what keeps
  // every page, font and bundle request free is that it is invoked only on
  // `/api/*` and, since Phase 5 Task 2's public short link, `/t/*` — both
  // paths with no file under `dist/`, so without the entry the asset
  // router's own 404 would answer before the script ran. Widening this list
  // further than those two is what would start metering the site.
  it("runs the Worker script on /api/* and /t/* only, so asset requests stay free", () => {
    expect(scalar("main")).toBeDefined();
    expect(toml).toMatch(/^run_worker_first = \["\/api\/\*", "\/t\/\*"\]$/m);
  });

  // T11 / SEO-4: a bogus URL must 404, never serve the landing page with a
  // soft-404 HTTP 200.
  it("serves dist/404.html on a miss, never the single-page-application fallback", () => {
    expect(scalar("not_found_handling")).toBe("404-page");
  });

  // SEO-7: once a custom domain is added, the workers.dev and preview URLs
  // must stop indexing alongside it.
  it("disables workers_dev and preview_urls once a route is declared", () => {
    if (/^routes = |^\[\[routes]]$/m.test(toml)) {
      expect(toml).toMatch(/^workers_dev = false$/m);
      expect(toml).toMatch(/^preview_urls = false$/m);
    }
  });
});

// `_headers` and the fonts are plain files under `public/`, and the only thing
// that carries them into `dist/` — the directory wrangler uploads — is Vite's
// publicDir copy. Nothing else in this suite asserts that link, so disabling
// it ships a site with no Content-Security-Policy and four fonts that 404
// while every other test stays green.
describe("the public directory reaches the build", () => {
  const publicDir = viteConfig.publicDir ?? "public";

  // Both tests below assert `publicDir` is a string before they call this, so
  // a disabled copy fails by assertion and never reaches the throw.
  const inPublicDir = (path: string) => {
    if (typeof publicDir !== "string") throw new Error("publicDir is disabled");
    return resolve(ROOT, publicDir, path);
  };

  it("is copied into dist, so _headers is deployed rather than only committed", () => {
    expect(publicDir).toBe("public");
    expect(existsSync(inPublicDir("_headers"))).toBe(true);
    // Same reasoning, and the candidate URL is unreachable without it.
    expect(existsSync(inPublicDir("_redirects"))).toBe(true);
  });

  it("carries every font face the stylesheet asks for", () => {
    const fontsCss = readFileSync(resolve(ROOT, "src/styles/fonts.css"), "utf8");
    const urls = [...fontsCss.matchAll(/url\("([^"]+)"\)/g)].map(
      (m) => m[1] ?? "",
    );

    // `false` disables the copy entirely — say so as an assertion rather than
    // letting path.resolve throw a type error further down.
    expect(typeof publicDir).toBe("string");
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("/")).toBe(true);
      expect(existsSync(inPublicDir(url.slice(1)))).toBe(true);
    }
  });
});
