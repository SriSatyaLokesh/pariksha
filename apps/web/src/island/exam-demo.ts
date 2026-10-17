// The hero's interactive exam demo — the one island this page ships.
//
// Progressive enhancement, not hydration (D2): this module upgrades
// prerendered markup in place and never renders a question from scratch.
// With no JavaScript, or on any failure, the prerendered page (static
// question 1, the no-JavaScript sentence, the fallback link) is what the
// visitor sees — this file's job is to never make that worse.
//
// No network call, no storage, no telemetry, ever (D3). See the forbidden
// list in `apps/web/test/island.test.ts`.
//
// Spec: docs/superpowers/specs/2026-10-17-landing-page-v3-interactive.md §2-§3.

import { gradeChoice, round2, type ChoiceQuestion } from "@pariksha/core";

import { GRADING, type GradingQuestion } from "./questions";

// §2.4: the only arithmetic this island is permitted to contain is the
// `round2(sum)` below. Every point value it renders comes out of
// `gradeChoice` (I-5). `DEFAULTS` never applies — every demo question
// declares its own `scoring.mode` and `scoring.points` — it is passed
// because the signature requires it. No `passMarkPercent` anywhere.
const DEFAULTS = { mode: "all_or_nothing", negativeFraction: 0.25 } as const;

// `GRADING` carries only the five fields `gradeChoice` reads (§2.2); the
// two `QuestionBase` fields it never reads — `prompt` and `options` — are
// deliberately absent so the island does not ship a second copy of what the
// React hero already prerenders from `PROMPTS`. This cast is what that
// omission costs, and it is the only one in the file.
function asChoiceQuestion(q: GradingQuestion): ChoiceQuestion {
  return q as unknown as ChoiceQuestion;
}

const EXAMPLES_HREF = "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude";
const CORE_HREF = "https://github.com/SriSatyaLokesh/pariksha/tree/main/packages/core";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type ResponseValue =
  | { kind: "option"; option: string }
  | { kind: "options"; options: string[] }
  | { kind: "boolean"; value: boolean };

/** One question, resolved once in `init()` so no index access can miss. */
interface Item {
  li: HTMLElement;
  qid: string;
  q: GradingQuestion;
}

interface State {
  phase: "answering" | "finished";
  current: number;
  answers: Record<string, ResponseValue | null>;
  marked: Set<string>;
}

const KIND_LABEL: Record<GradingQuestion["type"], string> = {
  single: "Single choice.",
  true_false: "True or false.",
  multiple: "Select all that apply.",
};

function pointsLabel(n: number): string {
  return `${n} point${n === 1 ? "" : "s"}.`;
}

function paletteLabel(num: number, answered: boolean, marked: boolean): string {
  const state = marked
    ? answered
      ? "marked for review, answered"
      : "marked for review, not answered"
    : answered
      ? "answered"
      : "not answered";
  return `Question ${num}, ${state}`;
}

// ---------------------------------------------------------------------------
// Init — upgrades prerendered markup in place. Never throws past this
// function: every failure, found here or in a listener, falls back to the
// untouched static page (I-10).
// ---------------------------------------------------------------------------

export function init(doc: Document = document): void {
  const root = doc.querySelector<HTMLElement>("[data-demo]");
  if (!root) return;

  const liveNode = root.querySelector<HTMLElement>("[data-demo-live]");
  const paletteNode = root.querySelector<HTMLElement>("[data-demo-palette]");
  const controlsNode = root.querySelector<HTMLElement>("[data-demo-controls]");
  const resultNode = root.querySelector<HTMLElement>("[data-demo-result]");
  const linkNode = controlsNode?.querySelector("a") ?? null;

  // Rule 1 (§2.8): nothing is mutated before everything is found. The
  // aliases below are what carry that narrowing into every closure.
  if (!liveNode || !paletteNode || !controlsNode || !resultNode || !linkNode) return;
  const live = liveNode;
  const palette = paletteNode;
  const controls = controlsNode;
  const result = resultNode;
  const fallbackLink = linkNode;

  const items: Item[] = [];
  for (const [i, li] of Array.from(root.querySelectorAll<HTMLElement>("[data-demo-q]")).entries()) {
    const qid = li.dataset.qid;
    const q = GRADING[i];
    if (!qid || !q || q.id !== qid) return;
    items.push({ li, qid, q });
  }
  if (items.length === 0 || items.length !== GRADING.length) return;

  // Rule 2 (§2.8): the original markup is captured before the first write.
  const controlsHTML = controls.innerHTML;
  const paletteHTML = palette.innerHTML;

  const cleanups: Array<() => void> = [];
  function on<K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
  ): void {
    el.addEventListener(type, handler as EventListener);
    cleanups.push(() => {
      el.removeEventListener(type, handler as EventListener);
    });
  }

  function restore(): void {
    for (const off of cleanups.splice(0)) off();
    controls.innerHTML = controlsHTML;
    controls.hidden = false;
    palette.innerHTML = paletteHTML;
    palette.hidden = false;
    palette.setAttribute("aria-hidden", "true");
    items.forEach((item, i) => {
      item.li.hidden = i !== 0;
    });
    result.hidden = true;
    result.innerHTML = "";
    live.textContent = "";
  }

  // Rule 3/4 (§2.8): every listener body runs inside `run`; on a throw the
  // page is restored to the no-JavaScript state and nothing is reported.
  function run(fn: () => void): void {
    try {
      fn();
    } catch {
      try {
        restore();
      } catch {
        /* nothing left to do */
      }
    }
  }

  run(() => {
    function readResponse(item: Item): ResponseValue | null {
      const inputs = Array.from(item.li.querySelectorAll<HTMLInputElement>(`input[name="${item.qid}"]`));
      if (item.q.type === "multiple") {
        const selected = inputs.filter((input) => input.checked).map((input) => input.value);
        return selected.length ? { kind: "options", options: selected } : null;
      }
      const checked = inputs.find((input) => input.checked);
      if (!checked) return null;
      if (item.q.type === "true_false") return { kind: "boolean", value: checked.value === "true" };
      return { kind: "option", option: checked.value };
    }

    function at(index: number): Item | null {
      return items[index] ?? null;
    }

    // On init the island reads the DOM's current checked state into its
    // model rather than resetting it (§3.2): a visitor who ticks an option
    // before the module arrives keeps that answer.
    const answers: Record<string, ResponseValue | null> = {};
    for (const item of items) answers[item.qid] = readResponse(item);

    const state: State = { phase: "answering", current: 0, answers, marked: new Set() };

    // -- build controls: Back / Mark for review / Next / Finish, ahead of
    //    the fallback link, which stays (I-9). -----------------------------
    //    I-8: none of these is `ButtonPrimary` and none carries its class.
    function makeButton(label: string, modifier: string): HTMLButtonElement {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = `runner-mock__control runner-mock__control--${modifier}`;
      btn.textContent = label;
      return btn;
    }

    const backBtn = makeButton("Back", "secondary");
    const markBtn = makeButton("Mark for review", "tertiary");
    markBtn.setAttribute("aria-pressed", "false");
    const nextBtn = makeButton("Next", "secondary");
    // §3.6: the one custom shortcut is announced, never hidden.
    const hint = doc.createElement("span");
    hint.className = "runner-mock__hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "Enter →";
    nextBtn.append(" ", hint);
    const finishBtn = makeButton("Finish", "primary");

    for (const node of Array.from(controls.childNodes)) {
      if (node !== fallbackLink) controls.removeChild(node);
    }
    const buttons = doc.createDocumentFragment();
    buttons.append(backBtn, markBtn, nextBtn, finishBtn);
    controls.insertBefore(buttons, fallbackLink);

    // -- build the palette as navigation ------------------------------------
    //    §3.6: a 36x36 visual square inside a 44x44 hit area, which is why
    //    the square is an inner span and the button around it is the target.
    palette.innerHTML = "";
    palette.removeAttribute("aria-hidden");
    const paletteButtons = items.map((_item, i) => {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "runner-mock__square-button";
      const square = doc.createElement("span");
      square.className = "runner-mock__square";
      square.textContent = String(i + 1);
      btn.append(square);
      palette.append(btn);
      return { btn, square };
    });

    function renderPanel(): void {
      items.forEach((item, i) => {
        item.li.hidden = i !== state.current;
      });
      paletteButtons.forEach(({ btn, square }, i) => {
        const item = at(i);
        if (!item) return;
        const answered = state.answers[item.qid] != null;
        const marked = state.marked.has(item.qid);
        const isCurrent = i === state.current;
        square.classList.toggle("runner-mock__square--current", isCurrent);
        square.classList.toggle("runner-mock__square--marked", marked);
        square.classList.toggle("runner-mock__square--answered", answered && !marked);
        if (isCurrent) btn.setAttribute("aria-current", "true");
        else btn.removeAttribute("aria-current");
        btn.setAttribute("aria-label", paletteLabel(i + 1, answered, marked));
      });
      backBtn.disabled = state.current === 0;
      nextBtn.disabled = state.current === items.length - 1;
      const current = at(state.current);
      markBtn.setAttribute("aria-pressed", String(current !== null && state.marked.has(current.qid)));
      const answeredCount = items.filter((item) => state.answers[item.qid] != null).length;
      // §2.4: at rest the label reads `Finish` and nothing else; the count
      // arrives with the first answer and stays.
      finishBtn.textContent = answeredCount > 0 ? `Finish (${answeredCount} of ${items.length} answered)` : "Finish";
    }

    function goTo(index: number): void {
      const item = at(index);
      if (!item) return;
      state.current = index;
      renderPanel();
      item.li.focus();
      live.textContent = `Question ${index + 1} of ${items.length}. ${KIND_LABEL[item.q.type]} ${pointsLabel(
        item.q.scoring.points,
      )}`;
    }

    function renderResult(): void {
      // I-5: every point value below comes out of `gradeChoice`, and the
      // one sum is rounded by the engine's own `round2`, not a local copy.
      const results = items.map((item) =>
        gradeChoice(asChoiceQuestion(item.q), state.answers[item.qid] ?? null, DEFAULTS),
      );
      const total = round2(results.reduce((sum, r) => sum + r.points, 0));
      const maxTotal = round2(results.reduce((sum, r) => sum + r.max, 0));
      const answeredCount = items.filter((item) => state.answers[item.qid] != null).length;
      const allCorrect = results.every((r) => r.points === r.max);

      let secondLine: string;
      if (answeredCount === 0) {
        secondLine = "You did not answer any of them. Try again, or read the file below.";
      } else if (allCorrect) {
        secondLine = "All three. The worked example has fourteen more.";
      } else {
        secondLine = `${Math.round((total / maxTotal) * 100)}% · this demo sets no pass mark`;
      }

      const rows = items
        .map((item, i) => {
          const r = results[i];
          if (!r) return "";
          const answered = state.answers[item.qid] != null;
          const correct = r.points === r.max;
          // §3.7: `Not answered` comes from the island's own null check, not
          // from `GradeResult.correct` — the distinction is presentation.
          const verdict = !answered ? "Not answered" : correct ? "Correct" : r.points > 0 ? "Partly correct" : "Wrong";
          const showExplanation = answered && !correct;
          return (
            `<li class="runner-mock__result-row">` +
            `<span class="runner-mock__result-type">${item.q.type}</span>` +
            `<span class="runner-mock__result-points">${r.points.toFixed(2)} / ${r.max}</span>` +
            `<span class="runner-mock__result-verdict">${verdict}</span>` +
            (showExplanation ? `<p class="runner-mock__result-explanation">${item.q.explanation}</p>` : "") +
            `</li>`
          );
        })
        .join("");

      result.innerHTML =
        `<h3 class="runner-mock__title runner-mock__result-score" tabindex="-1">You scored ${total.toFixed(2)} out of ${maxTotal}</h3>` +
        `<p class="runner-mock__result-summary">${secondLine}</p>` +
        `<ol class="runner-mock__result-rows">${rows}</ol>` +
        `<p class="runner-mock__result-link"><a href="${EXAMPLES_HREF}">Read the whole test — seventeen questions, three sections, the scoring</a></p>` +
        `<p class="runner-mock__result-prose"><strong>What just happened.</strong> The scoring is real: ` +
        `<code>@pariksha/core</code>, the module that will grade every attempt, is bundled into this page, and ` +
        `it is the part of Pariksha that is built and tested today. Questions 1 and 2 are all-or-nothing; ` +
        `question 3 is partial-credit, which is why its score has a decimal. A question left blank scores ` +
        `zero and never loses points, and the options are not shuffled here.</p>` +
        `<p class="runner-mock__result-prose"><strong>What is not real.</strong> This demo scores in your ` +
        `browser because there is nothing to call. A real Pariksha test does the opposite: the answer key ` +
        `stays on the server and never reaches a candidate, every rule is re-checked there, and the clock ` +
        `runs there too. The scoring engine, the formats, the schemas and this worked example are published ` +
        `today; the runner, the server, proctoring and the results CSV land with v0.1.</p>` +
        `<p class="runner-mock__result-link"><a href="${CORE_HREF}">See how that was scored</a> · ` +
        `<a href="#hero-bridge">the question, the key and the explanation</a></p>` +
        `<p class="runner-mock__result-link"><a href="#how-it-works">How you would run this yourself</a></p>` +
        `<button type="button" class="runner-mock__control runner-mock__control--tertiary" data-demo-retry>Try again</button>`;

      result.hidden = false;
      for (const item of items) item.li.hidden = true;
      palette.hidden = true;
      controls.hidden = true;
      // §3.6: on Finish the live region receives nothing — the focus move
      // announces the score, and two mechanisms on one event double-announce.
      live.textContent = "";
      result.querySelector<HTMLElement>(".runner-mock__result-score")?.focus();
    }

    function finish(): void {
      state.phase = "finished";
      renderResult();
    }

    function tryAgain(): void {
      state.phase = "answering";
      state.current = 0;
      state.marked.clear();
      items.forEach((item, i) => {
        state.answers[item.qid] = null;
        item.li.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
          input.checked = false;
        });
        item.li.hidden = i !== 0;
      });
      palette.hidden = false;
      controls.hidden = false;
      result.hidden = true;
      result.innerHTML = "";
      live.textContent = "";
      renderPanel();
      at(0)?.li.focus();
    }

    on(root, "change", (e) => {
      run(() => {
        const target = e.target as HTMLElement;
        if (target.tagName !== "INPUT") return;
        const li = target.closest<HTMLElement>("[data-demo-q]");
        if (!li) return;
        const item = items.find((candidate) => candidate.li === li);
        if (!item) return;
        state.answers[item.qid] = readResponse(item);
        renderPanel();
      });
    });

    on(root, "click", (e) => {
      run(() => {
        const btn = (e.target as HTMLElement).closest("button");
        if (!btn) return;
        if (btn === backBtn) {
          if (state.current > 0) goTo(state.current - 1);
          return;
        }
        if (btn === nextBtn) {
          if (state.current < items.length - 1) goTo(state.current + 1);
          return;
        }
        if (btn === finishBtn) {
          finish();
          return;
        }
        if (btn === markBtn) {
          const item = at(state.current);
          if (!item) return;
          if (state.marked.has(item.qid)) state.marked.delete(item.qid);
          else state.marked.add(item.qid);
          renderPanel();
          live.textContent = `Question ${state.current + 1} marked for review.`;
          return;
        }
        const paletteIndex = paletteButtons.findIndex((entry) => entry.btn === btn);
        if (paletteIndex !== -1) {
          goTo(paletteIndex);
          return;
        }
        if (btn.hasAttribute("data-demo-retry")) {
          tryAgain();
        }
      });
    });

    // The one custom keyboard binding (§3.6): Enter advances, or finishes
    // on the last question. Guarded so it never double-fires a native
    // button or link activation (§2.4's "Enter guard").
    on(root, "keydown", (e) => {
      run(() => {
        if (e.key !== "Enter") return;
        const target = e.target as HTMLElement;
        if (target.closest("button, a")) return;
        if (!target.closest("[data-demo-q]")) return;
        e.preventDefault();
        if (state.current < items.length - 1) goTo(state.current + 1);
        else finish();
      });
    });

    renderPanel();
  });
}

if (typeof document !== "undefined") {
  init();
}
