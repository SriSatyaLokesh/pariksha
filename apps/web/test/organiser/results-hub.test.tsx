import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { ApiClient, TestResultsOverviewItem } from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import { ResultsHub } from "../../src/routes/results-hub";

const MOCK_TESTS: TestResultsOverviewItem[] = [
  {
    id: "tst_1",
    name: "Midterm Exam",
    slug: "midterm-exam",
    state: "open",
    candidateCount: 40,
    attemptCount: 38,
    submittedCount: 35,
    averageScore: 78,
    passRate: 0.85,
  },
  {
    id: "tst_2",
    name: "Final Assessment",
    slug: "final-assessment",
    state: "draft",
    candidateCount: 50,
    attemptCount: 0,
    submittedCount: 0,
    averageScore: null,
    passRate: null,
  },
];

function createClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    resultsOverview: async () => ({ tests: MOCK_TESTS }),
    ...overrides,
  });
}

describe("ResultsHub", () => {
  it("renders loading state while waiting for API", () => {
    const client = createClient({
      resultsOverview: () => new Promise(() => {}), // never resolves
    });

    render(<ResultsHub client={client} workspaceId="wsp_1" onSelectTest={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("renders test list with title, state badge, candidate count, submissions count, class average, and pass rate", async () => {
    const client = createClient();

    render(<ResultsHub client={client} workspaceId="wsp_1" onSelectTest={vi.fn()} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Results" })).toBeVisible();
    expect(
      screen.getByText("Select a test to review candidate submissions, scores, and exam integrity."),
    ).toBeVisible();

    // Headers
    expect(screen.getByRole("columnheader", { name: "Test" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "State" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Candidates" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Submissions" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Class Average" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Pass Rate" })).toBeVisible();

    // Test 1 row
    expect(screen.getByText("Midterm Exam")).toBeVisible();
    expect(screen.getByText("midterm-exam")).toBeVisible();
    expect(screen.getByText("Open")).toBeVisible();
    expect(screen.getByText("40")).toBeVisible();
    expect(screen.getByText("35 / 40")).toBeVisible();
    expect(screen.getByText("78%")).toBeVisible();
    expect(screen.getByText("85%")).toBeVisible();
  });

  it("displays empty state when workspace has 0 tests", async () => {
    const client = createClient({
      resultsOverview: async () => ({ tests: [] }),
    });

    render(<ResultsHub client={client} workspaceId="wsp_1" onSelectTest={vi.fn()} />);

    expect(await screen.findByText("No tests exist yet in this workspace.")).toBeVisible();
  });

  it("handles zero submissions / unscored test displaying '—'", async () => {
    const client = createClient();

    render(<ResultsHub client={client} workspaceId="wsp_1" onSelectTest={vi.fn()} />);

    expect(await screen.findByText("Final Assessment")).toBeVisible();
    expect(screen.getByText("final-assessment")).toBeVisible();
    expect(screen.getByText("Draft")).toBeVisible();
    expect(screen.getByText("0 / 50")).toBeVisible();

    // Check unscored averages display dash "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("clicking 'Open results' button calls onSelectTest with test.id", async () => {
    const onSelectTest = vi.fn();
    const client = createClient();

    render(<ResultsHub client={client} workspaceId="wsp_1" onSelectTest={onSelectTest} />);

    const openButton = await screen.findByRole("button", {
      name: "Open results for Midterm Exam",
    });
    expect(openButton).toBeVisible();

    fireEvent.click(openButton);
    expect(onSelectTest).toHaveBeenCalledWith("tst_1");
  });

  it("renders error state when API fails", async () => {
    const client = createClient({
      resultsOverview: async () => {
        throw new Error("Network error loading results");
      },
    });

    render(<ResultsHub client={client} workspaceId="wsp_1" onSelectTest={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Network error loading results");
  });
});
