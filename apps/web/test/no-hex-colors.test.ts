import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";
import { hasIllegalColorLiteral } from "../../../scripts/tokens.mjs";

// Controller decision #1, widened by issue 137 (T28, constraints.md §2.1):
// no colour literal of any kind anywhere in apps/web/src, across .ts, .tsx,
// .css and .html, excepting the two generated token files. Not just hex any
// more — rgb()/rgba()/hsl()/hsla()/oklch()/lab() and the named-colour
// keywords are illegal too, with the one carve-out `base.css` and
// `components.css` already rely on: `rgb(from var(--color-NAME) r g b / a)`.
// The check itself lives in scripts/tokens.mjs and is imported rather than
// re-implemented here, so this guard and the one `pnpm tokens` runs can
// never drift apart (T28 widens both "together").
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const SRC_DIR = resolve(ROOT_DIR, "src");
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html"]);
const EXCLUDED_FILENAMES = new Set(["tokens.css", "tokens.ts"]);
const INLINE_STYLE_RE = /\sstyle=\{/;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, files);
    } else if (
      SCANNED_EXTENSIONS.has(extname(full)) &&
      !EXCLUDED_FILENAMES.has(entry)
    ) {
      files.push(full);
    }
  }
  return files;
}

const srcFiles = walk(SRC_DIR);
// Phase 6 Task 1 (#65): exam.html is the fourth entry and is scanned like
// the other two HTML ones — the list is by hand, so a new page is only
// covered once it is named here.
const htmlFiles = [
  join(ROOT_DIR, "index.html"),
  join(ROOT_DIR, "admin.html"),
  join(ROOT_DIR, "exam.html"),
];
const allScannedFiles = [...srcFiles, ...htmlFiles];

describe("no colour literal of any kind anywhere in apps/web/src", () => {
  for (const file of allScannedFiles) {
    it(`${relative(ROOT_DIR, file)} has no illegal colour literal`, () => {
      const content = readFileSync(file, "utf8");
      expect(hasIllegalColorLiteral(content)).toBe(false);
    });
  }
});

describe("no inline style attributes anywhere in apps/web/src", () => {
  const tsxFiles = srcFiles.filter((file) => file.endsWith(".tsx"));
  for (const file of tsxFiles) {
    it(`${relative(ROOT_DIR, file)} has no style={} attribute`, () => {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(INLINE_STYLE_RE);
    });
  }
});

describe("no CSS-in-JS runtime is imported", () => {
  const tsFiles = srcFiles.filter(
    (file) => file.endsWith(".ts") || file.endsWith(".tsx"),
  );
  const cssInJsPattern = /from\s+["'](styled-components|@emotion\/[^"']+)["']/;
  for (const file of tsFiles) {
    it(`${relative(ROOT_DIR, file)} does not import a CSS-in-JS runtime`, () => {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(cssInJsPattern);
    });
  }
});
