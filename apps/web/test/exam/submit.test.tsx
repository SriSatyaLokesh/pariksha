// Ending the test, from the candidate's side (#75, P6.11) — `C-08` and
// `AC-16`.
//
// **Every assertion starts at `ExamApp` and clicks its way there.**
// Nothing here renders `SubmitDialog`, `Receipt` or `ResultView` on its
// own: a screen nobody can reach is a screen nobody sees, which has been
// the top review finding in three consecutive phases. The one exception is
// the `ResultView` shape test at the bottom, which asserts about a payload
// rather than about a route — and it is reached from `ExamApp` too, by
// giving the submit a payload to answer with.
//
// The release gate itself is the server's (`apps/api/test/run/release.test.ts`).
// What is argued here is the other half of the same rule: the browser
// renders exactly what it was handed, with no branch anywhere that could
// show more.

import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type {
  LandingPayload,
  Receipt,
  ReleasedResult,
  RunClient,
} from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;

/** A real click, then a tick for whatever it started. `user-event` is not
 *  a dependency of this repo and adding one to press a button would be a
 *  new package in a candidate bundle's test tree for no gain — every
 *  other suite here drives the DOM the same way. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    // A real pointer click focuses what it hits, and `useDialogKeys`
    // restores focus to whatever held it — so a `fireEvent.click` alone
    // would make "focus comes back to Submit" vacuously pass from
    // `document.body`.
    element.focus();
    fireEvent.click(element);
    await Promise.resolve();
  });
}

/** Walk forward to a question the resumed paper left unanswered. q1 and
 *  q2 already carry an answer, so answering either changes nothing. */
async function goToUnanswered(): Promise<void> {
  await click(screen.getByRole("button", { name: /next question/i }));
  await click(screen.getByRole("button", { name: /next question/i }));
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

/** Seven questions, two answered: five unanswered, which is the number
 *  the confirmation has to say out loud. */
const paper: AttemptPaper = {
  attemptId: "att_finish01",
  sections: [
    {
      id: "logic",
      title: "Logic",
      instructions: null,
      timeLimitMinutes: null,
      questions: [1, 2, 3, 4, 5, 6, 7].map(question),
    },
  ],
  responses: {
    q1: { kind: "option", option: "a" },
    q2: { kind: "option", option: "b" },
  },
  clientSeq: 2,
  navigation: "free",
  maxIndex: 0,
  remainingMs: 45 * 60_000,
  sectionRemainingMs: null,
  warnAtMinutes: [10, 2],
  lateSyncGraceSeconds: 30,
  allowCalculator: false,
  serverNow: NOW,
  submittedAt: null,
};

const landing: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 7,
  sections: [{ id: "logic", title: "Logic", questionCount: 7, timeLimitMinutes: null }],
  rules: null,
  proctoring: "off",
  accessMode: "link_code",
  state: "open",
  opensAt: null,
  closesAt: null,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: {
    logo: null,
    logoAlt: null,
    primaryColour: null,
    footerText: null,
    startMessage: null,
  },
  candidateList: false,
  serverNow: NOW,
};

const receipt: Receipt = {
  attemptId: "att_finish01",
  submittedAt: NOW,
  answered: 2,
  unanswered: 5,
  total: 7,
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

/** Reach the runner the way a candidate does, then press Submit. */
async function openTheDialog(runClient: RunClient): Promise<void> {
  render(<ExamApp client={runClient} />);
  await screen.findByRole("navigation", { name: /question palette/i });
  await click(screen.getByRole("button", { name: /submit test/i }));
}

afterEach(() => {
  localStorage.clear();
});

// --- C-08: the confirmation ---------------------------------------------

it("C-08: the confirmation names the unanswered and marked counts before anything is submitted", async () => {
  const submit = vi.fn();
  render(<ExamApp client={client({ submit })} />);
  await screen.findByRole("navigation", { name: /question palette/i });

  // Mark one question, so "marked" is a number this screen produced
  // rather than a constant.
  await click(screen.getByRole("button", { name: /mark for review/i }));
  await click(screen.getByRole("button", { name: /submit test/i }));

  const dialog = screen.getByRole("dialog", { name: /submit this test/i });
  expect(dialog).toHaveTextContent(/5 questions are unanswered/i);
  expect(dialog).toHaveTextContent(/1 is marked for review/i);
  expect(dialog).toHaveTextContent(/cannot come back/i);
  expect(submit).not.toHaveBeenCalled();
});

it("the confirmation counts the answer the candidate has just given, not the one the resume carried", async () => {
  render(<ExamApp client={client()} />);
  await screen.findByRole("navigation", { name: /question palette/i });
  // q1 and q2 arrived answered; answering q3 takes unanswered from 5 to 4.
  await goToUnanswered();
  await click(await screen.findByRole("radio", { name: /the first option/i }));
  await click(screen.getByRole("button", { name: /submit test/i }));

  expect(screen.getByRole("dialog")).toHaveTextContent(/4 questions are unanswered/i);
});

it("Keep working closes the confirmation and submits nothing", async () => {
  const submit = vi.fn();
  await openTheDialog(client({ submit }));
  await click(screen.getByRole("button", { name: /keep working/i }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
  // And the candidate is back on the paper, not on a blank screen.
  expect(await screen.findByText("Question 1 stem")).toBeVisible();
});

it("the confirmation takes Escape, and returns focus to the control that opened it", async () => {
  await openTheDialog(client());
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toHaveAccessibleName(/submit test/i);
});

it("Tab is trapped inside the confirmation, because it claims aria-modal", async () => {
  // The hook's own rule and the repo's two precedents: `Runner.tsx`'s
  // Clear-answer dialog declines `aria-modal` because it traps nothing,
  // `Calculator.tsx` earns it. Telling a screen reader the paper behind
  // is inert while Tab walks into it is the worst of the three states.
  await openTheDialog(client());
  const dialog = screen.getByRole("dialog", { name: /submit this test/i });
  expect(dialog).toHaveAttribute("aria-modal", "true");

  const stops = within(dialog).getAllByRole("button");
  const first = stops[0] as HTMLElement;
  const last = stops[stops.length - 1] as HTMLElement;
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
});

it("the finish page takes the keyboard, rather than dropping it on <body>", async () => {
  // A view swap moves no focus: the dialog's own cleanup restores focus
  // to a Submit button that has just unmounted, so a candidate who has
  // ended a timed exam hears nothing at all. axe cannot see this.
  await openTheDialog(client({ submit: () => Promise.resolve({ receipt, released: null }) }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));

  expect(await screen.findByRole("heading", { name: /submitted/i })).toHaveFocus();
});

it("the confirmation has no axe violations", async () => {
  await openTheDialog(client());
  expect(await axe(document.body)).toHaveNoViolations();
});

// --- the submission itself ----------------------------------------------

it("AC-14: the queue is drained before the attempt is closed, never after", async () => {
  // Submitting first would close the attempt and every answer still in
  // the queue would come back a 409. The order is the whole promise.
  const order: string[] = [];
  const runClient = client({
    putAnswer: async () => {
      order.push("save");
      await Promise.resolve();
      return { outcome: "accepted" as const };
    },
    submit: async () => {
      order.push("submit");
      await Promise.resolve();
      return { receipt, released: null };
    },
  });
  render(<ExamApp client={runClient} />);
  await screen.findByRole("navigation", { name: /question palette/i });
  await goToUnanswered();
  await click(await screen.findByRole("radio", { name: /the first option/i }));
  await click(screen.getByRole("button", { name: /submit test/i }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));

  await screen.findByRole("heading", { name: /submitted/i });
  expect(order).toEqual(["save", "submit"]);
});

it("while the submission is in flight the confirmation says so and takes no second press", async () => {
  // `pending` was passed to `SubmitDialog` and observed by nothing —
  // exactly the shape of the `onZero` defect this phase already shipped.
  // What it buys is the only thing between a candidate on a slow
  // connection and pressing Submit and Finish three more times.
  let release = (): void => undefined;
  const submit = vi.fn(
    () =>
      new Promise<{ receipt: Receipt; released: null }>((resolve) => {
        release = () => {
          resolve({ receipt, released: null });
        };
      }),
  );
  await openTheDialog(client({ submit }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));

  const dialog = screen.getByRole("dialog", { name: /submit this test/i });
  expect(within(dialog).getByRole("button", { name: /submit and finish/i })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: /keep working/i })).toBeDisabled();
  // The non-visual half: a screen-reader user hears that something is
  // happening rather than meeting two controls that stopped answering.
  expect(dialog).toHaveTextContent(/submitting your test/i);

  await act(async () => {
    release();
    await Promise.resolve();
  });
  expect(await screen.findByRole("heading", { name: /submitted/i })).toBeVisible();
  expect(submit).toHaveBeenCalledTimes(1);
});

it("a refused submission leaves the candidate able to press again, with a reason", async () => {
  const submit = vi
    .fn<RunClient["submit"]>()
    .mockRejectedValueOnce(new Error("The network dropped. Try again."))
    .mockResolvedValueOnce({ receipt, released: null });
  await openTheDialog(client({ submit }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/network dropped/i);
  // Still on the paper, still able to try — which is only safe because
  // the server's own submission is idempotent.
  await click(screen.getByRole("button", { name: /submit and finish/i }));
  expect(await screen.findByRole("heading", { name: /submitted/i })).toBeVisible();
  expect(submit).toHaveBeenCalledTimes(2);
});

// --- C-08: the finish page ----------------------------------------------

it("C-08: the finish page shows the reference, the time and 'Attempt 2 of 3', and no score when the release says never", async () => {
  await openTheDialog(client({ submit: () => Promise.resolve({ receipt, released: null }) }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));

  await screen.findByRole("heading", { name: /submitted/i });
  expect(screen.getByText("att_finish01")).toBeVisible();
  expect(screen.getByText(/attempt 2 of 3/i)).toBeVisible();
  expect(screen.getByText(/2 of 7/)).toBeVisible();
  // No score, no percentage, no verdict — there is none to show.
  expect(screen.queryByRole("heading", { name: /your result/i })).toBeNull();
  expect(screen.queryByText(/passed|not passed/i)).toBeNull();
  expect(screen.getByText(/results for this test are not shown here/i)).toBeVisible();
});

// --- #186: the organiser's finish message -------------------------------

/** Submit a `release.when: "never"` receipt carrying `finishMessage` and
 *  land on the finish page — the pairing the spec names, because there the
 *  receipt is the whole answer and the message stands beside no score. */
const finishMessaged = async (finishMessage: string | null): Promise<void> => {
  await openTheDialog(
    client({ submit: () => Promise.resolve({ receipt: { ...receipt, finishMessage }, released: null }) }),
  );
  await click(screen.getByRole("button", { name: /submit and finish/i }));
  await screen.findByRole("heading", { name: /submitted/i });
};

it("shows the organiser's finish message after submitting", async () => {
  await finishMessaged("Thank you. Your organiser will be in touch.");
  expect(await screen.findByText("Thank you. Your organiser will be in touch.")).toBeVisible();
});

it("shows no empty message block when the organiser set none", async () => {
  await finishMessaged(null);
  expect(screen.queryByTestId("exam-finish-message")).toBeNull();
  // And the finish page is still the finish page, so the absence above is
  // an absent block rather than an unreached screen.
  expect(screen.getByText(/results for this test are not shown here/i)).toBeVisible();
});

it("treats an empty message as no message, the way the start message does", async () => {
  // The builder deletes the key rather than storing "" (`withMessage`), but
  // an imported `pariksha/test@1` document can carry one — and an empty
  // paragraph between the facts and the note is a gap nobody wrote.
  await finishMessaged("");
  expect(screen.queryByTestId("exam-finish-message")).toBeNull();
});

it("renders the message as text, never as markup", async () => {
  // Organiser-authored free text landing on a candidate's screen. The
  // payload is an `onerror` that fires the moment the element is parsed
  // into the document, so the surviving `<img>` is the assertion — not the
  // alert, which jsdom would swallow.
  const payload = '<img src=x onerror="alert(1)">bye';
  await finishMessaged(payload);
  expect(await screen.findByText(payload)).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
});

it("the finish page has no axe violations", async () => {
  await openTheDialog(client({ submit: () => Promise.resolve({ receipt, released: null }) }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));
  await screen.findByRole("heading", { name: /submitted/i });

  expect(await axe(document.body)).toHaveNoViolations();
});

// --- AC-16: the browser renders what it was given, and no more ----------

const scoreOnly: ReleasedResult = {
  show: "score_only",
  total: 31,
  max: 40,
  percent: 77.5,
  passed: true,
  pending: [],
};

const withSections: ReleasedResult = {
  ...scoreOnly,
  show: "score_and_sections",
  sections: [{ sectionId: "logic", title: "Logic", points: 31, max: 40 }],
};

const withReview: ReleasedResult = {
  ...withSections,
  show: "full_review",
  review: [
    {
      questionId: "q1",
      yourAnswer: { kind: "option", option: "a" },
      correct: "a",
      explanation: "Because the first option says so.",
      points: 1,
    },
  ],
};

const finishWith = async (released: ReleasedResult | null): Promise<void> => {
  await openTheDialog(client({ submit: () => Promise.resolve({ receipt, released }) }));
  await click(screen.getByRole("button", { name: /submit and finish/i }));
  await screen.findByRole("heading", { name: /submitted/i });
};

it("AC-16: a score_only payload renders the score and no section table", async () => {
  await finishWith(scoreOnly);
  expect(screen.getByRole("heading", { name: /your result/i })).toBeVisible();
  expect(screen.getByText("31")).toBeVisible();
  expect(screen.getByText(/passed/i)).toBeVisible();
  // The table is absent because the key is absent, not because a flag
  // hid it — there is no flag.
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(/correct answer/i)).toBeNull();
});

it("AC-16: a score_and_sections payload renders the table and no review", async () => {
  await finishWith(withSections);
  const table = screen.getByRole("table");
  expect(within(table).getByText("Logic")).toBeVisible();
  expect(screen.queryByText(/correct answer/i)).toBeNull();
  expect(screen.queryByText(/because the first option/i)).toBeNull();
});

it("AC-16: a full_review payload renders the correct answer and the explanation", async () => {
  await finishWith(withReview);
  expect(screen.getByRole("table")).toBeVisible();
  expect(screen.getByText(/correct answer/i)).toBeVisible();
  await waitFor(() => {
    expect(screen.getByText(/because the first option says so/i)).toBeVisible();
  });
});

it("a null pass mark is no verdict at all, not a failure", async () => {
  await finishWith({ ...scoreOnly, passed: null });
  expect(screen.queryByText(/^passed$|^not passed$/i)).toBeNull();
  expect(screen.getByText("31")).toBeVisible();
});

it("a pending question says the score may still rise", async () => {
  await finishWith({ ...scoreOnly, pending: ["q3"] });
  expect(screen.getByText(/waiting to be marked by a person/i)).toBeVisible();
});

// --- the reload after submitting ----------------------------------------

it("a reload after submitting resumes to the finish page, not to a live paper", async () => {
  // `GET /run/attempt` serves a submitted attempt's paper in full — the
  // cookie outlives the deadline so the receipt can be re-read — so a
  // `boot()` that only looked at "is there a paper" put the candidate back
  // on a counting-down screen whose every save is a 409, with the restored
  // queue replaying into refusals behind it.
  const submit = vi.fn(() => Promise.resolve({ receipt, released: scoreOnly }));
  const putAnswer = vi.fn(() => Promise.reject(new Error("a submitted attempt saves nothing")));
  render(
    <ExamApp
      client={client({ resume: () => Promise.resolve({ ...paper, submittedAt: NOW }), submit, putAnswer })}
    />,
  );

  await screen.findByRole("heading", { name: /submitted/i });
  // The receipt, and the result the same server gate released with it.
  expect(screen.getByText("att_finish01")).toBeVisible();
  expect(screen.getByText(/attempt 2 of 3/i)).toBeVisible();
  expect(screen.getByRole("heading", { name: /your result/i })).toBeVisible();
  // And no paper: no palette, no clock, no Submit, and nothing queued.
  expect(screen.queryByRole("navigation", { name: /question palette/i })).toBeNull();
  expect(screen.queryByRole("timer")).toBeNull();
  expect(screen.queryByRole("button", { name: /submit test/i })).toBeNull();
  expect(putAnswer).not.toHaveBeenCalled();
});

it("the full review has no axe violations at 200% text", async () => {
  // The runner's own text-size control acts through a root attribute, so
  // the finish page inherits whatever the candidate left it at.
  document.documentElement.setAttribute("data-font-scale", "1.5");
  try {
    await finishWith(withReview);
    expect(await axe(document.body)).toHaveNoViolations();
  } finally {
    document.documentElement.removeAttribute("data-font-scale");
  }
});
