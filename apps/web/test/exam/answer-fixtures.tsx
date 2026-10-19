import { fireEvent, render, screen } from "@testing-library/react";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper } from "../../src/components/exam/Runner";
import type { LandingPayload, RunClient } from "../../src/lib/run";

// The pre-submit checklist's first item, shared by the three answer test
// files: anything added to a screen needs a test that starts at the app
// root and CLICKS its way there. Rendering `AnswerInput` directly proves
// nothing about whether a candidate can ever reach it.
//
// `AttemptPaper` is Task 5's type, declared locally in Runner.tsx until
// `lib/paper.ts` arrives (Task 6's report, "RunClient methods stubbed
// rather than called"); this file imports it from there rather than
// re-declaring a third copy.

const NOW = 1_760_000_000_000;

/** One question of each of the twelve types, in a single section, so a
 * click-through from the root reaches every component this task adds. */
export const examPaper: AttemptPaper = {
  attemptId: "att_answers",
  sections: [
    {
      id: "all",
      title: "Everything",
      instructions: null,
      timeLimitMinutes: null,
      questions: [
        {
          id: "q1",
          type: "single",
          prompt: "What is the capital of France?",
          points: 1,
          // Fix round 1, I1: one question carries a passage and media, so
          // both are on a path a candidate can click to. `src` is used
          // verbatim — the scrubber rewrote it to the attempt-scoped
          // route when the layout was pinned, and nothing on this side
          // builds a media URL.
          group: { id: "geo", passage: "A short *passage* about European capitals." },
          media: [
            {
              kind: "image",
              src: "/api/v1/run/attempt/media/media/w1/map.png",
              alt: "A map of France",
            },
          ],
          options: [
            { id: "a", text: "Paris" },
            { id: "b", text: "Lyon" },
          ],
        },
        {
          id: "q2",
          type: "multiple",
          prompt: "Which are primes?",
          points: 2,
          options: [
            { id: "a", text: "Two" },
            { id: "b", text: "Four" },
            { id: "c", text: "Five" },
          ],
        },
        {
          id: "q3",
          type: "select_k",
          prompt: "Choose exactly two.",
          points: 2,
          k: 2,
          options: [
            { id: "a", text: "Alpha" },
            { id: "b", text: "Beta" },
            { id: "c", text: "Gamma" },
          ],
        },
        { id: "q4", type: "true_false", prompt: "The sky is blue.", points: 1 },
        {
          id: "q5",
          type: "assertion_reason",
          prompt: "Consider the following.",
          points: 1,
          assertion: "Water boils at 100C.",
          reason: "At one atmosphere.",
        },
        {
          id: "q6",
          type: "matching",
          prompt: "Match the joins.",
          points: 2,
          left: ["INNER JOIN", "LEFT JOIN"],
          right: ["Only matching rows", "All left rows"],
        },
        {
          id: "q7",
          type: "multi_matching",
          prompt: "Match every pair.",
          points: 2,
          left: ["A", "B"],
          right: ["X", "Y"],
        },
        {
          id: "q8",
          type: "ordering",
          prompt: "Put these in order.",
          points: 3,
          items: ["C", "A", "B"],
        },
        {
          id: "q9",
          type: "fill_blank",
          prompt: "The capital is {{1}} and the currency is {{2}}.",
          points: 2,
          blanks: [{ id: "1" }, { id: "2" }],
        },
        { id: "q10", type: "numeric", prompt: "Acceleration due to gravity?", points: 1, unit: "m/s2" },
        { id: "q11", type: "short_answer", prompt: "Define a join.", points: 2, maxLength: 500 },
        { id: "q12", type: "long_answer", prompt: "Discuss normalisation.", points: 5, maxLength: 5000 },
      ],
    },
  ],
  responses: {},
  navigation: "free",
  maxIndex: 11,
  remainingMs: 45 * 60_000,
  sectionRemainingMs: null,
  warnAtMinutes: [10, 5],
  lateSyncGraceSeconds: 120,
  allowCalculator: false,
  serverNow: NOW,
};

export const landingPayload: LandingPayload = {
  name: "Everything",
  description: null,
  durationMinutes: 45,
  questionCount: 12,
  sections: [{ id: "all", title: "Everything", questionCount: 12, timeLimitMinutes: null }],
  rules: null,
  proctoring: "off",
  accessMode: "link_code",
  state: "open",
  opensAt: null,
  closesAt: null,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: { logo: null, logoAlt: null, primaryColour: null, footerText: null, startMessage: null },
  serverNow: NOW,
};

function client(): RunClient & { start: () => Promise<AttemptPaper> } {
  return {
    landing: () => Promise.resolve(landingPayload),
    start: () => Promise.resolve(examPaper),
  };
}

function activate(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

/** Render `ExamApp`, press Start, and wait for the runner. Returns
 * nothing on purpose: `RenderResult` cannot be named across files without
 * a path into @testing-library/dom's internals (TS2883), and every caller
 * queries through `screen` anyway. */
export async function startFromRoot(): Promise<void> {
  render(<ExamApp client={client()} />);
  activate(await screen.findByRole("button", { name: /^start/i }));
  await screen.findByRole("navigation", { name: /question palette/i });
}

/** Jump the palette to the question with this 1-based number. */
export function jumpTo(number: number): void {
  activate(screen.getByRole("button", { name: new RegExp(`^question ${String(number)} `, "i") }));
}
