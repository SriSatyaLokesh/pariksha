// @vitest-environment node
//
// Artefact checks for the hero's exam-demo island: the size budget and the
// network, storage, timer, inline-style and colour-literal bans (v3 spec
// §2.4, I-2 to I-8). The island is bundled and minified in isolation with
// esbuild's in-process API — nothing is written, and apps/web/dist, which
// other tests read, is never touched.
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
    // I-2 / T35: printed whether this run passes or fails the budget.
    console.log(`[island.test.ts] exam-demo.ts minified: ${Buffer.byteLength(built, "utf8")} bytes`);
  });

  it("stays at or under the 10 KB minified budget (I-2, informational proxy for T35)", () => {
    expect(Buffer.byteLength(built, "utf8")).toBeLessThanOrEqual(10 * 1024);
  });

  it("contains no network, storage, cookie or telemetry identifier (I-3)", () => {
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

  it("contains no interval, animation-frame or delayed timer (I-4)", () => {
    expect(built).not.toContain("setInterval");
    expect(built).not.toContain("requestAnimationFrame");
    expect(built).not.toContain("setTimeout");
  });

  it("sets no style attribute, no element.style, and no colour literal (I-7)", () => {
    expect(built).not.toContain(".style");
    expect(built).not.toMatch(/setAttribute\(["']style["']/);
    expect(built).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(built).not.toMatch(/\brgb\(/);
    expect(built).not.toMatch(/\bhsl\(/);
  });

  it("does not use ButtonPrimary's class on any control it creates (I-8)", () => {
    expect(built).not.toContain("button-primary");
  });
});
