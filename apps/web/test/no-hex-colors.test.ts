import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative, resolve } from "node:path";

// Controller decision #1: no hex colour literal anywhere in apps/web/src,
// across .ts, .tsx, .css and .html, excepting the two generated token
// files. Style exclusively through the token custom properties.

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const SRC_DIR = resolve(ROOT_DIR, "src");
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html"]);
const EXCLUDED_FILENAMES = new Set(["tokens.css", "tokens.ts"]);
const HEX_COLOR_RE = /#[0-9a-fA-F]{3,8}\b/;
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
const htmlFiles = [join(ROOT_DIR, "index.html"), join(ROOT_DIR, "admin.html")];
const allScannedFiles = [...srcFiles, ...htmlFiles];

describe("no hex colour literal anywhere in apps/web/src", () => {
  for (const file of allScannedFiles) {
    it(`${relative(ROOT_DIR, file)} has no hex colour literal`, () => {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(HEX_COLOR_RE);
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
