import { HeroSection } from "../../components/HeroSection";
import { CodeBlock } from "../../components/CodeBlock";
import { PROMPTS, type Prompt } from "../../island/questions";

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
      masthead={
        // v4 §3: the product name in Kalam, filling the voltage the copy
        // column leaves empty. aria-hidden because TopNav already announces
        // "Pariksha" — a screen reader should not hear it twice before it
        // reaches the headline.
        <div className="hero-masthead" aria-hidden="true">
          <span className="hero-masthead__name">Pariksha</span>
          <hr className="hero-masthead__rule" />
        </div>
      }
      lead={
        <>
          Open source, self-hosted, pre-alpha as of October 2026.
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
    />
  );
}

/**
 * v4: the hero is one screen (A2), so the bridge band can no longer live
 * inside it — a code block and a non-scrolling hero cannot both be true.
 * It renders immediately below instead, on cream, carrying exactly the
 * same prose and the same CB-1 excerpt. Nothing was cut; it moved.
 */
export function HeroBridge() {
  return (
    <div className="hero-bridge-band">
      <BridgeBand />
    </div>
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
    <div className="exam-demo" data-demo>
      <h2 className="visually-hidden" id="demo-heading">
        Try three questions
      </h2>

      <div className="exam-demo__cards" role="group" aria-labelledby="demo-heading">
        {PROMPTS.map((q, i) => (
          <article
            key={q.id}
            className="exam-card"
            data-demo-card
            data-qid={q.id}
            aria-labelledby={`demo-stem-${String(i + 1)}`}
          >
            <div className="exam-card__bar">
              <span className="exam-card__type">{TYPE_LABEL[q.type]}</span>
              <span className="exam-card__points">
                {q.points} pts{q.type === "single" ? "" : " · partial credit"}
              </span>
            </div>
            <div className="exam-card__body">
              {q.type === "matching" ? (
                <MatchingRows q={q} stemId={`demo-stem-${String(i + 1)}`} />
              ) : (
                <ChoiceOptions q={q} stemId={`demo-stem-${String(i + 1)}`} />
              )}
              <p className="exam-card__verdict" data-demo-verdict hidden></p>
            </div>
          </article>
        ))}
      </div>

      <div className="exam-demo__bar">
        <div className="exam-demo__status">
          <ul className="exam-demo__pips" data-demo-pips aria-hidden="true">
            {PROMPTS.map((q, i) => (
              <li key={q.id} className="exam-demo__pip" data-demo-pip data-on="0">
                {i + 1}
              </li>
            ))}
          </ul>
          <span className="exam-demo__count" data-demo-count aria-live="polite">
            0 of 3 answered
          </span>
        </div>
        <div className="exam-demo__actions">
          <span className="exam-demo__score" data-demo-score aria-live="polite" hidden></span>
          <button className="exam-demo__button" type="button" data-demo-score-btn disabled>
            Score my answers
          </button>
          <a className="hero-text-link" href={WORKED_EXAMPLE}>
            All seventeen questions
          </a>
        </div>
      </div>

      <p className="exam-demo__nojs" data-demo-nojs>
        Scoring needs JavaScript. Every question above reads without it.
      </p>
    </div>
  );
}

const TYPE_LABEL: Record<Prompt["type"], string> = {
  single: "Single choice",
  multiple: "Select all that apply",
  matching: "Matching",
};

/** single and multiple: native radios and checkboxes, so the keyboard works
 * before a line of JavaScript runs. `name` is the question id — the island's
 * contract reads `input[name=qid]`. */
function ChoiceOptions({ q, stemId }: { q: Prompt; stemId: string }) {
  const [stem, series] = q.prompt.split("\n\n");
  return (
    <fieldset className="exam-card__fieldset">
      <legend className="exam-card__stem" id={stemId}>
        {stem}
      </legend>
      {series !== undefined && <p className="exam-card__series">{series}</p>}
      <div className="exam-card__options">
        {(q.options ?? []).map((o) => (
          <label className="exam-card__option" key={o.id}>
            <input
              type={q.type === "single" ? "radio" : "checkbox"}
              name={q.id}
              value={o.id}
            />
            <span className="exam-card__value">{o.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** matching: one <select> per left item. The value is the right-item string
 * itself, not an index — the island compares it to the key unchanged. */
function MatchingRows({ q, stemId }: { q: Prompt; stemId: string }) {
  return (
    <div className="exam-card__fieldset">
      <p className="exam-card__stem" id={stemId}>
        {q.prompt}
      </p>
      <div className="exam-card__match">
        {(q.left ?? []).map((l, i) => {
          const id = `demo-match-${String(i + 1)}`;
          return (
            <div className="exam-card__match-row" key={l}>
              <label className="exam-card__match-key" htmlFor={id}>
                {l}
              </label>
              <select id={id} data-demo-match data-left={l} defaultValue="">
                <option value="">Choose…</option>
                {(q.right ?? []).map((r) => (
                  <option value={r} key={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
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
