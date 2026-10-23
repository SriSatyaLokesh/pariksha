// `countedScore()` (`K6`) — one function, three readers: the organiser's
// CSV, the analytics screen (8c) and the candidate's own result page
// (`apps/api/src/run/release.ts`, `K7`).

import { describe, expect, it } from "vitest";
import type { AttemptFigure } from "../src/counted.js";
import { countedScore } from "../src/counted.js";

const T = 1_700_000_000_000;
const a = (percent: number, attemptId: string): AttemptFigure => ({
  attemptId,
  percent,
  submittedAt: T,
});
const early = (percent: number, attemptId: string): AttemptFigure => ({
  attemptId,
  percent,
  submittedAt: T,
});
const late = (percent: number, attemptId: string): AttemptFigure => ({
  attemptId,
  percent,
  submittedAt: T + 60_000,
});

describe("countedScore", () => {
  it("highest takes the best attempt and names it", () => {
    expect(countedScore([a(72, "att_1"), a(81, "att_2")], "highest")).toEqual({
      percent: 81,
      attemptId: "att_2",
      of: 2,
    });
  });

  it("latest takes the most recently submitted, not the last in the array", () => {
    expect(countedScore([late(81, "att_2"), early(72, "att_1")], "latest")).toEqual({
      percent: 81,
      attemptId: "att_2",
      of: 2,
    });
  });

  it("average belongs to no attempt and rounds to 2dp", () => {
    expect(countedScore([a(72, "att_1"), a(81, "att_2"), a(70, "att_3")], "average")).toEqual({
      percent: 74.33,
      attemptId: null,
      of: 3,
    });
  });

  it("returns null for no attempts", () => {
    expect(countedScore([], "highest")).toBeNull();
  });
});
