// Tests for the hero's exam-demo island (ASSIGNMENT 1).
//
// Behaviour tests (state machine, no-markup no-op, error path) run the
// TypeScript module directly under jsdom, against a hand-built fixture that
// matches the data-attribute contract in v3 spec §2.3 — this file does not
// depend on apps/web/src/sections/s1-s3/Hero.tsx, which is another
// assignment's ownership and may not exist yet.
//
// The artefact checks (network/storage ban, no timers, no inline style or
// colour literal, size budget) bundle+minify the island in isolation with
// esbuild, writing to an OS temp directory — never to apps/web/dist, which
// other agents' tests read concurrently in this shared worktree.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { init } from "../src/island/exam-demo";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture: hand-built prerendered markup matching v3 spec §2.3 and §3.2 —
// three real questions, a fallback link, an inert palette, an empty live
// region and a hidden result panel.
// ---------------------------------------------------------------------------

const FALLBACK_HREF = "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude";
const FALLBACK_TEXT = "These three questions, and fourteen more, are in the worked example";
const NOJS_SENTENCE = "Scoring, and questions 2 and 3, need JavaScript.";

function fixtureHTML(): string {
  return `
    <div class="runner-mock runner-mock--demo" data-demo>
      <h2 id="demo-heading">Try three questions</h2>
      <p class="visually-hidden" aria-live="polite" data-demo-live></p>
      <ol>
        <li data-demo-q data-qid="LOG-001" id="demo-q-1" tabindex="-1" aria-labelledby="demo-stem-1">
          <fieldset>
            <legend id="demo-stem-1">What comes next in the series?</legend>
            <label><input type="radio" name="LOG-001" value="a" /><span>95</span></label>
            <label><input type="radio" name="LOG-001" value="b" /><span>117</span></label>
            <label><input type="radio" name="LOG-001" value="c" /><span>127</span></label>
            <label><input type="radio" name="LOG-001" value="d" /><span>131</span></label>
          </fieldset>
        </li>
        <li data-demo-q data-qid="LOG-007" id="demo-q-2" tabindex="-1" aria-labelledby="demo-stem-2" hidden>
          <fieldset>
            <legend id="demo-stem-2">EARTH is written as FBSUI.</legend>
            <label><input type="radio" name="LOG-007" value="true" /><span>True</span></label>
            <label><input type="radio" name="LOG-007" value="false" /><span>False</span></label>
          </fieldset>
        </li>
        <li data-demo-q data-qid="QNT-004" id="demo-q-3" tabindex="-1" aria-labelledby="demo-stem-3" hidden>
          <fieldset>
            <legend id="demo-stem-3">Which are divisible by 6?</legend>
            <label><input type="checkbox" name="QNT-004" value="a" /><span>114</span></label>
            <label><input type="checkbox" name="QNT-004" value="b" /><span>128</span></label>
            <label><input type="checkbox" name="QNT-004" value="c" /><span>222</span></label>
            <label><input type="checkbox" name="QNT-004" value="d" /><span>345</span></label>
            <label><input type="checkbox" name="QNT-004" value="e" /><span>432</span></label>
          </fieldset>
        </li>
      </ol>
      <div data-demo-palette aria-hidden="true">
        <span class="runner-mock__square runner-mock__square--current">1</span>
        <span class="runner-mock__square">2</span>
        <span class="runner-mock__square">3</span>
      </div>
      <div data-demo-controls>
        <p class="runner-mock__nojs">${NOJS_SENTENCE}</p>
        <a class="runner-mock__fallback" href="${FALLBACK_HREF}">${FALLBACK_TEXT}</a>
      </div>
      <div data-demo-result hidden></div>
    </div>
  `;
}

function mount() {
  document.body.innerHTML = fixtureHTML();
  return {
    root: document.querySelector<HTMLElement>("[data-demo]")!,
    live: document.querySelector<HTMLElement>("[data-demo-live]")!,
    palette: document.querySelector<HTMLElement>("[data-demo-palette]")!,
    controls: document.querySelector<HTMLElement>("[data-demo-controls]")!,
    result: document.querySelector<HTMLElement>("[data-demo-result]")!,
    questions: Array.from(document.querySelectorAll<HTMLElement>("[data-demo-q]")),
  };
}

function check(input: HTMLInputElement): void {
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function controlButtons(controls: HTMLElement): HTMLButtonElement[] {
  return Array.from(controls.querySelectorAll("button"));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// The state machine: answer, change an answer, advance, finish, restart.
// ---------------------------------------------------------------------------

describe("state machine", () => {
  it("upgrades the controls to four buttons and the palette to three, keeping the fallback link", () => {
    const { controls, palette } = mount();
    init(document);

    const buttons = controlButtons(controls);
    expect(buttons.map((b) => b.textContent)).toEqual(["Back", "Mark for review", "Next Enter →", "Finish"]);
    expect(controls.textContent).not.toContain(NOJS_SENTENCE);
    const link = controls.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(FALLBACK_HREF);
    expect(controls.lastElementChild).toBe(link);

    const squares = palette.querySelectorAll("button");
    expect(squares).toHaveLength(3);
    // §3.6: the 36px square is an inner span so the button around it can
    // carry the 44px hit area without growing the visual box.
    expect(palette.querySelectorAll("button > span.runner-mock__square")).toHaveLength(3);
    expect(squares[0]!.getAttribute("aria-current")).toBe("true");
    expect(palette.hasAttribute("aria-hidden")).toBe(false);
  });

  it("answering does not advance the question, and updates the Finish label", () => {
    const { root, controls, questions } = mount();
    init(document);
    const finishBtn = controlButtons(controls)[3]!;
    expect(finishBtn.textContent).toBe("Finish");

    const optionC = root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!;
    check(optionC);

    expect(questions[0]!.hidden).toBe(false);
    expect(questions[1]!.hidden).toBe(true);
    expect(finishBtn.textContent).toBe("Finish (1 of 3 answered)");
  });

  it("changing an answer before advancing keeps only the latest choice", () => {
    const { root, controls } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="a"]')!);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);

    const optionA = root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="a"]')!;
    const optionC = root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!;
    expect(optionA.checked).toBe(false);
    expect(optionC.checked).toBe(true);
    expect(controlButtons(controls)[3]!.textContent).toBe("Finish (1 of 3 answered)");
  });

  it("Next advances, hides the previous question, moves focus and announces", () => {
    const { controls, questions, live } = mount();
    init(document);
    click(controlButtons(controls)[2]!); // Next

    expect(questions[0]!.hidden).toBe(true);
    expect(questions[1]!.hidden).toBe(false);
    expect(document.activeElement).toBe(questions[1]!);
    expect(live.textContent).toBe("Question 2 of 3. True or false. 1 point.");

    click(controlButtons(controls)[2]!); // Next again
    expect(questions[2]!.hidden).toBe(false);
    expect(live.textContent).toBe("Question 3 of 3. Select all that apply. 2 points.");
  });

  it("Back reverses Next, and a palette click jumps directly", () => {
    const { controls, palette, questions } = mount();
    init(document);
    click(controlButtons(controls)[2]!); // -> Q2
    click(controlButtons(controls)[0]!); // Back -> Q1
    expect(questions[0]!.hidden).toBe(false);
    expect(controlButtons(controls)[0]!.disabled).toBe(true); // Back disabled on Q1

    click(palette.querySelectorAll("button")[2]!); // jump to Q3
    expect(questions[2]!.hidden).toBe(false);
    expect(controlButtons(controls)[2]!.disabled).toBe(true); // Next disabled on Q3
  });

  it("Mark for review toggles aria-pressed and composes with answered in the palette label", () => {
    const { root, controls, palette } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);
    const markBtn = controlButtons(controls)[1]!;
    click(markBtn);
    expect(markBtn.getAttribute("aria-pressed")).toBe("true");
    const square1 = palette.querySelectorAll("button")[0]!;
    expect(square1.querySelector("span")!.className).toContain("runner-mock__square--marked");
    expect(square1.getAttribute("aria-label")).toBe("Question 1, marked for review, answered");

    click(markBtn);
    expect(markBtn.getAttribute("aria-pressed")).toBe("false");
    expect(square1.getAttribute("aria-label")).toBe("Question 1, answered");
  });

  it("Finish calls the real scoring, in question order, and total 2.67 out of 5", () => {
    const { root, controls, result, live } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);
    click(controlButtons(controls)[2]!);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-007"][value="false"]')!);
    click(controlButtons(controls)[2]!);
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="a"]')!);
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="c"]')!);
    check(root.querySelector<HTMLInputElement>('input[name="QNT-004"][value="b"]')!);
    click(controlButtons(controls)[3]!); // Finish

    expect(result.hidden).toBe(false);
    const h3 = result.querySelector("h3")!;
    expect(h3.textContent).toBe("You scored 2.67 out of 5");
    const rows = Array.from(result.querySelectorAll(".runner-mock__result-row")).map((r) => r.textContent);
    expect(rows[0]!).toContain("2.00 / 2");
    expect(rows[0]!).toContain("Correct");
    expect(rows[1]!).toContain("0.00 / 1");
    expect(rows[1]!).toContain("Wrong");
    expect(rows[2]!).toContain("0.67 / 2");
    expect(rows[2]!).toContain("Partly correct");
    expect(document.activeElement).toBe(h3);
    expect(live.textContent).toBe("");
  });

  it("an unattempted question shows no explanation, and a wholly unanswered attempt scores zero", () => {
    const { controls, result } = mount();
    init(document);
    click(controlButtons(controls)[3]!); // Finish with nothing answered
    const h3 = result.querySelector("h3")!;
    expect(h3.textContent).toBe("You scored 0.00 out of 5");
    expect(result.querySelectorAll(".runner-mock__result-row")).toHaveLength(3);
    expect(result.querySelectorAll(".runner-mock__result-explanation")).toHaveLength(0);
    expect(result.textContent).toContain("Not answered");
  });

  it("Try again restarts cleanly: inputs, palette, marks, and focus all reset", () => {
    const { root, controls, result, palette, questions } = mount();
    init(document);
    check(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!);
    click(controlButtons(controls)[1]!); // mark Q1
    click(controlButtons(controls)[3]!); // Finish

    click(result.querySelector<HTMLButtonElement>("[data-demo-retry]")!);

    expect(result.hidden).toBe(true);
    expect(result.innerHTML).toBe("");
    expect(questions[0]!.hidden).toBe(false);
    expect(questions[1]!.hidden).toBe(true);
    expect(document.activeElement).toBe(questions[0]!);
    expect(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="c"]')!.checked).toBe(false);
    expect(palette.querySelector("button > span")!.className).not.toContain("--marked");
    expect(palette.querySelector("button > span")!.className).not.toContain("--answered");
    expect(controlButtons(controls)[3]!.textContent).toBe("Finish");
  });

  it("the Enter guard: Enter on Back/Mark/a palette square never double-fires the custom binding", () => {
    const { controls, palette, questions, root } = mount();
    init(document);
    click(controlButtons(controls)[2]!); // -> Q2, so Back is enabled

    const backBtn = controlButtons(controls)[0]!;
    backBtn.focus();
    backBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // jsdom does not synthesise a native click from this keydown (a real
    // browser would); the assertion is that the CUSTOM handler did nothing —
    // still on Q2, not jumped forward to Q3 as an unguarded handler would.
    expect(questions[1]!.hidden).toBe(false); // still on Q2
    expect(questions[2]!.hidden).toBe(true);
    click(backBtn); // simulate the native activation a real Enter press causes
    expect(questions[0]!.hidden).toBe(false);

    const markBtn = controlButtons(controls)[1]!;
    markBtn.focus();
    markBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(questions[1]!.hidden).toBe(true); // did not advance

    const square3 = palette.querySelectorAll("button")[2]!;
    square3.focus();
    square3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(root.querySelector("[data-demo-result]")!.hasAttribute("hidden")).toBe(true); // did not finish
  });

  it("Enter on a question advances, and finishes on the last question", () => {
    const { questions, result } = mount();
    init(document);
    questions[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(questions[1]!.hidden).toBe(false);
    questions[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(questions[2]!.hidden).toBe(false);
    questions[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(result.hidden).toBe(false);
  });

  it("pre-init checked state is preserved, not reset", () => {
    document.body.innerHTML = fixtureHTML();
    const root = document.querySelector<HTMLElement>("[data-demo]")!;
    root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="b"]')!.checked = true;
    init(document);
    const controls = document.querySelector<HTMLElement>("[data-demo-controls]")!;
    expect(root.querySelector<HTMLInputElement>('input[name="LOG-001"][value="b"]')!.checked).toBe(true);
    expect(controlButtons(controls)[3]!.textContent).toBe("Finish (1 of 3 answered)");
    expect(document.querySelector("[data-demo-palette] button > span")!.className).toContain("--answered");
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
    const html = fixtureHTML().replace('data-demo-palette', 'data-demo-palette-renamed');
    document.body.innerHTML = html;
    const before = document.body.innerHTML;
    init(document);
    expect(document.body.innerHTML).toBe(before);
  });

  it("does nothing when the fallback link is missing", () => {
    const html = fixtureHTML().replace(/<a[^>]*>.*?<\/a>/s, "");
    document.body.innerHTML = html;
    const before = document.body.innerHTML;
    init(document);
    expect(document.body.innerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The error path: a throwing listener falls back to the static markup (I-10).
// ---------------------------------------------------------------------------

describe("error path", () => {
  it("restores the no-JavaScript page when a listener throws", () => {
    const { controls, questions, result, live } = mount();
    init(document);

    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = () => {
      throw new Error("boom");
    };
    try {
      click(controlButtons(controls)[2]!); // Next -> goTo -> .focus() throws
    } finally {
      HTMLElement.prototype.focus = originalFocus;
    }

    // Fully restored: original sentence and link back, no buttons, question
    // 1 visible, result empty and hidden, live region empty.
    expect(controls.textContent).toContain(NOJS_SENTENCE);
    expect(controls.querySelectorAll("button")).toHaveLength(0);
    expect(controls.querySelector("a")!.getAttribute("href")).toBe(FALLBACK_HREF);
    expect(questions[0]!.hidden).toBe(false);
    expect(questions[1]!.hidden).toBe(true);
    expect(result.hidden).toBe(true);
    expect(result.innerHTML).toBe("");
    expect(live.textContent).toBe("");

    // And it stays inert: the removed listeners do not fire again.
    const after = controls.innerHTML;
    click(controls);
    expect(controls.innerHTML).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// Artefact checks: bundle+minify in isolation (never touches apps/web/dist).
// ---------------------------------------------------------------------------

function findEsbuildBin(): string {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  const entry = readdirSync(pnpmDir).find((d) => d.startsWith("esbuild@"));
  if (!entry) throw new Error("esbuild not found under node_modules/.pnpm — cannot measure the island");
  return path.join(pnpmDir, entry, "node_modules", "esbuild", "bin", "esbuild");
}

function buildIslandMinified(): string {
  const entry = path.join(__dirname, "..", "src", "island", "exam-demo.ts");
  const outDir = mkdtempSync(path.join(tmpdir(), "pariksha-island-"));
  const outFile = path.join(outDir, "exam-demo.min.js");
  execFileSync(process.execPath, [
    findEsbuildBin(),
    entry,
    "--bundle",
    "--minify",
    "--format=esm",
    "--target=es2020",
    `--outfile=${outFile}`,
  ]);
  return readFileSync(outFile, "utf8");
}

describe("artefact: the island, bundled and minified in isolation", () => {
  let built: string;

  beforeAll(() => {
    built = buildIslandMinified();
    // I-2 / T35: printed whether this run passes or fails the budget.
    console.log(`[island.test.ts] exam-demo.ts minified: ${Buffer.byteLength(built, "utf8")} bytes`);
  });

  it("stays at or under the 10 KB minified budget (I-2, informational proxy for T35)", () => {
    expect(Buffer.byteLength(built, "utf8")).toBeLessThanOrEqual(10 * 1024);
  });

  it("contains no network, storage, cookie or telemetry identifier (I-3)", () => {
    const forbidden = [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "sendBeacon",
      "localStorage",
      "sessionStorage",
      "cookie",
      "indexedDB",
      "caches",
      "PerformanceObserver",
      "clipboard",
    ];
    for (const token of forbidden) {
      expect(built, `must not contain "${token}"`).not.toContain(token);
    }
  });

  it("contains no interval, animation-frame or delayed timer (I-4)", () => {
    expect(built).not.toContain("setInterval");
    expect(built).not.toContain("requestAnimationFrame");
    expect(built).not.toContain("setTimeout");
  });

  it("sets no style attribute, no element.style, and no colour literal (I-7)", () => {
    expect(built).not.toContain(".style");
    expect(built).not.toMatch(/setAttribute\(["']style["']/);
    expect(built).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(built).not.toMatch(/\brgb\(/);
    expect(built).not.toMatch(/\bhsl\(/);
  });

  it("does not use ButtonPrimary's class on any control it creates (I-8)", () => {
    expect(built).not.toContain("button-primary");
  });
});
