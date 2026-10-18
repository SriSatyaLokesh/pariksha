// Tests for the hero's v4 exam-demo island — three cards scored at once
// (single, multiple, matching), owner-approved prototype at
// .planning/landing/v4-hero-prototype.html.
//
// Behaviour tests (answered-detection, pips/count, the enable rule, scoring,
// no-markup no-op, error path) run the TypeScript module directly under
// jsdom, against a hand-built fixture that matches the data-attribute
// contract documented at the top of src/island/exam-demo.ts — this file
// does not depend on apps/web/src/sections/s1-s3/Hero.tsx, which is another
// assignment's ownership and may not reflect the v4 markup yet.
//
// The artefact checks (network/storage ban, no timers, no inline style or
// colour literal, size budget) live in island-artefact.test.ts, which is
// NOT owned by this assignment: esbuild's API refuses to run under jsdom
// (that file asks for the node environment), so a jsdom file cannot host
// them without splitting its environment mid-file, which Vitest does not
// support. See the handoff note in this PR's deviations for the measured
// bundle size and the budget-file amendment that file still needs.
import { beforeEach, describe, expect, it } from "vitest";
import { init } from "../src/island/exam-demo";

const FALLBACK_HREF = "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude";
const FALLBACK_TEXT = "These three questions, and fourteen more, are in the worked example";
const NOJS_SENTENCE = "Scoring needs JavaScript.";

// ---------------------------------------------------------------------------
// Fixture: hand-built prerendered markup for the v4 contract — three cards
// always visible side by side, a pips/count status row, one Score button
// disabled until the first answer, and a per-card verdict slot.
// ---------------------------------------------------------------------------

function matchingSelect(left: string, right: readonly string[]): string {
  const options = right.map((r) => `<option value="${r}">${r}</option>`).join("");
  return `<select data-demo-match data-left="${left}"><option value="">Choose a rule…</option>${options}</select>`;
}

const RIGHT = [
  "Each term is twice the one before it",
  "Add the next odd number, starting at 3",
  "Squares of the natural numbers",
  "Multiples of 3",
];
const LEFT = ["2, 4, 8, 16", "2, 5, 10, 17", "1, 4, 9, 16", "3, 6, 9, 12"];

function fixtureHTML(): string {
  return `
    <div class="runner-mock runner-mock--demo" data-demo>
      <h2 id="demo-heading">Try three questions</h2>
      <div class="runner-mock__cards">
        <article data-demo-card data-qid="LOG-001" aria-labelledby="c1p">
          <p id="c1p">What comes next in the series?</p>
          <fieldset>
            <legend class="visually-hidden">Options</legend>
            <label><input type="radio" name="LOG-001" value="a" /><span>95</span></label>
            <label><input type="radio" name="LOG-001" value="b" /><span>117</span></label>
            <label><input type="radio" name="LOG-001" value="c" /><span>127</span></label>
            <label><input type="radio" name="LOG-001" value="d" /><span>131</span></label>
          </fieldset>
          <p data-demo-verdict hidden></p>
        </article>
        <article data-demo-card data-qid="QNT-004" aria-labelledby="c2p">
          <p id="c2p">Which are divisible by 6?</p>
          <fieldset>
            <legend class="visually-hidden">Options</legend>
            <label><input type="checkbox" name="QNT-004" value="a" /><span>114</span></label>
            <label><input type="checkbox" name="QNT-004" value="b" /><span>128</span></label>
            <label><input type="checkbox" name="QNT-004" value="c" /><span>222</span></label>
            <label><input type="checkbox" name="QNT-004" value="d" /><span>345</span></label>
            <label><input type="checkbox" name="QNT-004" value="e" /><span>432</span></label>
          </fieldset>
          <p data-demo-verdict hidden></p>
        </article>
        <article data-demo-card data-qid="LOG-003" aria-labelledby="c3p">
          <p id="c3p">Match each series to the rule that generates it.</p>
          <div class="runner-mock__match">
            ${LEFT.map((l) => matchingSelect(l, RIGHT)).join("")}
          </div>
          <p data-demo-verdict hidden></p>
        </article>
      </div>
      <div class="runner-mock__status">
        <ul data-demo-pips aria-label="Questions answered">
          <li data-demo-pip data-on="0">1</li>
          <li data-demo-pip data-on="0">2</li>
          <li data-demo-pip data-on="0">3</li>
        </ul>
        <span data-demo-count aria-live="polite">0 of 3 answered</span>
      </div>
      <div class="runner-mock__actions">
        <span data-demo-score aria-live="polite" hidden></span>
        <button type="button" data-demo-score-btn disabled>Score my answers</button>
        <p data-demo-nojs>${NOJS_SENTENCE}</p>
        <a class="runner-mock__fallback" href="${FALLBACK_HREF}">${FALLBACK_TEXT}</a>
      </div>
    </div>
  `;
}

function mount() {
  document.body.innerHTML = fixtureHTML();
  return {
    root: document.querySelector<HTMLElement>("[data-demo]")!,
    cards: Array.from(document.querySelectorAll<HTMLElement>("[data-demo-card]")),
    pips: Array.from(document.querySelectorAll<HTMLElement>("[data-demo-pip]")),
    count: document.querySelector<HTMLElement>("[data-demo-count]")!,
    scoreBtn: document.querySelector<HTMLButtonElement>("[data-demo-score-btn]")!,
    scoreLive: document.querySelector<HTMLElement>("[data-demo-score]")!,
  };
}

function check(input: HTMLInputElement): void {
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function uncheck(input: HTMLInputElement): void {
  input.checked = false;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function select(sel: HTMLSelectElement, value: string): void {
  sel.value = value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function selectsOf(card: HTMLElement): HTMLSelectElement[] {
  return Array.from(card.querySelectorAll("select"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Answered-detection, the count, the pips, and the enable rule.
// ---------------------------------------------------------------------------

describe("answered-detection, count, pips and the enable rule", () => {
  it("starts with nothing answered and the Score button disabled", () => {
    const { pips, count, scoreBtn } = mount();
    init(document);
    expect(pips.map((p) => p.dataset.on)).toEqual(["0", "0", "0"]);
    expect(count.textContent).toBe("0 of 3 answered");
    expect(scoreBtn.disabled).toBe(true);
  });

  it("a single-choice answer updates its pip, the count, and enables Score", () => {
    const { root, pips, count, scoreBtn } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);
    expect(pips[0]!.dataset.on).toBe("1");
    expect(count.textContent).toBe("1 of 3 answered");
    expect(scoreBtn.disabled).toBe(false);
  });

  it("a multiple-choice answer counts as answered the instant any box is checked", () => {
    const { root, pips, count } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="a"]')!);
    expect(pips[1]!.dataset.on).toBe("1");
    expect(count.textContent).toBe("1 of 3 answered");
  });

  it("a matching card counts as answered once any row has a selection, before all four are filled", () => {
    const { cards, pips, count } = mount();
    init(document);
    const [first] = selectsOf(cards[2]!);
    select(first!, RIGHT[0]!);
    expect(pips[2]!.dataset.on).toBe("1");
    expect(count.textContent).toBe("1 of 3 answered");
  });

  it("clearing the only answer disables Score again and un-marks its pip", () => {
    const { root, pips, scoreBtn } = mount();
    init(document);
    const optionC = root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!;
    check(optionC);
    expect(scoreBtn.disabled).toBe(false);
    uncheck(optionC);
    expect(pips[0]!.dataset.on).toBe("0");
    expect(scoreBtn.disabled).toBe(true);
  });

  it("all three answered reads 3 of 3", () => {
    const { root, cards, count } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="a"]')!);
    selectsOf(cards[2]!).forEach((s, i) => select(s, RIGHT[i]!));
    expect(count.textContent).toBe("3 of 3 answered");
  });
});

// ---------------------------------------------------------------------------
// Scoring — through @pariksha/core, never reimplemented arithmetic.
// ---------------------------------------------------------------------------

describe("scoring", () => {
  it("scores single (all-or-nothing), multiple (partial) and matching (partial) and totals them", () => {
    const { root, cards, scoreBtn, scoreLive } = mount();
    init(document);

    // LOG-001: correct -> 2.00 / 2.
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);
    // QNT-004: a and c correct, b wrong -> correct=2, wrong=1, total=3 -> 2*(2-1)/3 = 0.67.
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="a"]')!);
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="c"]')!);
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="b"]')!);
    // LOG-003: rows 0 and 2 correct, row 1 wrong, row 3 left blank ->
    // correct=2, wrong=1, total=4 (left.length) -> 2*(2-1)/4 = 0.50.
    const matchSelects = selectsOf(cards[2]!);
    select(matchSelects[0]!, RIGHT[0]!); // correct
    select(matchSelects[1]!, RIGHT[3]!); // wrong
    select(matchSelects[2]!, RIGHT[2]!); // correct
    // row 3 left blank on purpose.

    click(scoreBtn);

    expect(scoreLive.hidden).toBe(false);
    expect(scoreLive.textContent).toBe("You scored 3.17 out of 6");
    expect(cards[0]!.dataset.state).toBe("right");
    expect(cards[0]!.querySelector("[data-demo-verdict]")!.textContent).toContain("2.00 / 2");
    expect(cards[1]!.dataset.state).toBe("wrong");
    expect(cards[1]!.querySelector("[data-demo-verdict]")!.textContent).toContain("0.67 / 2");
    expect(cards[2]!.dataset.state).toBe("wrong");
    expect(cards[2]!.querySelector("[data-demo-verdict]")!.textContent).toContain("0.50 / 2");

    expect(scoreBtn.disabled).toBe(true);
    expect(scoreBtn.textContent).toBe("Scored");
  });

  it("an unattempted card shows no explanation and a blank response scores zero, not negative", () => {
    const { root, cards, scoreBtn, scoreLive } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="a"]')!); // wrong, to enable Score
    click(scoreBtn);
    expect(scoreLive.textContent).toBe("You scored 0.00 out of 6");
    expect(cards[1]!.dataset.state).toBe("unanswered");
    expect(cards[1]!.querySelector("[data-demo-verdict]")!.querySelector(".runner-mock__result-explanation")).toBeNull();
    expect(cards[1]!.querySelector("[data-demo-verdict]")!.textContent).toContain("Not answered");
  });

  it("a fully correct matching card scores the full 2 points with no explanation shown", () => {
    const { cards, scoreBtn } = mount();
    init(document);
    selectsOf(cards[2]!).forEach((s, i) => select(s, RIGHT[i]!));
    click(scoreBtn);
    expect(cards[2]!.dataset.state).toBe("right");
    const verdict = cards[2]!.querySelector("[data-demo-verdict]")!;
    expect(verdict.textContent).toContain("2.00 / 2");
    expect(verdict.querySelector(".runner-mock__result-explanation")).toBeNull();
  });

  it("does not steal focus when scoring", () => {
    const { root, scoreBtn } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);
    scoreBtn.focus();
    click(scoreBtn);
    expect(document.activeElement).toBe(scoreBtn);
  });
});

// ---------------------------------------------------------------------------
// The no-markup no-op (D2 made mechanical for the island's own side).
// ---------------------------------------------------------------------------

describe("no-markup no-op", () => {
  it("does nothing when data-demo is absent", () => {
    document.body.innerHTML = "<p>no demo here</p>";
    const before = document.body.innerHTML;
    expect(() => init(document)).not.toThrow();
    expect(document.body.innerHTML).toBe(before);
  });

  it("does nothing when a required hook is missing", () => {
    const html = fixtureHTML().replace("data-demo-pips", "data-demo-pips-renamed");
    document.body.innerHTML = html;
    const before = document.body.innerHTML;
    init(document);
    expect(document.body.innerHTML).toBe(before);
  });

  it("does nothing when a card's verdict slot is missing", () => {
    const html = fixtureHTML().replace('<p data-demo-verdict hidden></p>', "");
    document.body.innerHTML = html;
    const before = document.body.innerHTML;
    init(document);
    expect(document.body.innerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The error path: a throwing listener restores the static hero, not just
// stops — nothing partially written is left behind (I-10 analogue).
// ---------------------------------------------------------------------------

describe("error path", () => {
  it("restores the static hero when scoring throws", () => {
    const { root, cards, scoreBtn, scoreLive, pips, count } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);

    // Throws inside `score()`, at the total/maxTotal reduce — after Score
    // was clicked and before any DOM write that method makes.
    const original = Array.prototype.reduce;
    Array.prototype.reduce = function () {
      throw new Error("boom");
    } as typeof Array.prototype.reduce;
    try {
      click(scoreBtn);
    } finally {
      Array.prototype.reduce = original;
    }

    expect(scoreLive.hidden).toBe(true);
    expect(scoreLive.textContent).toBe("");
    expect(scoreBtn.disabled).toBe(true); // 0 answered again, since state was reset
    expect(scoreBtn.textContent).toBe("Score my answers");
    expect(pips.map((p) => p.dataset.on)).toEqual(["0", "0", "0"]);
    expect(count.textContent).toBe("0 of 3 answered");
    for (const card of cards) {
      expect(card.querySelector<HTMLElement>("[data-demo-verdict]")!.hidden).toBe(true);
      expect(card.dataset.state).toBeUndefined();
    }

    // And it stays inert: removed listeners do not fire again.
    const after = root.innerHTML;
    click(root);
    expect(root.innerHTML).toBe(after);
  });
});
