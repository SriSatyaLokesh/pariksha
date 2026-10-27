import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { proctoringRequirements } from "@pariksha/core";
import {
  DEMO_LANDING_FIXTURE,
  DEMO_PAPER_FIXTURE,
  DEMO_PROCTORING_CONFIG,
} from "../../src/lib/demo-test";
import { ProctoringLayer } from "../../src/components/exam/ProctoringLayer";

describe("Demo Proctoring Configuration", () => {
  it("exports DEMO_PROCTORING_CONFIG with required controls enabled and violation limit 3", () => {
    expect(DEMO_PROCTORING_CONFIG).toBeDefined();
    expect(DEMO_PROCTORING_CONFIG.desktopOnly).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.requireFullscreen).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.watermark).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.blockCopyPaste).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.extraMonitorCheck).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.allowCalculator).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.violationLimit).toBe(3);
    expect(DEMO_PROCTORING_CONFIG.violationAction).toBe("warn_then_flag");
  });

  it("attaches DEMO_PROCTORING_CONFIG to DEMO_PAPER_FIXTURE", () => {
    expect(DEMO_PAPER_FIXTURE.proctoring).toEqual(DEMO_PROCTORING_CONFIG);
  });

  it("sets DEMO_LANDING_FIXTURE requirements matching proctoringRequirements(DEMO_PROCTORING_CONFIG)", () => {
    expect(DEMO_LANDING_FIXTURE.proctoring.requirements).toEqual(
      proctoringRequirements(DEMO_PROCTORING_CONFIG),
    );
  });
});

describe("Demo Proctoring Client-Side 3-Violation Auto-Submit Guard", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation(() =>
      Promise.reject(new Error("Network fetch is prohibited during demo proctoring")),
    );
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("handles copy/paste violations locally for att_demo_ attempts without fetch errors and triggers autoSubmitted on 3rd violation", async () => {
    const onAutoSubmit = vi.fn();

    render(
      <ProctoringLayer
        attemptId="att_demo_evaluator"
        proctoring={DEMO_PROCTORING_CONFIG}
        initialViolations={0}
        onAutoSubmit={onAutoSubmit}
      />,
    );

    // Initial state: no warnings
    const countStatus = screen.getByRole("status");
    expect(countStatus.textContent).toBe("");

    // 1st violation: copy blocked
    fireEvent.copy(document);
    await waitFor(() => {
      expect(countStatus.textContent).toContain("Warning 1 of 3");
    });
    expect(onAutoSubmit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2nd violation: paste blocked
    fireEvent.paste(document);
    await waitFor(() => {
      expect(countStatus.textContent).toContain("Warning 2 of 3");
    });
    expect(onAutoSubmit).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // 3rd violation: context menu or copy blocked -> triggers auto-submit
    fireEvent.copy(document);
    await waitFor(() => {
      expect(countStatus.textContent).toContain("Warning 3 of 3");
    });
    await waitFor(() => {
      expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    });

    // Verify auto-submitted overlay is visible
    expect(await screen.findByText("Test submitted")).toBeInTheDocument();
    expect(
      screen.getByText(/submitted because the warning limit was reached/i),
    ).toBeInTheDocument();

    // Verify watermark is rendered
    expect(screen.getAllByText(/att_demo_evaluator/)[0]).toBeInTheDocument();

    // Zero fetch calls made across all 3 violations
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("triggers auto-submit on 1st violation if initialViolations is already 2", async () => {
    const onAutoSubmit = vi.fn();

    render(
      <ProctoringLayer
        attemptId="att_demo_evaluator"
        proctoring={DEMO_PROCTORING_CONFIG}
        initialViolations={2}
        onAutoSubmit={onAutoSubmit}
      />,
    );

    const countStatus = screen.getByRole("status");
    expect(countStatus.textContent).toContain("Warning 2 of 3");

    fireEvent.copy(document);
    await waitFor(() => {
      expect(countStatus.textContent).toContain("Warning 3 of 3");
    });
    await waitFor(() => {
      expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Test submitted")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attempts network fetch for non-demo attempt IDs", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          violations: 1,
          limit: 3,
          action: "warn_then_flag",
        }),
    } as Response);

    render(
      <ProctoringLayer
        attemptId="att_production_candidate"
        proctoring={DEMO_PROCTORING_CONFIG}
        initialViolations={0}
      />,
    );

    fireEvent.copy(document);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/v1/run/attempt/events",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });
});
