// @vitest-environment node
//
// Artefact checks for the landing page's one island, the Signal hero's pool
// draw and build-status toggle: the size budget and the network, storage,
// timer and colour-literal bans exam-demo.ts's own header comment commits
// to ("No network call, no storage, no telemetry, ever. See the forbidden
// list in apps/web/test/island-artefact.test.ts."). The island is bundled
// and minified in isolation with esbuild's in-process API — nothing is
// written, and apps/web/dist, which other tests read, is never touched.
//
// Node environment, not jsdom: esbuild's API asserts that
// `new TextEncoder().encode("") instanceof Uint8Array`, which is false
// inside jsdom's realm. The behaviour tests keep the DOM, in
// island.test.ts.

import { buildSync } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function buildIslandMinified(): string {
  const out = buildSync({
    entryPoints: [path.join(__dirname, "..", "src", "island", "exam-demo.ts")],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
    write: false,
  }).outputFiles[0];
  if (!out) throw new Error("esbuild produced no output for the island");
  return out.text;
}

describe("artefact: the island, bundled and minified in isolation", () => {
  let built: string;

  beforeAll(() => {
    built = buildIslandMinified();
    // Printed whether this run passes or fails the budget — prerender.test.ts's
    // T2 asserts the same 14 KB ceiling on the artefact that actually ships.
    console.log(
      `[island-artefact.test.ts] exam-demo.ts minified: ${Buffer.byteLength(built, "utf8")} bytes`,
    );
  });

  it("stays at or under the 14 KB minified budget", () => {
    expect(Buffer.byteLength(built, "utf8")).toBeLessThanOrEqual(14 * 1024);
  });

  it("contains no network, storage, cookie or telemetry identifier", () => {
    const forbidden = [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "sendBeacon",
      "localStorage",
      "sessionStorage",
      "cookie",
      "indexedDB",
      "caches",
      "PerformanceObserver",
      "clipboard",
    ];
    for (const token of forbidden) {
      expect(built, `must not contain "${token}"`).not.toContain(token);
    }
  });

  it("contains no interval, animation-frame or delayed timer", () => {
    expect(built).not.toContain("setInterval");
    expect(built).not.toContain("requestAnimationFrame");
    expect(built).not.toContain("setTimeout");
  });

  it("sets no style attribute, no element.style, and no colour literal", () => {
    expect(built).not.toContain(".style");
    expect(built).not.toMatch(/setAttribute\(["']style["']/);
    expect(built).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(built).not.toMatch(/\brgb\(/);
    expect(built).not.toMatch(/\bhsl\(/);
  });
});
