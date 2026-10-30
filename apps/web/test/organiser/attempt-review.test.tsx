// Phase 8g Task 4: Per-Attempt Review Screen component tests
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { AttemptReview } from "../../src/components/organiser/AttemptReview";
import { AttemptRoute } from "../../src/routes/attempt";
import { fakeClient } from "../fixtures/api-client";
import type { AttemptReviewData } from "../../src/lib/api";

const SAMPLE_REVIEW: AttemptReviewData = {
  attempt: {
    id: "att_123",
    candidateId: "cnd_456",
    status: "submitted",
    startedAt: 1700000000000,
    submittedAt: 1700003600000,
    totalScore: 8,
    maxScore: 10,
    integrityFlag: "clean",
    observed: true,
  },
  registration: {
    name: "Jane Candidate",
    email: "jane@university.edu",
    rollNumber: "CS-2026-042",
  },
  identityPhotoUrl: "https://storage.pariksha.test/identity.jpg?signature=abc",
  timeline: [
    {
      kind: "snapshot",
      timestamp: 1700000060000,
      snapshotUrl: "https://storage.pariksha.test/snap1.jpg?signature=123",
      flagged: false,
      reason: "interval",
      faceCount: null,
    },
    {
      kind: "unobserved",
      timestamp: 1700000120000,
      reason: "camera_lost",
      details: { outageMs: 30000 },
    },
    {
      kind: "snapshot",
      timestamp: 1700000180000,
      snapshotUrl: "https://storage.pariksha.test/snap2.jpg?signature=456",
      flagged: true,
      reason: "violation",
      faceCount: null,
    },
    {
      kind: "event",
      timestamp: 1700000200000,
      eventKind: "tab_blur",
      details: {},
      flagged: true,
    },
  ],
  events: [
    {
      id: "evt_1",
      kind: "tab_blur",
      serverTs: 1700000200000,
      clientTs: 1700000200000,
      payload: {},
    },
  ],
  answers: [
    {
      questionId: "q_1",
      sectionId: "sec_1",
      answer: "b",
      key: "b",
      pointsAwarded: 4,
      maxPoints: 5,
      correct: true,
      verdict: "correct",
    },
    {
      questionId: "q_2",
      sectionId: "sec_1",
      answer: "Paris",
      key: "Paris",
      pointsAwarded: 4,
      maxPoints: 5,
      correct: true,
      verdict: "correct",
    },
  ],
  sectionScores: [
    {
      sectionId: "sec_1",
      title: "Core Knowledge",
      score: 8,
      maxScore: 10,
    },
  ],
};

describe("AttemptReview (R-03)", () => {
  it("renders candidate registration info and score summary at the top", () => {
    render(<AttemptReview review={SAMPLE_REVIEW} />);

    expect(screen.getByText("Jane Candidate")).toBeInTheDocument();
    expect(screen.getByText("jane@university.edu")).toBeInTheDocument();
    expect(screen.getByText("CS-2026-042")).toBeInTheDocument();

    // Score summary
    expect(screen.getByText(/8\s*\/\s*10/)).toBeInTheDocument();
    expect(screen.getByText(/submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/clean/i)).toBeInTheDocument();
  });

  it("renders identity photo when present", () => {
    render(<AttemptReview review={SAMPLE_REVIEW} />);

    const img = screen.getByRole("img", { name: /identity photo/i });
    expect(img).toHaveAttribute("src", SAMPLE_REVIEW.identityPhotoUrl!);
  });

  it("renders snapshots with timestamps, flagged badges, and face count as 'Not counted'", () => {
    render(<AttemptReview review={SAMPLE_REVIEW} />);

    const images = screen.getAllByRole("img");
    expect(images.length).toBeGreaterThan(1);

    // K1: face count must display "Not counted" when null
    const notCounted = screen.getAllByText(/not counted/i);
    expect(notCounted.length).toBeGreaterThan(0);

    // Flagged badge
    expect(screen.getByText(/violation/i)).toBeInTheDocument();
  });

  it("marks unobserved periods clearly as gaps rather than filling them", () => {
    render(<AttemptReview review={SAMPLE_REVIEW} />);

    // Unobserved period gap marker
    expect(screen.getByText(/unobserved/i)).toBeInTheDocument();
  });

  it("renders candidate answers against keys for authorised reviewers", () => {
    render(<AttemptReview review={SAMPLE_REVIEW} />);

    expect(screen.getByText("Core Knowledge")).toBeInTheDocument();
    // Keys displayed
    expect(screen.getAllByText(/key/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Paris/).length).toBeGreaterThan(0);
  });

  it("renders human-readable formats and does not leak raw JSON into the UI", () => {
    const reviewWithComplexAnswers: AttemptReviewData = {
      ...SAMPLE_REVIEW,
      answers: [
        {
          questionId: "q_options",
          sectionId: "sec_1",
          prompt: "Which of the following are prime numbers?",
          questionType: "multiple",
          answer: { kind: "options", options: ["e", "b"] },
          key: ["b", "d"],
          pointsAwarded: 0,
          maxPoints: 2,
          correct: false,
          verdict: "incorrect",
        },
        {
          questionId: "q_num",
          sectionId: "sec_1",
          prompt: "Calculate equilibrium temperature",
          questionType: "numeric",
          answer: { kind: "number", value: 23 },
          key: { value: 25, tolerance: 0.5, tolerance_type: "absolute" },
          pointsAwarded: 0,
          maxPoints: 2,
          correct: false,
          verdict: "incorrect",
        },
        {
          questionId: "q_map",
          sectionId: "sec_1",
          prompt: "Match sequences to rules",
          questionType: "matching",
          answer: { kind: "map", pairs: { "2, 4, 8, 16": "Doubling" } },
          key: { "2, 4, 8, 16": "Doubling" },
          pointsAwarded: 2,
          maxPoints: 2,
          correct: true,
          verdict: "correct",
        },
        {
          questionId: "q_blanks",
          sectionId: "sec_1",
          prompt: "Fill in the missing values",
          questionType: "fill_blank",
          answer: { kind: "blanks", values: { b1: "52", b2: "67" } },
          key: { b1: ["52"], b2: ["67"] },
          pointsAwarded: 2,
          maxPoints: 2,
          correct: true,
          verdict: "correct",
        },
      ],
    };

    render(<AttemptReview review={reviewWithComplexAnswers} />);

    // Assert prompts are rendered
    expect(screen.getByText("Which of the following are prime numbers?")).toBeInTheDocument();
    expect(screen.getByText("Calculate equilibrium temperature")).toBeInTheDocument();
    expect(screen.getByText("Match sequences to rules")).toBeInTheDocument();
    expect(screen.getByText("Fill in the missing values")).toBeInTheDocument();

    // Assert human-readable formatted output
    expect(screen.getByText(/25\s*\(±\s*0\.5\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Doubling").length).toBeGreaterThan(0);
    expect(screen.getByText(/b1:\s*52/i)).toBeInTheDocument();
    expect(screen.getByText(/b2:\s*67/i)).toBeInTheDocument();

    // Assert no raw JSON is rendered in answer boxes
    expect(screen.queryByText(/\{"kind":/)).not.toBeInTheDocument();
  });

  it("handles edge cases: null answers, missing prompts, and manual grading keys without crashing", () => {
    const edgeCaseReview: AttemptReviewData = {
      ...SAMPLE_REVIEW,
      answers: [
        {
          questionId: "q_null",
          sectionId: "sec_1",
          prompt: undefined,
          questionType: "short_answer",
          answer: null,
          key: null,
          pointsAwarded: null,
          maxPoints: 5,
        },
        {
          questionId: "q_unknown_kind",
          sectionId: "sec_1",
          prompt: null,
          questionType: "custom",
          answer: { kind: "future_unknown_kind", data: "special" },
          key: undefined,
          pointsAwarded: 0,
          maxPoints: 2,
        },
      ],
    };

    render(<AttemptReview review={edgeCaseReview} />);

    // Assert Question header renders properly without prompt
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(screen.getByText("Question 2")).toBeInTheDocument();

    // Assert null answer & key displays "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("passes axe accessibility checks", async () => {
    const { container } = render(<AttemptReview review={SAMPLE_REVIEW} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

describe("AttemptRoute", () => {
  it("fetches review and displays AttemptReview", async () => {
    const client = fakeClient({
      attemptReview: vi.fn().mockResolvedValue(SAMPLE_REVIEW),
    });

    render(
      <AttemptRoute
        workspaceId="wsp_1"
        attemptId="att_123"
        client={client}
      />,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Jane Candidate")).toBeInTheDocument();
    });

    expect(client.attemptReview).toHaveBeenCalledWith("wsp_1", "att_123");
  });

  it("handles fetch error gracefully and provides back navigation", async () => {
    const client = fakeClient({
      attemptReview: vi.fn().mockRejectedValue(new Error("Network failure")),
    });
    const onBack = vi.fn();

    render(
      <AttemptRoute
        workspaceId="wsp_1"
        attemptId="att_bad"
        client={client}
        onBack={onBack}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network failure");
    });

    const backButton = screen.getByRole("button", { name: /back/i });
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalled();
  });

  it("renders speech detected events with transcript text and source badge", () => {
    const reviewWithSpeech: AttemptReviewData = {
      ...SAMPLE_REVIEW,
      timeline: [
        {
          kind: "event",
          timestamp: 1700000200000,
          eventKind: "speech_detected",
          details: { transcript: "What is the answer to question 2?", source: "byok" },
          flagged: false,
        },
      ],
    };

    render(<AttemptReview review={reviewWithSpeech} />);

    expect(screen.getByText("Speech Detected")).toBeInTheDocument();
    expect(screen.getByText("BYOK")).toBeInTheDocument();
    expect(screen.getByText(/What is the answer to question 2\?/)).toBeInTheDocument();
  });
});
