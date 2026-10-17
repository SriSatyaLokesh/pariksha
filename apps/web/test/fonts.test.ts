import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Catches the bug a missing licence file leaves behind: a .woff2 committed
// to public/fonts without its OFL text, or a README row whose licence cell
// points at a file that was never added. hosting.test.ts already checks
// that every fonts.css @font-face resolves to a real file — this file is
// only about the README <-> licence-file link, which nothing else covers.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, "../public/fonts");
const README_PATH = resolve(FONTS_DIR, "README.md");

const readme = readFileSync(README_PATH, "utf8");
const woff2Files = readdirSync(FONTS_DIR).filter((f) => f.endsWith(".woff2"));
const oflFiles = readdirSync(FONTS_DIR).filter((f) => f.startsWith("OFL-"));

// One markdown table row per font: `` `file.woff2` `` ... `` `OFL-x.txt` ``
// somewhere later on the same line (the table has other columns between).
function licenceFileFor(woff2: string): string | null {
  const rowRe = new RegExp(
    "^\\|[^\\n]*`" + woff2.replace(/\./g, "\\.") + "`[^\\n]*$",
    "m",
  );
  const row = rowRe.exec(readme)?.[0];
  if (!row) return null;
  const match = /`(OFL-[a-zA-Z0-9-]+\.txt)`/.exec(row);
  return match?.[1] ?? null;
}

describe("every self-hosted font has a licence README can account for", () => {
  it("found at least one .woff2 to check (sanity: the suite isn't vacuous)", () => {
    expect(woff2Files.length).toBeGreaterThan(0);
  });

  for (const woff2 of woff2Files) {
    it(`${woff2} has a README row naming an OFL file that exists`, () => {
      const licence = licenceFileFor(woff2);
      expect(licence, `${woff2}: no README.md row names its licence`).not
        .toBeNull();
      if (!licence) return;
      expect(
        oflFiles.includes(licence),
        `${woff2}: README names "${licence}" as its licence, but that file is not in public/fonts`,
      ).toBe(true);
    });
  }

  it("has no OFL file in public/fonts that no row's licence cell names", () => {
    const named = new Set(
      woff2Files.map((f) => licenceFileFor(f)).filter((f): f is string => !!f),
    );
    const orphaned = oflFiles.filter((f) => !named.has(f));
    expect(orphaned).toEqual([]);
  });
});
