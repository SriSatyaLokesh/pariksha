import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
});

describe("wrangler.jsonc", () => {
  // No comments or trailing commas in this file, so it's valid JSON — no
  // JSONC parser dependency needed.
  const config: { assets?: { directory?: string }; main?: string } =
    JSON.parse(readFileSync(resolve(ROOT, "wrangler.jsonc"), "utf8"));

  it("serves assets from the same directory Vite builds into", () => {
    const outDir = viteConfig.build?.outDir ?? "dist";
    expect(resolve(ROOT, config.assets?.directory ?? "")).toBe(
      resolve(ROOT, outDir),
    );
  });

  it("declares no main script, so every request is a free static-asset request", () => {
    expect(config.main).toBeUndefined();
  });
});
