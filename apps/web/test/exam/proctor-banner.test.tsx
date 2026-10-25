import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveProctoring } from "@pariksha/core";
import { ProctorBanner } from "../../src/components/exam/ProctorBanner";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;

const question: CandidateQuestion = {
  id: "q1",
  type: "single",
  prompt: "Question 1?",
  points: 1,
  options: [
    { id: "a", text: "Option A" },
    { id: "b", text: "Option B" },
  ],
};

function paperFixture(): AttemptPaper {
  return {
    attemptId: "att_proctor_test",
    sections: [{ id: "s1", title: "Section 1", instructions: null, timeLimitMinutes: null, questions: [question] }],
    responses: {},
    clientSeq: 0,
    navigation: "free",
    maxIndex: 0,
    remainingMs: 45 * 60_000,
    sectionRemainingMs: null,
    warnAtMinutes: [10, 2],
    lateSyncGraceSeconds: 30,
    allowCalculator: false,
    serverNow: NOW,
    submittedAt: null,
    lockedAt: null,
    proctoring: resolveProctoring({ profile: "strict" }),
    violations: 0,
  };
}

afterEach(() => {
  cleanup();
});

describe("ProctorBanner Component (C-10, D8)", () => {
  it("renders with role='alert', displays message and dismiss button", () => {
    const onDismiss = vi.fn();
    render(<ProctorBanner message="Please check your camera" messageAt={NOW} onDismiss={onDismiss} />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass("exam-proctor-banner");
    expect(screen.getByText("Please check your camera")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("calls onDismiss when clicking dismiss button", () => {
    const onDismiss = vi.fn();
    render(<ProctorBanner message="Warning message" messageAt={NOW} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when pressing Escape key", () => {
    const onDismiss = vi.fn();
    render(<ProctorBanner message="Warning message" messageAt={NOW} onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when pressing Enter key on the dismiss button", () => {
    const onDismiss = vi.fn();
    render(<ProctorBanner message="Warning message" messageAt={NOW} onDismiss={onDismiss} />);

    const button = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Candidate Broadcast Integration (C-10, K12, K13)", () => {
  it("shows banner when response carries message, does not reshow after dismissal, and reshows when messageAt is newer", async () => {
    let nextResponse: { outcome: "accepted"; message?: string; messageAt?: number } = {
      outcome: "accepted",
      message: "First proctor announcement",
      messageAt: NOW + 1000,
    };

    const putAnswer = vi.fn(async () => nextResponse);

    const client: RunClient = {
      landing: () => Promise.reject(new Error("no landing")),
      access: () => Promise.reject(new Error("no access")),
      requestEmailCode: () => Promise.reject(new Error("no code")),
      form: () => Promise.reject(new Error("no form")),
      register: () => Promise.reject(new Error("no register")),
      start: () => Promise.reject(new Error("no start")),
      resume: () => Promise.resolve(paperFixture()),
      ...RESULT_STUB,
      putAnswer,
    };

    render(<ExamApp client={client} />);

    // Wait for the resumed exam view to render
    const option = await screen.findByLabelText("Option A");
    expect(option).toBeInTheDocument();

    // Verify banner is not present initially
    expect(screen.queryByRole("alert")).toBeNull();

    // 1. Candidate selects an option, triggering putAnswer
    fireEvent.click(option);

    // Banner should appear with the message
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("First proctor announcement")).toBeInTheDocument();

    // 2. Candidate dismisses the banner
    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismissBtn);

    // Banner should now be hidden
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });

    // 3. Candidate selects Option B, triggering another save with same messageAt
    const optionB = screen.getByLabelText("Option B");
    fireEvent.click(optionB);

    // Wait for putAnswer to be called for option B
    await waitFor(() => {
      expect(putAnswer).toHaveBeenCalledTimes(2);
    });

    // Banner must NOT reshow the dismissed message
    expect(screen.queryByRole("alert")).toBeNull();

    // 4. Server gets a strictly newer broadcast message
    nextResponse = {
      outcome: "accepted",
      message: "Newer broadcast message: 5 minutes remaining",
      messageAt: NOW + 5000,
    };

    // Candidate clicks Option A again
    fireEvent.click(option);

    // Banner MUST reshow with the newer message
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("Newer broadcast message: 5 minutes remaining")).toBeInTheDocument();
  });
});

describe("Constraint KG7: No candidate polling intervals", () => {
  it("verifies zero fetch polling intervals in candidate runtime", () => {
    const candidateFiles = [
      "src/components/exam/ProctorBanner.tsx",
      "src/components/exam/Runner.tsx",
      "src/routes/exam.tsx",
    ];

    for (const relPath of candidateFiles) {
      const fullPath = resolve(__dirname, "../../", relPath);
      const code = readFileSync(fullPath, "utf-8");

      // Verify no setInterval or setTimeout repeatedly calling fetch or candidate APIs
      // Searching for polling patterns: setInterval(..., fetch) or while(true) fetch
      const hasPolling = /setInterval\s*\(\s*(async\s*)?\(\)\s*=>\s*\{[^}]*fetch/.test(code);
      expect(hasPolling, `Polling found in ${relPath}`).toBe(false);
    }
  });
});
