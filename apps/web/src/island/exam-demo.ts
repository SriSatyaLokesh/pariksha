// The hero's interactive exam demo — the one island this page ships.
//
// v4: three cards (single, multiple, matching), scored together, replacing
// the v3 one-question-at-a-time runner. Owner-approved prototype:
// .planning/landing/v4-hero-prototype.html.
//
// Progressive enhancement, not hydration: this module upgrades prerendered
// markup in place and never renders a card from scratch. With no
// JavaScript, or on any failure, the prerendered page — all three cards,
// real inputs, the no-JavaScript sentence, the fallback link — is what the
// visitor sees; this file's job is to never make that worse.
//
// No network call, no storage, no telemetry, ever. See the forbidden list
// in apps/web/test/island-artefact.test.ts.
//
// -----------------------------------------------------------------------
// The public contract with the prerendered markup (data attributes only,
// never class names — a renamed block must not break the demo):
//
//   data-demo                  the root. Absent -> the island returns,
//                               having touched nothing.
//   data-demo-card + data-qid  each card; data-qid is the key into GRADING,
//                               in the same order.
//   data-demo-verdict          inside each card: an empty, hidden element
//                               the island writes a verdict into on Score.
//   input[name=qid]            single/multiple cards: same as before.
//   select[data-demo-match]
//     + data-left="<left>"     matching card: one <select> per left row;
//                               its value is the chosen right-item string
//                               (not an index — it is compared to
//                               MatchingQuestion.key[left] unchanged).
//   data-demo-pips             the status strip; data-demo-pip x N,
//                               GRADING.length of them, each toggling
//                               data-on="0"|"1".
//   data-demo-count            a polite live region: "N of 3 answered".
//   data-demo-score-btn        a real, prerendered <button disabled>. The
//                               island enables/disables it; never replaced.
//   data-demo-score            a polite live region, hidden until Score is
//                               pressed; then holds the total.
//   data-demo-nojs (optional)  a sentence explaining Score needs
//                               JavaScript; removed on successful init.
//
// The island writes only: `hidden` and `textContent`/`innerHTML` on the
// nodes above, `disabled` and the label on the Score button, `data-on` on
// the pips, and `data-state` on a card ("right" | "wrong" | "unanswered").
// It sets no `style` attribute and no `element.style` property, ever.
// -----------------------------------------------------------------------
//
// Scores through `gradeQuestion`, the public dispatcher, rather than
// deep-importing `grade/structured.js` (forbidden: packages/core's own
// acceptance test rejects a deep import, and only `gradeChoice` is a
// direct public export today). The cost: `gradeQuestion` statically
// references `grade/text.ts`'s pattern compiler and `grade/manual.ts`,
// about 4.4 KB minified this demo never reaches (measured by bundling
// `gradeChoice`+a direct `gradeStructured` import in isolation vs.
// `gradeQuestion` alone). See this PR's deviations: if
// `packages/core/src/index.ts` gains a direct `gradeStructured` export
// (the same shape as its existing `gradeChoice` one, for the same reason),
// switching to it recovers that 4.4 KB — a budget optimisation, not a
// correctness fix, since `gradeQuestion` already dispatches to the same
// `gradeStructured` internally for a `matching` question.

import { gradeQuestion, round2, type Question } from "@pariksha/core";

import { GRADING, type GradingQuestion } from "./questions";

// The only arithmetic this island is permitted to contain is the
// `round2(sum)` below. Every point value it renders comes out of
// `gradeQuestion`. `DEFAULTS` never applies — every demo question declares
// its own `scoring.mode` — it is passed because the signature requires it.
const DEFAULTS = { mode: "all_or_nothing", negativeFraction: 0.25 } as const;

// `GradingQuestion` carries only the fields `gradeQuestion` reads for these
// three types; the `QuestionBase` fields it never reads (`prompt`,
// `options`, `right`) are deliberately absent so the island does not ship a
// second copy of what the React hero already prerenders from `PROMPTS`.
// This cast is what that omission costs, and it is the only one in the file.
function asQuestion(q: GradingQuestion): Question {
  return q as unknown as Question;
}

type ResponseValue =
  | { kind: "option"; option: string }
  | { kind: "options"; options: string[] }
  | { kind: "map"; pairs: Record<string, string> };

interface Item {
  card: HTMLElement;
  qid: string;
  q: GradingQuestion;
  verdict: HTMLElement;
}

interface State {
  scored: boolean;
  answers: Record<string, ResponseValue | null>;
}

const TYPE_LABEL: Record<GradingQuestion["type"], string> = {
  single: "single",
  multiple: "multiple",
  matching: "matching",
};

export function init(doc: Document = document): void {
  const root = doc.querySelector<HTMLElement>("[data-demo]");
  if (!root) return;

  const pipsNode = root.querySelector<HTMLElement>("[data-demo-pips]");
  const countNode = root.querySelector<HTMLElement>("[data-demo-count]");
  const scoreBtnNode = root.querySelector<HTMLButtonElement>("[data-demo-score-btn]");
  const scoreLiveNode = root.querySelector<HTMLElement>("[data-demo-score]");
  const cardNodes = Array.from(root.querySelectorAll<HTMLElement>("[data-demo-card]"));

  // Rule 1: nothing is mutated before everything is found. A single missing
  // hook means an immediate return with the DOM untouched.
  if (!pipsNode || !countNode || !scoreBtnNode || !scoreLiveNode) return;
  const countEl = countNode;
  const scoreBtn = scoreBtnNode;
  const scoreLive = scoreLiveNode;
  const pips = Array.from(pipsNode.querySelectorAll<HTMLElement>("[data-demo-pip]"));
  if (pips.length !== GRADING.length || cardNodes.length !== GRADING.length) return;

  const items: Item[] = [];
  for (const [i, card] of cardNodes.entries()) {
    const qid = card.dataset.qid;
    const q = GRADING[i];
    const verdict = card.querySelector<HTMLElement>("[data-demo-verdict]");
    if (!qid || !q || q.id !== qid || !verdict) return;
    items.push({ card, qid, q, verdict });
  }

  // Rule 2: the original markup is captured before the first write.
  const initial = {
    count: countEl.textContent ?? "",
    scoreBtnText: scoreBtn.textContent ?? "",
    scoreBtnDisabled: scoreBtn.disabled,
    scoreLiveHidden: scoreLive.hidden,
  };

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
    pips.forEach((pip) => {
      pip.dataset.on = "0";
    });
    countEl.textContent = initial.count;
    scoreBtn.textContent = initial.scoreBtnText;
    scoreBtn.disabled = initial.scoreBtnDisabled;
    scoreLive.hidden = initial.scoreLiveHidden;
    scoreLive.textContent = "";
    for (const item of items) {
      item.verdict.hidden = true;
      item.verdict.innerHTML = "";
      delete item.card.dataset.state;
    }
  }

  // Rule 3/4: every listener body runs inside `run`; on a throw the page is
  // restored to the no-JavaScript-equivalent state and nothing is reported.
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
      if (item.q.type === "multiple") {
        const inputs = Array.from(item.card.querySelectorAll<HTMLInputElement>(`input[name="${item.qid}"]`));
        const selected = inputs.filter((input) => input.checked).map((input) => input.value);
        return selected.length ? { kind: "options", options: selected } : null;
      }
      if (item.q.type === "single") {
        const inputs = Array.from(item.card.querySelectorAll<HTMLInputElement>(`input[name="${item.qid}"]`));
        const checked = inputs.find((input) => input.checked);
        return checked ? { kind: "option", option: checked.value } : null;
      }
      // matching: one <select> per left row; a row left blank is simply
      // absent from `pairs` — a partially filled map still counts as
      // answered (gradeStructured scores only the entries present).
      const pairs: Record<string, string> = {};
      for (const sel of Array.from(item.card.querySelectorAll<HTMLSelectElement>("select[data-demo-match]"))) {
        const left = sel.dataset.left;
        if (left && sel.value) pairs[left] = sel.value;
      }
      return Object.keys(pairs).length ? { kind: "map", pairs } : null;
    }

    // On init the island reads the DOM's current state into its model
    // rather than resetting it: a visitor who answers before the module
    // arrives keeps that answer.
    const answers: Record<string, ResponseValue | null> = {};
    for (const item of items) answers[item.qid] = readResponse(item);
    const state: State = { scored: false, answers };

    function updateStatus(): void {
      const answeredFlags = items.map((item) => state.answers[item.qid] != null);
      pips.forEach((pip, i) => {
        pip.dataset.on = answeredFlags[i] ? "1" : "0";
      });
      const n = answeredFlags.filter(Boolean).length;
      countEl.textContent = `${n} of ${items.length} answered`;
      if (!state.scored) scoreBtn.disabled = n === 0;
    }

    function score(): void {
      // Every point value below comes out of `gradeQuestion`; the one sum
      // is rounded by the engine's own `round2`, not a local copy.
      const results = items.map((item) => gradeQuestion(asQuestion(item.q), state.answers[item.qid] ?? null, DEFAULTS));
      const total = round2(results.reduce((sum, r) => sum + r.points, 0));
      const maxTotal = round2(results.reduce((sum, r) => sum + r.max, 0));

      items.forEach((item, i) => {
        const r = results[i]!;
        const answered = state.answers[item.qid] != null;
        const correct = r.points === r.max;
        const showExplanation = answered && !correct;
        const verdictWord = !answered ? "Not answered" : correct ? "Correct" : r.points > 0 ? "Partly correct" : "Wrong";
        item.card.dataset.state = !answered ? "unanswered" : correct ? "right" : "wrong";
        item.verdict.hidden = false;
        item.verdict.innerHTML =
          `<span class="runner-mock__result-type">${TYPE_LABEL[item.q.type]}</span>` +
          `<span class="runner-mock__result-verdict">${verdictWord}</span>` +
          `<span class="runner-mock__result-points">${r.points.toFixed(2)} / ${r.max}</span>` +
          (showExplanation ? `<p class="runner-mock__result-explanation">${item.q.explanation}</p>` : "");
      });

      scoreLive.hidden = false;
      scoreLive.textContent = `You scored ${total.toFixed(2)} out of ${maxTotal}`;
      state.scored = true;
      scoreBtn.disabled = true;
      scoreBtn.textContent = "Scored";
    }

    on(root, "change", (e) => {
      run(() => {
        const target = e.target as HTMLElement;
        const card = target.closest<HTMLElement>("[data-demo-card]");
        if (!card) return;
        const item = items.find((candidate) => candidate.card === card);
        if (!item) return;
        state.answers[item.qid] = readResponse(item);
        updateStatus();
      });
    });

    on(root, "click", (e) => {
      run(() => {
        const btn = (e.target as HTMLElement).closest("button");
        if (btn === scoreBtn && !scoreBtn.disabled) score();
      });
    });

    // §2.8-equivalent: once the island is live, Score is the real control;
    // the no-JavaScript sentence is no longer the honest description.
    const nojs = root.querySelector<HTMLElement>("[data-demo-nojs]");
    if (nojs) nojs.hidden = true;

    updateStatus();
  });
}

if (typeof document !== "undefined") {
  init();
}
