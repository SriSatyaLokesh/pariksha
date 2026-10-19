import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    // Task 2 widened `RunClient`; the landing screen calls neither, and a
    // stub that resolved would hide a screen that started to.
    access: () => Promise.reject(new Error("the landing screen does not pass the gate")),
    requestEmailCode: () => Promise.reject(new Error("the landing screen sends no code")),
    // Task 3 widened it again. Rejecting, not resolving, for the same
    // reason: a landing screen that started asking for the registration
    // form should fail here rather than pass quietly.
    form: () => Promise.reject(new Error("the landing screen reads no form")),
    register: () => Promise.reject(new Error("the landing screen registers nobody")),
    // Task 5, and the same posture a third time: the landing screen
    // mints no attempt and resumes none, so both reject rather than
    // resolve. A screen that starts calling either fails here.
    start: () => Promise.reject(new Error("the landing screen starts no attempt")),
    resume: () => Promise.reject(new Error("the landing screen resumes no attempt")),
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
  // No @testing-library/user-event in this workspace, by a decision this
  // repo already made and documented (`test/authoring/reorder.test.tsx:44`):
  // a focused native <button>'s real Enter/Space activation is a `click` in
  // every browser, so focusing and clicking exercises the code path a
  // keyboard user reaches without adding a dependency for one test.
  const check = screen.getByRole("button", { name: /check my device/i });
  check.focus();
  fireEvent.click(check);
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
  const buttons = screen.getAllByRole("button");
  expect(buttons.length).toBeGreaterThan(0);

  for (const button of buttons) {
    const visible = (button.textContent ?? "").trim();
    // Without this, the assertion below is satisfied by the empty string
    // for any control whose visible label has gone missing.
    expect(visible.length, "a control with no visible label at all").toBeGreaterThan(0);
    // `toHaveAccessibleName` computes the name the way a screen reader does
    // (aria-label, then aria-labelledby, then content), so the two sides of
    // this comparison are no longer the same expression. The previous
    // version read `aria-label ?? textContent` and compared it against
    // `textContent` — an identity for every control with no aria-label,
    // which was all of them.
    expect(button).toHaveAccessibleName(
      new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    );
  }

  // The positive control. With no control carrying an aria-label that
  // differs from its text, the loop above would hold for a component that
  // never set one — true, and proving nothing. Start is deliberately
  // labelled "Start <test name>" over the visible "Start".
  const start = screen.getByRole("button", { name: "Start Aptitude" });
  expect(start.textContent?.trim()).toBe("Start");
  expect(start.getAttribute("aria-label")).toBe("Start Aptitude");
});

it("every control is a focusable native button, in the order a candidate meets them", async () => {
  // Named for what it really checks. Without user-event no Tab key can be
  // dispatched, so what is asserted is the thing that makes Tab work:
  // native <button> elements, no tabindex override taking them out of (or
  // jumping them ahead in) the sequence, and the document order a
  // candidate reads — check the device, then start.
  await mount();
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((b) => b.tagName)).toEqual(["BUTTON", "BUTTON"]);
  for (const button of buttons) expect(button).not.toHaveAttribute("tabindex");
  expect(buttons[0]).toHaveAccessibleName(/check my device/i);
  expect(buttons[1]).toHaveAccessibleName(/start/i);
  buttons[0]?.focus();
  expect(buttons[0]).toHaveFocus();
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
