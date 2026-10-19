// `C-05`'s save banner, and the wiring that puts it in front of a real
// candidate (#72, P6.8).
//
// Four states, and a candidate stares at them when the network drops.
// Each carries a **word** and a mono **mark**, never a colour alone
// (`DESIGN.md`: "Colour is never the only carrier here") — so the tests
// below assert on text, which is the thing that survives greyscale, a
// forced-colours mode and a screen reader alike.
//
// The reachability half is the point the pre-submit checklist keeps
// making: the banner is rendered directly here *and* clicked to from
// `ExamApp`, because a component nobody can reach is a component nobody
// sees. The last block types an answer into the real runner and watches
// the real queue carry it to a real `putAnswer`.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveBanner } from "../../src/components/exam/SaveBanner";
import { SAVE_DEBOUNCE_MS, queueStorageKey, type SaveState } from "../../src/lib/queue";
import { ExamApp, REGISTRATION_TOKEN_KEY } from "../../src/routes/exam";
import type { AttemptPaper } from "../../src/lib/paper";
import type { LandingPayload, QueuedSave, RunClient, SaveOutcome } from "../../src/lib/run";

const NOW = 1_760_000_000_000;

afterEach(() => {
  cleanup();
  document.documentElement.style.fontSize = "";
  localStorage.clear();
  sessionStorage.clear();
});

// --- the four states -----------------------------------------------------

const STATES: [SaveState, RegExp][] = [
  [{ kind: "saving", pending: 1 }, /saving/i],
  [{ kind: "saved", at: NOW }, /saved/i],
  [{ kind: "offline", pending: 3 }, /offline.*3/i],
  [{ kind: "refused", questionId: "A", message: "Time is up." }, /not saved/i],
];

it.each(STATES)("C-05: the banner states %j", (state, text) => {
  render(<SaveBanner state={state} />);
  expect(screen.getByRole("status")).toHaveTextContent(text);
});

it("the banner is a live region, and the refused state is an alert, not a status", () => {
  const { rerender } = render(<SaveBanner state={{ kind: "idle" }} />);
  // Present from the first render rather than inserted with its content:
  // a live region a screen reader has never seen is one it does not
  // announce.
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();

  rerender(
    <SaveBanner state={{ kind: "refused", questionId: "A", message: "Time is up." }} />,
  );
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Time is up.");
});

it("the banner carries a word, not only a colour, and has no axe violations", async () => {
  for (const [state] of STATES) {
    const { container, unmount } = render(<SaveBanner state={state} />);
    expect(screen.getByRole("status").textContent).toMatch(/\w/);
    expect(await axe(container)).toHaveNoViolations();
    unmount();
  }
});

it("no axe violations at 200% zoom either", async () => {
  const { container } = render(
    <SaveBanner state={{ kind: "refused", questionId: "A", message: "Time is up." }} />,
  );
  document.documentElement.style.fontSize = "32px";
  expect(await axe(container)).toHaveNoViolations();
});

it("every state is distinguishable without reading a colour", () => {
  // The real requirement: not "there is some text" but "the four texts
  // differ". A banner that said "Saved" in four colours would pass a
  // per-state assertion and fail a candidate who cannot see them.
  const words = new Set<string>();
  for (const [state] of STATES) {
    const { unmount } = render(<SaveBanner state={state} />);
    words.add(screen.getByRole("status").textContent ?? "");
    unmount();
  }
  expect(words.size).toBe(STATES.length);
});

it("each state also carries a mark that is not a word, for the glance", () => {
  const marks = new Set<string>();
  for (const [state] of STATES) {
    const { container, unmount } = render(<SaveBanner state={state} />);
    const mark = container.querySelector(".exam-save-mark");
    expect(mark).not.toBeNull();
    // Hidden from the accessibility tree: the word beside it already
    // says this, and announcing "exclamation mark" twice is noise.
    expect(mark).toHaveAttribute("aria-hidden", "true");
    marks.add(mark?.textContent ?? "");
    unmount();
  }
  expect(marks.size).toBe(STATES.length);
});

it("the offline state counts what is waiting, so a candidate knows how much is at stake", () => {
  render(<SaveBanner state={{ kind: "offline", pending: 7 }} />);
  expect(screen.getByRole("status")).toHaveTextContent(/7/);
});

it("idle says nothing, and still holds the live region open", () => {
  render(<SaveBanner state={{ kind: "idle" }} />);
  expect(screen.getByRole("status").textContent).toBe("");
});

it("the banner animates nothing — a candidate who thinks the page moved thinks the answer went", async () => {
  const { readResolvedCss } = await import("../css-chain");
  const { resolve, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const css = readResolvedCss(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/exam.css"),
  );
  const banner = [...css.matchAll(/\.exam-save-[^{]*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
  expect(banner.length).toBeGreaterThan(0);
  for (const body of banner) expect(body).not.toMatch(/transition|animation/);
});

// --- reachability: the app root, clicked to, and a real save -------------

const landing: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 2,
  sections: [{ id: "logic", title: "Logic", questionCount: 2, timeLimitMinutes: null }],
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

const paper: AttemptPaper = {
  attemptId: "att_save",
  sections: [
    {
      id: "logic",
      title: "Logic",
      instructions: null,
      timeLimitMinutes: null,
      questions: [
        {
          id: "q1",
          type: "short_answer",
          prompt: "Name the capital.",
          points: 1,
          maxLength: 200,
        },
        { id: "q2", type: "short_answer", prompt: "And the river.", points: 1, maxLength: 200 },
      ],
    },
  ],
  responses: {},
  clientSeq: 0,
  navigation: "free",
  maxIndex: 1,
  remainingMs: 45 * 60_000,
  sectionRemainingMs: null,
  warnAtMinutes: [10, 2],
  lateSyncGraceSeconds: 30,
  allowCalculator: false,
  serverNow: NOW,
  submittedAt: null,
};

interface Saved {
  calls: QueuedSave[];
  answer: (outcome: SaveOutcome, message?: string) => void;
}

function clientThatSaves(): { client: RunClient; saved: Saved } {
  const saved: Saved = { calls: [], answer: () => undefined };
  let outcome: SaveOutcome = "accepted";
  let message: string | undefined;
  saved.answer = (next, text) => {
    outcome = next;
    message = text;
  };
  const client: RunClient = {
    landing: () => Promise.resolve(landing),
    resume: () => Promise.resolve(null),
    start: () => Promise.resolve(paper),
    putAnswer: (save) => {
      saved.calls.push(save);
      return Promise.resolve({
        outcome,
        ...(message === undefined ? {} : { message }),
        remainingMs: 44 * 60_000,
      });
    },
    access: () => Promise.reject(new Error("the runner passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("the runner sends no code")),
    form: () => Promise.reject(new Error("the runner reads no form")),
    register: () => Promise.reject(new Error("the runner registers nobody")),
  };
  return { client, saved };
}

async function startFromRoot(client: RunClient) {
  const view = render(<ExamApp client={client} />);
  const start = await screen.findByRole("button", { name: /^start/i });
  start.focus();
  fireEvent.click(start);
  await screen.findByRole("navigation", { name: /question palette/i });
  return view;
}

describe("the save banner is reached from the candidate app's own root", () => {
  let saved: Saved;
  let client: RunClient;

  beforeEach(() => {
    sessionStorage.setItem(REGISTRATION_TOKEN_KEY, "reg_save");
    ({ client, saved } = clientThatSaves());
  });

  const type = (value: string): void => {
    fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  };

  it("typing an answer in the real runner reaches the real client, and the banner says Saved", async () => {
    await startFromRoot(client);
    expect(screen.getByRole("status", { name: /save status/i })).toBeInTheDocument();

    type("Delhi");
    await waitFor(() => {
      expect(saved.calls).toHaveLength(1);
    });
    expect(saved.calls[0]).toMatchObject({ questionId: "q1", value: { kind: "text", text: "Delhi" } });
    await screen.findByText(/saved/i);
  });

  it("a refused save says Not saved and raises an alert, never Saved", async () => {
    saved.answer("refused", "Your time is up.");
    await startFromRoot(client);

    type("Delhi");
    expect(await screen.findByRole("alert")).toHaveTextContent("Your time is up.");
    expect(screen.getByRole("status", { name: /save status/i })).toHaveTextContent(/not saved/i);
  });

  it("the answer input stays usable while a save is in flight — nothing here is disabled", async () => {
    // Deliberate: an exam must never take the keyboard away from a
    // candidate because a request is open. The only disabled controls in
    // the runner are Previous/Next at the ends of the paper, which this
    // task does not touch.
    await startFromRoot(client);
    type("Del");
    const input = screen.getByRole("textbox");
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute("aria-disabled");
    type("Delhi");
    await waitFor(() => {
      expect(saved.calls.length).toBeGreaterThan(0);
    });
    expect((saved.calls.at(-1) as QueuedSave).value).toEqual({ kind: "text", text: "Delhi" });
  });

  it("clearing an answer is a save of null, not a local forget", async () => {
    await startFromRoot(client);
    type("Delhi");
    await waitFor(() => {
      expect(saved.calls).toHaveLength(1);
    });

    const clear = screen.getByRole("button", { name: /clear answer/i });
    clear.focus();
    fireEvent.click(clear);
    const confirm = screen.getByRole("button", { name: /clear it/i });
    confirm.focus();
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(saved.calls).toHaveLength(2);
    });
    expect((saved.calls[1] as QueuedSave).value).toBeNull();
  });

  it("the queue is keyed by attempt and is written through to localStorage", async () => {
    await startFromRoot(client);
    type("Delhi");
    await waitFor(() => {
      expect(localStorage.getItem(queueStorageKey("att_save"))).toContain("Delhi");
    });
  });

  it("the runner with a live banner has no axe violations", async () => {
    const { container } = await startFromRoot(client);
    type("Delhi");
    await waitFor(() => {
      expect(saved.calls).toHaveLength(1);
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the attempt view seeds its counter from the server", () => {
  it("a resumed attempt starts above the highest sequence the server holds", async () => {
    // Without this a reload restarts the browser's counter at 1, the
    // server refuses every save as stale, the queue drops each one as
    // "superseded", and the banner reads Saved over answers that were
    // never written.
    sessionStorage.setItem(REGISTRATION_TOKEN_KEY, "reg_save");
    const { client, saved } = clientThatSaves();
    const resumed: AttemptPaper = { ...paper, clientSeq: 12, responses: { q1: { kind: "text", text: "Delhi" } } };
    const resuming: RunClient = { ...client, resume: () => Promise.resolve(resumed) };

    render(<ExamApp client={resuming} />);
    await screen.findByRole("navigation", { name: /question palette/i });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New Delhi" } });
    await waitFor(() => {
      expect(saved.calls).toHaveLength(1);
    });
    expect((saved.calls[0] as QueuedSave).clientSeq).toBeGreaterThan(12);
  });

  it("a live attempt is resumed before the landing page is even asked for (C-06)", async () => {
    const { client } = clientThatSaves();
    let askedForLanding = false;
    const resuming: RunClient = {
      ...client,
      landing: () => {
        askedForLanding = true;
        return Promise.resolve(landing);
      },
      resume: () => Promise.resolve(paper),
    };
    render(<ExamApp client={resuming} />);
    await screen.findByRole("navigation", { name: /question palette/i });
    expect(askedForLanding).toBe(false);
  });
});

// --- the debounce, with the clock faked ----------------------------------

it("C-05: an edit in the real runner reaches the client inside two seconds", async () => {
  vi.useFakeTimers();
  try {
    sessionStorage.setItem(REGISTRATION_TOKEN_KEY, "reg_save");
    const { client, saved } = clientThatSaves();
    render(<ExamApp client={client} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const start = screen.getByRole("button", { name: /^start/i });
    start.focus();
    fireEvent.click(start);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Delhi" } });
    expect(saved.calls).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    });
    expect(saved.calls).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
