// The candidate's two figures on the finish page (`K7`) — "This attempt"
// and, once the server has decided to disclose it, "Counted for your
// result".
//
// **Driven from `ExamApp`, never from `Receipt` directly.** Three defects
// of exactly that shape shipped in Phase 6 behind component-level tests:
// a screen nobody can reach through the real runner is a screen nobody
// sees. The gate itself — whether `counted` is present at all — is the
// server's (`apps/api/test/run/release.test.ts`); what is argued here is
// that the browser renders exactly the block it was handed, and renders it
// with the exact copy `K7` fixes.

import { afterEach, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PROCTORING_DEFAULTS } from "@pariksha/core";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { LandingPayload, Receipt, ReleasedResult, RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
    fireEvent.click(element);
    await Promise.resolve();
  });
}

const question = (n: number): CandidateQuestion => ({
  id: `q${String(n)}`,
  type: "single",
  prompt: `Question ${String(n)} stem`,
  points: 1,
  options: [
    { id: "a", text: "The first option" },
    { id: "b", text: "The second option" },
  ],
});

const paper: AttemptPaper = {
  attemptId: "att_finish01",
  sections: [
    { id: "logic", title: "Logic", instructions: null, timeLimitMinutes: null, questions: [question(1)] },
  ],
  responses: { q1: { kind: "option", option: "a" } },
  clientSeq: 1,
  navigation: "free",
  maxIndex: 0,
  remainingMs: 45 * 60_000,
  sectionRemainingMs: null,
  warnAtMinutes: [10, 2],
  lateSyncGraceSeconds: 30,
  allowCalculator: false,
  serverNow: NOW,
  submittedAt: null,
  proctoring: PROCTORING_DEFAULTS.off,
  violations: 0,
};

const landing: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 1,
  sections: [{ id: "logic", title: "Logic", questionCount: 1, timeLimitMinutes: null }],
  rules: null,
  proctoring: { profile: "off", requirements: [] },
  accessMode: "link_code",
  state: "open",
  opensAt: null,
  closesAt: null,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: { logo: null, logoAlt: null, primaryColour: null, footerText: null, startMessage: null },
  candidateList: false,
  serverNow: NOW,
};

const receipt: Receipt = {
  attemptId: "att_finish01",
  submittedAt: NOW,
  answered: 1,
  unanswered: 0,
  total: 1,
  attemptNo: 2,
  attemptsAllowed: 3,
  finishMessage: null,
};

function client(overrides: Partial<RunClient> = {}): RunClient {
  return {
    landing: () => Promise.resolve(landing),
    resume: () => Promise.resolve(paper),
    start: () => Promise.resolve(paper),
    access: () => Promise.reject(new Error("the runner passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("the runner sends no code")),
    form: () => Promise.reject(new Error("the runner reads no form")),
    register: () => Promise.reject(new Error("the runner registers nobody")),
    putAnswer: () => Promise.resolve({ outcome: "accepted" as const }),
    ...RESULT_STUB,
    ...overrides,
  };
}

/** This attempt scored 72% under `score_only` — `overrides` carries (or
 *  omits) the `counted` block the server has already decided to disclose. */
const BASE_RELEASED: ReleasedResult = {
  show: "score_only",
  total: 72,
  max: 100,
  percent: 72,
  passed: null,
  pending: [],
};

async function submitThrough(overrides: Partial<ReleasedResult> = {}): Promise<void> {
  const released: ReleasedResult = { ...BASE_RELEASED, ...overrides };
  render(<ExamApp client={client({ submit: () => Promise.resolve({ receipt, released }) })} />);
  await screen.findByRole("navigation", { name: /question palette/i });
  await click(screen.getByRole("button", { name: /submit test/i }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));
  await screen.findByRole("heading", { name: /submitted/i });
}

afterEach(() => {
  localStorage.clear();
});

it("shows both figures on the last attempt", async () => {
  await submitThrough({ counted: { percent: 81, attemptId: "att_2", of: 2 } });
  expect(await screen.findByText(/This attempt: 72%/)).toBeInTheDocument();
  expect(screen.getByText(/Counted for your result: 81%, your best of 2/)).toBeInTheDocument();
});

it("shows only this attempt's figure when the server sent no counted block", async () => {
  await submitThrough();
  expect(await screen.findByText(/This attempt: 72%/)).toBeInTheDocument();
  // The second test's positive control is the first: the same query,
  // present there and absent here.
  expect(screen.queryByText(/Counted for your result/)).toBeNull();
});

it("names the average, not a best, when counted_attempt is average", async () => {
  await submitThrough({ counted: { percent: 74.33, attemptId: null, of: 3 } });
  expect(screen.getByText(/Counted for your result: 74\.33%, your average of 3/)).toBeInTheDocument();
});

it("the finish page with both figures has no axe violations", async () => {
  await submitThrough({ counted: { percent: 81, attemptId: "att_2", of: 2 } });
  expect(await axe(document.body)).toHaveNoViolations();
});
