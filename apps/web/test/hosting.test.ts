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

describe("wrangler.jsonc", () => {
  // No comments or trailing commas in this file, so it's valid JSON — no
  // JSONC parser dependency needed.
  const config: {
    assets?: {
      directory?: string;
      not_found_handling?: string;
    };
    main?: string;
    routes?: unknown;
    workers_dev?: boolean;
    preview_urls?: boolean;
  } = JSON.parse(readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8"));

  it("serves assets from the same directory Vite builds into", () => {
    const outDir = viteConfig.build?.outDir ?? "dist";
    expect(resolve(ROOT, config.assets?.directory ?? "")).toBe(
      resolve(ROOT, outDir),
    );
  });

  it("declares no main script, so every request is a free static-asset request", () => {
    expect(config.main).toBeUndefined();
  });

  // T11 / SEO-4: a bogus URL must 404, never serve the landing page with a
  // soft-404 HTTP 200.
  it("serves dist/404.html on a miss, never the single-page-application fallback", () => {
    expect(config.assets?.not_found_handling).toBe("404-page");
  });

  // SEO-7: once a custom domain is added, the workers.dev and preview URLs
  // must stop indexing alongside it.
  it("disables workers_dev and preview_urls once a route is declared", () => {
    if (config.routes !== undefined) {
      expect(config.workers_dev).toBe(false);
      expect(config.preview_urls).toBe(false);
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
