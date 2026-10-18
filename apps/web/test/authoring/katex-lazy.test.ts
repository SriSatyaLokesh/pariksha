import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Question } from "@pariksha/core";

import { hasLatex, renderMarkdown } from "../../src/render/markdown";

// The run-time half of ADR 0004's budget case: KaTeX's 76 KB gzipped is
// fetched only by content that actually contains LaTeX, and then once.
// bundle.test.ts proves no entry can reach it by static import; this counts
// how many times the module is really evaluated.
//
// It lives in a file of its own because the count is a property of the whole
// module graph: `vi.resetModules()` does not re-run a mock factory, so a test
// elsewhere in the same file that renders a formula first would make the
// count read zero here and the assertions vacuous. One file, one load.
const katex = vi.hoisted(() => ({ loads: 0 }));
vi.mock("katex", async (importOriginal) => {
  katex.loads += 1;
  return await importOriginal<object>();
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANK = resolve(
  __dirname,
  "../../../../examples/reasoning-aptitude/questions.json",
);

describe("KaTeX loads only for content that needs it", () => {
  it("a bank with no maths never loads KaTeX", async () => {
    const bank = JSON.parse(readFileSync(BANK, "utf8")) as {
      questions: Question[];
    };

    expect(bank.questions.length).toBeGreaterThan(0);
    for (const question of bank.questions) {
      expect(hasLatex(question.prompt), question.id).toBe(false);
      await renderMarkdown(question.prompt);
      if (question.explanation) await renderMarkdown(question.explanation);
    }

    expect(katex.loads).toBe(0);
  });

  it("a question that does contain maths loads it exactly once, however often it renders", async () => {
    await renderMarkdown("$a$");
    await renderMarkdown("$b$");
    await renderMarkdown("$c$");

    expect(katex.loads).toBe(1);
  });
});
