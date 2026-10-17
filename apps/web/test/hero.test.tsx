import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { Hero, HeroBridge } from "../src/sections/s1-s3/Hero";

// design contract: docs/superpowers/specs/2026-10-17-landing-page-v3-interactive.md
// §3 (the hero) and §2.3 (the island's contract with this markup). This
// file protects D2 — the demo must be a complete, correct, readable
// question with no JavaScript running at all — and the honesty
// requirements (D5) that must be prerendered, not written by the island.

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

  // v4 A1: three cards, one per type, all prerendered and all visible.
  // The island only upgrades this; with JavaScript off it is the whole demo.
  it("prerenders three cards in order — single, multiple, matching (A1, D2)", () => {
    const { container } = render(<Hero />);
    const cards = Array.from(container.querySelectorAll("[data-demo-card]"));
    expect(cards.map((c) => c.getAttribute("data-qid"))).toEqual([
      "LOG-001",
      "QNT-004",
      "LOG-003",
    ]);
    for (const card of cards) {
      expect(card).not.toHaveAttribute("hidden");
      expect(card.querySelector("[data-demo-verdict]")).toHaveAttribute(
        "hidden",
      );
    }
  });

  // Native controls, so the keyboard works before a byte of JavaScript
  // loads. A div with role="radio" would have to reimplement arrow keys.
  it("uses native radios, checkboxes and selects, never custom controls", () => {
    const { container } = render(<Hero />);
    expect(
      container.querySelectorAll('input[name="LOG-001"][type="radio"]'),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll('input[name="QNT-004"][type="checkbox"]'),
    ).toHaveLength(5);
    expect(container.querySelectorAll("select[data-demo-match]")).toHaveLength(
      4,
    );
    expect(
      container.querySelectorAll(
        '[role="radio"], [role="checkbox"], [role="listbox"]',
      ),
    ).toHaveLength(0);
  });

  // The island compares a select's value to MatchingQuestion.key[left]
  // unchanged, so option values must be the right-hand strings themselves,
  // not indices. This is the contract term most easily broken by a
  // well-meaning refactor, and nothing else would catch it.
  it("matching selects carry the right-item strings as values, not indices (island contract)", () => {
    const { container } = render(<Hero />);
    const selects = Array.from(
      container.querySelectorAll("select[data-demo-match]"),
    );
    expect(selects.map((sel) => sel.getAttribute("data-left"))).toEqual([
      "2, 4, 8, 16",
      "2, 5, 10, 17",
      "1, 4, 9, 16",
      "3, 6, 9, 12",
    ]);
    for (const sel of selects) {
      const values = Array.from(sel.querySelectorAll("option")).map((o) =>
        o.getAttribute("value"),
      );
      expect(values).toEqual([
        "",
        "Each term is twice the one before it",
        "Add the next odd number, starting at 3",
        "Squares of the natural numbers",
        "Multiples of 3",
      ]);
    }
  });

  // Every stem, option and rule is readable text in the HTML — the
  // assertion that protects both the crawler and the no-JavaScript
  // visitor. If this fails, the page has become a JavaScript app.
  it("every prompt, option and rule is prerendered as text (D2)", () => {
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    for (const needle of [
      "What comes next in the series?",
      "3, 7, 15, 31, 63, ?",
      "Which of these numbers are divisible by 6?",
      "Match each series to the rule that generates it.",
      "95",
      "117",
      "127",
      "131",
      "114",
      "128",
      "222",
      "345",
      "432",
      "Squares of the natural numbers",
      "Multiples of 3",
    ]) {
      expect(text).toContain(needle);
    }
  });

  it("prerenders the control bar inert: three pips, the count, a disabled real button", () => {
    const { container } = render(<Hero />);
    const pips = container.querySelectorAll("[data-demo-pip]");
    expect(pips).toHaveLength(3);
    for (const pip of Array.from(pips)) {
      expect(pip.getAttribute("data-on")).toBe("0");
    }
    expect(container.querySelector("[data-demo-count]")).toHaveTextContent(
      "0 of 3 answered",
    );
    const button = container.querySelector("[data-demo-score-btn]");
    expect(button?.tagName).toBe("BUTTON");
    expect(button).toBeDisabled();
    expect(container.querySelector("[data-demo-nojs]")).not.toBeNull();
  });

  // D5: a visitor who has just taken an exam will assume the product runs.
  // Nothing in the prerendered markup may look like a result.
  it("carries no score, verdict or result in the markup (D5)", () => {
    const { container } = render(<Hero />);
    expect(container.querySelector("[data-demo-score]")).toHaveAttribute(
      "hidden",
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/You scored/);
    expect(text).not.toMatch(/\d+\.\d\d \/ \d/);
  });

  // v4: the masthead is the product name in Kalam, and it is aria-hidden —
  // TopNav already announces "Pariksha" and a screen reader should not meet
  // it twice before reaching the headline.
  it("renders the Kalam masthead once, aria-hidden", () => {
    const { container } = render(<Hero />);
    const masthead = container.querySelector(".hero-masthead");
    expect(masthead).not.toBeNull();
    expect(masthead).toHaveAttribute("aria-hidden", "true");
    expect(masthead?.querySelector(".hero-masthead__name")).toHaveTextContent(
      "Pariksha",
    );
  });

  it("has no primary filled CTA in the hero — the demo is the action (§3.1, T20)", () => {
    const { container } = render(<Hero />);
    expect(container.querySelector(".button-primary")).toBeNull();
  });

  it("keeps exactly two secondary text links on voltage: the repo and the status anchor", () => {
    const { container } = render(<Hero />);
    expect(
      within(container).getByRole("link", { name: "Read the code on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/SriSatyaLokesh/pariksha");
    expect(
      within(container).getByRole("link", { name: "What is built today" }),
    ).toHaveAttribute("href", "#status");
  });

  // A2 moved the bridge band out of the hero; it renders below it now,
  // carrying exactly the same prose and the same CB-1a excerpt.
  it("the bridge band prerenders CB-1a and the server-side-key honesty prose (§3.8, D5)", () => {
    const { container } = render(<HeroBridge />);
    const text = container.textContent ?? "";
    expect(text).toContain("The three questions above are this file.");
    expect(text).toMatch(/LOG-001/);
    expect(text).toMatch(/there is nothing to call/);
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
