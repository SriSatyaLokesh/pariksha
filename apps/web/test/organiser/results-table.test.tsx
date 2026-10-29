import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { ApiClient, TestResultAttempt } from "../../src/lib/api";
import { fakeClient } from "../fixtures/api-client";
import { ResultsTable } from "../../src/components/organiser/ResultsTable";

const MOCK_ATTEMPT_1: TestResultAttempt = {
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
      promptExcerpt: "Calculate Bernoulli numbers using the algorithm.",
      pointsEarned: 10,
      maxPoints: 10,
      correct: true,
    },
    {
      questionId: "qst_2",
      promptExcerpt: "Explain difference between Analytical Engine and Difference Engine.",
      pointsEarned: 15,
      maxPoints: 15,
      correct: true,
    },
  ],
};

const MOCK_ATTEMPT_2: TestResultAttempt = {
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
  questionBreakdown: [
    {
      questionId: "qst_1",
      promptExcerpt: "Calculate Bernoulli numbers using the algorithm.",
      pointsEarned: 0,
      maxPoints: 10,
      correct: false,
    },
    {
      questionId: "qst_2",
      promptExcerpt: "Explain difference between Analytical Engine and Difference Engine.",
      pointsEarned: 5,
      maxPoints: 15,
      correct: false,
    },
  ],
};

const MOCK_ATTEMPT_3: TestResultAttempt = {
  attemptId: "att_3",
  candidateId: "cnd_3",
  candidateName: "Grace Hopper",
  candidateEmail: "grace@example.com",
  externalId: "EXT-003",
  status: "in_progress",
  startedAt: 1700002000000,
  submittedAt: null,
  durationSeconds: null,
  score: null,
  maxScore: 100,
  percentage: null,
  passed: null,
  rank: null,
  integrityFlag: "scoring_blocked",
  violations: 5,
  questionBreakdown: [
    {
      questionId: "qst_1",
      promptExcerpt: "Calculate Bernoulli numbers using the algorithm.",
      pointsEarned: 0,
      maxPoints: 10,
      correct: null,
    },
  ],
};

const MOCK_ATTEMPT_4: TestResultAttempt = {
  attemptId: "att_4",
  candidateId: "cnd_4",
  candidateName: "Alan Turing",
  candidateEmail: "alan@example.com",
  externalId: "EXT-004",
  status: "locked",
  startedAt: 1700000500000,
  submittedAt: null,
  durationSeconds: null,
  score: null,
  maxScore: 100,
  percentage: null,
  passed: null,
  rank: null,
  integrityFlag: "scoring_blocked",
  violations: 8,
  questionBreakdown: [],
};

const ALL_RESULTS = [MOCK_ATTEMPT_1, MOCK_ATTEMPT_2, MOCK_ATTEMPT_3, MOCK_ATTEMPT_4];

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeClient({
    exportPage: vi.fn().mockResolvedValue({
      csv: "candidate,score\nAda,95\n",
      nextCursor: null,
      filename: "results.csv",
    }),
    ...overrides,
  });
}

describe("ResultsTable", () => {
  it("renders rows with candidate details, scores, badges, and review button", () => {
    const client = createClient();
    const onReview = vi.fn();

    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={ALL_RESULTS}
        totalPoints={100}
        passMark={50}
        onReviewAttempt={onReview}
      />,
    );

    // Candidates
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("ada@example.com")).toBeVisible();
    expect(screen.getByText("Charles Babbage")).toBeVisible();
    expect(screen.getByText("charles@example.com")).toBeVisible();

    // Ranks
    expect(screen.getByText("#1")).toBeVisible();
    expect(screen.getByText("#2")).toBeVisible();

    // Scores & Percentages
    expect(screen.getByText("95 / 100")).toBeVisible();
    expect(screen.getByText("95.0%")).toBeVisible();
    expect(screen.getByText("45 / 100")).toBeVisible();
    expect(screen.getByText("45.0%")).toBeVisible();

    // Badges — use getAllByText since badge text also appears in filter dropdown options
    expect(screen.getByText("Pass")).toBeVisible();
    expect(screen.getByText("Fail")).toBeVisible();
    expect(screen.getAllByText("Clean").some((el) => el.classList.contains("status-badge"))).toBe(true);
    expect(screen.getAllByText("Review").some((el) => el.classList.contains("status-badge"))).toBe(true);

    // Unscored / in progress items display dashes
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);

    // Review buttons
    const reviewButtons = screen.getAllByRole("button", { name: /review/i });
    expect(reviewButtons.length).toBeGreaterThan(0);
  });

  it("expands accordion row to display question breakdown with Zero Key Leakage (KG1)", () => {
    const client = createClient();
    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={[MOCK_ATTEMPT_1]}
        totalPoints={100}
        passMark={50}
        onReviewAttempt={vi.fn()}
      />,
    );

    // Initially breakdown is not visible
    expect(
      screen.queryByText("Calculate Bernoulli numbers using the algorithm."),
    ).not.toBeInTheDocument();

    // Click accordion toggle
    const toggle = screen.getByRole("button", { name: /toggle breakdown|expand/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("Calculate Bernoulli numbers using the algorithm."),
    ).toBeVisible();
    expect(screen.getByText("10 / 10")).toBeVisible();
    // MOCK_ATTEMPT_1 has 2 correct questions, so there are 2 "✓ Correct" badges
    const correctBadges = screen.getAllByText("✓ Correct");
    expect(correctBadges.length).toBe(2);
    expect(correctBadges[0]).toBeVisible();

    expect(
      screen.getByText("Explain difference between Analytical Engine and Difference Engine."),
    ).toBeVisible();
    expect(screen.getByText("15 / 15")).toBeVisible();

    // KG1 check: verify no key / answer leakage
    expect(screen.queryByText(/answer key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model answer/i)).not.toBeInTheDocument();

    // Toggle again to collapse
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("Calculate Bernoulli numbers using the algorithm."),
    ).not.toBeInTheDocument();
  });

  it("filters candidate rows by search text", () => {
    const client = createClient();
    const onFilterChange = vi.fn();

    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={ALL_RESULTS}
        totalPoints={100}
        passMark={50}
        onReviewAttempt={vi.fn()}
        onFilterChange={onFilterChange}
      />,
    );

    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("Charles Babbage")).toBeVisible();

    const searchInput = screen.getByPlaceholderText("Search by candidate name or email…");
    fireEvent.change(searchInput, { target: { value: "Ada" } });

    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.queryByText("Charles Babbage")).not.toBeInTheDocument();

    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "Ada" }),
    );
  });

  it("filters candidate rows by status and integrity dropdowns", () => {
    const client = createClient();
    const onFilterChange = vi.fn();

    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={ALL_RESULTS}
        totalPoints={100}
        passMark={50}
        onReviewAttempt={vi.fn()}
        onFilterChange={onFilterChange}
      />,
    );

    const statusSelect = screen.getByLabelText(/filter by status/i);
    const integritySelect = screen.getByLabelText(/filter by integrity/i);

    // Filter by locked
    fireEvent.change(statusSelect, { target: { value: "locked" } });
    expect(screen.getByText("Alan Turing")).toBeVisible();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();

    // Reset status and filter by integrity: review
    fireEvent.change(statusSelect, { target: { value: "all" } });
    fireEvent.change(integritySelect, { target: { value: "review" } });
    expect(screen.getByText("Charles Babbage")).toBeVisible();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.queryByText("Alan Turing")).not.toBeInTheDocument();

    expect(onFilterChange).toHaveBeenCalled();
  });

  it("invokes onReviewAttempt when Review button is clicked", () => {
    const client = createClient();
    const onReview = vi.fn();

    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={[MOCK_ATTEMPT_1]}
        totalPoints={100}
        passMark={50}
        onReviewAttempt={onReview}
      />,
    );

    const reviewButton = screen.getByRole("button", { name: "Review" });
    fireEvent.click(reviewButton);

    expect(onReview).toHaveBeenCalledWith("att_1");
  });

  it("displays empty state when no results match filters", () => {
    const client = createClient();
    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={ALL_RESULTS}
        totalPoints={100}
        passMark={50}
        onReviewAttempt={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText("Search by candidate name or email…");
    fireEvent.change(searchInput, { target: { value: "NonExistentCandidate" } });

    expect(screen.getByText(/no candidate results found|no results/i)).toBeVisible();
  });

  it("triggers CSV export for results and answers", async () => {
    const exportPage = vi.fn().mockResolvedValue({
      csv: "candidate,score\nAda,95\n",
      nextCursor: null,
      filename: "results.csv",
    });
    const client = createClient({ exportPage });

    // Mock createObjectURL
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);

    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={ALL_RESULTS}
        totalPoints={100}
        passMark={50}
        onReviewAttempt={vi.fn()}
      />,
    );

    const exportResultsBtn = screen.getByRole("button", { name: /export results/i });
    const exportAnswersBtn = screen.getByRole("button", { name: /export answers/i });

    fireEvent.click(exportResultsBtn);
    await waitFor(() => {
      expect(exportPage).toHaveBeenCalledWith("wsp_1", "tst_1", "results", undefined);
    });

    fireEvent.click(exportAnswersBtn);
    await waitFor(() => {
      expect(exportPage).toHaveBeenCalledWith("wsp_1", "tst_1", "answers", undefined);
    });

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("displays Load more candidates button when nextCursor is present", () => {
    const client = createClient();
    const onLoadMore = vi.fn();

    render(
      <ResultsTable
        testId="tst_1"
        workspaceId="wsp_1"
        client={client}
        results={[MOCK_ATTEMPT_1]}
        totalPoints={100}
        passMark={50}
        nextCursor="cursor_page_2"
        onLoadMore={onLoadMore}
        onReviewAttempt={vi.fn()}
      />,
    );

    const loadMoreBtn = screen.getByRole("button", { name: /load more candidates/i });
    expect(loadMoreBtn).toBeVisible();

    fireEvent.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalled();
  });
});
