// Phase 7c Task 3 (`Q9b`, `Q9c`, `AC-17`): the device and browser gate.
//
// `deviceReport()` already existed (7a's C-01 "Check my device") and only
// ever reported. This task extends that one function — never a second
// checker over a different input set (`Q9b`) — to also *refuse*: when
// `desktop_only` is on and the device fails it. `R3`/`R4` below are this
// task's own rulings, not the brief's, and are why this file reads the way
// it does.
//
// `R4`: the table carries an explicit `refused` column rather than
// deriving the expectation from `sig.name` — a renamed row (or
// "touchscreen laptop" matching on a `.includes("laptop")` test by
// accident) must not silently change what is asserted. This is the table
// that proves `AC-17`, which the owner also checks by hand on real
// hardware, so it has to be readable at a glance.

import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PROCTORING_DEFAULTS, proctoringRequirements, resolveProctoring } from "@pariksha/core";
import { deviceReport, ExamApp } from "../../src/routes/exam";
import type { LandingPayload, RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

afterEach(() => {
  vi.unstubAllGlobals();
});

// The pure function's own baseline — `off` has `desktopOnly: false`, so
// every table row below states the one field it cares about explicitly.
const offResolved = PROCTORING_DEFAULTS.off;

interface DeviceSignature {
  name: string;
  width: number;
  pointerFine: boolean;
  ua: string;
  /** `R4`: pinned per row, not derived from `name`. */
  refused: boolean;
}

// Real UAs, not the brief's elided ones — `browserName` has to recognise
// every one of these as a supported browser, or a signature's `refused`
// expectation would be contaminated by an unrelated browser miss (this
// task's `refused` is desktop-only + device alone, never the browser —
// see `deviceReport`'s own doc comment — but the findings list should
// still be honest for a real device).
const SIGNATURES: readonly [
  DeviceSignature,
  DeviceSignature,
  DeviceSignature,
  DeviceSignature,
  DeviceSignature,
] = [
  {
    name: "Android phone",
    width: 412,
    pointerFine: false,
    ua: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
    refused: true,
  },
  {
    name: "iPhone",
    width: 390,
    pointerFine: false,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    refused: true,
  },
  {
    // The case a UA string alone misses (brief, Step 3): this UA is
    // indistinguishable from a real Mac's, and the screen is wide enough
    // to pass — it is caught on the pointer alone.
    name: "iPad in desktop-mode Safari",
    width: 1024,
    pointerFine: false,
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    refused: true,
  },
  {
    name: "laptop",
    width: 1440,
    pointerFine: true,
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    refused: false,
  },
  {
    // Touch capability alongside a real mouse must not disqualify a real
    // desktop — `pointerFine` wins.
    name: "touchscreen laptop",
    width: 1920,
    pointerFine: true,
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.0.0",
    refused: false,
  },
];

function stubDevice(sig: DeviceSignature) {
  vi.stubGlobal("innerWidth", sig.width);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine") ? sig.pointerFine : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal("navigator", { userAgent: sig.ua });
}

function withDevice(sig: DeviceSignature, fn: () => void) {
  stubDevice(sig);
  fn();
}

it.each(SIGNATURES)("refuses $name when desktop_only is on, except a real desktop", (sig) => {
  withDevice(sig, () => {
    const r = deviceReport({ ...offResolved, desktopOnly: true });
    expect(r.refused).toBe(sig.refused);
  });
});

// Review Focus 4 / Q1a — allowed means allowed, on every one of them, the
// device-class finding notwithstanding (`R3`): a 390px screen is still
// reported `ok: false`, and still admitted.
it.each(SIGNATURES)("admits $name when desktop_only is off", (sig) => {
  withDevice(sig, () => {
    expect(deviceReport({ ...offResolved, desktopOnly: false }).refused).toBe(false);
  });
});

const UNSUPPORTED_BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Lynx/2.9";

it("refuses unsupported browser when any proctoring control is active", () => {
  stubDevice({
    name: "desktop with unsupported browser",
    width: 1440,
    pointerFine: true,
    ua: UNSUPPORTED_BROWSER_UA,
    refused: true,
  });
  const rDesktop = deviceReport({ ...offResolved, desktopOnly: true });
  expect(rDesktop.refused).toBe(true);
  expect(rDesktop.refusedReason).toBe("browser");

  const rCam = deviceReport({ ...offResolved, desktopOnly: false, requireCamera: true });
  expect(rCam.refused).toBe(true);
  expect(rCam.refusedReason).toBe("browser");

  const rCopy = deviceReport({ ...offResolved, desktopOnly: false, blockCopyPaste: true });
  expect(rCopy.refused).toBe(true);
  expect(rCopy.refusedReason).toBe("browser");
});

it("admits unsupported browser when proctoring is off (honesty without refusal)", () => {
  stubDevice({
    name: "desktop with unsupported browser",
    width: 1440,
    pointerFine: true,
    ua: UNSUPPORTED_BROWSER_UA,
    refused: false,
  });
  const r = deviceReport(offResolved);
  expect(r.refused).toBe(false);
  expect(r.refusedReason).toBeNull();
  expect(r.ok).toBe(false);
  const browserFinding = r.findings.find((f) => f.label === "Browser");
  expect(browserFinding?.ok).toBe(false);
});

it("distinguishes between desktop and browser refusal reasons", () => {
  stubDevice(SIGNATURES[0]);
  const rMobile = deviceReport({ ...offResolved, desktopOnly: true });
  expect(rMobile.refused).toBe(true);
  expect(rMobile.refusedReason).toBe("desktop");

  stubDevice({
    name: "desktop with unsupported browser",
    width: 1440,
    pointerFine: true,
    ua: UNSUPPORTED_BROWSER_UA,
    refused: true,
  });
  const rBrowser = deviceReport({ ...offResolved, desktopOnly: true });
  expect(rBrowser.refused).toBe(true);
  expect(rBrowser.refusedReason).toBe("browser");

  stubDevice({
    name: "mobile with unsupported browser",
    width: 390,
    pointerFine: false,
    ua: UNSUPPORTED_BROWSER_UA,
    refused: true,
  });
  const rNonDesktop = deviceReport({ ...offResolved, desktopOnly: false, requireCamera: true });
  expect(rNonDesktop.refused).toBe(true);
  expect(rNonDesktop.refusedReason).toBe("browser");

  stubDevice(SIGNATURES[3]);
  const rCompliant = deviceReport({ ...offResolved, desktopOnly: true });
  expect(rCompliant.refused).toBe(false);
  expect(rCompliant.refusedReason).toBeNull();
});

it("announces browser requirement message in exam-device-blocked when browser is unsupported", async () => {
  stubDevice({
    name: "desktop with unsupported browser",
    width: 1440,
    pointerFine: true,
    ua: UNSUPPORTED_BROWSER_UA,
    refused: true,
  });
  render(
    <ExamApp
      client={clientFor({
        ...landingFixture,
        proctoring: { profile: "strict", requirements: STRICT_DESKTOP_REQUIREMENTS },
      })}
    />,
  );
  await screen.findByRole("heading", { level: 1 });
  const start = screen.getByRole("button", { name: /Start/ });
  expect(start).toBeDisabled();
  expect(
    await screen.findByText(
      "This test requires a fully updated Chrome, Edge, Firefox or Safari. Please open this link in a supported browser.",
    ),
  ).toBeVisible();
  expect(start).toHaveAccessibleDescription(
    /This test requires a fully updated Chrome, Edge, Firefox or Safari\. Please open this link in a supported browser\./,
  );
});

// --- the landing page's gate ----------------------------------------------

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

const landingFixture: LandingPayload = {
  name: "Aptitude",
  description: "A 45-minute aptitude paper.",
  durationMinutes: 45,
  questionCount: 17,
  sections: [{ id: "logic", title: "Logic", questionCount: 4, timeLimitMinutes: 15 }],
  rules: null,
  proctoring: { profile: "off", requirements: [] },
  accessMode: "link_code",
  state: "open",
  opensAt: NOW - DAY,
  closesAt: NOW + DAY,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: { logo: null, logoAlt: null, primaryColour: null, footerText: null, startMessage: null },
  candidateList: false,
  serverNow: NOW,
};

function clientFor(payload: LandingPayload): RunClient {
  return {
    landing: () => Promise.resolve(payload),
    access: () => Promise.reject(new Error("the landing screen does not pass the gate")),
    requestEmailCode: () => Promise.reject(new Error("the landing screen sends no code")),
    form: () => Promise.reject(new Error("the landing screen reads no form")),
    register: () => Promise.reject(new Error("the landing screen registers nobody")),
    start: () => Promise.reject(new Error("the landing screen starts no attempt")),
    resume: () => Promise.resolve(null),
    ...RESULT_STUB,
    putAnswer: () => Promise.reject(new Error("the landing screen saves nothing")),
  };
}

// `R5`: no opener exists in this repo — every suite writes its own. This
// one stubs the device, mounts the landing page, and clicks "Check my
// device" itself, so the test body only has to assert the outcome.
async function openCandidateLanding(
  overrides: Partial<LandingPayload>,
  opts: { device: DeviceSignature },
): Promise<void> {
  stubDevice(opts.device);
  render(<ExamApp client={clientFor({ ...landingFixture, ...overrides })} />);
  await screen.findByRole("heading", { level: 1 });
  fireEvent.click(screen.getByRole("button", { name: /check my device/i }));
}

// Review round 1, finding 2: `exam.tsx`'s `desktopOnly` extraction parses
// `proctoringRequirements`'s real sentence, not a string this file invents.
// Driving the gate with the pinned production sentence means a reworded
// sentence at the `packages/core` end breaks *this test* rather than
// silently stopping the gate from firing in production — the shape of the
// defect the spec cites as `#186`. `resolveProctoring({ profile: "strict"
// })` is `desktop_only: true` by default (`PROCTORING_DEFAULTS.strict`),
// so this is the one line that line actually ships.
const STRICT_DESKTOP_REQUIREMENTS = proctoringRequirements(resolveProctoring({ profile: "strict" }));

it("blocks the start button and explains, rather than failing silently", async () => {
  await openCandidateLanding(
    { proctoring: { profile: "strict", requirements: STRICT_DESKTOP_REQUIREMENTS } },
    { device: SIGNATURES[0] },
  );
  expect(await screen.findByText(/This test needs a laptop or desktop computer\./)).toBeVisible();
  const start = screen.getByRole("button", { name: /Start/ });
  expect(start).toBeDisabled();
  // Not conveyed by the disabled state alone: reachable from the button
  // itself, the way a screen reader reaches it.
  expect(start).toHaveAccessibleDescription(/This test needs a laptop or desktop computer\./);
});

it("a compliant device on the same strict test starts clean", async () => {
  await openCandidateLanding(
    { proctoring: { profile: "strict", requirements: STRICT_DESKTOP_REQUIREMENTS } },
    { device: SIGNATURES[3] }, // "laptop"
  );
  expect(screen.queryByText(/This test needs a laptop or desktop computer\./)).toBeNull();
  expect(screen.getByRole("button", { name: /Start/ })).toBeEnabled();
});

it("the blocked landing page has no axe violations", async () => {
  await openCandidateLanding(
    { proctoring: { profile: "strict", requirements: STRICT_DESKTOP_REQUIREMENTS } },
    { device: SIGNATURES[0] },
  );
  await screen.findByText(/This test needs a laptop or desktop computer\./);
  expect(await axe(document.body)).toHaveNoViolations();
});

// Whole-branch review, finding 1 (BLOCKING) — the probe. `blocked` used to
// read `report?.refused`, and `report` stays `null` until "Check my
// device" is clicked (`openCandidateLanding` above always clicks it, which
// is exactly why no existing test saw this). A phone candidate who simply
// taps Start on a desktop-only test must be refused without ever pressing
// the optional button.
it("refuses Start on a desktop-only test without clicking Check my device", async () => {
  stubDevice(SIGNATURES[0]); // Android phone
  render(
    <ExamApp
      client={clientFor({
        ...landingFixture,
        proctoring: { profile: "strict", requirements: STRICT_DESKTOP_REQUIREMENTS },
      })}
    />,
  );
  await screen.findByRole("heading", { level: 1 });
  expect(screen.getByRole("button", { name: /Start/ })).toBeDisabled();
});

it("the device-blocked live region exists from first render, not only once refused", async () => {
  // Review round 1, finding 1: a region mounted only when `blocked` turns
  // true is a region no screen reader has registered yet when it does —
  // reworded from `{blocked && <p role="status">...}` to an always-mounted
  // region whose *contents* vary. No device stub and no click: this proves
  // the element exists before either, which `openCandidateLanding`'s own
  // click would hide a regression on.
  const { container } = render(<ExamApp client={clientFor(landingFixture)} />);
  await screen.findByRole("heading", { level: 1 });
  const region = container.querySelector("#exam-device-blocked");
  expect(region).not.toBeNull();
  expect(region).toHaveTextContent("");
});
