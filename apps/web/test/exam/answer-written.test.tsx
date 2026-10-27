import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ResponseValue } from "@pariksha/core";
import { renderMarkdown } from "../../src/render/markdown";
import { AnswerInput, BLANK_MARKER } from "../../src/components/exam/answer";
import { numberFieldValue } from "../../src/components/answer-common";
import type { CandidateQuestion } from "../../src/lib/paper";
import { jumpTo, startFromRoot } from "./answer-fixtures";

// Task 7 (#71, P6.7), the written family: fill_blank, numeric,
// short_answer and long_answer.
//
// fill_blank is the one place the shared renderer and a candidate input
// meet. The plan's ruling: the prompt's `{{id}}` placeholders become
// BLANK_MARKER(id) BEFORE renderMarkdown runs, and the rendered HTML is
// split on the marker AFTER. Substituting an `<input>` into the Markdown
// source instead would need `html: true`, which ADR 0004 forbids, and
// would create the product's first stored-HTML surface.

const fillBlank: CandidateQuestion = {
  id: "q1",
  type: "fill_blank",
  prompt: "The capital is {{1}} and the currency is {{2}}.",
  points: 2,
  blanks: [{ id: "1" }, { id: "2" }],
};

const oneBlank: CandidateQuestion = {
  id: "q1b",
  type: "fill_blank",
  prompt: "The capital is {{1}}.",
  points: 1,
  blanks: [{ id: "1" }],
};

const numeric: CandidateQuestion = {
  id: "q2",
  type: "numeric",
  prompt: "Acceleration due to gravity?",
  points: 1,
  unit: "m/s²",
};

const shortAnswer: CandidateQuestion = {
  id: "q3",
  type: "short_answer",
  prompt: "Define a join.",
  points: 2,
  maxLength: 500,
};

const longAnswer: CandidateQuestion = {
  id: "q4",
  type: "long_answer",
  prompt: "Discuss normalisation.",
  points: 5,
  maxLength: 500,
};

function Harness({
  question,
  onChange,
  disabled = false,
}: {
  question: CandidateQuestion;
  onChange?: (next: ResponseValue | null) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<ResponseValue | null>(null);
  return (
    <AnswerInput
      question={question}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function type(element: HTMLElement, text: string): void {
  fireEvent.change(element, { target: { value: text } });
}

describe("fill_blank renders its inputs inside the prompt", () => {
  it("fill_blank renders an input inline, in the prompt, one per placeholder, in prompt order", async () => {
    render(<Harness question={fillBlank} />);
    expect(await screen.findAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByLabelText(/blank 1/i).previousSibling).toHaveTextContent(/The capital is/);
    expect(screen.getByLabelText(/blank 2/i).previousSibling).toHaveTextContent(/and the currency is/);
  });

  it("bracketed placeholders like [[b1]] render inline text inputs just like {{b1}}", async () => {
    const bracketQuestion: CandidateQuestion = {
      id: "q_bracket",
      type: "fill_blank",
      prompt: "The standard port used for secure HTTPS connections is [[b1]].",
      points: 1,
      blanks: [{ id: "b1" }],
    };
    render(<Harness question={bracketQuestion} />);
    expect(await screen.findAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByLabelText(/blank 1/i)).toBeInTheDocument();
  });

  it("each blank answers under its own id, and emptying the last one answers null", async () => {
    const spy = vi.fn();
    render(<Harness question={fillBlank} onChange={spy} />);
    const first = await screen.findByLabelText(/blank 1/i);
    type(first, "Delhi");
    expect(spy).toHaveBeenLastCalledWith({ kind: "blanks", values: { "1": "Delhi" } });
    type(screen.getByLabelText(/blank 2/i), "Rupee");
    expect(spy).toHaveBeenLastCalledWith({ kind: "blanks", values: { "1": "Delhi", "2": "Rupee" } });
    type(first, "");
    expect(spy).toHaveBeenLastCalledWith({ kind: "blanks", values: { "2": "Rupee" } });
    type(screen.getByLabelText(/blank 2/i), "");
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  it("a prompt containing the marker's literal text cannot forge a blank", async () => {
    render(<Harness question={{ ...oneBlank, prompt: `{{1}} pkb:1 and ${BLANK_MARKER("1")}` }} />);
    expect(await screen.findAllByRole("textbox")).toHaveLength(1);
  });

  it("a prompt that is nothing but marker text declares no blank at all", async () => {
    render(<Harness question={{ ...oneBlank, prompt: `pkb:1 and ${BLANK_MARKER("1")}` }} />);
    await waitFor(() => {
      expect(document.querySelector(".exam-blanks")?.textContent).toContain("pkb:1");
    });
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("a placeholder with no matching blank is left as written, not turned into an input", async () => {
    render(<Harness question={{ ...oneBlank, prompt: "The capital is {{1}} in {{9}}." }} />);
    expect(await screen.findAllByRole("textbox")).toHaveLength(1);
    expect(document.querySelector(".exam-blanks")?.textContent).toContain("{{9}}");
  });

  it("the marker survives markdown-it unchanged inside emphasis, a link and a code span", async () => {
    const wraps = [
      (s: string) => `*${s}*`,
      (s: string) => `[${s}](https://x.test)`,
      (s: string) => `\`${s}\``,
    ];
    for (const wrap of wraps) {
      expect(await renderMarkdown(wrap(BLANK_MARKER("1")))).toContain(BLANK_MARKER("1"));
    }
  });

  it("the marker is built from code points, never pasted (pre-flight A-22)", () => {
    // Two U+2063 INVISIBLE SEPARATORs around an ASCII payload. A paste
    // through a terminal or a trailing-whitespace lint silently drops
    // them, and the marker becomes forgeable — which is exactly what the
    // forgery test above exists for.
    expect(BLANK_MARKER("1")).toBe("⁣pkb:1⁣");
    expect([...BLANK_MARKER("7")].map((c) => c.codePointAt(0))).toContain(0x2063);
  });
});

describe("numeric", () => {
  it("numeric accepts a number and a unit is shown but not typed into", () => {
    const spy = vi.fn();
    render(<Harness question={numeric} onChange={spy} />);
    type(screen.getByRole("spinbutton"), "9.81");
    expect(spy).toHaveBeenLastCalledWith({ kind: "number", value: 9.81 });
    expect(screen.getByText("m/s²")).toBeVisible();
    // Shown, announced with the field, and not a control of its own.
    expect(screen.getByRole("spinbutton")).toHaveAccessibleDescription(/m\/s/);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("an emptied numeric field answers null, never 0", () => {
    const spy = vi.fn();
    render(<Harness question={numeric} onChange={spy} />);
    const field = screen.getByRole("spinbutton");
    type(field, "9.81");
    type(field, "");
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(spy).not.toHaveBeenCalledWith({ kind: "number", value: 0 });
  });

  it("numberFieldValue is the general form of that guard", () => {
    // The empty-field-coerces-to-zero bug has been fixed three times in
    // three files in this repo (ReorderableList's position field,
    // authoring/answer/Written.tsx's value and tolerance, Choice.tsx's k).
    // This is the shape all of them want.
    expect(numberFieldValue("")).toBeNull();
    expect(numberFieldValue("   ")).toBeNull();
    expect(numberFieldValue("abc")).toBeNull();
    expect(numberFieldValue("1e999")).toBeNull();
    expect(numberFieldValue("0")).toBe(0);
    expect(numberFieldValue("-9.81")).toBe(-9.81);
  });

  it("a numeric question without a unit shows no unit text", () => {
    const { unit: _unit, ...noUnit } = numeric;
    render(<Harness question={noUnit} />);
    expect(screen.queryByText("m/s²")).toBeNull();
  });

  // G5-14 (UI/UX audit, P0). A trackpad or mouse-wheel scroll over a
  // focused number input silently changes its value — a lost mark a
  // candidate never sees happen. Blurring on `wheel` is what stops the
  // browser's own default (it runs the default action only while the
  // field is still focused); jsdom does not implement that default step
  // itself, so this test is about the one thing it CAN see — the field
  // giving up focus — not about the value surviving a real scroll, which
  // needs a real browser.
  it("scrolling the wheel over the field blurs it rather than changing the value", () => {
    render(<Harness question={numeric} />);
    const field = screen.getByRole("spinbutton");
    field.focus();
    expect(field).toHaveFocus();
    fireEvent.wheel(field, { deltaY: 100 });
    expect(field).not.toHaveFocus();
  });
});

describe("short_answer and long_answer", () => {
  it("short_answer and long_answer enforce max_length and show a remaining count", () => {
    for (const question of [shortAnswer, longAnswer]) {
      const view = render(<Harness question={question} />);
      expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "500");
      type(screen.getByRole("textbox"), "x".repeat(10));
      expect(screen.getByText(/490 characters left/i)).toBeVisible();
      view.unmount();
    }
  });

  it("the remaining count starts at the whole budget and is visible from first render", () => {
    render(<Harness question={shortAnswer} />);
    expect(screen.getByText(/500 characters left/i)).toBeVisible();
  });

  // G5-05 (UI/UX audit, P0). This counter used to carry `role="status"`
  // and update on every keystroke, so a screen reader announced "999
  // characters left", "998…", once per character typed — an interruption
  // on every single keystroke in a timed exam. It must stay visible and
  // reachable, but it must not be a live region a screen reader narrates
  // mid-type: the field describes it instead, read once on focus.
  it("the remaining count is not a live region, and is wired to the field by aria-describedby", () => {
    render(<Harness question={shortAnswer} />);
    expect(screen.queryByRole("status")).toBeNull();
    const field = screen.getByRole("textbox");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const status = document.getElementById(describedBy ?? "");
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent(/500 characters left/i);
    expect(status).not.toHaveAttribute("role", "status");
  });

  it("long_answer is a multi-line field and short_answer is not", () => {
    const view = render(<Harness question={longAnswer} />);
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
    view.unmount();
    render(<Harness question={shortAnswer} />);
    expect(screen.getByRole("textbox").tagName).toBe("INPUT");
  });

  it("the format's own ceiling applies when the author set no maximum", () => {
    const { maxLength: _short, ...noMaxShort } = shortAnswer;
    const view = render(<Harness question={noMaxShort} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "500");
    view.unmount();
    const { maxLength: _long, ...noMaxLong } = longAnswer;
    render(<Harness question={noMaxLong} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "5000");
  });

  it("emptying the field answers null, not an empty string", () => {
    const spy = vi.fn();
    render(<Harness question={shortAnswer} onChange={spy} />);
    type(screen.getByRole("textbox"), "a join");
    type(screen.getByRole("textbox"), "");
    expect(spy).toHaveBeenLastCalledWith(null);
  });
});

describe("S-10, LaTeX, read-only and axe", () => {
  it("S-10: no accepted answer, tolerance, rubric or model answer reaches the DOM", async () => {
    // The fixtures below are authoring-shaped on purpose: every key field
    // the format carries is present, and none of it may survive into the
    // DOM even if a future `forCandidate` regression let it through.
    const leaky = {
      ...fillBlank,
      blanks: [
        { id: "1", accepted: ["Delhi"], match: "exact" },
        { id: "2", accepted: ["Rupee"] },
      ],
      key: { value: 9.81, tolerance: 0.01 },
      rubric: [{ level: "model", points: 5 }],
      model_answer: "Delhi",
      explanation: "Delhi is the capital.",
    } as unknown as CandidateQuestion;
    const { container } = render(<Harness question={leaky} />);
    await screen.findAllByRole("textbox");
    for (const leak of ["Delhi", "tolerance", "rubric", "model"]) {
      expect(container.innerHTML).not.toContain(leak);
    }
    // The positive control: the prompt itself did render.
    expect(container.innerHTML).toContain("The capital is");
  });

  it("LaTeX in a prompt renders through the shared renderer", async () => {
    const { container } = render(<Harness question={{ ...numeric, prompt: "Find $x^2$" }} />);
    await waitFor(() => {
      expect(container.querySelector("math")).not.toBeNull();
    });
  });

  it("a prompt with no LaTeX produces no MathML at all", async () => {
    const { container } = render(<Harness question={numeric} />);
    await screen.findByRole("spinbutton");
    expect(container.querySelector("math")).toBeNull();
  });

  it.each([fillBlank, numeric, shortAnswer, longAnswer])(
    "$type has no axe violations and every input is labelled",
    async (question) => {
      const { container } = render(<Harness question={question} />);
      await waitFor(() => {
        expect(container.querySelectorAll("input,textarea").length).toBeGreaterThan(0);
      });
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it("no axe violations at 200% zoom either", async () => {
    const { container } = render(<Harness question={fillBlank} />);
    await screen.findAllByRole("textbox");
    document.documentElement.style.fontSize = "32px";
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "";
  });

  it.each([fillBlank, numeric, shortAnswer, longAnswer])(
    "$type is fully disabled when read-only",
    async (question) => {
      const { container } = render(<Harness question={question} disabled />);
      await waitFor(() => {
        expect(container.querySelectorAll("input,textarea").length).toBeGreaterThan(0);
      });
      for (const control of container.querySelectorAll<HTMLElement>("input,textarea")) {
        expect(control).toBeDisabled();
      }
    },
  );
});

describe("reachability: the candidate app's own root, clicked to", () => {
  it("the fill_blank question is reachable from the palette and typeable there", async () => {
    await startFromRoot();
    jumpTo(9);
    type(await screen.findByLabelText(/blank 1/i), "Delhi");
    expect(screen.getByRole("button", { name: /^question 9 /i })).toHaveClass("is-filled");
  });

  it("the numeric question is reachable, and its unit comes from the paper", async () => {
    await startFromRoot();
    jumpTo(10);
    expect(await screen.findByText("m/s2")).toBeVisible();
    type(screen.getByRole("spinbutton"), "9.81");
    expect(screen.getByRole("button", { name: /^question 10 /i })).toHaveClass("is-filled");
  });

  it("the long_answer question is reachable and counts down from the paper's own maximum", async () => {
    await startFromRoot();
    jumpTo(12);
    // Scoped to the question column: Task 8's save banner carries its own
    // `role="status"` in the header, and the counter here (G5-05) is no
    // longer one — scoping still keeps this from matching anything of
    // the header's.
    const column = await screen.findByRole("main", { name: /question 12/i });
    expect(within(column).getByText(/5000 characters left/i)).toBeVisible();
  });
});
