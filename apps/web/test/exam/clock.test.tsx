// The candidate's countdown (#73, P6.9) — **Review Focus 4**.
//
// The whole point of this file is one assertion: *moving the system clock
// does not move the countdown*. A timer written as
// `deadlineAt - Date.now()` passes every other test here and fails that
// one, and in production it hands a candidate either an hour of free time
// or a sudden panic the moment a laptop corrects its clock, wakes from
// sleep, or is deliberately changed.
//
// So `Date` and `performance` are faked **separately**: `vi.useFakeTimers`
// is told exactly what to take over (`Date`, and the timer functions the
// component really uses) and `performance.now` is stubbed by hand. A test
// that let one tool drive both could not tell the two clocks apart, which
// is the only thing this file exists to do.
//
// No wall-clock assertions anywhere: every elapsed millisecond here is one
// this file moved on purpose.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Clock, anchorFrom, formatRemaining, reanchor } from "../../src/components/exam/Clock";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper } from "../../src/lib/paper";
import type { Receipt, RunClient } from "../../src/lib/run";
import { SAVE_DEBOUNCE_MS, queueStorageKey } from "../../src/lib/queue";
import { RESULT_STUB } from "./run-client-stub";

const MINUTE = 60_000;
const STYLES = dirname(fileURLToPath(import.meta.url));
const EXAM_CSS = resolve(STYLES, "../../src/styles/exam.css");
const TOKENS_CSS = resolve(STYLES, "../../src/styles/tokens.css");

/** The monotonic clock, under this file's control. */
let mono = 0;

beforeEach(() => {
  mono = 0;
  // Deliberately NOT faking `performance`: the two clocks have to be
  // movable independently or Review Focus 4 cannot be tested at all.
  vi.useFakeTimers({
    toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"],
  });
  vi.spyOn(performance, "now").mockImplementation(() => mono);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.style.fontSize = "";
  // The save queue lives in `localStorage`, and the zero tests below seed
  // it on purpose: a leftover row is another test's unsent answer.
  localStorage.clear();
});

/** Real elapsed time: the monotonic clock and the interval together. */
function advance(ms: number): void {
  act(() => {
    mono += ms;
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Settle the app on **this file's clock**: flush the microtasks a promise
 * is waiting on, and run `ms` of the timers the save queue schedules.
 *
 * The tests below that drive `ExamApp` used to hand the clock back with
 * `vi.useRealTimers()` and wait on `findBy*`/`waitFor`. That is a race,
 * and a losing one: @testing-library's `asyncUtilTimeout` is **1 s**, a
 * far tighter bar than this package's 10 s `testTimeout`, and the step
 * being waited on contains the queue's own 800 ms `SAVE_DEBOUNCE_MS`
 * window. Two hundred milliseconds of margin is not a test, it is a coin
 * toss that a loaded run loses — measured failing in every loaded run of
 * the full gate and passing in every run of this file alone.
 *
 * So no wall-clock anywhere: the debounce is *advanced*, not waited for,
 * and every query below is a synchronous `getBy*`. Same shape as
 * `autosave.test.tsx`'s `C-05`. `mono` deliberately does not move, so the
 * countdown reads the server's number rather than one a slow machine
 * ticked down on its own.
 */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** One edit's worth of the save queue: the debounce window and the
 *  response that re-anchors the clock behind it. */
const saved = (): Promise<void> => settle(SAVE_DEBOUNCE_MS + 50);

const timers = (): HTMLElement[] => screen.getAllByRole("timer");
const total = (): HTMLElement => timers()[0] as HTMLElement;
const shown = (chip: HTMLElement = total()): string =>
  chip.querySelector(".exam-timer-value")?.textContent ?? "";
const minutesShown = (chip: HTMLElement = total()): number =>
  Number(shown(chip).split(":").slice(0, -1).join(""));

const noop = () => undefined;

function renderClock(
  remainingMs = 45 * MINUTE,
  sectionRemainingMs: number | null = null,
  overrides: Partial<Parameters<typeof Clock>[0]> = {},
) {
  return render(
    <Clock
      anchor={anchorFrom(remainingMs, sectionRemainingMs)}
      warnAtMinutes={[10, 2]}
      onZero={noop}
      {...overrides}
    />,
  );
}

// --- Review Focus 4: the wall clock is never read -----------------------

describe("AC-13: the countdown is monotonic", () => {
  it("moving the system clock forward an hour does not move the countdown", () => {
    renderClock();
    const before = shown();
    expect(before).toBe("45:00");

    // A laptop correcting itself after sleep, a candidate changing the
    // clock on purpose: `Date.now()` jumps an hour and one real second
    // passes.
    vi.setSystemTime(Date.now() + 3_600_000);
    advance(1000);

    expect(shown()).not.toBe(before); // it ticked one second…
    expect(minutesShown()).toBe(44); // …and not an hour.
    expect(shown()).toBe("44:59");
  });

  it("moving the system clock BACKWARD does not stop or rewind it either", () => {
    renderClock();
    vi.setSystemTime(Date.now() - 6 * 3_600_000);
    advance(60_000);
    expect(shown()).toBe("44:00");
  });

  it("the countdown advances with performance.now(), one second per second", () => {
    renderClock();
    advance(60_000);
    expect(minutesShown()).toBe(44);
    expect(shown()).toBe("44:00");
  });

  it("a visibilitychange recomputes from the monotonic clock, never from the wall clock", () => {
    renderClock();
    // A background tab's interval is throttled, so the monotonic clock
    // moves without the interval firing. Coming back must correct it.
    act(() => {
      mono += 120_000;
      vi.setSystemTime(Date.now() + 3_600_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(shown()).toBe("43:00");
  });

  it("a server response re-anchors the countdown, correcting any drift", () => {
    const { rerender } = renderClock();
    advance(5 * MINUTE);
    expect(shown()).toBe("40:00");

    rerender(
      <Clock anchor={anchorFrom(10 * MINUTE, null)} warnAtMinutes={[10, 2]} onZero={noop} />,
    );
    expect(shown()).toBe("10:00");
  });

  it("re-anchoring from a save carries the section clock forward rather than inventing one", () => {
    const first = anchorFrom(45 * MINUTE, 15 * MINUTE);
    mono += 5 * MINUTE;
    // What a save answers: the paper's remaining time, and nothing about
    // the section (the route carries only `remainingMs`).
    const next = reanchor(first, 40 * MINUTE);

    expect(next.remainingMs).toBe(40 * MINUTE);
    expect(next.sectionRemainingMs).toBe(10 * MINUTE);
    expect(next.at).toBe(mono);
  });

  it("a null section stays null through a re-anchor", () => {
    expect(reanchor(anchorFrom(45 * MINUTE, null), 40 * MINUTE).sectionRemainingMs).toBeNull();
  });
});

// --- the warning marks ---------------------------------------------------

describe("C-07: the warning marks", () => {
  it("the chip swaps once at each warning mark, and the last one is urgent", () => {
    renderClock();
    expect(total()).toHaveAttribute("data-warn", "0");
    expect(total()).not.toHaveClass("timer-chip-urgent");

    advance(35 * MINUTE); // ten minutes left: the first mark
    expect(total()).toHaveAttribute("data-warn", "1");
    expect(total()).not.toHaveClass("timer-chip-urgent");

    advance(8 * MINUTE); // two minutes left: the last mark
    expect(total()).toHaveAttribute("data-warn", "2");
    expect(total()).toHaveClass("timer-chip-urgent");
  });

  it("the swap carries a non-colour mark, which is what a greyscale reader sees", () => {
    renderClock();
    expect(total().querySelector(".exam-timer-mark")).toBeNull();
    advance(35 * MINUTE);
    expect(total().querySelector(".exam-timer-mark")?.textContent).toBe("!");
    advance(8 * MINUTE);
    expect(total().querySelector(".exam-timer-mark")?.textContent).toBe("!!");
  });

  it("a warning is announced in words as well as colour", () => {
    renderClock();
    const announce = screen.getByRole("status", { name: /time warnings/i });
    // Present from the first render, and silent until there is something
    // to say: a live region a screen reader has never seen is one it does
    // not announce.
    expect(announce).toBeInTheDocument();
    expect(announce.textContent).toBe("");

    advance(35 * MINUTE);
    expect(announce).toHaveTextContent(/10 minutes remaining/i);
    advance(8 * MINUTE);
    expect(announce).toHaveTextContent(/2 minutes remaining/i);
  });

  it("the section's own marks fire on the section's own time, not the paper's", () => {
    renderClock(45 * MINUTE, 10 * MINUTE);
    const [whole, section] = timers() as [HTMLElement, HTMLElement];

    // The section is at its first mark the moment it starts; the paper is
    // nowhere near one.
    expect(section).toHaveAttribute("data-warn", "1");
    expect(whole).toHaveAttribute("data-warn", "0");

    advance(8 * MINUTE);
    expect(section).toHaveClass("timer-chip-urgent");
    expect(whole).not.toHaveClass("timer-chip-urgent");
    expect(screen.getByRole("status", { name: /time warnings/i })).toHaveTextContent(
      /2 minutes remaining in this section/i,
    );
  });

  it("the marks come from the version, in whatever order the organiser listed them", () => {
    render(
      <Clock anchor={anchorFrom(45 * MINUTE, null)} warnAtMinutes={[1, 20]} onZero={noop} />,
    );
    advance(25 * MINUTE); // twenty minutes left: the organiser's first mark
    expect(total()).toHaveAttribute("data-warn", "1");
    expect(screen.getByRole("status", { name: /time warnings/i })).toHaveTextContent(
      /20 minutes remaining/i,
    );
  });
});

// --- zero ----------------------------------------------------------------

describe("C-07: zero", () => {
  it("onZero fires exactly once at zero", () => {
    const onZero = vi.fn();
    renderClock(45 * MINUTE, null, { onZero });

    advance(44 * MINUTE);
    expect(onZero).not.toHaveBeenCalled();

    advance(MINUTE + 5_000);
    expect(onZero).toHaveBeenCalledTimes(1);

    // And it stays fired: the clock going further past zero must not
    // submit twice.
    advance(60_000);
    expect(onZero).toHaveBeenCalledTimes(1);
  });

  it("a save that re-anchors AT zero does not submit a second time", async () => {
    // The production path the guard exists for, and the one a
    // time-advancing test cannot reach: `onZero` drains the queue, the
    // drain's own save answers `remainingMs: 0`, the attempt view
    // re-anchors from it — and a fresh anchor is a fresh render with a
    // fresh `at`. Without the once-per-mount guard that is a second
    // submission from a candidate who has already finished.
    const onZero = vi.fn();
    const { rerender } = renderClock(1000, null, { onZero });
    advance(2000);
    expect(onZero).toHaveBeenCalledTimes(1);

    mono += 500;
    rerender(<Clock anchor={anchorFrom(0, null)} warnAtMinutes={[10, 2]} onZero={onZero} />);
    advance(1000);
    expect(onZero).toHaveBeenCalledTimes(1);
  });

  it("the countdown floors at zero rather than counting down into negatives", () => {
    renderClock(MINUTE);
    advance(5 * MINUTE);
    expect(shown()).toBe("0:00");
  });

  it("onSectionZero fires when the SECTION runs out, and the paper's clock keeps going", () => {
    const onZero = vi.fn();
    const onSectionZero = vi.fn();
    renderClock(45 * MINUTE, 10 * MINUTE, { onZero, onSectionZero });

    advance(10 * MINUTE);
    expect(onSectionZero).toHaveBeenCalledTimes(1);
    expect(onZero).not.toHaveBeenCalled();
    expect(shown()).toBe("35:00");
  });

  it("a paper with no section clock never fires onSectionZero", () => {
    const onSectionZero = vi.fn();
    renderClock(MINUTE, null, { onSectionZero });
    advance(5 * MINUTE);
    expect(onSectionZero).not.toHaveBeenCalled();
  });
});

// --- how it reads --------------------------------------------------------

describe("the chip, as a candidate reads it", () => {
  it("formats under an hour as MM:SS and over it as H:MM:SS", () => {
    expect(formatRemaining(45 * MINUTE)).toBe("45:00");
    expect(formatRemaining(90 * MINUTE)).toBe("1:30:00");
    expect(formatRemaining(59_999)).toBe("0:59");
    expect(formatRemaining(-1)).toBe("0:00");
  });

  it("section and total clocks sit side by side, each labelled, with no axe violations", async () => {
    const { container } = renderClock(45 * MINUTE, 15 * MINUTE);
    const [whole, section] = timers() as [HTMLElement, HTMLElement];

    expect(timers()).toHaveLength(2);
    // `timer` takes its name from the author, so each chip names itself —
    // and the name is a superset of the visible text (WCAG 2.5.3),
    // because the digits are one of the two things it points at.
    expect(whole).toHaveAccessibleName(/time left 45:00/i);
    expect(section).toHaveAccessibleName(/this section 15:00/i);
    expect(within(whole).getByText("Time left")).toBeVisible();

    // axe-core is entirely timer-bound in jsdom (87 `setTimeout` hops for
    // one run, #161), so it never resolves while this file owns
    // `setTimeout`. The monotonic stub stays, so the clock reads the same
    // through both passes.
    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "32px";
    expect(await axe(container)).toHaveNoViolations();
  });

  it("there is one timer when the section has no limit of its own", () => {
    renderClock(45 * MINUTE, null);
    expect(timers()).toHaveLength(1);
  });

  it("DESIGN.md: the digits are tabular so the countdown does not jitter", () => {
    // `css: false` in this package's vitest config, so
    // `getComputedStyle(...).fontVariantNumeric` is empty for every
    // element and the real file is what gets read — the same way
    // `testbuilder/timing.test.tsx` asserts its own figure class.
    const css = readFileSync(EXAM_CSS, "utf8");
    expect(css).toMatch(
      /\.exam-timer-value\s*\{[^}]*font-variant-numeric:\s*var\(--type-timer-numeric-font-variant-numeric\)/,
    );
    expect(readFileSync(TOKENS_CSS, "utf8")).toMatch(
      /--type-timer-numeric-font-variant-numeric:\s*tabular-nums/,
    );
  });

  it("DESIGN.md: the timer never animates or pulses, at any state", () => {
    renderClock(45 * MINUTE, 15 * MINUTE);
    advance(43 * MINUTE);
    for (const chip of timers()) {
      expect(getComputedStyle(chip).animationName).toBe("none");
      expect(getComputedStyle(chip).transitionDuration).toBe("0s");
    }
    // And the stylesheet itself declares none, which is what would still
    // be true if jsdom ever grew a cascade.
    const rules = readFileSync(EXAM_CSS, "utf8").match(/\.exam-timer[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/transition|animation/);
  });
});

// --- reachability: the clock on the real runner, from the app root ------

/** A resumed attempt, so `ExamApp` goes straight to the runner the way
 *  `C-06` says it does. */
const resumedPaper: AttemptPaper = {
  attemptId: "att_clock",
  sections: [
    {
      id: "logic",
      title: "Logic",
      instructions: null,
      timeLimitMinutes: 15,
      questions: [
        { id: "q1", type: "short_answer", prompt: "Question 1 stem", points: 1, maxLength: 200 },
        { id: "q2", type: "single", prompt: "Question 2 stem", points: 1 },
      ],
    },
  ],
  responses: {},
  clientSeq: 0,
  navigation: "free",
  maxIndex: 0,
  remainingMs: 45 * MINUTE,
  sectionRemainingMs: 15 * MINUTE,
  warnAtMinutes: [10, 2],
  lateSyncGraceSeconds: 30,
  allowCalculator: false,
  serverNow: 1_760_000_000_000,
  submittedAt: null,
};

/** A `per_section` paper of two typable questions per section, one
 *  section per entry in `limits` — `C-07`'s auto-advance is only
 *  observable through a paper that has somewhere to advance *to*, twice,
 *  and `null` is a section with no `time_limit_minutes` at all. */
const sectionedPaper = (attemptId: string, limits: readonly (number | null)[]): AttemptPaper => ({
  ...resumedPaper,
  attemptId,
  navigation: "per_section",
  sections: limits.map((timeLimitMinutes, at) => ({
    id: `s${String(at)}`,
    title: `Section ${String(at + 1)}`,
    instructions: null,
    timeLimitMinutes,
    questions: [at * 2 + 1, at * 2 + 2].map((n) => ({
      id: `q${String(n)}`,
      type: "short_answer" as const,
      prompt: `Question ${String(n)} stem`,
      points: 1,
      maxLength: 200,
    })),
  })),
});

const threeSections = sectionedPaper("att_sections", [10, 10, 10]);
/** Timed → **untimed** → timed. `time_limit_minutes` is per section and
 *  optional, so this is a paper an organiser can really publish. */
const mixedSections = sectionedPaper("att_mixed", [10, null, 10, 10]);

function resumingClient(overrides: Partial<RunClient> = {}, paper = resumedPaper): RunClient {
  return {
    landing: () => Promise.reject(new Error("the runner reads no landing page")),
    access: () => Promise.reject(new Error("the runner passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("the runner sends no code")),
    form: () => Promise.reject(new Error("the runner reads no form")),
    register: () => Promise.reject(new Error("the runner registers nobody")),
    start: () => Promise.reject(new Error("this attempt is resumed, not started")),
    resume: () => Promise.resolve(paper),
    putAnswer: () => Promise.reject(new Error("nothing is saved here")),
    ...RESULT_STUB,
    ...overrides,
  };
}

describe("the clock is on the runner a candidate actually reaches", () => {
  it("resuming an attempt shows both clocks, reading the server's own numbers", async () => {
    render(<ExamApp client={resumingClient()} />);
    await settle();
    screen.getByRole("navigation", { name: /question palette/i });

    const [whole, section] = screen.getAllByRole("timer") as [HTMLElement, HTMLElement];
    expect(shown(whole)).toBe("45:00");
    expect(shown(section)).toBe("15:00");
  });

  it("a save re-anchors the countdown from the server's reading, not the browser's", async () => {
    const putAnswer = vi.fn().mockResolvedValue({ outcome: "accepted", remainingMs: 12 * MINUTE });
    render(<ExamApp client={resumingClient({ putAnswer })} />);
    await settle();
    screen.getByRole("navigation", { name: /question palette/i });

    // One real answer, through the real queue, through the real
    // transport — this is the wiring Task 8's `remainingMs` exists for,
    // and nothing else in the suite would notice it missing.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Delhi" } });
    await saved();
    expect(putAnswer).toHaveBeenCalled();
    expect(shown()).toBe("12:00");
  });

  it("C-07: the section clock fires once per SECTION, and the chip re-anchors to the new one", async () => {
    // Critical 2, from the app root. `useZeroOnce`'s guard is
    // once-per-mount — right for `onZero`, where a re-anchor at zero must
    // not submit twice (`M19`), and wrong for a section clock that
    // legitimately expires once per section: only section one ever fired.
    // Compounding it, `reanchor` carried `sectionRemainingMs` *downward*
    // only and a save carried no section reading at all, so the chip read
    // `0:00` for the rest of the paper while still counting the section
    // the candidate had already left.
    // Thirty seconds: the chip must read the section's own number back,
    // and `mono` never moves here, so what is asserted is what the server
    // sent rather than whatever a slow machine ticked it down to.
    const readings = [30_000, 0];
    const putAnswer = vi.fn(() =>
      Promise.resolve({
        outcome: "accepted" as const,
        remainingMs: 44 * MINUTE,
        maxIndex: 0,
        sectionRemainingMs: readings.shift() ?? 0,
      }),
    );
    // Section one is already over at mount, which is what a resume into an
    // expired section really looks like.
    render(
      <ExamApp client={resumingClient({ putAnswer }, { ...threeSections, sectionRemainingMs: 0 })} />,
    );
    await settle();
    screen.getByRole("navigation", { name: /question palette/i });

    // Boundary one: the candidate is moved to the first question of
    // section two rather than left on a question every save refuses.
    expect(screen.getByText("Question 3 stem")).toBeVisible();

    // The save re-anchors the section chip on to section two's own clock.
    // Carried forward from the previous anchor it would still read 0:00.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Delhi" } });
    await saved();
    const [, section] = screen.getAllByRole("timer") as [HTMLElement, HTMLElement];
    expect(shown(section)).toBe("0:30");

    // Boundary two: section two runs out in its turn. A guard that never
    // re-armed would leave the candidate here for the rest of the paper.
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    await settle();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Mumbai" } });
    await saved();
    expect(screen.getByText("Question 5 stem")).toBeVisible();
  });

  it("C-07: a section with NO time limit does not disarm every section after it", async () => {
    // Critical 2 one section further on. The re-arm held the last
    // anchored reading and required it to be non-null, so an untimed
    // section stored `null` and every later rise failed the comparison:
    // `fired` stayed latched from the first boundary and nothing after
    // the untimed section ever auto-advanced. A candidate on a
    // timed → untimed → timed paper sat on a question every save refused
    // for the rest of the attempt.
    // Section two is untimed, so its save reports `null`; section three's
    // reports a clock the server already has at zero.
    const readings: (number | null)[] = [null, 0];
    const putAnswer = vi.fn(() =>
      Promise.resolve({
        outcome: "accepted" as const,
        remainingMs: 44 * MINUTE,
        maxIndex: 0,
        sectionRemainingMs: readings.shift() ?? null,
      }),
    );
    render(
      <ExamApp
        client={resumingClient({ putAnswer }, { ...mixedSections, sectionRemainingMs: 0 })}
      />,
    );
    await settle();
    screen.getByRole("navigation", { name: /question palette/i });

    // Boundary one, out of timed section one — the half that already
    // worked.
    expect(screen.getByText("Question 3 stem")).toBeVisible();

    // A save inside the untimed section: there is no section chip to
    // show, and nothing auto-advances out of it, which is correct.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Delhi" } });
    await saved();
    expect(putAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("timer")).toHaveLength(1);
    expect(screen.getByText("Question 3 stem")).toBeVisible();

    // The candidate walks out of it themselves, into timed section three.
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    await settle();
    expect(screen.getByText("Question 5 stem")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Mumbai" } });
    await saved();

    // Boundary two, across the untimed section. Latched, this never
    // happens and the candidate stays on question 5.
    expect(screen.getByText("Question 7 stem")).toBeVisible();
  });

  it("the paper's own clock still fires exactly once, however the section clock re-arms", async () => {
    // `M19` is the other half of the same guard and must keep working:
    // `onZero` drains the queue, the drain's own save answers
    // `remainingMs: 0`, and a second firing is a second submission from a
    // candidate who has already finished. The section's re-arm must not
    // reach it.
    const onZero = vi.fn();
    const { rerender } = render(
      <Clock
        anchor={anchorFrom(0, 0)}
        warnAtMinutes={[10, 2]}
        onZero={onZero}
        onSectionZero={noop}
      />,
    );
    advance(1000);
    expect(onZero).toHaveBeenCalledTimes(1);

    // A fresh anchor whose SECTION reading has risen — the event that
    // re-arms the section guard — while the paper is still at zero.
    mono += 500;
    rerender(
      <Clock
        anchor={anchorFrom(0, 30_000)}
        warnAtMinutes={[10, 2]}
        onZero={onZero}
        onSectionZero={noop}
      />,
    );
    advance(1000);
    expect(onZero).toHaveBeenCalledTimes(1);
  });

  it("a refusal carries no reading, and the countdown is left where it was", async () => {
    // Task 8 deviation 4: `remainingMs` is **absent** on a refusal. The
    // clock must not re-anchor to an invented zero.
    const putAnswer = vi
      .fn()
      .mockResolvedValue({ outcome: "refused", message: "Your time for this test is up." });
    render(<ExamApp client={resumingClient({ putAnswer })} />);
    await settle();
    screen.getByRole("navigation", { name: /question palette/i });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Delhi" } });
    await saved();
    expect(putAnswer).toHaveBeenCalled();
    expect(shown()).toBe("45:00");
    expect(screen.getByRole("alert")).toHaveTextContent(/time for this test is up/i);
  });
});

// --- C-07: zero, from the app root --------------------------------------
//
// The half of `C-07` the clock cannot prove on its own. Every test in
// "C-07: zero" above renders `<Clock>` with a `vi.fn()` for `onZero`, so
// what the runner actually *does* at zero — drain the queue, then submit —
// was wired and reached by nothing: reverting `exam.tsx`'s `void finish()`
// to the `void queue.drain()` it replaced passed the whole web suite.

const receipt: Receipt = {
  attemptId: "att_clock",
  submittedAt: 1_760_000_000_000,
  answered: 1,
  unanswered: 1,
  total: 2,
  attemptNo: 1,
  attemptsAllowed: 1,
};

/** An answer made in time that never reached the server — in
 *  `localStorage`, which is where a reload really finds it. */
function queueAnswerFor(attemptId: string): void {
  localStorage.setItem(
    queueStorageKey(attemptId),
    JSON.stringify({
      seq: 4,
      saves: [
        { questionId: "q1", value: { kind: "text", text: "Delhi" }, clientSeq: 4, queuedAt: 0 },
      ],
    }),
  );
}

/** A resume at `deadline + 20 s`, inside the 30-second grace: the server
 *  has not materialised the timeout, so it serves the paper with no time
 *  left on it and the browser's own clock is at zero on arrival. */
const expired = { ...resumedPaper, remainingMs: 0, sectionRemainingMs: null };

describe("C-07: the countdown reaching zero ends the attempt", () => {
  it("drains the queue and THEN submits, from the runner a candidate is sitting on", async () => {
    const order: string[] = [];
    const putAnswer = vi.fn(async () => {
      order.push("save");
      await Promise.resolve();
      return { outcome: "accepted" as const };
    });
    const submit = vi.fn(async () => {
      order.push("submit");
      await Promise.resolve();
      return { receipt, released: null };
    });
    queueAnswerFor(expired.attemptId);

    render(<ExamApp client={resumingClient({ putAnswer, submit }, expired)} />);
    await settle(50);

    // Submitting first would close the attempt and the answer still in the
    // queue would come back a 409 — `AC-14`'s "zero lost answers" on the
    // one path the candidate is not there to retry.
    expect(order).toEqual(["save", "submit"]);
    // And the candidate lands on the finish page rather than on a paper
    // whose every save is now refused.
    expect(screen.getByRole("heading", { name: /submitted/i })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: /question palette/i })).toBeNull();
  });

  it("a refused auto-submit shows the reason and does NOT open a confirmation nobody asked for", async () => {
    // The candidate never pressed Submit — their clock ran out. Opening
    // the "Submit this test?" dialog here asks them to confirm something
    // they did not do, on top of a paper they can no longer write to.
    const submit = vi.fn(() => Promise.reject(new Error("The network dropped. Try again.")));
    render(<ExamApp client={resumingClient({ submit }, expired)} />);
    await settle(50);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/network dropped/i);
  });
});
