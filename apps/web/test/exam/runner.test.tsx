import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readResolvedCss } from "../css-chain";
import { ExamApp, REGISTRATION_TOKEN_KEY } from "../../src/routes/exam";
import { Runner } from "../../src/components/exam/Runner";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { LandingPayload, RunClient } from "../../src/lib/run";

// C-04, the runner shell. Task 7 brings the answer blocks, Task 8 the save
// banner and Task 9 the clock; this task owns everything around them, so
// `questionSlot`, `bannerSlot` and `clockSlot` are props and the tests
// drive them with stand-ins.
//
// `paper` is typed against `AttemptPaper` in `apps/web/src/lib/paper.ts`
// — the shape the server really answers with, imported rather than
// re-declared since the Phase 6 merge.
//
// No `@testing-library/user-event` in this workspace, by a decision this
// repo already made and documented (`test/authoring/reorder.test.tsx:44`,
// `test/exam/landing.test.tsx:88`). Where those files stopped at
// focus-then-click, these go further: every keyboard claim below
// dispatches a real `keydown` through `fireEvent.keyDown` on the real
// `document.activeElement`, and tab order is asserted against the
// document's own focusable sequence rather than simulated.

const NOW = 1_760_000_000_000;
const EXAM_CSS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/exam.css");

function question(n: number): CandidateQuestion {
  return { id: `q${String(n)}`, type: "single", prompt: `Question ${String(n)} stem`, points: 1 };
}

/** 17 questions over two sections — the paper the landing fixture
 * advertises, as a candidate who has just started it: `linear`, and
 * `maxIndex: 0`, so nothing is locked yet and question one is where they
 * are. `lockedProps()` below is the same paper later in the attempt, and
 * is what puts real `locked` squares on the board.
 *
 * Task 10 corrected the pairing here. The fixture used to carry
 * `maxIndex: 10` *and* `index: 0`, which under "no going back" is a
 * position a candidate cannot be in — the lock is on everything BEHIND
 * `maxIndex`, so a candidate at question one has `maxIndex` 0. */
const paper: AttemptPaper = {
  attemptId: "att_demo",
  sections: [
    {
      id: "logic",
      title: "Logic",
      instructions: null,
      timeLimitMinutes: 15,
      questions: [1, 2, 3, 4].map(question),
    },
    {
      id: "numeracy",
      title: "Numeracy",
      instructions: null,
      timeLimitMinutes: null,
      questions: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map(question),
    },
  ],
  responses: { q2: { kind: "option", option: "a" } },
  clientSeq: 0,
  navigation: "linear",
  maxIndex: 0,
  remainingMs: 45 * 60_000,
  sectionRemainingMs: 15 * 60_000,
  warnAtMinutes: [10, 5],
  lateSyncGraceSeconds: 120,
  allowCalculator: true,
  serverNow: NOW,
  submittedAt: null,
};

type Props = ComponentProps<typeof Runner>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    paper,
    index: 0,
    onIndex: vi.fn(),
    marked: new Set<string>(["q3"]),
    onToggleMark: vi.fn(),
    onClear: vi.fn(),
    questionSlot: (q: CandidateQuestion) => <p>{q.prompt}</p>,
    clockSlot: <span>44:59 left</span>,
    bannerSlot: <span>Saved</span>,
    ...overrides,
  };
}

/** The same paper later in the attempt: the candidate has reached
 * question 11, so questions 1-10 are behind the `linear` lock. `index`
 * moves with `maxIndex`, because the two are the same fact. */
function lockedProps(overrides: Partial<Props> = {}): Props {
  return props({ paper: { ...paper, maxIndex: 10 }, index: 10, ...overrides });
}

/** Focus then click — a focused native button's real Enter/Space
 * activation is a `click` in every browser, which is the repo's standing
 * reason for not carrying user-event. */
function activate(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

/** A real `keydown` on whatever currently has focus. */
function press(key: string): void {
  const target = document.activeElement ?? document.body;
  fireEvent.keyDown(target, { key });
}

const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]";

/** The document's own tab sequence, in document order. Nothing in the
 * runner sets a positive tabindex, so document order IS tab order — which
 * is the thing worth asserting, and is stronger than asking a simulated
 * Tab where it would have gone. */
function tabOrder(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) =>
      el.getAttribute("tabindex") !== "-1" && !el.matches(":disabled"),
  );
}

/**
 * The first square carrying `state` as one of its accessible-name words.
 * `\b` rather than a bare substring, because "unanswered" contains
 * "answered" and a substring match would read the wrong square — and a
 * square can legitimately carry two words at once ("current, marked" is
 * what a candidate marking the question they are on produces).
 */
function squareFor(state: string): HTMLElement {
  const nav = screen.getByRole("navigation", { name: /question palette/i });
  const square = within(nav)
    .getAllByRole("button")
    .find((el) => new RegExp(`\\b${state}\\b`, "i").test(el.getAttribute("aria-label") ?? ""));
  if (!square) throw new Error(`no palette square in state ${state}`);
  return square;
}

/** Marking is browser state (the plan's "Smaller calls" ruling), so the
 * owner of `marked` is the runner's parent. This stands in for it. */
function Harness({ initial = new Set<string>() }: { initial?: Set<string> }) {
  const [marked, setMarked] = useState<ReadonlySet<string>>(initial);
  const [index, setIndex] = useState(0);
  const toggle = (id: string) => {
    setMarked((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  return <Runner {...props({ index, onIndex: setIndex, marked, onToggleMark: toggle })} />;
}

afterEach(() => {
  // `data-font-scale` / `data-contrast` live on <html>, which no cleanup()
  // resets — a leaked attribute makes the next test's assertion pass for
  // the wrong reason.
  delete document.documentElement.dataset.fontScale;
  delete document.documentElement.dataset.contrast;
  document.documentElement.style.fontSize = "";
  localStorage.clear();
});

describe("the runner shell (C-04)", () => {
  it("C-04: the runner shows the question panel, the numbered palette and the four controls", () => {
    render(<Runner {...props()} />);
    expect(screen.getByRole("navigation", { name: /question palette/i })).toBeVisible();
    for (const name of [/previous/i, /next/i, /mark for review/i, /clear answer/i]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(screen.getByText("Question 1 stem")).toBeVisible();
  });

  it("C-04: the palette numbers every question and marks the current one", () => {
    render(<Runner {...props()} />);
    expect(screen.getAllByRole("button", { name: /question \d+/i })).toHaveLength(17);
    expect(screen.getByRole("button", { name: /question 1 .*current/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("the clock and banner slots are rendered where the shell puts them", () => {
    render(<Runner {...props()} />);
    expect(screen.getByText("44:59 left")).toBeVisible();
    expect(screen.getByText("Saved")).toBeVisible();
  });

  it("DESIGN.md: every palette state carries a non-colour carrier a greyscale reader can see", () => {
    render(<Runner {...lockedProps()} />);
    for (const [state, carrier] of [
      ["answered", "is-filled"],
      ["marked", "has-notch"],
      ["current", "has-ring"],
      ["locked", "has-lock"],
    ] as const) {
      expect(squareFor(state)).toHaveClass(carrier);
      expect(squareFor(state)).toHaveAccessibleName(new RegExp(state, "i"));
    }
  });

  it("a carrier class is only a carrier if the stylesheet draws a shape for it", () => {
    // The four assertions above are satisfied by four class names that
    // render nothing. These are what make them mean something: a notch
    // and a lock are drawn geometry, and the ring is a border width, none
    // of which a greyscale reader loses.
    const css = readFileSync(EXAM_CSS, "utf8");
    expect(css).toMatch(/\.palette-square\.has-notch::after\s*\{[^}]*clip-path/);
    expect(css).toMatch(/\.palette-square\.has-lock::after\s*\{[^}]*border:/);
    expect(css).toMatch(/\.palette-square\.has-ring\s*\{[^}]*border-width/);
    expect(css).toMatch(/\.palette-square\.is-filled\s*\{[^}]*background/);
  });

  it("Mark for review toggles the palette state and the button's pressed state", () => {
    render(<Harness />);
    const mark = screen.getByRole("button", { name: /mark for review/i });
    expect(mark).toHaveAttribute("aria-pressed", "false");
    activate(mark);
    expect(screen.getByRole("button", { name: /mark for review/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(squareFor("marked")).toBeVisible();
    // The marked square is question 1 — the one the candidate is on — and
    // it keeps saying "current" too. A single-valued state would have lost
    // one of the two, in the commonest case there is.
    expect(squareFor("marked")).toHaveAccessibleName(/question 1 .*current.*marked/i);
    expect(squareFor("marked")).toHaveClass("has-ring", "has-notch");
  });

  it("Mark for review un-marks on a second press", () => {
    render(<Harness initial={new Set(["q1"])} />);
    activate(screen.getByRole("button", { name: /mark for review/i }));
    expect(screen.getByRole("button", { name: /mark for review/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Question 1 (current, unanswered)" })).not.toHaveClass(
      "has-notch",
    );
  });

  it("Clear answer asks before discarding, naming what is discarded (DESIGN.md: button-danger)", async () => {
    const onClear = vi.fn();
    const { container } = render(<Runner {...props({ onClear })} />);
    activate(screen.getByRole("button", { name: /clear answer/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/question 1/i);
    expect(onClear).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
    activate(within(dialog).getByRole("button", { name: /clear it/i }));
    expect(onClear).toHaveBeenCalledWith("q1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape refuses the confirmation and puts focus back on Clear answer", () => {
    const onClear = vi.fn();
    render(<Runner {...props({ onClear })} />);
    activate(screen.getByRole("button", { name: /clear answer/i }));
    expect(screen.getByRole("dialog")).toHaveFocus();
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /clear answer/i })).toHaveFocus();
  });

  it("Keep it refuses the confirmation too", () => {
    const onClear = vi.fn();
    render(<Runner {...props({ onClear })} />);
    activate(screen.getByRole("button", { name: /clear answer/i }));
    activate(within(screen.getByRole("dialog")).getByRole("button", { name: /keep it/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("Previous and Next move the index, and neither runs off the paper", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    activate(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Question 2 stem")).toBeVisible();
    expect(screen.getByRole("button", { name: /question 2 .*current/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
  });

  it("the whole runner is operable from the keyboard alone, including the palette", () => {
    const { container } = render(<Runner {...props()} />);
    const first = tabOrder(container)[0];
    // The first tab stop is deliberately NOT named after a question, so
    // an activation that moved no focus would leave `activeElement` on a
    // control whose name does not match the assertion below.
    expect(first).toHaveAccessibleName(/skip to the palette/i);
    expect(first).not.toHaveAccessibleName(/question/i);
    activate(first as HTMLElement);
    expect(document.activeElement).toHaveAccessibleName(/question 1/i);
  });

  it("nothing in the runner sits out of the tab order or jumps the queue", () => {
    const { container } = render(<Runner {...props()} />);
    const stops = tabOrder(container);
    // One stop for the whole rail, not seventeen: the APG's roving
    // tabindex. Seventeen stops between a candidate and their question is
    // a penalty for not using a mouse, not keyboard access.
    const squares = stops.filter((el) => el.className.includes("palette-square"));
    expect(squares).toHaveLength(1);
    for (const stop of stops) {
      expect(Number(stop.getAttribute("tabindex") ?? "0")).toBeLessThanOrEqual(0);
    }
  });

  it("arrow keys walk the palette and Enter jumps to the question", () => {
    const { container } = render(<Harness />);
    activate(tabOrder(container)[0] as HTMLElement);
    expect(document.activeElement).toHaveAccessibleName(/question 1/i);
    press("ArrowRight");
    expect(document.activeElement).toHaveAccessibleName(/question 2/i);
    press("ArrowDown");
    expect(document.activeElement).toHaveAccessibleName(/question 7/i);
    press("Home");
    expect(document.activeElement).toHaveAccessibleName(/question 1/i);
    press("End");
    expect(document.activeElement).toHaveAccessibleName(/question 17/i);
    press("ArrowRight");
    // End is the end: ArrowRight past it stays put rather than wrapping.
    expect(document.activeElement).toHaveAccessibleName(/question 17/i);
    activate(document.activeElement as HTMLElement);
    expect(screen.getByText("Question 17 stem")).toBeVisible();
    press("Home");
    press("ArrowRight");
    activate(document.activeElement as HTMLElement);
    expect(screen.getByText("Question 2 stem")).toBeVisible();
  });

  it("a locked question cannot be jumped to, and says so rather than going quiet", () => {
    const onIndex = vi.fn();
    render(<Runner {...lockedProps({ onIndex })} />);
    const locked = squareFor("locked");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked).toHaveAccessibleName(/locked/i);
    activate(locked);
    expect(onIndex).not.toHaveBeenCalled();
  });

  it("C-04: the font-size control scales the question stem and the choice persists across a remount", () => {
    render(<Runner {...props()} />);
    fireEvent.click(screen.getByRole("radio", { name: /large/i }));
    expect(document.documentElement).toHaveAttribute("data-font-scale", "1.5");
    cleanup();
    render(<Runner {...props()} />);
    expect(document.documentElement).toHaveAttribute("data-font-scale", "1.5");
  });

  it("the persisted font size is read back from storage, not left behind on <html>", () => {
    // The plan's own version above leans on the remount overwriting the
    // attribute with its own default (measured: it does, so that test is
    // not vacuous). This one does not lean on anything: the attribute is
    // deleted between the two renders, so only a real read-back can put
    // it there — and the radio's checked state is asserted too, which the
    // attribute alone never proves.
    render(<Runner {...props()} />);
    fireEvent.click(screen.getByRole("radio", { name: /large/i }));
    expect(localStorage.getItem("pariksha.view.fontScale")).toBe("1.5");
    cleanup();
    delete document.documentElement.dataset.fontScale;
    render(<Runner {...props()} />);
    expect(document.documentElement).toHaveAttribute("data-font-scale", "1.5");
    expect(screen.getByRole("radio", { name: /large/i })).toBeChecked();
  });

  it("the font scale really is wired to the question column, not just to an attribute", () => {
    // `css: false` means no stylesheet is applied in jsdom, so the
    // attribute assertions above cannot see whether anything is keyed off
    // it. This is the half that can fail.
    const css = readFileSync(EXAM_CSS, "utf8");
    expect(css).toMatch(/:root\[data-font-scale="1\.5"\]\s*\{\s*--exam-font-scale:\s*1\.5/);
    expect(css).toMatch(/\.exam-question\s*\{[^}]*--exam-font-scale/);
  });

  it("C-04: high contrast is a token swap and keeps every non-colour carrier", () => {
    render(<Runner {...props()} />);
    activate(screen.getByRole("switch", { name: /high contrast/i }));
    expect(document.documentElement).toHaveAttribute("data-contrast", "high");
    expect(squareFor("marked")).toHaveClass("has-notch");
    expect(screen.getByRole("switch", { name: /high contrast/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("high contrast is a token swap in CSS, so no component branches on it", () => {
    const css = readFileSync(EXAM_CSS, "utf8");
    expect(css).toMatch(/:root\[data-contrast="high"\]\s*\{[^}]*--color-hairline-strong:/);
    // DESIGN.md's high-contrast column: stronger hairlines, white for
    // cream, a darker muted, thicker edges and rings.
    for (const swapped of ["--color-hairline:", "--color-muted:", "--color-cream:", "--exam-ring:"]) {
      expect(css).toContain(swapped);
    }
  });

  it("DESIGN.md: nothing inside a live attempt animates", () => {
    const { container } = render(<Runner {...props()} />);
    for (const el of container.querySelectorAll("*")) {
      expect(getComputedStyle(el).transitionDuration).toBe("0s");
      expect(getComputedStyle(el).animationName).toBe("none");
    }
  });

  it("DESIGN.md: and the stylesheet itself declares no transition, animation or keyframes", () => {
    // The assertion above cannot fail: this package runs with
    // `css: false`, so jsdom applies no cascade and every element reports
    // the initial value whatever exam.css says (pre-flight scan, B-6a).
    // This is the one that actually guards "a candidate who thinks the
    // page reloaded thinks their answer was lost".
    //
    // Task 7 (#71): exam.css now @imports question.css, and a stylesheet
    // the candidate loads is in scope whichever file it lives in — so the
    // import chain is resolved rather than only the entry file read.
    const css = readResolvedCss(EXAM_CSS);
    expect(css).not.toMatch(/[\s;{]transition(-[a-z]+)?\s*:/);
    expect(css).not.toMatch(/[\s;{]animation(-[a-z]+)?\s*:/);
    expect(css).not.toMatch(/@keyframes/);
    // The positive control: the chain really did pull the imported file
    // in, or this would be a scan over a file with nothing in it.
    expect(css).toMatch(/\.reorderable-list__item\s*\{/);
  });

  it("the calculator appears only when the test allows it", () => {
    render(<Runner {...props({ paper: { ...paper, allowCalculator: false } })} />);
    expect(screen.queryByRole("button", { name: /calculator/i })).toBeNull();
  });

  it("the calculator opens from the runner when the test allows it", () => {
    render(<Runner {...props()} />);
    activate(screen.getByRole("button", { name: /^calculator$/i }));
    expect(screen.getByRole("dialog", { name: /calculator/i })).toBeVisible();
  });

  it("every control's accessible name is a superset of its visible label (WCAG 2.5.3)", () => {
    render(<Runner {...props()} />);
    const controls = screen.getAllByRole("button");
    expect(controls.length).toBeGreaterThan(20);
    for (const control of controls) {
      const visible = (control.textContent ?? "").replace(/\s+/g, " ").trim();
      if (visible === "") continue;
      const accessible = (control.getAttribute("aria-label") ?? visible)
        .replace(/\s+/g, " ")
        .trim();
      expect(accessible.toLowerCase(), visible).toContain(visible.toLowerCase());
    }
  });

  it("the positive control: Previous really does carry an aria-label that differs from its text", () => {
    // Without this the sweep above compares a value to itself for every
    // control that has no aria-label, and reverting an aria-label would
    // leave it green. `Previous` is a real instance of the rule: visible
    // "Previous", accessible "Previous question" — delete the attribute
    // and this lookup fails.
    render(<Runner {...props()} />);
    const previous = screen.getByRole("button", { name: "Previous question" });
    expect(previous.textContent).toBe("Previous");
    expect(previous).toHaveAttribute("aria-label", "Previous question");
    const square = screen.getByRole("button", { name: "Question 2 (answered)" });
    expect(square.textContent).toBe("2");
  });

  it("the runner has no axe violations at 100% and at 200% zoom", async () => {
    const { container } = render(<Runner {...props()} />);
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "32px";
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the runner has no axe violations in high contrast either", async () => {
    const { container } = render(<Runner {...props()} />);
    activate(screen.getByRole("switch", { name: /high contrast/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---- reachability: the app root, clicked to --------------------------------

const landing: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 17,
  sections: [{ id: "logic", title: "Logic", questionCount: 17, timeLimitMinutes: null }],
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

/** A registered candidate's client: the token is in `sessionStorage`
 * where the registration screen leaves it, and `start` refuses anything
 * else — a `start(undefined)` is the one failure the merge had to make
 * loud. */
function clientWithStart(): RunClient {
  sessionStorage.setItem(REGISTRATION_TOKEN_KEY, "reg_runner");
  return {
    landing: () => Promise.resolve(landing),
    start: (registrationToken) =>
      registrationToken === "reg_runner"
        ? Promise.resolve(paper)
        : Promise.reject(new Error(`start was given ${String(registrationToken)}`)),
    // Task 5's own widening: the five calls this screen never makes
    // reject rather than resolve, so a screen that starts making one
    // fails here instead of passing quietly.
    access: () => Promise.reject(new Error("the runner passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("the runner sends no code")),
    form: () => Promise.reject(new Error("the runner reads no form")),
    register: () => Promise.reject(new Error("the runner registers nobody")),
    // Task 8: `ExamApp` now asks for a resume before the landing page,
    // because `C-06` resumes a live attempt and `AC-14`'s queue only
    // drains once something mounts it. No attempt in this browser is the
    // ordinary first visit, and `null` is what the client answers with.
    resume: () => Promise.resolve(null),
    putAnswer: () => Promise.reject(new Error("the runner shell saves nothing")),
  };
}

/** The app root, started. The pre-submit checklist's first item: a screen
 * nobody can click their way to is a screen nobody sees. */
async function startFromRoot() {
  const view = render(<ExamApp client={clientWithStart()} />);
  activate(await screen.findByRole("button", { name: /^start/i }));
  await screen.findByRole("navigation", { name: /question palette/i });
  return view;
}

describe("the runner is reached from the candidate app's own root", () => {
  it("Start on the landing page opens the runner, palette and all", async () => {
    await startFromRoot();
    expect(screen.getAllByRole("button", { name: /question \d+/i })).toHaveLength(17);
    // Task 7 (#71): the stem now renders through the shared Markdown
    // renderer, which awaits a possible KaTeX import, so it lands a tick
    // after the palette does.
    expect(await screen.findByText("Question 1 stem")).toBeVisible();
  });

  it("marking a question from the root survives a reload, keyed by attempt id", async () => {
    const { unmount } = await startFromRoot();
    activate(screen.getByRole("button", { name: /mark for review/i }));
    expect(localStorage.getItem("pariksha.marked.att_demo")).toContain("q1");
    unmount();
    await startFromRoot();
    expect(screen.getByRole("button", { name: /mark for review/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clearing an answer from the root empties that question's palette square", async () => {
    await startFromRoot();
    activate(screen.getByRole("button", { name: /question 2 .*answered/i }));
    activate(screen.getByRole("button", { name: /clear answer/i }));
    activate(within(screen.getByRole("dialog")).getByRole("button", { name: /clear it/i }));
    expect(screen.getByRole("button", { name: /^question 2 /i })).not.toHaveClass("is-filled");
  });

  it("the calculator is reachable from the root, and axe is clean with it open", async () => {
    const { container } = await startFromRoot();
    activate(screen.getByRole("button", { name: /^calculator$/i }));
    expect(screen.getByRole("dialog", { name: /calculator/i })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the landing page is still the first screen, and axe is still clean there", async () => {
    const { container } = render(<ExamApp client={clientWithStart()} />);
    await screen.findByRole("heading", { level: 1, name: "Aptitude" });
    expect(screen.queryByRole("navigation", { name: /question palette/i })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
