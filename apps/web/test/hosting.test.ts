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

// This file is empty of rules on purpose and these tests keep it that way.
// T-02's candidate URL `/<workspace-slug>/<test-slug>` was served from here
// for one release; the rules broke every asset in production and were
// withdrawn in fb42d41. The Worker entry serves it now.
describe("_redirects", () => {
  const redirects = readFileSync(resolve(ROOT, "public/_redirects"), "utf8");
  const rules = redirects
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  // These two replace the three rules this file used to pin. The rules were
  // withdrawn after being measured on the deployed Worker, and the old tests
  // are the lesson: they asserted this file's CONTENT and stayed green while
  // production was broken. The pass-throughs they checked for were present
  // and did nothing — a 200 rewrite to its own path reads as a loop and is
  // dropped — so every two-segment path matched the fallback and
  // /assets/<hashed>.css answered 307 to /exam. The site lost every
  // stylesheet and script; /admin rendered nothing at all.
  //
  // What belongs here is the invariant, not the mechanism.
  it("carries no rule that could match a built asset path", () => {
    // A built asset is /assets/<name> or /fonts/<name> — two segments. Any
    // rule whose source can match two segments can swallow them, whatever
    // sits above it, because the pass-throughs meant to claim them first do
    // not take effect on Workers.
    const twoSegment = /^\/(?::[^/]+|\*|[^/\s]+)\/(?::[^/]+|\*|[^/\s]+)(?:\s|$)/;
    for (const rule of rules) {
      expect(rule, rule + " can match /assets/<file>").not.toMatch(twoSegment);
    }
  });

  it("has no active rule, which is the state the Worker leaves it in", () => {
    // T-02's candidate URL is served by the Worker entry, not by this file —
    // `apps/api/test/worker.test.ts` exercises that route rather than
    // reading a line of config. Nothing is left for this file to do, and the
    // test above says why nothing may be put back.
    expect(rules).toEqual([]);
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

  // This used to pin `["/api/*", "/t/*"]` and say that widening it was what
  // would start metering the site. It has been widened, deliberately, and
  // the comment on the line itself carries the cost: `/*/*` is every path of
  // two segments or more, so a candidate URL now invokes the script against
  // the free plan's 100,000 requests/day. T-02's `/<workspace-slug>/<test-slug>`
  // has no file under `dist/`, and `not_found_handling = "404-page"` answers
  // a request matching no asset with `404.html` without running the script —
  // which is exactly what production does today.
  //
  // What stays free is what this test now pins hardest: the exclusions. Every
  // byte a page pulls after the first — `/assets/*` and `/fonts/*` — must
  // never reach the script, and `/` and `/admin` are one segment, which
  // `/*/*` cannot match.
  //
  // This is a config assertion and it is NOT the coverage that matters. The
  // outage this replaces was shipped under three green tests of exactly this
  // kind. The behaviour lives in `apps/api/test/worker.test.ts`, against
  // Miniflare — but that pool invokes the script for every path regardless of
  // `run_worker_first` (measured, see the note there), so this line is the
  // only place the routing config is checked at all. Treat it as a reminder,
  // not as proof.
  it("runs the Worker script on the API, short links and candidate URLs, with assets and fonts excluded", () => {
    expect(scalar("main")).toBeDefined();
    const first = /^run_worker_first = \[(.+)\]$/m.exec(toml)?.[1];
    expect(first).toBeDefined();
    const patterns = [...(first ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(patterns).toEqual([
      "/api/*",
      "/t/*",
      "/*/*",
      "!/assets/*",
      "!/fonts/*",
    ]);
  });

  // T11 / SEO-4: a bogus URL must 404, never serve the landing page with a
  // soft-404 HTTP 200. `not_found_handling = "404-page"` is what keeps that
  // true for every path the asset router does not match.
  //
  // There IS one rewrite, and exactly one: the Worker entry serves the exam
  // shell for a TWO-SEGMENT path, because T-02's candidate URL
  // `/<workspace-slug>/<test-slug>` has no file behind it. (Phase 6 put that
  // rule in `_redirects`; it was withdrawn in fb42d41 after breaking every
  // asset in production, and `apps/api/src/index.ts` owns it now.) That is a
  // deliberate, bounded exception — never a blanket
  // `not_found_handling = "single-page-application"`, which would turn every
  // miss at every depth into a page. One-segment and three-segment misses
  // still get `dist/404.html`, which is what this line pins. Its accepted
  // cost — a two-segment path naming no real test answers 200 with the exam
  // shell, mitigated by `noindex` on both the meta tag and the header — is
  // recorded in ADR 0008.
  it("serves dist/404.html on a miss, and never turns the whole site into a SPA", () => {
    expect(scalar("not_found_handling")).toBe("404-page");
    expect(toml).not.toContain("single-page-application");
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
    // `_redirects` carries no rule any more, only the record of why (see
    // above), but it ships so that a file reappearing in `dist/` without one
    // here would be noticed.
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
