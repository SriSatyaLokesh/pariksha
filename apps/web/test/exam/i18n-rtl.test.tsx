import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Runner } from "../../src/components/exam/Runner";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";

const MOCK_QUESTION: CandidateQuestion = {
  id: "q_1",
  type: "single",
  prompt: "What is 2 + 2?",
  points: 1,
  options: [
    { id: "opt_1", text: "3" },
    { id: "opt_2", text: "4" },
  ],
};

const MOCK_PAPER: AttemptPaper = {
  attemptId: "att_123",
  sections: [
    {
      id: "sec_1",
      title: "General Knowledge",
      questions: [MOCK_QUESTION],
    },
  ],
  responses: {},
  clientSeq: 1,
  navigation: "free",
  maxIndex: 0,
  remainingMs: 3600000,
  sectionRemainingMs: null,
  warnAtMinutes: [5],
  lateSyncGraceSeconds: 30,
  allowCalculator: false,
  serverNow: Date.now(),
  submittedAt: null,
  lockedAt: null,
  proctoring: {
    recordFullscreen: false,
    recordTabSwitches: false,
    requireCamera: false,
    identityPhoto: false,
    periodicIntervalSeconds: null,
    violationCeiling: 5,
    violationAction: "flag",
    screenWatermark: false,
    requirements: [],
  },
  violations: 0,
};

describe("Runner i18n and RTL Support (T-24)", () => {
  it("renders in English with ltr direction by default", () => {
    const { container } = render(
      <Runner
        paper={MOCK_PAPER}
        index={0}
        onIndex={() => {}}
        marked={new Set()}
        onToggleMark={() => {}}
        onClear={() => {}}
        questionSlot={() => <div>Question Content</div>}
        clockSlot={<div>Clock</div>}
        bannerSlot={<div>Banner</div>}
        submitSlot={<button>Submit</button>}
      />,
    );

    const runner = container.querySelector(".exam-runner");
    expect(runner).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeInTheDocument();
  });

  it("renders Arabic with rtl direction and translated buttons", () => {
    const { container } = render(
      <Runner
        paper={{ ...MOCK_PAPER, language: "ar" }}
        index={0}
        onIndex={() => {}}
        marked={new Set()}
        onToggleMark={() => {}}
        onClear={() => {}}
        questionSlot={() => <div>Question Content</div>}
        clockSlot={<div>Clock</div>}
        bannerSlot={<div>Banner</div>}
        submitSlot={<button>Submit</button>}
      />,
    );

    const runner = container.querySelector(".exam-runner");
    expect(runner).toHaveAttribute("dir", "rtl");
    // Next in Arabic is التالي
    expect(screen.getByRole("button", { name: "التالي" })).toBeInTheDocument();
    // Clear selection in Arabic is مسح الاختيار
    expect(screen.getByRole("button", { name: "مسح الاختيار" })).toBeInTheDocument();
  });

  it("renders Hindi with ltr direction and translated buttons", () => {
    const { container } = render(
      <Runner
        paper={{ ...MOCK_PAPER, language: "hi" }}
        index={0}
        onIndex={() => {}}
        marked={new Set()}
        onToggleMark={() => {}}
        onClear={() => {}}
        questionSlot={() => <div>Question Content</div>}
        clockSlot={<div>Clock</div>}
        bannerSlot={<div>Banner</div>}
        submitSlot={<button>Submit</button>}
      />,
    );

    const runner = container.querySelector(".exam-runner");
    expect(runner).toHaveAttribute("dir", "ltr");
    // Next in Hindi is अगला
    expect(screen.getByRole("button", { name: "अगला" })).toBeInTheDocument();
    // Clear in Hindi is चयन साफ़ करें
    expect(screen.getByRole("button", { name: "चयन साफ़ करें" })).toBeInTheDocument();
  });
});
