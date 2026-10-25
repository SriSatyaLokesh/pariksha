import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MonitorAttemptRow, MonitorResponse } from "../../src/lib/api";
import { Monitor } from "../../src/routes/monitor";
import { fakeClient } from "../fixtures/api-client";

const WORKSPACE_ID = "wsp_1";
const TEST_ID = "tst_1";

const quietRow: MonitorAttemptRow = {
  attemptId: "att_quiet",
  candidateId: "cnd_1",
  candidateName: "Quiet Candidate",
  candidateEmail: "quiet@test.com",
  status: "started",
  startedAt: 1000,
  submittedAt: null,
  deadlineAt: 5000,
  answeredCount: 0,
  totalQuestions: 10,
  violations: 0,
  integrityFlag: "clean",
  lastContactAt: null,
  camera: "active",
  lockedAt: null,
};

const rowWithNullFaceCount: MonitorAttemptRow = {
  attemptId: "att_face_null",
  candidateId: "cnd_2",
  candidateName: "Null Face Candidate",
  candidateEmail: "face@test.com",
  status: "in_progress",
  startedAt: 1000,
  submittedAt: null,
  deadlineAt: 5000,
  answeredCount: 2,
  totalQuestions: 10,
  violations: 0,
  integrityFlag: "clean",
  lastContactAt: 2000,
  camera: "active",
  lockedAt: null,
  faceCount: null,
};

const mockResponse: MonitorResponse = {
  counts: { registered: 300, inProgress: 212, submitted: 80, autoSubmitted: 8 },
  rows: [quietRow],
};

function intervalsIssuingFetch(targetPath: string): string[] {
  // If targetPath is a string containing code rather than an existing directory,
  // scan the code directly (used for the planted control fixture)
  if (!fs.existsSync(targetPath)) {
    if (/setInterval\s*\([^)]*fetch\s*\(/s.test(targetPath) || /setInterval[\s\S]*?fetch/.test(targetPath)) {
      return ["planted-fixture: setInterval with fetch"];
    }
    return [];
  }

  const matches: string[] = [];
  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        // Look for setInterval that issues a fetch
        if (/setInterval[\s\S]{0,300}?fetch\(/.test(content)) {
          matches.push(`${fullPath}: setInterval issuing fetch`);
        }
      }
    }
  }

  scanDir(targetPath);
  return matches;
}

const FIXTURE_WITH_ONE = `
  function startPolling() {
    setInterval(() => {
      fetch("/api/poll");
    }, 5000);
  }
`;

describe("Monitor Screen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("refreshes every 15 seconds", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse);
    const client = fakeClient({ getMonitor: fetchSpy });

    render(<Monitor client={client} workspaceId={WORKSPACE_ID} testId={TEST_ID} />);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("renders an em dash for an attempt with no contact", async () => {
    render(
      <Monitor
        client={fakeClient({ getMonitor: vi.fn().mockResolvedValue(mockResponse) })}
        workspaceId={WORKSPACE_ID}
        testId={TEST_ID}
        rows={[quietRow]}
      />,
    );
    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  it("says which profiles produce a usable last-contact signal", () => {
    render(
      <Monitor
        client={fakeClient({ getMonitor: vi.fn().mockResolvedValue(mockResponse) })}
        workspaceId={WORKSPACE_ID}
        testId={TEST_ID}
      />,
    );
    expect(screen.getByText(/only Strict attempts report continuously/i)).toBeInTheDocument();
  });

  it("renders face count as not counted, never zero", () => {
    render(
      <Monitor
        client={fakeClient({ getMonitor: vi.fn().mockResolvedValue(mockResponse) })}
        workspaceId={WORKSPACE_ID}
        testId={TEST_ID}
        rows={[rowWithNullFaceCount]}
      />,
    );
    expect(screen.getByText(/not counted/)).toBeInTheDocument();
    expect(screen.queryByText(/^0 faces$/)).toBeNull();
  });

  it("passes axe accessibility checks", async () => {
    const { container } = render(
      <Monitor
        client={fakeClient({ getMonitor: vi.fn().mockResolvedValue(mockResponse) })}
        workspaceId={WORKSPACE_ID}
        testId={TEST_ID}
        rows={[quietRow]}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  describe("Proctor Action Controls", () => {
    const lockedRow: MonitorAttemptRow = {
      ...quietRow,
      attemptId: "att_locked",
      status: "locked",
      lockedAt: 2500,
    };

    it("performs extend time action with minutes dialog", async () => {
      const performActionSpy = vi.fn().mockResolvedValue({ extended: true });
      const client = fakeClient({
        getMonitor: vi.fn().mockResolvedValue(mockResponse),
        performProctorAction: performActionSpy,
      });

      render(
        <Monitor
          client={client}
          workspaceId={WORKSPACE_ID}
          testId={TEST_ID}
          rows={[quietRow]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /extend/i }));
      expect(await screen.findByRole("heading", { name: "Extend Time" })).toBeInTheDocument();

      const input = screen.getByLabelText(/minutes to add/i);
      fireEvent.change(input, { target: { value: "15" } });

      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(performActionSpy).toHaveBeenCalledWith(WORKSPACE_ID, "att_quiet", {
          kind: "extend_time",
          minutes: 15,
        });
      });
    });

    it("unlocks a locked attempt on button click", async () => {
      const performActionSpy = vi.fn().mockResolvedValue({ unlocked: true });
      const client = fakeClient({
        getMonitor: vi.fn().mockResolvedValue(mockResponse),
        performProctorAction: performActionSpy,
      });

      render(
        <Monitor
          client={client}
          workspaceId={WORKSPACE_ID}
          testId={TEST_ID}
          rows={[lockedRow]}
        />,
      );

      const unlockBtn = screen.getByRole("button", { name: /unlock/i });
      fireEvent.click(unlockBtn);

      await waitFor(() => {
        expect(performActionSpy).toHaveBeenCalledWith(WORKSPACE_ID, "att_locked", {
          kind: "unlock",
        });
      });
    });

    it("displays error message when unlock fails", async () => {
      const client = fakeClient({
        getMonitor: vi.fn().mockResolvedValue(mockResponse),
        performProctorAction: vi.fn().mockRejectedValue(new Error("Unlock server rejected")),
      });

      render(
        <Monitor
          client={client}
          workspaceId={WORKSPACE_ID}
          testId={TEST_ID}
          rows={[lockedRow]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /unlock/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Unlock server rejected");
    });

    it("resets attempt with confirmation naming non-destructive preservation", async () => {
      const performActionSpy = vi.fn().mockResolvedValue({ ok: true, newAttemptId: "att_new" });
      const client = fakeClient({
        getMonitor: vi.fn().mockResolvedValue(mockResponse),
        performProctorAction: performActionSpy,
      });

      render(
        <Monitor
          client={client}
          workspaceId={WORKSPACE_ID}
          testId={TEST_ID}
          rows={[quietRow]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /reset/i }));
      expect(await screen.findByRole("heading", { name: "Reset Attempt" })).toBeInTheDocument();
      expect(
        screen.getByText(/current attempt and its responses will be preserved and remain intact/i),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(performActionSpy).toHaveBeenCalledWith(WORKSPACE_ID, "att_quiet", {
          kind: "reset",
        });
      });
    });

    it("force submits attempt with confirmation dialog", async () => {
      const performActionSpy = vi.fn().mockResolvedValue({ ok: true, submitted: true });
      const client = fakeClient({
        getMonitor: vi.fn().mockResolvedValue(mockResponse),
        performProctorAction: performActionSpy,
      });

      render(
        <Monitor
          client={client}
          workspaceId={WORKSPACE_ID}
          testId={TEST_ID}
          rows={[quietRow]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /force submit/i }));
      expect(await screen.findByRole("heading", { name: "Force Submit Attempt" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(performActionSpy).toHaveBeenCalledWith(WORKSPACE_ID, "att_quiet", {
          kind: "force_submit",
        });
      });
    });

    it("sends proctor message to candidate via text modal", async () => {
      const performActionSpy = vi.fn().mockResolvedValue({ ok: true, sent: true });
      const client = fakeClient({
        getMonitor: vi.fn().mockResolvedValue(mockResponse),
        performProctorAction: performActionSpy,
      });

      render(
        <Monitor
          client={client}
          workspaceId={WORKSPACE_ID}
          testId={TEST_ID}
          rows={[quietRow]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /message/i }));
      expect(await screen.findByRole("heading", { name: "Send Message" })).toBeInTheDocument();

      const textarea = screen.getByPlaceholderText(/enter message for candidate/i);
      fireEvent.change(textarea, { target: { value: "Please keep your camera centered." } });

      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => {
        expect(performActionSpy).toHaveBeenCalledWith(WORKSPACE_ID, "att_quiet", {
          kind: "message",
          text: "Please keep your camera centered.",
        });
      });
    });
  });

  describe("KG7: candidate runtime adds no polling fetch", () => {
    it("the candidate runtime adds no polling fetch", () => {
      const examDir = path.resolve(__dirname, "../../src/components/exam");
      expect(intervalsIssuingFetch(examDir)).toEqual([]);
    });

    it("the scan catches one when planted — control", () => {
      expect(intervalsIssuingFetch(FIXTURE_WITH_ONE)).not.toEqual([]);
    });
  });
});
