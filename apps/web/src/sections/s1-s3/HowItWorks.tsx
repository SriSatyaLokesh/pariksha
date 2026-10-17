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

/**
 * S3 — How running an exam works. landing-page-v2-design.md §3 S3.
 *
 * The teach spine: three StepRows, each with its real artefact (CB-1, CB-2,
 * CB-3 — §4, verified verbatim against the files they quote) and a
 * rendered `results-table` using DESIGN.md's `results-table` and
 * `integrity-badge-*` tokens. The three CSV rows and the Divya caption are
 * content-inventory.md §4.3, sourced to `examples/reasoning-aptitude/`.
 */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby={HEADING_ID}
      className="section-s3 wrap"
    >
      <SectionHeading id={HEADING_ID} scale="chapter">
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
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;LOG-001&quot;</span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">&quot;type&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;single&quot;</span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">&quot;prompt&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">
                  &quot;What comes next in the series?\n\n3, 7, 15, 31, 63,
                  ?&quot;
                </span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">&quot;options&quot;</span>
                <span className="tok-punct">: [</span>
                {"\n    "}
                <span className="tok-punct">{"{ "}</span>
                <span className="tok-key">&quot;id&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;a&quot;</span>
                <span className="tok-punct">, </span>
                <span className="tok-key">&quot;text&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;95&quot;</span>
                <span className="tok-punct">{" }"},</span>
                {"\n    "}
                <span className="tok-punct">{"{ "}</span>
                <span className="tok-key">&quot;id&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;b&quot;</span>
                <span className="tok-punct">, </span>
                <span className="tok-key">&quot;text&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;117&quot;</span>
                <span className="tok-punct">{" }"},</span>
                {"\n    "}
                <span className="tok-punct">{"{ "}</span>
                <span className="tok-key">&quot;id&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;c&quot;</span>
                <span className="tok-punct">, </span>
                <span className="tok-key">&quot;text&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;127&quot;</span>
                <span className="tok-punct">{" }"},</span>
                {"\n    "}
                <span className="tok-punct">{"{ "}</span>
                <span className="tok-key">&quot;id&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;d&quot;</span>
                <span className="tok-punct">, </span>
                <span className="tok-key">&quot;text&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;131&quot;</span>
                <span className="tok-punct">{" }"}</span>
                {"\n  "}
                <span className="tok-punct">],</span>
                {"\n  "}
                <span className="tok-key">&quot;key&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;c&quot;</span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">&quot;difficulty&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;easy&quot;</span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">&quot;tags&quot;</span>
                <span className="tok-punct">: [</span>
                <span className="tok-string">&quot;reasoning&quot;</span>
                <span className="tok-punct">, </span>
                <span className="tok-string">&quot;series&quot;</span>
                <span className="tok-punct">],</span>
                {"\n  "}
                <span className="tok-key">&quot;scoring&quot;</span>
                <span className="tok-punct">: {"{ "}</span>
                <span className="tok-key">&quot;mode&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">
                  &quot;all_or_nothing&quot;
                </span>
                <span className="tok-punct">, </span>
                <span className="tok-key">&quot;points&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-number">2</span>
                <span className="tok-punct">{" },"}</span>
                {"\n  "}
                <span className="tok-key">&quot;explanation&quot;</span>
                <span className="tok-punct">: </span>
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
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;quant&quot;</span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">&quot;title&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">
                  &quot;Quantitative aptitude&quot;
                </span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">
                  &quot;time_limit_minutes&quot;
                </span>
                <span className="tok-punct">: </span>
                <span className="tok-number">15</span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">
                  &quot;shuffle_questions&quot;
                </span>
                <span className="tok-punct">: </span>
                <span className="tok-number">true</span>
                <span className="tok-punct">,</span>
                {"\n  "}
                <span className="tok-key">&quot;source&quot;</span>
                <span className="tok-punct">: {"{"}</span>
                {"\n    "}
                <span className="tok-key">&quot;kind&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;pool&quot;</span>
                <span className="tok-punct">,</span>
                {"\n    "}
                <span className="tok-key">&quot;bank&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-string">&quot;questions.json&quot;</span>
                <span className="tok-punct">,</span>
                {"\n    "}
                <span className="tok-key">&quot;count&quot;</span>
                <span className="tok-punct">: </span>
                <span className="tok-number">4</span>
                <span className="tok-punct">,</span>
                {"\n    "}
                <span className="tok-key">&quot;filter&quot;</span>
                <span className="tok-punct">: {"{ "}</span>
                <span className="tok-key">&quot;tags&quot;</span>
                <span className="tok-punct">: [</span>
                <span className="tok-string">
                  &quot;quantitative&quot;
                </span>
                <span className="tok-punct">{"] }"}</span>
                {"\n  "}
                <span className="tok-punct">{"}"}</span>
                {"\n"}
                {"}"}
              </CodeBlock>
              <p className="step-row__caption">
                Four questions drawn at random, for each candidate, from
                everything tagged <code>quantitative</code>.
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
              <CodeBlock
                caption="examples/reasoning-aptitude/results.csv"
                footer="29 columns in the real file — one per registration field, one per section"
              >
                <span className="tok-key">Full name</span>
                <span className="tok-punct">,...,Set,...,Score,Max </span>
                <span className="tok-key">score</span>
                <span className="tok-punct">
                  ,Percent,Rank,Result,...,Integrity flag,Reviewer
                  verdict,...
                </span>
                {"\n"}
                Fatima Sheikh,...,A,...,
                <span className="tok-number">24.00</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">27</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">88.9</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">1</span>
                ,Pass,...,clean,,...
                {"\n"}
                Ananya Rao,...,A,...,
                <span className="tok-number">21.50</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">27</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">79.6</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">2</span>
                ,Pass,...,review,Clear,...
                {"\n"}
                Divya Menon,...,A,...,
                <span className="tok-number">9.50</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">27</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">35.2</span>
                <span className="tok-punct">,</span>
                <span className="tok-number">6</span>
                ,Fail,...,high_risk,Suspicious,...
              </CodeBlock>

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
          <p>
            Server-enforced clock, answers queued and synced, one row per
            candidate out. Integrity comes out as a flag, never a verdict —
            a reviewer makes the call.
          </p>
        </StepRow>
      </div>
    </section>
  );
}
