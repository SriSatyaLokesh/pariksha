import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ResponseValue } from "@pariksha/core";
import { AnswerInput } from "../../src/components/exam/answer";
import type { CandidateQuestion } from "../../src/lib/paper";
import { ExamApp } from "../../src/routes/exam";
import { client, startFromRoot } from "./answer-fixtures";

// Task 7 (#71, P6.7), the choice family: single, multiple, select_k,
// true_false and assertion_reason. `CandidateQuestion` carries no key of
// any kind (apps/api/src/run/scrub.ts strips it), so S-10 here is about
// what the component itself could leak — a class name, a data attribute,
// an option ordered by correctness.
//
// No @testing-library/user-event in this workspace, by a decision the repo
// already made in writing (test/authoring/reorder.test.tsx:44,
// test/exam/landing.test.tsx:88, and Task 6's report decision 4). A
// focused native control's real Enter/Space activation IS a `click`, so
// `activate()` below focuses first and then clicks.
//
// Corrected in fix round 1: an earlier version of this note claimed every
// keyboard assertion dispatches a real `keydown`. None here do, and none
// need to — not one component this task adds defines a key handler of its
// own, so Task 6's trap (a handler on a container swallowing a key meant
// for the focused child) has nothing to bite on here; every key these
// controls answer to is the browser's own. Where this task DOES own an
// event handler — `ReorderableList`'s drag — the assertion reads
// `preventDefault` back off `fireEvent`'s return value, in
// answer-structured.test.tsx and in reorder.test.tsx.

const OPTIONS = [
  { id: "a", text: "Alpha" },
  { id: "b", text: "Beta" },
  { id: "c", text: "Gamma" },
];

const ASSERTION_REASON_TEXTS = [
  "Both true, and the reason explains the assertion",
  "Both true, but the reason does not explain the assertion",
  "The assertion is true and the reason is false",
  "The assertion is false and the reason is true",
];

type ChoiceType = "single" | "multiple" | "select_k" | "true_false" | "assertion_reason";

function fixture(type: ChoiceType): CandidateQuestion {
  const base: CandidateQuestion = { id: "q1", type, prompt: "Pick an answer.", points: 1 };
  switch (type) {
    case "true_false":
      return base;
    case "assertion_reason":
      return { ...base, assertion: "Water boils at 100C.", reason: "At one atmosphere." };
    case "select_k":
      return { ...base, options: OPTIONS, k: 2 };
    default:
      return { ...base, options: OPTIONS };
  }
}

/** The order the component must show, which for the three authored types
 * is the pinned `options` order and for the two synthesised types is the
 * order the format itself fixes. */
function pinnedOrder(type: ChoiceType): string[] {
  if (type === "true_false") return ["True", "False"];
  if (type === "assertion_reason") return ASSERTION_REASON_TEXTS;
  return OPTIONS.map((option) => option.text);
}

function optionTexts(): string[] {
  return [...document.querySelectorAll(".exam-option-text")].map((el) => el.textContent ?? "");
}

function activate(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

/** A controlled harness: select_k's lock is a function of the value, so a
 * test that never feeds `onChange` back in cannot see it at all. */
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

describe("the choice family renders its options as the candidate was dealt them", () => {
  it.each(["single", "multiple", "select_k", "true_false", "assertion_reason"] as const)(
    "%s renders its options in the pinned order with the whole row as the hit target",
    (type) => {
      const spy = vi.fn();
      render(<Harness question={fixture(type)} onChange={spy} />);
      expect(optionTexts()).toEqual(pinnedOrder(type));
      // The label text, not the control: DESIGN.md's option-row is "the
      // entire row is the hit target, not just the radio or checkbox".
      activate(screen.getByText(pinnedOrder(type)[1]!));
      expect(spy).toHaveBeenCalled();
    },
  );

  it("single answers with the option id, not with its text or its position", () => {
    const spy = vi.fn();
    render(<Harness question={fixture("single")} onChange={spy} />);
    activate(screen.getByText("Beta"));
    expect(spy).toHaveBeenLastCalledWith({ kind: "option", option: "b" });
  });

  it("true_false answers with a boolean, and assertion_reason with the format's own key", () => {
    const tf = vi.fn();
    const { unmount } = render(<Harness question={fixture("true_false")} onChange={tf} />);
    activate(screen.getByText("False"));
    expect(tf).toHaveBeenLastCalledWith({ kind: "boolean", value: false });
    unmount();

    const ar = vi.fn();
    render(<Harness question={fixture("assertion_reason")} onChange={ar} />);
    activate(screen.getByText(ASSERTION_REASON_TEXTS[2]!));
    expect(ar).toHaveBeenLastCalledWith({ kind: "option", option: "a_true_r_false" });
  });

  it("assertion_reason shows the assertion and the reason, both labelled", () => {
    render(<Harness question={fixture("assertion_reason")} />);
    expect(screen.getByText(/water boils at 100c/i)).toBeVisible();
    expect(screen.getByText(/at one atmosphere/i)).toBeVisible();
    expect(screen.getByText("Assertion")).toBeVisible();
    expect(screen.getByText("Reason")).toBeVisible();
  });

  it("multiple keeps the chosen options in the pinned order, whatever order they were clicked", () => {
    const spy = vi.fn();
    render(<Harness question={fixture("multiple")} onChange={spy} />);
    activate(screen.getByText("Gamma"));
    activate(screen.getByText("Alpha"));
    expect(spy).toHaveBeenLastCalledWith({ kind: "options", options: ["a", "c"] });
  });

  it("deselecting the last chosen option answers null, not an empty array", () => {
    const spy = vi.fn();
    render(<Harness question={fixture("multiple")} onChange={spy} />);
    activate(screen.getByText("Alpha"));
    activate(screen.getByText("Alpha"));
    expect(spy).toHaveBeenLastCalledWith(null);
  });

  it("selection carries two carriers, so it survives greyscale", () => {
    render(<Harness question={fixture("single")} />);
    activate(screen.getByText("Beta"));
    // The filled control is one carrier; the row's own class (cream fill,
    // 2px voltage border in exam.css) is the second.
    expect(screen.getByRole("radio", { name: /beta/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /beta/i }).closest(".exam-option-row")).toHaveClass(
      "is-selected",
    );
  });
});

describe("select_k (AC-07)", () => {
  it("AC-07: select_k locks further choices once k options are picked, and unlocks on deselect", () => {
    render(<Harness question={fixture("select_k")} />);
    activate(screen.getByText("Alpha"));
    activate(screen.getByText("Beta"));
    expect(screen.getByRole("checkbox", { name: /gamma/i })).toBeDisabled();
    activate(screen.getByText("Alpha"));
    expect(screen.getByRole("checkbox", { name: /gamma/i })).toBeEnabled();
  });

  it("the locked state is announced, not only visual", () => {
    render(<Harness question={fixture("select_k")} />);
    expect(screen.getByRole("status")).toHaveTextContent(/0 of 2 chosen/i);
    activate(screen.getByText("Alpha"));
    activate(screen.getByText("Beta"));
    expect(screen.getByRole("status")).toHaveTextContent(/2 of 2 chosen/i);
  });

  it("an already-chosen option is never locked, or the choice could not be undone", () => {
    render(<Harness question={fixture("select_k")} />);
    activate(screen.getByText("Alpha"));
    activate(screen.getByText("Beta"));
    expect(screen.getByRole("checkbox", { name: /alpha/i })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /beta/i })).toBeEnabled();
  });
});

describe("S-10: the candidate's DOM holds no key", () => {
  it.each(["single", "multiple", "select_k", "true_false", "assertion_reason"] as const)(
    "%s: no option carries a correctness marker in the DOM or in its props",
    (type) => {
      const { container } = render(<Harness question={fixture(type)} />);
      expect(container.innerHTML).not.toMatch(/correct|is-key|data-answer/i);
    },
  );

  it("the positive control: the marker words would be found if they were there", () => {
    // Without this the sweep above would pass against a component that
    // rendered nothing at all.
    const { container } = render(<Harness question={fixture("single")} />);
    expect(container.innerHTML).toMatch(/Alpha/);
  });
});

describe("keyboard and axe", () => {
  it.each(["single", "multiple", "select_k", "true_false", "assertion_reason"] as const)(
    "%s is operable with the keyboard alone and has no axe violations",
    async (type) => {
      const spy = vi.fn();
      const { container } = render(<Harness question={fixture(type)} onChange={spy} />);
      const controls = [...container.querySelectorAll<HTMLElement>("input")];
      expect(controls.length).toBeGreaterThan(0);
      // Nothing is removed from the tab order, and nothing jumps it with a
      // positive tabindex.
      for (const control of controls) {
        expect(control.getAttribute("tabindex")).toBeNull();
      }
      // A focused native control activates on Enter/Space as a click.
      activate(controls[1]!);
      expect(spy).toHaveBeenCalled();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it("the radio families share one name, which is what gives them arrow-key navigation", () => {
    // jsdom implements no arrow-key behaviour for radio groups — the
    // browser does, and only for radios that share a `name`. Asserting the
    // name is the honest proxy; asserting a simulated ArrowDown would pass
    // against a group the browser could not navigate.
    const { container } = render(<Harness question={fixture("single")} />);
    const names = new Set([...container.querySelectorAll("input[type=radio]")].map((el) => el.getAttribute("name")));
    expect(names.size).toBe(1);
    expect([...names][0]).toBeTruthy();
  });

  it("no axe violations at 200% zoom either", async () => {
    const { container } = render(<Harness question={fixture("select_k")} />);
    document.documentElement.style.fontSize = "32px";
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "";
  });

  it("WCAG 2.5.3, with a positive control: every option's accessible name contains its visible text", () => {
    render(<Harness question={fixture("multiple")} />);
    for (const text of pinnedOrder("multiple")) {
      expect(screen.getByRole("checkbox", { name: new RegExp(text, "i") })).toBeInTheDocument();
    }
    // The control: the select_k counter is visibly "0 of 2 chosen" and
    // accessibly a superset of it, so a renamed region fails this lookup.
    const { unmount } = render(<Harness question={fixture("select_k")} />);
    expect(within(screen.getAllByRole("status")[0]!).queryByText(/chosen/i)).not.toBeNull();
    unmount();
  });
});

describe("read-only", () => {
  it("every control is disabled when the attempt is not answerable", () => {
    const spy = vi.fn();
    const { container } = render(<Harness question={fixture("multiple")} onChange={spy} disabled />);
    for (const control of container.querySelectorAll<HTMLElement>("input")) {
      expect(control).toBeDisabled();
    }
    fireEvent.click(screen.getByText("Alpha"));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("reachability: the candidate app's own root, clicked to", () => {
  it("Start opens the runner and question 1's real options are there to click", async () => {
    await startFromRoot();
    const first = await screen.findByRole("radio", { name: /paris/i });
    activate(first);
    expect(first).toBeChecked();
  });

  it("an answer given from the root fills that question's palette square", async () => {
    await startFromRoot();
    activate(await screen.findByRole("radio", { name: /paris/i }));
    expect(screen.getByRole("button", { name: /^question 1 /i })).toHaveClass("is-filled");
  });

  it("the paper's own prompt renders through the shared renderer", async () => {
    render(<ExamApp client={client()} />);
    activate(await screen.findByRole("button", { name: /^start/i }));
    expect(await screen.findByText(/capital of France/i)).toBeVisible();
  });
});

// ---- the non-colour carriers, read out of the stylesheet ------------------
//
// Every class-name assertion above (`is-selected`, a disabled row, the
// drop target) is only worth something if the class actually draws
// something a greyscale reader keeps. This package runs with `css: false`
// so jsdom applies no cascade and `getComputedStyle` would report the
// initial value whatever exam.css says — the same trap the pre-flight
// scan recorded as B-6a. So the stylesheet itself is read.

describe("every answer state carries a shape, not only a colour", () => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/exam.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  /** The declarations of the first rule whose selector list is exactly
   * `selector`. Indexed rather than regexed: these selectors carry `.`,
   * `:`, `(` and `)`, and an escaping bug in the helper would read as a
   * missing rule. */
  function body(selector: string): string {
    const at = css.indexOf(`\n${selector} {`);
    if (at === -1) throw new Error(`selector not found: ${selector}`);
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
  }

  it("a chosen option thickens its edge, on top of the filled control", () => {
    expect(body(".exam-option-row.is-selected")).toMatch(/border-width:\s*2px/);
  });

  it("a locked or read-only option dashes its edge", () => {
    expect(body(".exam-option-row:has(input:disabled)")).toMatch(/border-style:\s*dashed/);
    expect(body(".exam-select:disabled,\n.exam-text-input:disabled,\n.exam-text-area:disabled")).toMatch(
      /border-style:\s*dashed/,
    );
    expect(body(".exam-blank-input:disabled")).toMatch(/border-bottom-style:\s*dashed/);
  });

  it("the drag drop-target draws a bar, which is geometry and not a fill", () => {
    expect(body(".reorderable-list__item.is-drop-target")).toMatch(
      /border-inline-start:\s*4px solid/,
    );
  });

  it("the option row is the hit target, at DESIGN.md's 48px floor", () => {
    expect(body(".exam-option-row")).toMatch(/min-height:\s*48px/);
  });
});

// ---- the passage and the media (fix round 1, I1) --------------------------
//
// `AnswerInput` renders `question.group.passage` through the shared
// renderer and `question.media[]` as <img>, and neither had a fixture
// anywhere, so the alt-text path had never met axe. Both are data the
// pinned layout supplies: the scrubber rewrites every `media.src` to the
// attempt-scoped route before it reaches this component, which is why
// nothing here builds a URL and the fixture's src is simply a string.

const PASSAGE_SRC = "Read the passage. It mentions *Paris* and nothing else.";

const withPassage: CandidateQuestion = {
  ...fixture("single"),
  group: { id: "g1", passage: PASSAGE_SRC },
};

/** The base `shown()` prefixes every `media.src` with — `MEDIA_BASE` in
 *  `apps/api/src/run/attempt.ts`, repeated here because the browser never
 *  imports from the server. */
const MEDIA_BASE = "/api/v1/run/attempt/media/";

const withMedia: CandidateQuestion = {
  ...fixture("single"),
  media: [
    { kind: "image", src: `${MEDIA_BASE}abc.png`, alt: "A circuit diagram" },
    { kind: "image", src: `${MEDIA_BASE}def.png`, alt: "Its truth table" },
  ],
};

describe("the passage and the question's media", () => {
  it("the passage renders through the shared renderer, inside its own labelled region", async () => {
    render(<Harness question={withPassage} />);
    const passage = screen.getByRole("region", { name: /passage/i });
    expect(await within(passage).findByText(/read the passage/i)).toBeVisible();
    // Markdown, not plain text: the emphasis really became an element.
    expect(passage.querySelector("em")).not.toBeNull();
  });

  it("a question with no group renders no passage region at all", () => {
    render(<Harness question={fixture("single")} />);
    expect(screen.queryByRole("region", { name: /passage/i })).toBeNull();
  });

  it("every image carries the alt text the paper gave it, in order", () => {
    render(<Harness question={withMedia} />);
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual([
      "A circuit diagram",
      "Its truth table",
    ]);
  });

  it("the src is used verbatim: nothing here builds a media URL", () => {
    render(<Harness question={withMedia} />);
    const src = screen.getByRole("img", { name: "A circuit diagram" }).getAttribute("src");
    expect(src).toBe(`${MEDIA_BASE}abc.png`);
    // And the fixture is a URL the server can really answer. The route is
    // `GET /api/v1/run/attempt/media/:key` — **one** path parameter — and
    // `shown()` builds it as the base plus the bare storage key, so a key
    // with a slash in it names a route that does not exist. This suite
    // asserted `media/w1/abc.png` for a round and proved nothing.
    expect((src ?? "").slice(MEDIA_BASE.length)).not.toContain("/");
  });

  it("a passage and media have no axe violations, at 100% and at 200% zoom", async () => {
    const both: CandidateQuestion = { ...withPassage, media: withMedia.media ?? [] };
    const { container } = render(<Harness question={both} />);
    await screen.findByText(/read the passage/i);
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "32px";
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "";
  });

  it("a passage and media are still inert when the attempt is read-only", () => {
    const both: CandidateQuestion = { ...withPassage, media: withMedia.media ?? [] };
    const { container } = render(<Harness question={both} disabled />);
    for (const control of container.querySelectorAll<HTMLElement>("input")) {
      expect(control).toBeDisabled();
    }
    expect(container.querySelectorAll("[draggable='true']")).toHaveLength(0);
  });
});

describe("reachability: the passage and the media, from the root", () => {
  it("question 1's passage and image are on the screen a candidate actually reaches", async () => {
    await startFromRoot();
    const passage = await screen.findByRole("region", { name: /passage/i });
    // textContent, not getByText: the renderer splits the sentence across
    // an <em>, which is the point of rendering it through markdown at all.
    await waitFor(() => {
      expect(passage.textContent).toMatch(/A short passage about European capitals/);
    });
    expect(screen.getByRole("img", { name: "A map of France" })).toHaveAttribute(
      "src",
      `${MEDIA_BASE}map.png`,
    );
  });

  it("axe is clean on the whole runner with a passage and an image in it", async () => {
    const view = render(<ExamApp client={client()} />);
    activate(await screen.findByRole("button", { name: /^start/i }));
    const passage = await screen.findByRole("region", { name: /passage/i });
    await waitFor(() => {
      expect(passage.textContent).toMatch(/European capitals/);
    });
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
