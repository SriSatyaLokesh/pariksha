import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ExamApp, deviceReport } from "../../src/routes/exam";
import type { LandingPayload, RunClient } from "../../src/lib/run";

// C-01, over the candidate app's own root. Nothing here renders
// `ExamLanding` directly: the pre-submit checklist's first item is that a
// screen is reached from the app root, because a component nobody mounts is
// a component nobody sees.

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

const landingFixture: LandingPayload = {
  name: "Aptitude",
  description: "A 45-minute aptitude paper.",
  durationMinutes: 45,
  questionCount: 17,
  sections: [
    { id: "logic", title: "Logic", questionCount: 4, timeLimitMinutes: 15 },
    { id: "numeracy", title: "Numeracy", questionCount: 13, timeLimitMinutes: null },
  ],
  rules: "A candidate cannot go back to an earlier question.",
  proctoring: "standard",
  accessMode: "link_code",
  state: "open",
  opensAt: NOW - DAY,
  closesAt: NOW + DAY,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: {
    logo: null,
    logoAlt: null,
    primaryColour: null,
    footerText: "Alpha Corp · Hyderabad",
    startMessage: "Read every instruction before you begin.",
  },
  serverNow: NOW,
};

function clientFor(payload: LandingPayload | Error): RunClient {
  return {
    landing: () => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload)),
  };
}

/** The app root, settled. Every test below starts here. */
async function mount(payload: LandingPayload | Error = landingFixture) {
  const view = render(<ExamApp client={clientFor(payload)} />);
  await screen.findByRole("heading", { level: 1 });
  return view;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("C-01: name, duration, question count, sections, rules, proctoring, devices and the window", async () => {
  await mount();
  for (const text of [
    /Aptitude/,
    /45 minutes/,
    /17 questions/i,
    /Logic/,
    /cannot go back to an earlier question/i,
    /Standard/,
    /laptop or desktop/i,
    /Closes/i,
  ]) {
    expect(screen.getByText(text), String(text)).toBeVisible();
  }
  expect(screen.getByText(/Alpha Corp · Hyderabad/)).toBeVisible();
  expect(screen.getByText(/Read every instruction before you begin\./)).toBeVisible();
});

it("every section is listed with its own question count", async () => {
  await mount();
  const sections = within(screen.getByRole("list", { name: /sections/i })).getAllByRole("listitem");
  expect(sections).toHaveLength(2);
  expect(sections[0]).toHaveTextContent(/Logic/);
  expect(sections[0]).toHaveTextContent(/4 questions/);
  expect(sections[1]).toHaveTextContent(/13 questions/);
});

it("C-01: 'Check my device' reports before the window opens and does not block starting", async () => {
  await mount({ ...landingFixture, state: "scheduled", opensAt: NOW + DAY });
  await userEvent.click(screen.getByRole("button", { name: /check my device/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/screen|browser/i);
  // The window, not the device: the report never disables the button and
  // never enables it (Phase 7 owns the gate).
  expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
});

it("the start button is enabled only while the test is open", async () => {
  await mount();
  expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
});

it("a closed test says so instead of offering a start button that refuses", async () => {
  await mount({ ...landingFixture, state: "closed" });
  expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
  expect(screen.getByText(/closed/i)).toBeVisible();
});

it("a test that cannot be resolved says so rather than rendering an empty page", async () => {
  render(<ExamApp client={clientFor(new Error("No such test."))} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/No such test\./);
});

it("DESIGN.md: the landing page keeps the voltage canvas", async () => {
  const { container } = await mount();
  expect(container.querySelector(".exam-landing-hero")).toHaveClass("card-voltage");
});

it("the landing page has no axe violations", async () => {
  const { container } = await mount();
  expect(await axe(container)).toHaveNoViolations();
});

it("WCAG 2.5.3: every control's accessible name contains its visible label", async () => {
  await mount();
  for (const button of screen.getAllByRole("button")) {
    const accessible = (button.getAttribute("aria-label") ?? button.textContent ?? "").toLowerCase();
    expect(accessible, button.textContent ?? "").toContain((button.textContent ?? "").trim().toLowerCase());
  }
});

it("every control is reachable with the keyboard alone", async () => {
  await mount();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: /check my device/i })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: /start/i })).toHaveFocus();
});

describe("deviceReport", () => {
  const stub = (width: number, pointerFine: boolean, userAgent: string) => {
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("pointer: fine") ? pointerFine : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal("navigator", { userAgent });
  };

  it("passes a wide screen with a mouse on a supported browser", () => {
    stub(1440, true, "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0 Safari/537.36");
    const report = deviceReport();
    expect(report.ok).toBe(true);
    expect(report.findings.map((f) => f.label)).toEqual(["Screen", "Pointer", "Browser"]);
    expect(report.findings.every((f) => f.ok)).toBe(true);
  });

  it("fails a phone on both the screen and the pointer, and names which", () => {
    stub(390, false, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile/15E148 Safari/604.1");
    const report = deviceReport();
    expect(report.ok).toBe(false);
    const failed = report.findings.filter((f) => !f.ok).map((f) => f.label);
    expect(failed).toContain("Screen");
    expect(failed).toContain("Pointer");
  });

  it("names an unsupported browser rather than reporting it as fine", () => {
    stub(1440, true, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Lynx/2.9");
    const browser = deviceReport().findings.find((f) => f.label === "Browser");
    expect(browser?.ok).toBe(false);
    expect(browser?.detail).toMatch(/Chrome|Edge|Firefox|Safari/);
  });
});
