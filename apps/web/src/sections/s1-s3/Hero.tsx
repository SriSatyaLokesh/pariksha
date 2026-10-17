import { HeroSection } from "../../components/HeroSection";
import { CodeBlock } from "../../components/CodeBlock";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const WORKED_EXAMPLE = `${REPO}/tree/main/examples/reasoning-aptitude`;

// design contract §3 S1 (v2, unchanged by v3): the h1 is a 45-character
// budget, not a fixed string — T19 asserts the string, the contract
// governs any replacement.
const HEADING = "Pariksha — run real exams you host yourself.";

/**
 * S1 — Hero. landing-page-v3-interactive.md §3, amending
 * landing-page-v2-design.md §3 S1.
 *
 * The static mock (M-1) is gone. In its place: the hero's own prerendered
 * exam demo (D2) — a real question, real options, a real palette, exactly
 * as a visitor with JavaScript off sees it. The island
 * (src/island/exam-demo.ts, a separate file and a separate assignment)
 * upgrades this markup in place by its `data-demo*` hooks; it must never
 * rewrite it from scratch (D2). Every id and data attribute below is a
 * contract term (§2.3) — changing one here without updating the island is
 * the one mistake this file can make that no test here will catch.
 *
 * Source order, fixed at every width (§3.1): chip → h1 → demo → lead → the
 * two text links → the bridge band. The two-column layout at >=900px is
 * built by HeroSection's grid placement, never by reordering this markup.
 */
export function Hero() {
  return (
    <HeroSection
      headingId="hero-heading"
      heading={HEADING}
      chip="PRE-ALPHA · APACHE-2.0"
      demo={<ExamDemo />}
      lead={
        <>
          Pariksha is an open-source exam platform you deploy yourself; as of
          October 2026 the formats, the scoring engine and worked example are
          published, and the application lands with v0.1.
        </>
      }
      links={
        <>
          <a className="hero-text-link" href={REPO}>
            Read the code on GitHub
          </a>
          <a className="hero-text-link" href="#status">
            What is built today
          </a>
        </>
      }
      bridge={<BridgeBand />}
    />
  );
}

/**
 * §3.2–§3.6: the prerendered half of the demo. No JavaScript runs here —
 * the island is a separate module loaded by a `<script type="module">` tag
 * the prerender injects (§2.7), never rendered by React. With the island
 * off, blocked, or still loading, this is the whole of the page the demo
 * offers (§2.8), and it must stand on its own: one complete, answerable
 * question, two more in the HTML for a screen reader or a crawler to read,
 * and a sentence that says — truthfully — what needs JavaScript and where
 * to find the rest without it.
 */
function ExamDemo() {
  return (
    <div className="runner-mock runner-mock--demo" data-demo>
      <h2 className="runner-mock__title" id="demo-heading">
        Try three questions
      </h2>

      <div
        className="runner-mock__panel"
        role="group"
        aria-labelledby="demo-heading"
      >
        <div className="runner-mock__header">
          <span className="runner-mock__section">
            DEMO · 3 QUESTIONS · ABOUT 30 SECONDS
          </span>
          <span className="runner-mock__section">Timer off</span>
          <span className="runner-mock__section runner-mock__privacy">
            Scored in your browser by Pariksha&rsquo;s own scoring engine.
            Nothing you type leaves this page.
          </span>
        </div>

        {/* §3.6: the one live region, present and empty — the island
            writes announcements here, nothing does before it loads. */}
        <p className="visually-hidden" aria-live="polite" data-demo-live></p>

        <ol className="runner-mock__list">
          {/* LOG-001 — shortest stem in the set, so its first option is
              the one that has to clear the fold (§3.3, E-9). */}
          <li
            className="runner-mock__question"
            id="demo-q-1"
            data-demo-q
            data-qid="LOG-001"
            tabIndex={-1}
            aria-labelledby="demo-stem-1"
          >
            <div className="runner-mock__stem-row">
              <span className="runner-mock__question-of">
                Question 1 of 3
              </span>
              <span className="runner-mock__points">single · 2 pts</span>
            </div>
            <fieldset className="runner-mock__fieldset">
              <legend className="runner-mock__stem" id="demo-stem-1">
                What comes next in the series?
                <br />
                3, 7, 15, 31, 63, ?
              </legend>
              <div className="runner-mock__options">
                <label className="runner-mock__option">
                  <input type="radio" name="LOG-001" value="a" />
                  <span>95</span>
                </label>
                <label className="runner-mock__option">
                  <input type="radio" name="LOG-001" value="b" />
                  <span>117</span>
                </label>
                <label className="runner-mock__option">
                  <input type="radio" name="LOG-001" value="c" />
                  <span>127</span>
                </label>
                <label className="runner-mock__option">
                  <input type="radio" name="LOG-001" value="d" />
                  <span>131</span>
                </label>
              </div>
            </fieldset>
          </li>

          {/* LOG-007 */}
          <li
            className="runner-mock__question"
            id="demo-q-2"
            data-demo-q
            data-qid="LOG-007"
            tabIndex={-1}
            aria-labelledby="demo-stem-2"
            hidden
          >
            <div className="runner-mock__stem-row">
              <span className="runner-mock__question-of">
                Question 2 of 3
              </span>
              <span className="runner-mock__points">true_false · 1 pts</span>
            </div>
            <fieldset className="runner-mock__fieldset">
              <legend className="runner-mock__stem" id="demo-stem-2">
                In a certain code, EARTH is written as FBSUI.{" "}
                <strong>Statement:</strong> each letter has been replaced by
                the letter that follows it in the alphabet.
              </legend>
              <div className="runner-mock__options">
                <label className="runner-mock__option">
                  <input type="radio" name="LOG-007" value="true" />
                  <span>True</span>
                </label>
                <label className="runner-mock__option">
                  <input type="radio" name="LOG-007" value="false" />
                  <span>False</span>
                </label>
              </div>
            </fieldset>
          </li>

          {/* QNT-004 — the load-bearing question: five options, a
              three-option key, partial credit (§3.3). */}
          <li
            className="runner-mock__question"
            id="demo-q-3"
            data-demo-q
            data-qid="QNT-004"
            tabIndex={-1}
            aria-labelledby="demo-stem-3"
            hidden
          >
            <div className="runner-mock__stem-row">
              <span className="runner-mock__question-of">
                Question 3 of 3
              </span>
              <span className="runner-mock__points">multiple · 2 pts</span>
            </div>
            <fieldset className="runner-mock__fieldset">
              <legend className="runner-mock__stem" id="demo-stem-3">
                Which of these numbers are divisible by 6? (Select all that
                apply.)
              </legend>
              <div className="runner-mock__options">
                <label className="runner-mock__option">
                  <input type="checkbox" name="QNT-004" value="a" />
                  <span>114</span>
                </label>
                <label className="runner-mock__option">
                  <input type="checkbox" name="QNT-004" value="b" />
                  <span>128</span>
                </label>
                <label className="runner-mock__option">
                  <input type="checkbox" name="QNT-004" value="c" />
                  <span>222</span>
                </label>
                <label className="runner-mock__option">
                  <input type="checkbox" name="QNT-004" value="d" />
                  <span>345</span>
                </label>
                <label className="runner-mock__option">
                  <input type="checkbox" name="QNT-004" value="e" />
                  <span>432</span>
                </label>
              </div>
            </fieldset>
          </li>
        </ol>

        {/* §3.5: the palette ships as inert status — bare numbers, no
            navigation — until the island replaces its contents with
            buttons. E-7: the strip holds the same 44px height in both
            states. */}
        <div
          className="runner-mock__palette"
          aria-hidden="true"
          data-demo-palette
        >
          <span className="runner-mock__square runner-mock__square--current">
            1
          </span>
          <span className="runner-mock__square">2</span>
          <span className="runner-mock__square">3</span>
        </div>

        {/* §2.8: the sentence is not optional. With JavaScript off this is
            what the control row can honestly offer — nothing it cannot
            deliver, and the one link that delivers all seventeen
            questions anyway. The island removes the sentence and inserts
            its four buttons ahead of this link; the link itself survives
            every upgrade and every island error (I-9). */}
        <div className="runner-mock__controls" data-demo-controls>
          <p className="runner-mock__section runner-mock__nojs">
            Scoring, and questions 2 and 3, need JavaScript.
          </p>
          <a className="runner-mock__fallback" href={WORKED_EXAMPLE}>
            These three questions, and fourteen more, are in the worked
            example
          </a>
        </div>

        {/* §3.2: the result panel must not contain a score, a verdict
            word, or anything else in any form in the prerendered HTML — an
            answer engine lifting a result would be lifting a claim about
            an application that does not run yet (D5). The island writes
            into this element; nothing writes into it before that. */}
        <div className="runner-mock__result" data-demo-result hidden></div>
      </div>
    </div>
  );
}

/**
 * §3.8 — the bridge band. CB-1a, the four lines of LOG-001 that carry the
 * argument, prerendered and always visible on cream, closing the hero's
 * foot. This is where the honesty the demo owes a visitor who has just
 * taken an exam (D5) is carried in full — in prose, not in the island, so
 * a crawler or a visitor with JavaScript off reads every word of it.
 *
 * The id is a contract term: §3.7 item 5 points the result panel's
 * "See how that was scored" line back down here, so the island's
 * `#hero-bridge` anchor and this attribute move together or not at all.
 */
function BridgeBand() {
  return (
    <div className="hero-bridge" id="hero-bridge">
      <h3 className="runner-mock__title">
        The three questions above are this file.
      </h3>
      <CodeBlock caption="examples/reasoning-aptitude/questions.json · LOG-001">
        {"{\n  "}
        <span className="tok-key">&quot;id&quot;</span>
        {": "}
        <span className="tok-string">&quot;LOG-001&quot;</span>
        {","}
        {"\n  …"}
        {"\n  "}
        <span className="tok-key">&quot;key&quot;</span>
        {": "}
        <span className="tok-string">&quot;c&quot;</span>
        {","}
        {"\n  "}
        <span className="tok-key">&quot;scoring&quot;</span>
        {": { "}
        <span className="tok-key">&quot;mode&quot;</span>
        {": "}
        <span className="tok-string">&quot;all_or_nothing&quot;</span>
        {", "}
        <span className="tok-key">&quot;points&quot;</span>
        {": "}
        <span className="tok-number">2</span>
        {" },"}
        {"\n  "}
        <span className="tok-key">&quot;explanation&quot;</span>
        {": "}
        <span className="tok-string">
          &quot;Each term is double the previous term plus one: 63 × 2 + 1 =
          127.&quot;
        </span>
        {"\n}"}
      </CodeBlock>
      <p className="runner-mock__note">
        Seventeen questions like it are in the worked example, together with
        the test that draws from them, the candidate list, and the results
        CSV it produces. <a href="#how-it-works">Read the whole file →</a>
      </p>
      <p className="runner-mock__note">
        The key is here because there is nothing to call: a real Pariksha
        test keeps it on the server, where it never reaches a candidate,
        re-checks every rule there, and runs the clock there too. The
        scoring engine, the formats, the schemas and this worked example are
        published today; the runner, the server, proctoring and the results
        CSV land with v0.1.
      </p>
    </div>
  );
}
