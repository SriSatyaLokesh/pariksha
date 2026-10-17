import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { Hero } from "../src/sections/s1-s3/Hero";

// design contract: docs/superpowers/specs/2026-10-17-landing-page-v3-interactive.md
// §3 (the hero) and §2.3 (the island's contract with this markup). This
// file protects D2 — the demo must be a complete, correct, readable
// question with no JavaScript running at all — and the honesty
// requirements (D5) that must be prerendered, not written by the island.

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const H1_TEXT = "Pariksha — run real exams you host yourself.";

describe("Hero — the exam demo, with no JavaScript (D2)", () => {
  it("renders exactly one h1, the verbatim budgeted headline (T19)", () => {
    const { container } = render(<Hero />);
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(H1_TEXT);
    expect(H1_TEXT.length).toBeLessThanOrEqual(45);
  });

  it("carries the pre-alpha / Apache-2.0 honesty chip, prerendered (D5)", () => {
    const { container } = render(<Hero />);
    expect(container.textContent).toContain("PRE-ALPHA · APACHE-2.0");
  });

  it("the demo root carries the island's one query hook, data-demo", () => {
    const { container } = render(<Hero />);
    expect(container.querySelector("[data-demo]")).not.toBeNull();
  });

  it("question 1 (LOG-001) is a complete, visible, answerable question with real options", () => {
    const { container } = render(<Hero />);
    const q1 = container.querySelector("#demo-q-1");
    expect(q1).not.toBeNull();
    expect(q1).not.toHaveAttribute("hidden");
    expect(q1?.getAttribute("data-qid")).toBe("LOG-001");

    const legend = container.querySelector("#demo-stem-1");
    expect(legend?.textContent).toContain(
      "What comes next in the series?",
    );
    expect(legend?.textContent).toContain("3, 7, 15, 31, 63, ?");

    const options = q1?.querySelectorAll('input[name="LOG-001"]');
    expect(options).toHaveLength(4);
    const values = [...(options ?? [])].map((el) =>
      (el as HTMLInputElement).value,
    );
    expect(values).toEqual(["a", "b", "c", "d"]);
    expect(["95", "117", "127", "131"]).toEqual(
      [...(q1?.querySelectorAll(".runner-mock__option span") ?? [])].map(
        (el) => el.textContent,
      ),
    );
    // every control is a native form control sharing one radio group
    expect(
      [...(options ?? [])].every((el) => (el as HTMLInputElement).type === "radio"),
    ).toBe(true);
  });

  it("questions 2 and 3 are in the HTML, complete, but hidden (a crawler reads all three)", () => {
    const { container } = render(<Hero />);

    const q2 = container.querySelector("#demo-q-2");
    expect(q2).toHaveAttribute("hidden");
    expect(q2?.getAttribute("data-qid")).toBe("LOG-007");
    expect(q2?.querySelectorAll('input[name="LOG-007"]')).toHaveLength(2);
    expect(q2?.textContent).toContain("EARTH is written as FBSUI");
    // markdown rendered as real markup, never as literal asterisks (§3.3)
    expect(q2?.innerHTML).not.toContain("**");
    expect(q2?.querySelector("strong")?.textContent).toBe("Statement:");

    const q3 = container.querySelector("#demo-q-3");
    expect(q3).toHaveAttribute("hidden");
    expect(q3?.getAttribute("data-qid")).toBe("QNT-004");
    const checkboxes = q3?.querySelectorAll('input[name="QNT-004"]');
    expect(checkboxes).toHaveLength(5);
    expect(
      [...(checkboxes ?? [])].every(
        (el) => (el as HTMLInputElement).type === "checkbox",
      ),
    ).toBe(true);
    expect([...(checkboxes ?? [])].map((el) => (el as HTMLInputElement).value)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("the palette is three inert, labelled squares, not navigation (§3.5)", () => {
    const { container } = render(<Hero />);
    const palette = container.querySelector("[data-demo-palette]");
    expect(palette).toHaveAttribute("aria-hidden", "true");
    const squares = palette?.querySelectorAll(".runner-mock__square");
    expect(squares).toHaveLength(3);
    expect(squares?.[0]?.textContent).toBe("1");
    // no button inside the prerendered palette — the island creates those
    expect(palette?.querySelector("button")).toBeNull();
  });

  it("the live region is present, polite and empty before any script runs (§3.6)", () => {
    const { container } = render(<Hero />);
    const live = container.querySelector("[data-demo-live]");
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveClass("visually-hidden");
    expect(live?.textContent).toBe("");
  });

  it("the control row tells the truth about what needs JavaScript, and keeps the fallback link (I-9, §2.8)", () => {
    const { container } = render(<Hero />);
    const controls = container.querySelector("[data-demo-controls]");
    expect(controls?.textContent).toContain(
      "Scoring, and questions 2 and 3, need JavaScript.",
    );
    const fallback = controls?.querySelector("a");
    expect(fallback).toHaveAttribute(
      "href",
      `${REPO}/tree/main/examples/reasoning-aptitude`,
    );
    expect(fallback?.textContent).toContain(
      "These three questions, and fourteen more, are in the worked example",
    );
    // nothing that looks like a working button ships in the no-JS state
    expect(controls?.querySelector("button")).toBeNull();
  });

  it("the result panel carries no score, verdict or result in any form (D5)", () => {
    const { container } = render(<Hero />);
    const result = container.querySelector("[data-demo-result]");
    expect(result).toHaveAttribute("hidden");
    expect(result?.textContent).toBe("");
    expect(container.textContent).not.toMatch(/you scored/i);
    for (const word of ["Correct", "Partly correct", "Wrong", "Not answered"]) {
      expect(container.textContent).not.toContain(word);
    }
  });

  it("the chrome row carries the DEMO label, Timer off, and the privacy clause (§3.9)", () => {
    const { container } = render(<Hero />);
    expect(container.textContent).toContain(
      "DEMO · 3 QUESTIONS · ABOUT 30 SECONDS",
    );
    expect(container.textContent).toContain("Timer off");
    expect(container.textContent).toContain(
      "Nothing you type leaves this page.",
    );
  });

  it("has no primary filled CTA in the hero — the primary action is the demo's own Finish (§3.1)", () => {
    const { container } = render(<Hero />);
    expect(container.querySelector(".button-primary")).toBeNull();
  });

  it("keeps exactly two secondary text links on voltage: the repo and the status anchor", () => {
    const { container } = render(<Hero />);
    const links = container.querySelectorAll("a.hero-text-link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", REPO);
    expect(links[0]?.textContent).toBe("Read the code on GitHub");
    expect(links[1]).toHaveAttribute("href", "#status");
  });

  it("the bridge band prerenders CB-1a and the server-side-key honesty prose (§3.8, D5)", () => {
    const { container } = render(<Hero />);
    const bridge = container.querySelector(".hero-bridge");
    expect(bridge?.textContent).toContain(
      "The three questions above are this file.",
    );
    expect(bridge?.textContent).toContain(
      "examples/reasoning-aptitude/questions.json · LOG-001",
    );
    expect(bridge?.textContent).toContain('"id"');
    expect(bridge?.textContent).toContain('"LOG-001"');
    expect(bridge?.textContent).toContain('"key"');
    expect(bridge?.textContent).toContain("all_or_nothing");
    expect(bridge?.textContent).toContain(
      "Each term is double the previous term plus one",
    );
    expect(bridge?.textContent).toContain("never reaches a candidate");
    expect(bridge?.textContent).toContain("land with v0.1");
  });

  it("carries no emoji and no glyph as the only carrier of meaning (A13)", () => {
    const { container } = render(<Hero />);
    const emojiRange = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emojiRange.test(container.textContent ?? "")).toBe(false);
    expect(container.textContent).not.toContain("✓");
    expect(container.textContent).not.toContain("✗");
  });

  it("has no accessibility violations (jest-axe)", async () => {
    const { container } = render(<Hero />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
