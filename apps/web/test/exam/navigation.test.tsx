// What the interface does about a navigation rule the SERVER owns
// (#74, P6.10).
//
// The server refuses the write (`apps/api/test/run/navigation.test.ts`);
// everything here is about not making a candidate discover that the hard
// way, and about the refusal still being visible when the interface
// guessed wrong. Two rules drive the whole file:
//
//  * **"No going back", not "no looking forward".** `AC-14` puts the
//    whole paper in the browser, so the lock is on *returning*. Under
//    `linear` the squares BEHIND the candidate are closed and the ones
//    ahead are open; under `per_section` the sections already left are
//    closed and the current one is entirely open.
//  * **A locked control is inert, reachable and explained.** Disabled
//    states are this phase's blind spot: `aria-disabled` rather than
//    `disabled`, so a candidate can still land on the square and hear
//    why — and `onJump` really is not called, so "inert" is not a claim
//    about a class name.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { Runner, lockedIndices, paletteStates } from "../../src/components/exam/Runner";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { LandingPayload, RunClient } from "../../src/lib/run";

const NOW = 1_760_000_000_000;

const question = (n: number): CandidateQuestion => ({
  id: `q${String(n)}`,
  type: "single",
  prompt: `Question ${String(n)} stem`,
  points: 1,
});

/** Six questions over two sections of three — the shape the API fixture
 *  `alpha/per-section` has, so the two halves of this task are argued
 *  about the same paper. */
const base: AttemptPaper = {
  attemptId: "att_nav",
  sections: [
    {
      id: "logic",
      title: "Logic",
      instructions: null,
      timeLimitMinutes: 15,
      questions: [1, 2, 3].map(question),
    },
    {
      id: "quant",
      title: "Quant",
      instructions: null,
      timeLimitMinutes: 10,
      questions: [4, 5, 6].map(question),
    },
  ],
  responses: {},
  clientSeq: 0,
  navigation: "free",
  maxIndex: 0,
  remainingMs: 45 * 60_000,
  sectionRemainingMs: 15 * 60_000,
  warnAtMinutes: [10, 2],
  lateSyncGraceSeconds: 30,
  allowCalculator: false,
  serverNow: NOW,
  submittedAt: null,
};

const paperWith = (over: Partial<AttemptPaper>): AttemptPaper => ({ ...base, ...over });

function renderRunner(paper: AttemptPaper, index: number, onIndex = vi.fn()) {
  return {
    onIndex,
    ...render(
      <Runner
        paper={paper}
        index={index}
        onIndex={onIndex}
        marked={new Set<string>()}
        onToggleMark={vi.fn()}
        onClear={vi.fn()}
        questionSlot={(q) => <p>{q.prompt}</p>}
        clockSlot={<span>44:59 left</span>}
        bannerSlot={<span>Saved</span>}
      />,
    ),
  };
}

const square = (n: number): HTMLElement =>
  within(screen.getByRole("navigation", { name: /question palette/i })).getByRole("button", {
    name: new RegExp(`^Question ${String(n)} \\(`, "i"),
  });

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.style.fontSize = "";
});

// --- what is locked, as arithmetic --------------------------------------

describe("T-13: which questions a mode closes", () => {
  it("free closes nothing at all, however far the candidate has got", () => {
    expect(lockedIndices(paperWith({ navigation: "free", maxIndex: 5 })).size).toBe(0);
  });

  it("linear closes everything BEHIND the candidate and nothing ahead", () => {
    const locked = lockedIndices(paperWith({ navigation: "linear", maxIndex: 3 }));
    expect([...locked].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    // Looking forward is the half `AC-14` makes impossible to withhold:
    // the whole paper is already in the browser.
    expect(locked.has(4)).toBe(false);
  });

  it("per_section closes whole sections, and leaves the current one entirely open", () => {
    const locked = lockedIndices(paperWith({ navigation: "per_section", maxIndex: 4 }));
    expect([...locked].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    // Including the question BEFORE the candidate inside their own
    // section, which is exactly what `linear` would have closed.
    expect(locked.has(3)).toBe(false);
  });

  it("the squares carry answered and locked at once, because a linear paper is both", () => {
    const paper = paperWith({
      navigation: "linear",
      maxIndex: 3,
      responses: { q2: { kind: "option", option: "a" } },
    });
    const states = paletteStates(paper, new Set(["q3"]), 3);

    // A single-valued state would have repainted the whole rail as
    // padlocks and lost everything the palette is for.
    expect(states[1]).toMatchObject({ number: 2, state: "answered", locked: true });
    expect(states[2]).toMatchObject({ number: 3, state: "marked", locked: true });
    expect(states[3]).toMatchObject({ number: 4, state: "unanswered", current: true });
    expect(states[3]?.locked).toBeUndefined();
  });
});

// --- the rail -------------------------------------------------------------

describe("AC-15: the palette draws the lock", () => {
  it("linear: locked squares carry a lock glyph and say so in their name", () => {
    renderRunner(paperWith({ navigation: "linear", maxIndex: 3 }), 3);

    expect(square(1)).toHaveClass("has-lock");
    expect(square(1)).toHaveAccessibleName(/question 1 .*locked/i);
    expect(square(5)).not.toHaveClass("has-lock");
  });

  it("linear: Previous is absent, not merely disabled, when the question behind is locked", () => {
    renderRunner(paperWith({ navigation: "linear", maxIndex: 3 }), 3);
    expect(screen.queryByRole("button", { name: /previous/i })).toBeNull();
    // Next is untouched: forward is never the thing a mode forbids.
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("the rule is the general one — Previous goes exactly when the target is locked", () => {
    // Not a `navigation === "linear"` special case. On a `per_section`
    // paper the candidate's own section is free, so Previous is there in
    // the middle of it and gone at its first question, where the target
    // is the section they have left.
    const inside = renderRunner(paperWith({ navigation: "per_section", maxIndex: 4 }), 4);
    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
    inside.unmount();

    renderRunner(paperWith({ navigation: "per_section", maxIndex: 3 }), 3);
    expect(screen.queryByRole("button", { name: /previous/i })).toBeNull();
  });

  it("per_section: squares in a left section are inert, and announce why", () => {
    const { onIndex } = renderRunner(paperWith({ navigation: "per_section", maxIndex: 4 }), 4);

    const locked = square(1);
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveAccessibleDescription(/section is closed/i);

    // Genuinely inert, not merely styled: this is the finding two
    // consecutive UI tasks produced.
    fireEvent.click(locked);
    expect(onIndex).not.toHaveBeenCalled();
  });

  it("linear names its own rule, not the section one", () => {
    renderRunner(paperWith({ navigation: "linear", maxIndex: 3 }), 3);
    expect(square(1)).toHaveAccessibleDescription(/going back to an earlier question/i);
  });

  it("a free paper offers no lock, no reason and no missing control", () => {
    renderRunner(paperWith({ navigation: "free", maxIndex: 5 }), 2);
    expect(square(1)).not.toHaveAttribute("aria-disabled");
    expect(square(1)).toHaveAccessibleDescription("");
    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
  });

  it("a locked square is still reachable by keyboard — it is aria-disabled, not disabled", () => {
    renderRunner(paperWith({ navigation: "linear", maxIndex: 3 }), 3);
    const locked = square(1);
    expect(locked).not.toBeDisabled(); // `disabled` would take it out of the tab order…
    locked.focus();
    expect(document.activeElement).toBe(locked); // …and a candidate could never ask why.
  });

  it("the locked rail has no axe violations, at 100% and at 200% zoom", async () => {
    const { container } = renderRunner(paperWith({ navigation: "linear", maxIndex: 3 }), 3);
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "32px";
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the locked rail has no axe violations in high contrast either", async () => {
    const { container } = renderRunner(paperWith({ navigation: "per_section", maxIndex: 4 }), 4);
    fireEvent.click(screen.getByRole("switch", { name: /high contrast/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

// --- reachability: the root, and a refusal the interface did not predict --

const landing: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 6,
  sections: [{ id: "logic", title: "Logic", questionCount: 6, timeLimitMinutes: null }],
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
  serverNow: NOW,
};

function client(paper: AttemptPaper, overrides: Partial<RunClient> = {}): RunClient {
  return {
    landing: () => Promise.resolve(landing),
    resume: () => Promise.resolve(paper),
    start: () => Promise.resolve(paper),
    access: () => Promise.reject(new Error("the runner passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("the runner sends no code")),
    form: () => Promise.reject(new Error("the runner reads no form")),
    register: () => Promise.reject(new Error("the runner registers nobody")),
    putAnswer: () => Promise.reject(new Error("nothing is saved here")),
    ...overrides,
  };
}

describe("the lock is what a candidate meets at the app's own root", () => {
  it("AC-15: a resumed linear attempt opens where the candidate left off, not on a dead question", async () => {
    // Question one is behind the lock on this paper. Opening there would
    // show an input whose every save the server refuses — a dead screen,
    // on the one page a candidate cannot leave.
    render(<ExamApp client={client(paperWith({ navigation: "linear", maxIndex: 3 }))} />);
    await screen.findByRole("navigation", { name: /question palette/i });

    // The stem renders through the shared Markdown renderer, which
    // awaits a possible KaTeX import, so it lands a tick after the palette.
    expect(await screen.findByText("Question 4 stem")).toBeVisible();
    expect(square(1)).toHaveClass("has-lock");
    expect(screen.queryByRole("button", { name: /previous/i })).toBeNull();
  });

  it("a resumed free attempt still opens at question one", async () => {
    render(<ExamApp client={client(paperWith({ navigation: "free", maxIndex: 3 }))} />);
    await screen.findByRole("navigation", { name: /question palette/i });
    expect(await screen.findByText("Question 1 stem")).toBeVisible();
  });

  it("a server 403 the interface did not predict is shown, not swallowed", async () => {
    // The server is the authority and the browser's copy of the rule is a
    // convenience. When the two disagree — a stale `maxIndex`, a second
    // tab that moved on — the candidate must be told, never told "Saved".
    const putAnswer = vi.fn().mockResolvedValue({
      outcome: "refused",
      message: "This test does not allow going back to an earlier question.",
    });
    const paper = paperWith({
      navigation: "free",
      maxIndex: 0,
      sections: [
        {
          id: "logic",
          title: "Logic",
          instructions: null,
          timeLimitMinutes: null,
          questions: [
            { id: "q1", type: "short_answer", prompt: "Question 1 stem", points: 1, maxLength: 200 },
          ],
        },
      ],
    });
    render(<ExamApp client={client(paper, { putAnswer })} />);
    await screen.findByRole("navigation", { name: /question palette/i });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Delhi" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/going back/i);
    expect(screen.getByRole("status", { name: /save status/i })).toHaveTextContent(/not saved/i);
    await waitFor(() => {
      expect(putAnswer).toHaveBeenCalled();
    });
  });
});
