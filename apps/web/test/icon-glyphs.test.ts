import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function findTsxFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTsxFiles(full));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

function stripComments(source: string): string {
  // Strip block comments while preserving line breaks
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    "\n".repeat((m.match(/\n/g) || []).length),
  );
  // Strip single-line comments
  return withoutBlock
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

describe("Spec §13 Icon Consistency: No raw Unicode icon glyphs in JSX", () => {
  it("enforces that no raw warning (⚠) or check (✓) glyphs are rendered as icons in apps/web/src", () => {
    const srcDir = resolve(__dirname, "../src");
    const tsxFiles = findTsxFiles(srcDir);
    const violations: { file: string; line: number; text: string }[] = [];

    // Match raw icon glyphs:
    // 1. Any warning sign (⚠ or ⚠️ U+26A0) outside comments
    // 2. Any check mark (✓ U+2713) used as an icon or standalone glyph (excluding textual badges like "✓ Correct")
    for (const file of tsxFiles) {
      const relativePath = file.replace(/\\/g, "/").slice(srcDir.length - 3);
      if (relativePath.includes("AttemptReview.tsx")) {
        // Exclude string literals for candidate choice comparison text
        continue;
      }
      const content = readFileSync(file, "utf8");
      const cleanContent = stripComments(content);
      const lines = cleanContent.split("\n");

      lines.forEach((line, index) => {
        // Warning sign is forbidden everywhere in code outside comments
        if (line.includes("⚠")) {
          violations.push({
            file: relativePath,
            line: index + 1,
            text: line.trim(),
          });
          return;
        }

        // Check mark (✓) as icon:
        // - inside span tags like <span ...>✓...</span>
        // - as standalone quotes: "✓", "✓ "
        // - in badge labels like "✓ Schema Valid"
        // - in JSX interpolation like ✓ {success}
        if (line.includes("✓")) {
          // Allow textual badge "✓ Correct" if present
          const stripped = line.replace(/✓ Correct/g, "");
          if (
            stripped.includes("✓") &&
            (/<span[^>]*>[^<]*✓/.test(line) ||
              /['"]\s*✓\s*['"]/.test(line) ||
              /✓\s*\{/.test(line) ||
              /✓\s+[A-Za-z]/.test(stripped) ||
              /glyph:\s*['"]✓['"]/.test(line))
          ) {
            violations.push({
              file: relativePath,
              line: index + 1,
              text: line.trim(),
            });
          }
        }
      });
    }

    if (violations.length > 0) {
      const summary = violations
        .map((v) => `  ${v.file}:${v.line} -> ${v.text}`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} raw Unicode icon glyph(s) in apps/web/src. Replace with <Icon name="..." /> from OrganiserShell:\n${summary}`,
      );
    }
  });
});
