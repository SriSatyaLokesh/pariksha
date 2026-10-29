import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ApiClient, TestResultsPayload } from "../../src/lib/api";
import { fakeClient } from "../fixtures/api-client";
import { ResultsRoute } from "../../src/routes/results";

const MOCK_RESULTS_PAYLOAD: TestResultsPayload = {
  test: {
    id: "tst_1",
    title: "Algorithms & Data Structures",
    totalPoints: 100,
    passMark: 50,
  },
  summary: {
    totalRegistered: 25,
    submittedCount: 18,
    inProgressCount: 5,
    lockedCount: 2,
    averageScore: 72,
    passRate: 0.8,
  },
  results: [
    {
      attemptId: "att_1",
      candidateId: "cnd_1",
      candidateName: "Ada Lovelace",
      candidateEmail: "ada@example.com",
      externalId: "EXT-001",
      status: "submitted",
      startedAt: 1700000000000,
      submittedAt: 1700003600000,
      durationSeconds: 3600,
      score: 95,
      maxScore: 100,
      percentage: 95.0,
      passed: true,
      rank: 1,
      integrityFlag: "clean",
      violations: 0,
      questionBreakdown: [
        {
          questionId: "qst_1",
          promptExcerpt: "Calculate Fibonacci sequence iteratively.",
          pointsEarned: 10,
          maxPoints: 10,
          correct: true,
        },
      ],
    },
    {
      attemptId: "att_2",
      candidateId: "cnd_2",
      candidateName: "Charles Babbage",
      candidateEmail: "charles@example.com",
      externalId: "EXT-002",
      status: "submitted",
      startedAt: 1700001000000,
      submittedAt: 1700004000000,
      durationSeconds: 3000,
      score: 45,
      maxScore: 100,
      percentage: 45.0,
      passed: false,
      rank: 2,
      integrityFlag: "review",
      violations: 2,
      questionBreakdown: [],
    },
  ],
  nextCursor: "cursor_page_2",
};

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeClient({
    testResults: vi.fn().mockResolvedValue(MOCK_RESULTS_PAYLOAD),
    exportPage: vi.fn().mockResolvedValue({
      csv: "candidate,score\nAda,95\n",
      nextCursor: null,
      filename: "results.csv",
    }),
    ...overrides,
  });
}

describe("ResultsRoute", () => {
  it("renders loading status while results are being fetched", () => {
    const client = createClient({
      testResults: () => new Promise(() => {}),
    });

    render(
      <ResultsRoute
        client={client}
        workspaceId="wsp_1"
        testId="tst_1"
        onBack={vi.fn()}
        onReviewAttempt={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
  });

  it("renders metric cards and test header", async () => {
    const client = createClient();

    render(
      <ResultsRoute
        client={client}
        workspaceId="wsp_1"
        testId="tst_1"
        onBack={vi.fn()}
        onReviewAttempt={vi.fn()}
      />,
    );

    // Test title
    expect(await screen.findByRole("heading", { level: 1, name: "Algorithms & Data Structures" })).toBeVisible();

    // 4 Metric cards
    expect(screen.getByText("Registered Candidates")).toBeVisible();
    expect(screen.getByText("25")).toBeVisible();

    // "Submitted" appears in both the metric card label and elsewhere (option, th, badges),
    // so scope to the summary card using within()
    const summaryCards = document.querySelectorAll(".results-summary-card");
    const submittedCard = Array.from(summaryCards).find((card) =>
      card.querySelector(".results-summary-card__label")?.textContent?.trim() === "Submitted",
    );
    expect(submittedCard).toBeDefined();
    const submittedLabel = within(submittedCard as HTMLElement).getByText("Submitted");
    expect(submittedLabel).toBeVisible();
    expect(screen.getByText("18")).toBeVisible();
    expect(screen.getByText(/5 in progress/i)).toBeVisible();
    expect(screen.getByText(/2 locked/i)).toBeVisible();

    expect(screen.getByText("Class Average")).toBeVisible();
    expect(screen.getByText("72%")).toBeVisible();

    expect(screen.getByText("Pass Rate")).toBeVisible();
    expect(screen.getByText("80%")).toBeVisible();
    expect(screen.getByText(/50/)).toBeVisible(); // pass mark
  });

  it("calls onBack when back button is clicked", async () => {
    const client = createClient();
    const onBack = vi.fn();

    render(
      <ResultsRoute
        client={client}
        workspaceId="wsp_1"
        testId="tst_1"
        onBack={onBack}
        onReviewAttempt={vi.fn()}
      />,
    );

    const backButton = await screen.findByRole("button", { name: /back/i });
    fireEvent.click(backButton);

    expect(onBack).toHaveBeenCalled();
  });

  it("loads more results when clicking load more", async () => {
    const nextResultsPayload: TestResultsPayload = {
      test: MOCK_RESULTS_PAYLOAD.test,
      summary: MOCK_RESULTS_PAYLOAD.summary,
      results: [
        {
          attemptId: "att_3",
          candidateId: "cnd_3",
          candidateName: "Alan Turing",
          candidateEmail: "alan@example.com",
          externalId: "EXT-003",
          status: "submitted",
          startedAt: 1700000000000,
          submittedAt: 1700003600000,
          durationSeconds: 3600,
          score: 100,
          maxScore: 100,
          percentage: 100.0,
          passed: true,
          rank: 1,
          integrityFlag: "clean",
          violations: 0,
          questionBreakdown: [],
        },
      ],
      nextCursor: null,
    };

    const testResults = vi
      .fn()
      .mockResolvedValueOnce(MOCK_RESULTS_PAYLOAD)
      .mockResolvedValueOnce(nextResultsPayload);

    const client = createClient({ testResults });

    render(
      <ResultsRoute
        client={client}
        workspaceId="wsp_1"
        testId="tst_1"
        onBack={vi.fn()}
        onReviewAttempt={vi.fn()}
      />,
    );

    expect(await screen.findByText("Ada Lovelace")).toBeVisible();

    const loadMoreBtn = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(testResults).toHaveBeenCalledTimes(2);
      expect(testResults).toHaveBeenLastCalledWith(
        "wsp_1",
        "tst_1",
        expect.objectContaining({ cursor: "cursor_page_2" }),
      );
    });

    expect(await screen.findByText("Alan Turing")).toBeVisible();
    // Previous candidate still visible
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
  });

  it("calls onReviewAttempt when Review is clicked in ResultsTable", async () => {
    const client = createClient();
    const onReviewAttempt = vi.fn();

    render(
      <ResultsRoute
        client={client}
        workspaceId="wsp_1"
        testId="tst_1"
        onBack={vi.fn()}
        onReviewAttempt={onReviewAttempt}
      />,
    );

    const reviewButtons = await screen.findAllByRole("button", { name: "Review" });
    fireEvent.click(reviewButtons[0]!);

    expect(onReviewAttempt).toHaveBeenCalledWith("att_1");
  });

  it("renders error alert when testResults fails", async () => {
    const client = createClient({
      testResults: vi.fn().mockRejectedValue(new Error("Network failed to load")),
    });

    render(
      <ResultsRoute
        client={client}
        workspaceId="wsp_1"
        testId="tst_1"
        onBack={vi.fn()}
        onReviewAttempt={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Network failed to load");
  });
});
