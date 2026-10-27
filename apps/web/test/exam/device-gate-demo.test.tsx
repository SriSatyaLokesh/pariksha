import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PROCTORING_DEFAULTS, type ResolvedProctoring } from "@pariksha/core";
import { deviceReport, ExamApp } from "../../src/routes/exam";
import type { LandingPayload, RunClient } from "../../src/lib/run";
import * as demoTestModule from "../../src/lib/demo-test";
import { RESULT_STUB } from "./run-client-stub";

const DEMO_PROCTORING_CONFIG: ResolvedProctoring =
  (demoTestModule as { DEMO_PROCTORING_CONFIG?: ResolvedProctoring }).DEMO_PROCTORING_CONFIG ?? {
    ...PROCTORING_DEFAULTS.off,
    desktopOnly: true,
  };

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubDevice(opts: { width: number; pointerFine?: boolean; ua?: string }) {
  vi.stubGlobal("innerWidth", opts.width);
  if (opts.pointerFine !== undefined) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("pointer: fine") ? opts.pointerFine : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  }
  if (opts.ua !== undefined) {
    vi.stubGlobal("navigator", { userAgent: opts.ua });
  }
}

const landingFixture: LandingPayload = {
  name: "Pariksha Interactive Demo Exam",
  description: "Experience the candidate exam interface.",
  durationMinutes: 15,
  questionCount: 12,
  sections: [{ id: "sec1", title: "Section 1", questionCount: 4, timeLimitMinutes: 5 }],
  rules: null,
  proctoring: {
    profile: "strict",
    requirements: ["This test must be taken on a desktop or laptop, not a phone or tablet."],
  },
  accessMode: "link_code",
  state: "open",
  opensAt: null,
  closesAt: null,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: { logo: null, logoAlt: null, primaryColour: null, footerText: null, startMessage: null },
  candidateList: false,
  serverNow: Date.now(),
};

function clientFor(payload: LandingPayload): RunClient {
  return {
    landing: () => Promise.resolve(payload),
    access: () => Promise.reject(new Error("landing only")),
    requestEmailCode: () => Promise.reject(new Error("landing only")),
    form: () => Promise.reject(new Error("landing only")),
    register: () => Promise.reject(new Error("landing only")),
    start: () => Promise.reject(new Error("landing only")),
    resume: () => Promise.resolve(null),
    ...RESULT_STUB,
    putAnswer: () => Promise.reject(new Error("landing only")),
  };
}

describe("Demo Device Gate (Block Phones & Tablets)", () => {
  it("refuses mobile screen widths under 1024px when desktopOnly is true", () => {
    stubDevice({ width: 414 });
    const report = deviceReport(DEMO_PROCTORING_CONFIG);
    expect(report.ok).toBe(false);
    expect(report.refused).toBe(true);
    expect(report.findings[0]?.ok).toBe(false);
  });

  it("admits desktop screens >= 1024px with fine pointer and desktop browser", () => {
    stubDevice({
      width: 1280,
      pointerFine: true,
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    });
    const report = deviceReport(DEMO_PROCTORING_CONFIG);
    expect(report.refused).toBe(false);
  });

  it("refuses touch-only devices even when screen width is >= 1024px (tablet)", () => {
    stubDevice({
      width: 1024,
      pointerFine: false,
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    });
    const report = deviceReport(DEMO_PROCTORING_CONFIG);
    expect(report.refused).toBe(true);
    expect(report.findings[1]?.ok).toBe(false);
  });

  it("refuses mobile user agents even with wide screen and fine pointer", () => {
    stubDevice({
      width: 1280,
      pointerFine: true,
      ua: "Mozilla/5.0 (Linux; Android 13; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    });
    const report = deviceReport(DEMO_PROCTORING_CONFIG);
    expect(report.refused).toBe(true);
  });

  it("admits mobile/tablet devices when desktopOnly is false", () => {
    stubDevice({ width: 414, pointerFine: false, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    const report = deviceReport({ ...PROCTORING_DEFAULTS.off, desktopOnly: false });
    expect(report.refused).toBe(false);
  });

  it("disables Start button with accessible notice when mobile device accesses desktop-only exam", async () => {
    stubDevice({ width: 414, pointerFine: false });
    render(<ExamApp client={clientFor(landingFixture)} />);

    await screen.findByRole("heading", { level: 1 });
    const start = screen.getByRole("button", { name: /Start/ });
    expect(start).toBeDisabled();

    // Verify accessible notice on Start button
    expect(start).toHaveAccessibleDescription(
      /This test must be taken on a desktop or laptop, not a phone or tablet\./,
    );
  });

  it("enables Start button on desktop with compliant screen and fine pointer", async () => {
    stubDevice({
      width: 1440,
      pointerFine: true,
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    });
    render(<ExamApp client={clientFor(landingFixture)} />);

    await screen.findByRole("heading", { level: 1 });
    const start = screen.getByRole("button", { name: /Start/ });
    expect(start).toBeEnabled();
  });
});
