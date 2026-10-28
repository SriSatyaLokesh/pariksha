import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { PROCTORING_DEFAULTS } from "@pariksha/core";
import { ExamApp, REGISTRATION_TOKEN_KEY, deviceReport } from "../../src/routes/exam";
import type { LandingPayload, RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

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
  // A real Standard resolution, not the empty array `resolveProctoring`
  // would never actually produce for this profile — copied from
  // `apps/api/test/run/landing.test.ts`'s own assertion of the same four
  // sentences, so the two cannot drift apart.
  //
  // Phase 7c Task 5 (`T5-R3`): `blockCopyPaste` gets a sentence of its own
  // now (`proctoringRequirements`, `packages/core/src/proctoring.ts`) and
  // Standard defaults it `true` — this is the fixture that pins the
  // sentence it adds, deliberately broken by this task's diff.
  proctoring: {
    profile: "standard",
    requirements: [
      "This test must be taken on a desktop or laptop, not a phone or tablet.",
      "Use a fully updated Chrome, Edge, Firefox or Safari.",
      // Whole-branch review, finding 3: copied verbatim from
      // `apps/api/test/run/landing.test.ts`'s own assertion so the two
      // cannot drift apart.
      "Leaving this browser tab or window is logged.",
      "The test runs in fullscreen. Leaving it is logged.",
      "Copying, pasting and right-click are disabled, and attempts are logged.",
    ],
  },
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
  candidateList: false,
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
    // Task 8: the root asks for a resume before the landing page, so this
    // one must answer. `null` is "no attempt in this browser", which is
    // exactly the state every test in this file is in.
    resume: () => Promise.resolve(null),
    ...RESULT_STUB,
    putAnswer: () => Promise.reject(new Error("the landing screen saves nothing")),
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

/** A passing desktop, stubbed explicitly. Review finding 1: Start is now
 *  genuinely gated on the device at mount (`device-gate.test.tsx` owns
 *  that gate itself) rather than only after "Check my device" is clicked,
 *  so any test here that wants Start enabled by default — because it is
 *  testing something else entirely — has to stand on a device that
 *  actually passes, the same as `landingFixture`'s Standard profile
 *  (`desktop_only: true`) requires. jsdom's own defaults (no
 *  `matchMedia`) fail the pointer check otherwise. */
function stubCompliantDevice(): void {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
  });
}

it("C-01: name, duration, question count, sections, rules and the window", async () => {
  await mount();
  for (const text of [
    /Aptitude/,
    /45 minutes/,
    /17 questions/i,
    /Logic/,
    /cannot go back to an earlier question/i,
    /Closes/i,
  ]) {
    expect(screen.getByText(text), String(text)).toBeVisible();
  }
  expect(screen.getByText(/Alpha Corp · Hyderabad/)).toBeVisible();
  expect(screen.getByText(/Read every instruction before you begin\./)).toBeVisible();
});

it("lists Strict's requirements on the start page", async () => {
  await mount({
    ...landingFixture,
    proctoring: {
      profile: "strict",
      requirements: ["A laptop or desktop computer.", "A working camera, on for the whole test."],
    },
  });
  expect(await screen.findByText(/A working camera, on for the whole test\./)).toBeVisible();
});

it("renders landing action buttons above proctoring requirements in DOM order", async () => {
  const { container } = await mount();
  const actionsElement = container.querySelector(".exam-landing-actions");
  const requirementsElement = container.querySelector(".exam-landing-requirements");
  expect(actionsElement).not.toBeNull();
  expect(requirementsElement).not.toBeNull();
  expect(
    (actionsElement!.compareDocumentPosition(requirementsElement!) &
      Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  ).toBe(true);
});

// Review Focus 5 — most fixtures have no proctoring block at all, which
// resolves to fully-populated Off: no requirements, and no heading over
// an empty list either.
it("shows no requirements and no error when the test has no proctoring block", async () => {
  await mount({ ...landingFixture, proctoring: { profile: "off", requirements: [] } });
  expect(screen.queryByRole("list", { name: /requirements/i })).toBeNull();
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
  // A passing desktop, stubbed explicitly: a refused device additionally
  // disables Start (`device-gate.test.tsx` owns that gate), so this test
  // pins a compliant device to isolate what it actually checks — that the
  // window, not the device, is why Start is disabled here.
  stubCompliantDevice();
  await mount({ ...landingFixture, state: "scheduled", opensAt: NOW + DAY });
  // No @testing-library/user-event in this workspace, by a decision this
  // repo already made and documented (`test/authoring/reorder.test.tsx:44`):
  // a focused native <button>'s real Enter/Space activation is a `click` in
  // every browser, so focusing and clicking exercises the code path a
  // keyboard user reaches without adding a dependency for one test.
  const check = screen.getByRole("button", { name: /check my device/i });
  check.focus();
  fireEvent.click(check);
  // Two live regions share this page since Task 3 (`#exam-device-blocked`
  // is now unconditionally mounted too, review round 1 finding 1), so a
  // bare singular role query is ambiguous here — find the one the device
  // findings actually landed in.
  const statuses = await screen.findAllByRole("status");
  expect(statuses.some((el) => /screen|browser/i.test(el.textContent ?? ""))).toBe(true);
  // The window, not a compliant device: a passing report never disables
  // the button and never enables it either — the window still rules.
  expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
});

it("the start button is enabled only while the test is open", async () => {
  stubCompliantDevice();
  await mount();
  expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
});

it("Start without a registration token opens registration rather than minting an attempt", async () => {
  // The merge's one real hazard: the screens were built against a
  // zero-argument `start()`, and `RunClient & Partial<PaperClient>` kept
  // `client.start()` compiling while calling the real `start(undefined)` —
  // a 4xx on the first live run, caught by nothing. The token comes from
  // `sessionStorage`, and there is none here — so Start is now the way IN
  // to registration (Task 6) rather than a dead end.
  stubCompliantDevice();
  sessionStorage.removeItem(REGISTRATION_TOKEN_KEY);
  await mount();
  fireEvent.click(screen.getByRole("button", { name: /start/i }));
  // `clientFor`'s `start` rejects with its own message, so a Start that
  // minted an attempt fails on the heading below rather than passing.
  expect(
    await screen.findByRole("heading", { level: 1, name: /register for aptitude/i }),
  ).toBeVisible();
  expect(screen.getByLabelText(/access code/i)).toBeVisible();
  expect(screen.queryByRole("button", { name: /^start$/i })).toBeNull();
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
  expect(buttons.map((b) => b.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON"]);
  for (const button of buttons) expect(button).not.toHaveAttribute("tabindex");
  expect(buttons[0]).toHaveAccessibleName(/check my device/i);
  expect(buttons[1]).toHaveAccessibleName(/start/i);
  // `C-09`'s way back in, after Start rather than before it: a candidate
  // who has come to sit the test meets that first, and one who has
  // already sat it is reading rather than racing.
  expect(buttons[2]).toHaveAccessibleName(/see my result/i);
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
    const report = deviceReport(PROCTORING_DEFAULTS.standard);
    expect(report.ok).toBe(true);
    expect(report.refused).toBe(false);
    expect(report.findings.map((f) => f.label)).toEqual(["Screen", "Pointer", "Browser"]);
    expect(report.findings.every((f) => f.ok)).toBe(true);
  });

  it("fails a phone on both the screen and the pointer, and names which", () => {
    stub(390, false, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile/15E148 Safari/604.1");
    const report = deviceReport(PROCTORING_DEFAULTS.standard);
    expect(report.ok).toBe(false);
    const failed = report.findings.filter((f) => !f.ok).map((f) => f.label);
    expect(failed).toContain("Screen");
    expect(failed).toContain("Pointer");
  });

  it("names an unsupported browser rather than reporting it as fine", () => {
    stub(1440, true, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Lynx/2.9");
    const browser = deviceReport(PROCTORING_DEFAULTS.standard).findings.find((f) => f.label === "Browser");
    expect(browser?.ok).toBe(false);
    expect(browser?.detail).toMatch(/Chrome|Edge|Firefox|Safari/);
  });
});
