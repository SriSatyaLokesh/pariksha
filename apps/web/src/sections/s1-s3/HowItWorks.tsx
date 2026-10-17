import { SectionHeading } from "../../components/SectionHeading";
import { StepRow } from "../../components/StepRow";
import { CodeBlock } from "../../components/CodeBlock";

const HEADING_ID = "how-it-works-heading";
const RESULTS_CAPTION_ID = "how-it-works-results-caption";
const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;

const RESULTS_ROWS = [
  {
    name: "Fatima Sheikh",
    score: "24 / 27",
    result: "Pass",
    flag: "clean" as const,
  },
  {
    name: "Ananya Rao",
    score: "21.5 / 27",
    result: "Pass",
    flag: "review" as const,
  },
  {
    name: "Divya Menon",
    score: "9.5 / 27",
    result: "Fail",
    flag: "high_risk" as const,
  },
];

const FLAG_TEXT: Record<(typeof RESULTS_ROWS)[number]["flag"], string> = {
  clean: "clean",
  review: "review",
  high_risk: "high risk",
};

const TYPE_NAMES = [
  "Single choice",
  "Multiple choice",
  "Select exactly K",
  "True/false",
  "Assertion–reason",
  "Matching",
  "Multi-matching",
  "Ordering",
  "Fill in the blank",
  "Numeric with tolerance",
  "Short answer",
  "Long answer",
];

/**
 * B3 — How running an exam works. landing-page-v3-interactive.md §4.3,
 * v3-cull.md §2: the band doing the absorbing. Three steps (CB-1 in full,
 * CB-2 with the negative-marking sentence beside it, M-3), then two
 * absorbed h3s carrying what survives of S5 (`#features`) and S6
 * (`#no-code`) so neither anchor link-rots. CB-3 (the results CSV code
 * block) is deleted as a duplicate of M-3; M-2 (the editor mock) is
 * deleted outright, per D5, as a fictional screen beside a working demo.
 */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby={HEADING_ID}
      className="section-s3 wrap"
    >
      <SectionHeading id={HEADING_ID} scale="chapter" eyebrow="HOW IT WORKS">
        How does running an exam on Pariksha actually work?
      </SectionHeading>
      <p className="section-s3__answer">
        Running an exam on Pariksha is three steps. An organiser writes
        questions as small documented objects, assembles them into a test
        whose sections draw from pools or hand out fixed sets, and publishes
        a URL. Candidates sit the test in a browser under a server-enforced
        clock. The organiser downloads one CSV row per candidate, with
        scores and integrity flags.
      </p>

      <div className="step-list">
        <StepRow
          ordinal="01"
          title="Write the questions"
          artefact={
            <>
              <CodeBlock
                caption="examples/reasoning-aptitude/questions.json"
                footer={
                  <>
                    16 more questions, covering all 12 types ·{" "}
                    <a href={blob("examples/reasoning-aptitude/questions.json")}>
                      read the whole file <span aria-hidden="true">→</span>
                    </a>
                  </>
                }
              >
                {"{\n"}
                {"  "}
                <span className="tok-key">&quot;id&quot;</span>
                {": "}
                <span className="tok-string">&quot;LOG-001&quot;</span>
                {","}
                {"\n  "}
                <span className="tok-key">&quot;type&quot;</span>
                {": "}
                <span className="tok-string">&quot;single&quot;</span>
                {","}
                {"\n  "}
                <span className="tok-key">&quot;prompt&quot;</span>
                {": "}
                <span className="tok-string">
                  &quot;What comes next in the series?\n\n3, 7, 15, 31, 63,
                  ?&quot;
                </span>
                {","}
                {"\n  "}
                <span className="tok-key">&quot;options&quot;</span>
                {": ["}
                {"\n    "}
                {"{ "}
                <span className="tok-key">&quot;id&quot;</span>
                {": "}
                <span className="tok-string">&quot;a&quot;</span>
                {", "}
                <span className="tok-key">&quot;text&quot;</span>
                {": "}
                <span className="tok-string">&quot;95&quot;</span>
                {" },"}
                {"\n    "}
                {"{ "}
                <span className="tok-key">&quot;id&quot;</span>
                {": "}
                <span className="tok-string">&quot;b&quot;</span>
                {", "}
                <span className="tok-key">&quot;text&quot;</span>
                {": "}
                <span className="tok-string">&quot;117&quot;</span>
                {" },"}
                {"\n    "}
                {"{ "}
                <span className="tok-key">&quot;id&quot;</span>
                {": "}
                <span className="tok-string">&quot;c&quot;</span>
                {", "}
                <span className="tok-key">&quot;text&quot;</span>
                {": "}
                <span className="tok-string">&quot;127&quot;</span>
                {" },"}
                {"\n    "}
                {"{ "}
                <span className="tok-key">&quot;id&quot;</span>
                {": "}
                <span className="tok-string">&quot;d&quot;</span>
                {", "}
                <span className="tok-key">&quot;text&quot;</span>
                {": "}
                <span className="tok-string">&quot;131&quot;</span>
                {" }"}
                {"\n  "}
                {"],"}
                {"\n  "}
                <span className="tok-key">&quot;key&quot;</span>
                {": "}
                <span className="tok-string">&quot;c&quot;</span>
                {","}
                {"\n  "}
                <span className="tok-key">&quot;difficulty&quot;</span>
                {": "}
                <span className="tok-string">&quot;easy&quot;</span>
                {","}
                {"\n  "}
                <span className="tok-key">&quot;tags&quot;</span>
                {": ["}
                <span className="tok-string">&quot;reasoning&quot;</span>
                {", "}
                <span className="tok-string">&quot;series&quot;</span>
                {"],"}
                {"\n  "}
                <span className="tok-key">&quot;scoring&quot;</span>
                {": { "}
                <span className="tok-key">&quot;mode&quot;</span>
                {": "}
                <span className="tok-string">
                  &quot;all_or_nothing&quot;
                </span>
                {", "}
                <span className="tok-key">&quot;points&quot;</span>
                {": "}
                <span className="tok-number">2</span>
                {" },"}
                {"\n  "}
                <span className="tok-key">&quot;explanation&quot;</span>
                {": "}
                <span className="tok-string">
                  &quot;Each term is double the previous term plus one: 63 ×
                  2 + 1 = 127.&quot;
                </span>
                {"\n"}
                {"}"}
              </CodeBlock>
              <p className="step-row__caption">
                The <code>key</code> and the <code>explanation</code> live in
                the file, never in the candidate&apos;s browser.
              </p>
            </>
          }
        >
          <p>
            A question is a small documented object: a prompt, options, a
            key, a score and an explanation. The key and the explanation
            live in the file and are never sent to a candidate&apos;s
            browser. An organiser is meant to build this in a Pariksha UI,
            not by hand-writing the file above — that screen is specified,
            not yet built.
          </p>
        </StepRow>

        <StepRow
          ordinal="02"
          title="Assemble the test into sections"
          artefact={
            <>
              <CodeBlock
                caption="examples/reasoning-aptitude/test.json"
                footer={
                  <>
                    instructions trimmed · two more sections: fixed sets A/B,
                    and a fixed list{" "}
                    <span aria-hidden="true">→</span>
                  </>
                }
              >
                {"{\n  "}
                <span className="tok-key">&quot;id&quot;</span>
                {": "}
                <span className="tok-string">&quot;quant&quot;</span>
                {","}
                {"\n  "}
                <span className="tok-key">&quot;title&quot;</span>
                {": "}
                <span className="tok-string">
                  &quot;Quantitative aptitude&quot;
                </span>
                {","}
                {"\n  "}
                <span className="tok-key">
                  &quot;time_limit_minutes&quot;
                </span>
                {": "}
                <span className="tok-number">15</span>
                {","}
                {"\n  "}
                <span className="tok-key">
                  &quot;shuffle_questions&quot;
                </span>
                {": "}
                <span className="tok-number">true</span>
                {","}
                {"\n  "}
                <span className="tok-key">&quot;source&quot;</span>
                {": {"}
                {"\n    "}
                <span className="tok-key">&quot;kind&quot;</span>
                {": "}
                <span className="tok-string">&quot;pool&quot;</span>
                {","}
                {"\n    "}
                <span className="tok-key">&quot;bank&quot;</span>
                {": "}
                <span className="tok-string">&quot;questions.json&quot;</span>
                {","}
                {"\n    "}
                <span className="tok-key">&quot;count&quot;</span>
                {": "}
                <span className="tok-number">4</span>
                {","}
                {"\n    "}
                <span className="tok-key">&quot;filter&quot;</span>
                {": { "}
                <span className="tok-key">&quot;tags&quot;</span>
                {": ["}
                <span className="tok-string">
                  &quot;quantitative&quot;
                </span>
                {"] }"}
                {"\n  "}
                {"}"}
                {"\n"}
                {"}"}
              </CodeBlock>
              <p className="step-row__caption">
                Four questions drawn at random, for each candidate, from
                everything tagged <code>quantitative</code>.
              </p>
              <p className="step-row__caption">
                The worked example&apos;s own test deducts a quarter of a
                question&apos;s points for a wrong answer; a blank costs
                nothing.
              </p>
            </>
          }
        >
          <p>
            A section names where its questions come from: a fixed list, a
            random draw from a tagged pool, or fixed sets A, B and C handed
            out round-robin by registration order so neighbours never get
            the same paper. No form tool can do this.
          </p>
        </StepRow>

        <StepRow
          ordinal="03"
          title="They sit it; you download the results"
          artefact={
            <>
              {/* A7: the scrolling container carries tabIndex, role="region"
                  and an accessible name, like CodeBlock and ComparisonTable. */}
              <div
                className="results-table__region"
                role="region"
                aria-labelledby={RESULTS_CAPTION_ID}
                tabIndex={0}
              >
                <table className="results-table">
                  <caption id={RESULTS_CAPTION_ID} className="visually-hidden">
                    Three example rows from a results CSV
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Candidate</th>
                      <th scope="col">Score</th>
                      <th scope="col">Result</th>
                      <th scope="col">Integrity flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RESULTS_ROWS.map((row) => (
                      <tr key={row.name}>
                        <th scope="row">{row.name}</th>
                        <td className="results-table__numeric">{row.score}</td>
                        <td>{row.result}</td>
                        <td>
                          <span className={`integrity-badge-${row.flag === "high_risk" ? "risk" : row.flag}`}>
                            {FLAG_TEXT[row.flag]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="step-row__caption">
                As specified in the worked example, not a live recording:
                Divya&apos;s row is the whole design in one line. Her attempt
                shows five tab switches and three fullscreen exits, marked{" "}
                <code>high_risk</code>. It did not cancel her result. A
                reviewer looked, wrote a note, and invited her to a
                supervised re-test.
              </p>
            </>
          }
        >
          {null}
        </StepRow>
      </div>

      <h3 id="features" className="absorbed-heading">
        What does Pariksha do?
      </h3>
      <p>
        Pariksha groups what it does by the organiser&apos;s job rather than
        by the shape of the codebase: clean registration that blocks
        duplicate sign-ups, proctoring that never records video or audio,
        flags instead of verdicts so a person always decides, and results
        that land in a spreadsheet already. The scoring and selection
        engines behind them are built and tested today.
      </p>
      <p className="feature-lead">
        The scoring and selection engines are built and tested; everything
        else on this page is specified. All twelve question types, the test
        builder and the candidate runtime land with v0.1; proctoring and
        results follow in v0.2.
      </p>
      <ul className="type-list">
        {TYPE_NAMES.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <ul className="capability-list">
        <li>
          A registration form you design per test, with a field you can mark
          unique to block repeat sign-ups.
        </li>
        <li>
          Proctoring that never records: no video and no audio are ever
          recorded.
        </li>
        <li>
          Every attempt is flagged <code>clean</code>, <code>review</code> or{" "}
          <code>high_risk</code> — the app flags, a person decides.
        </li>
        <li>
          Results as a CSV: one row per candidate, with scores and integrity
          flags.
        </li>
      </ul>

      <h3 id="no-code" className="absorbed-heading">
        Does an organiser ever have to write JSON?
      </h3>
      <p>
        No, organisers build questions and tests in a Pariksha UI: one
        editing screen for all twelve types, a type picker, a
        drag-to-reorder section list, live pool counts and a publish
        checklist. The JSON exists so that you can hand-author, script, diff
        or export a test if you want to — and so that nothing you build is
        locked into Pariksha.
      </p>
      <p className="no-code-pull-quote">
        You will never have to write this. It is here so that you can — and
        so that nothing you build is trapped.
      </p>
      <p>
        The format is published anyway: you can hand-author a question in a
        text editor against the documented schema, generate a bank from a
        script, diff a test in a pull request, or export a whole test as one
        file and import it into a different installation. Nothing you build
        this way is locked in, and the authoring interface itself is
        designed and not yet built.
      </p>
    </section>
  );
}
