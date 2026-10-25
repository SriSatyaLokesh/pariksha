import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DOC_FILES = [
  "docs/quickstart.md",
  "docs/organiser-guide.md",
  "docs/candidate-faq.md",
  "docs/security-guide.md",
  "docs/api-reference.md",
  "docs/privacy-template.md",
];

describe("Documentation Suite Quality Gate (O-04)", () => {
  it.each(DOC_FILES)("file %s exists and is substantial (> 1KB)", (file) => {
    const fullPath = resolve(file);
    expect(existsSync(fullPath), `Expected ${file} to exist`).toBe(true);
    const size = statSync(fullPath).size;
    expect(size, `${file} size (${size} bytes) should be > 1024 bytes`).toBeGreaterThan(1024);
  });

  it("contains valid cross-references and well-formed markdown headings", () => {
    for (const file of DOC_FILES) {
      const content = readFileSync(resolve(file), "utf8");
      // Must start with level 1 heading
      expect(content).toMatch(/^#\s+[A-Za-z0-9]/m);

      // Extract local markdown links [text](path)
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        const link = match[2];
        if (!link) continue;
        if (link.startsWith("http://") || link.startsWith("https://") || link.startsWith("#")) {
          continue;
        }
        // Local file link
        const targetPath = resolve(file, "..", link.split("#")[0] ?? "");
        expect(
          existsSync(targetPath),
          `In ${file}, referenced link "${link}" should exist at ${targetPath}`,
        ).toBe(true);
      }
    }
  });
});
