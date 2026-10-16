import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Question, ResponseValue } from "../src/types.js";
import type { ScoringDefaults } from "../src/grade/result.js";
import type { RubricAward } from "../src/grade/manual.js";
import { scoreAttempt } from "../src/score.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const bank = JSON.parse(
  readFileSync(join(repoRoot, "examples/reasoning-aptitude/questions.json"), "utf8"),
) as { questions: Question[] };

function byId(id: string): Question {
  const q = bank.questions.find((candidate) => candidate.id === id);
  if (!q) throw new Error(`fixture question ${id} not found`);
  return q;
}

const defaults: ScoringDefaults = { mode: "all_or_nothing", negativeFraction: 0.25 };

describe("scoreAttempt", () => {
  it("an ungraded long_answer (WRI-002) scores zero, counts toward max, and is listed as pending", () => {
    const s = scoreAttempt({
      questionsBySection: [{ sectionId: "writing", questions: [byId("WRI-002")] }],
      responses: { "WRI-002": { kind: "text", text: "Correlation is not causation." } },
      awards: {},
      defaults,
    });
    expect(s.perQuestion["WRI-002"]?.points).toBe(0);
    expect(s.max).toBe(5);
    expect(s.pending).toEqual(["WRI-002"]);
  });

  it("a manual question the candidate left entirely blank still scores zero, counts toward max, and IS pending", () => {
    // `pending` reports whether a reviewer has ever recorded an award, not
    // whether the candidate wrote anything — a blank answer and a graded
    // zero must stay distinguishable (e.g. for a disputed-result lookup),
    // and a grading queue can filter blanks out of `pending` itself if it
    // wants to.
    const s = scoreAttempt({
      questionsBySection: [{ sectionId: "writing", questions: [byId("WRI-002")] }],
      responses: { "WRI-002": null },
      awards: {},
      defaults,
    });
    expect(s.perQuestion["WRI-002"]?.points).toBe(0);
    expect(s.max).toBe(5);
    expect(s.pending).toEqual(["WRI-002"]);
  });

  it("a graded manual question (award present) is not pending, even with an empty-levels award", () => {
    const award: RubricAward = { levels: [] };
    const s = scoreAttempt({
      questionsBySection: [{ sectionId: "writing", questions: [byId("WRI-002")] }],
      responses: { "WRI-002": { kind: "text", text: "An answer." } },
      awards: { "WRI-002": award },
      defaults,
    });
    expect(s.pending).toEqual([]);
    expect(s.perQuestion["WRI-002"]?.points).toBe(0);
  });

  it("a 40-question partial-credit section totals exactly, with no float residue", () => {
    const questions: Question[] = Array.from({ length: 40 }, (_, i) => ({
      id: `PC-${i}`,
      type: "multiple",
      prompt: "Pick two of the three right options.",
      options: [
        { id: "a", text: "a" },
        { id: "b", text: "b" },
        { id: "c", text: "c" },
        { id: "d", text: "d" },
      ],
      key: ["a", "b", "c"],
      scoring: { mode: "partial", points: 1 },
    }));
    const responses: Record<string, ResponseValue | null> = Object.fromEntries(
      questions.map((q) => [q.id, { kind: "options", options: ["a", "b"] } as const]),
    );
    const s = scoreAttempt({
      questionsBySection: [{ sectionId: "section-1", questions }],
      responses,
      awards: {},
      defaults,
    });
    expect(s.sections[0]?.points).toBe(26.8); // not 26.799999999999997 / 26.80000000000003
    expect(s.sections[0]?.max).toBe(40);
    expect(Number.isInteger(s.percent * 100)).toBe(true);
  });

  it("negative marking can take one question below zero but never the section or the total", () => {
    const wrongQuestion: Question = {
      id: "LOG-001",
      type: "single",
      prompt: "pick one",
      options: [
        { id: "a", text: "a" },
        { id: "b", text: "b" },
        { id: "c", text: "c" },
      ],
      key: "c",
      scoring: { points: 2 }, // mode falls back to the attempt default (negative)
    };
    const s = scoreAttempt({
      questionsBySection: [{ sectionId: "section-1", questions: [wrongQuestion] }],
      responses: { "LOG-001": { kind: "option", option: "a" } },
      awards: {},
      defaults: { mode: "negative", negativeFraction: 0.25 },
    });
    expect(s.perQuestion["LOG-001"]?.points).toBeLessThan(0);
    expect(s.sections[0]?.points).toBe(0);
    expect(s.total).toBe(0);
  });

  it("passed is null when no pass mark is set, and compares against percent when one is", () => {
    const q = byId("LOG-007"); // true_false, key true, 1 point, all_or_nothing
    const input = {
      questionsBySection: [{ sectionId: "section-1", questions: [q] }],
      responses: { "LOG-007": { kind: "boolean" as const, value: true } },
      awards: {},
      defaults,
    };
    expect(scoreAttempt(input).passed).toBeNull();
    expect(scoreAttempt({ ...input, passMarkPercent: 50 }).passed).toBe(true);
    // Exact equality is a pass, not a fail: a 100% pass mark passes a
    // candidate who scored exactly 100%, same as a 40% pass mark would
    // pass someone who scored exactly 40%.
    expect(scoreAttempt({ ...input, passMarkPercent: 100 }).passed).toBe(true);
    expect(scoreAttempt({ ...input, passMarkPercent: 100.01 }).passed).toBe(false);
  });

  it("aggregates across multiple sections and rounds the attempt total independently of section rounding", () => {
    const s = scoreAttempt({
      questionsBySection: [
        { sectionId: "a", questions: [byId("LOG-007")] }, // 1 point, correct
        { sectionId: "b", questions: [byId("QNT-001")] }, // 2 points, correct
      ],
      responses: {
        "LOG-007": { kind: "boolean", value: true },
        "QNT-001": { kind: "number", value: 72 },
      },
      awards: {},
      defaults,
    });
    expect(s.sections).toEqual([
      { sectionId: "a", points: 1, max: 1 },
      { sectionId: "b", points: 2, max: 2 },
    ]);
    expect(s.total).toBe(3);
    expect(s.max).toBe(3);
    expect(s.percent).toBe(100);
  });
});
