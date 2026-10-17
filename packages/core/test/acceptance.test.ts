// The Phase 1 gate for AC-06 and AC-07 (see docs/superpowers/plans/
// 2026-10-16-phase-1-foundation-and-scoring.md, "Task 11"). Drives
// fixtures/scoring.json, a table of (type, mode, case) triples whose
// expected points are derived from docs/question-format.md's "Scoring
// modes" table and grade/result.ts's applyMode arithmetic — never from
// running the code and recording what came out.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";
import { gradeQuestion } from "../src/grade/index.js";
import { gradeManual } from "../src/grade/manual.js";
import type { ManualQuestion, RubricAward } from "../src/grade/manual.js";
import { APPLICABLE_MODES } from "../src/grade/result.js";
import type { ScoringDefaults } from "../src/grade/result.js";
import { QUESTION_TYPES } from "../src/types.js";
import type { Question, QuestionType, ResponseValue, ScoringMode } from "../src/types.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const srcDir = fileURLToPath(new URL("../src/", import.meta.url));

interface MatrixCase {
  type: QuestionType;
  mode: ScoringMode;
  case: "correct" | "partial" | "wrong" | "blank";
  question: Question;
  response: ResponseValue | null;
  defaults: ScoringDefaults;
  expected: number;
  note?: string;
}

interface Matrix {
  cases: MatrixCase[];
}

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as unknown;
}

const matrix = readJson("packages/core/test/fixtures/scoring.json") as Matrix;

function entry(type: QuestionType, mode: ScoringMode, label: MatrixCase["case"]): MatrixCase {
  const found = matrix.cases.find((c) => c.type === type && c.mode === mode && c.case === label);
  if (!found) throw new Error(`fixture (${type}, ${mode}, ${label}) not found`);
  return found;
}

describe("AC-06: the scoring matrix", () => {
  it("every entry's expected points match what gradeQuestion returns", () => {
    for (const c of matrix.cases) {
      const result = gradeQuestion(c.question, c.response, c.defaults);
      expect(result.points, `${c.type}/${c.mode}/${c.case}`).toBe(c.expected);
    }
  });

  it("the matrix covers all 12 types and, for each type, exactly the modes in APPLICABLE_MODES", () => {
    const types = new Set(matrix.cases.map((c) => c.type));
    expect(types).toEqual(new Set(QUESTION_TYPES));

    for (const type of QUESTION_TYPES) {
      const modes = new Set(matrix.cases.filter((c) => c.type === type).map((c) => c.mode));
      expect(modes).toEqual(new Set(APPLICABLE_MODES[type]));
    }
  });
});

describe("AC-07: data-model halves (the interaction halves — disabling, drag, keyboard — belong to a later, browser-facing phase)", () => {
  it("select_k scores a response holding more than k options as wrong across every part, never silently truncating it", () => {
    const c = entry("select_k", "partial", "wrong");
    const q = c.question as Question & { k: number };
    const response = c.response as { kind: "options"; options: string[] };
    // The fixture must actually exercise the rule: more options chosen than
    // k allows, with at least one of them a genuine key option — a naive
    // implementation that only intersected sets would award partial credit
    // here instead of zero.
    expect(response.options.length).toBeGreaterThan(q.k);
    expect(gradeQuestion(c.question, c.response, c.defaults).points).toBe(0);
  });

  it("multi_matching accepts several right items for one left item", () => {
    const c = entry("multi_matching", "partial", "correct");
    const q = c.question as Question & { key: Record<string, string[]> };
    const multiRightLeft = Object.entries(q.key).find(([, rights]) => rights.length > 1);
    expect(multiRightLeft).toBeDefined();

    const result = gradeQuestion(c.question, c.response, c.defaults);
    const totalParts = Object.values(q.key).reduce((sum, rights) => sum + rights.length, 0);
    expect(result.parts?.total).toBe(totalParts);
    expect(result.points).toBe(c.expected);
  });
});

describe("issue #130: manual grading against a rubric, for both manually-graded types", () => {
  // Was: an assertion that short_answer can never score above zero, because
  // only long_answer carried a `rubric` array while `rubric` was the only
  // mode applicable to either — so every short_answer scored 0 for every
  // candidate and the type was inert. Issue #130 resolved that by adding the
  // same optional `rubric` to short_answer (an additive change inside
  // `@1`), so both manual types now grade the same way.
  it("short_answer sums the rubric levels a reviewer picked, like long_answer", () => {
    const c = entry("short_answer", "rubric", "correct");
    const shortAnswer = c.question as ManualQuestion;
    expect(shortAnswer.rubric).toBeDefined();
    const award: RubricAward = { levels: ["Full"] };
    expect(gradeManual(shortAnswer, award, c.defaults).points).toBe(3);
  });

  it("a partial award on a short_answer scores between zero and its points", () => {
    const c = entry("short_answer", "rubric", "correct");
    const shortAnswer = c.question as ManualQuestion;
    const result = gradeManual(shortAnswer, { levels: ["Partial"] }, c.defaults);
    expect(result.points).toBe(1);
    expect(result.max).toBe(3);
  });

  it("a no-credit award, and an unreviewed short_answer, both score zero", () => {
    const c = entry("short_answer", "rubric", "correct");
    const shortAnswer = c.question as ManualQuestion;
    expect(gradeManual(shortAnswer, { levels: ["No credit"] }, c.defaults).points).toBe(0);
    expect(gradeManual(shortAnswer, null, c.defaults).points).toBe(0);
  });

  it("long_answer still sums the rubric levels a reviewer picked, through the same gradeManual path", () => {
    const c = entry("long_answer", "rubric", "correct");
    const longAnswer = c.question as ManualQuestion;
    const award: RubricAward = { levels: ["Excellent"] };
    expect(gradeManual(longAnswer, award, c.defaults).points).toBeGreaterThan(0);
  });
});

describe("purity (Global Constraints): packages/core/src performs no I/O and owns no clock", () => {
  it("no file under src calls Date, Math.random, fs, process or fetch outside of a comment", () => {
    const forbidden: { name: string; pattern: RegExp }[] = [
      { name: "Date", pattern: /\bnew\s+Date\s*\(|\bDate\.(?:now|parse|UTC)\s*\(/ },
      { name: "Math.random", pattern: /Math\.random\s*\(/ },
      {
        name: "fs",
        pattern: /from\s+["'](?:node:)?fs(?:\/promises)?["']|require\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/,
      },
      { name: "process", pattern: /\bprocess\s*[.[]/ },
      { name: "fetch", pattern: /\bfetch\s*\(/ },
    ];

    const offenders: string[] = [];
    for (const file of listTsFiles(srcDir)) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      for (const { name, pattern } of forbidden) {
        if (pattern.test(stripped)) offenders.push(`${file}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("public surface: the barrel is the only way in", () => {
  it("no file in the workspace (outside packages/core itself) imports from @pariksha/core/src/...", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(repoRoot, { skip: SKIP_DIRS })) {
      if (file.includes(`${join("packages", "core")}${sep}`)) continue; // its own test files use relative ../src imports
      const code = stripComments(readFileSync(file, "utf8"));
      if (/@pariksha\/core\/src\b/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".git", "coverage"]);

function listTsFiles(dir: string, options: { skip?: Set<string> } = {}): string[] {
  const out: string[] = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    if (options.skip?.has(dirent.name)) continue;
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...listTsFiles(full, options));
    else if (dirent.isFile() && (dirent.name.endsWith(".ts") || dirent.name.endsWith(".tsx"))) out.push(full);
  }
  return out;
}

/** Strips `//` and `/* *\/` comments so a mention inside documentation prose (e.g. "no Math.random()") never counts as a usage. There are no `//` sequences inside any string literal under src/, so this is safe here. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
