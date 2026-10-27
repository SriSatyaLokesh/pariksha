// Signal — the argument: why a form is not an exam, the integrity ethic,
// what it costs, and how it compares. Claims trace to
// `.planning/landing/content-inventory.md`.

function Tick() {
  return (
    <svg
      className="signal-tick signal-accent-word"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 8.4l3.3 3.3L13 5" />
    </svg>
  );
}

export function SignalNotAForm() {
  return (
    <section
      className="signal-wrap signal-section"
      aria-labelledby="not-a-form-heading"
    >
      <div className="signal-split">
        <div>
          <p className="signal-eyebrow">Why not a form</p>
          <h2 id="not-a-form-heading">A form shows everyone the same paper.</h2>
          <p>
            Pariksha draws each candidate&apos;s paper from a pool you tag and
            filter, or hands out fixed sets A, B and C round-robin by
            registration order, so neighbours never sit the same questions.
            Options shuffle underneath, except the ones you pin.
          </p>
          <ul className="signal-bullets">
            <li>
              <Tick />
              <span>
                <b>The key never leaves the server.</b> Not in the page, not in
                the payload.
              </span>
            </li>
            <li>
              <Tick />
              <span>
                <b>The clock is the server&apos;s.</b> Changing the
                computer&apos;s time does nothing; answers thirty seconds late
                are refused.
              </span>
            </li>
            <li>
              <Tick />
              <span>
                <b>One roll number, one attempt.</b> Any registration field can
                be marked unique.
              </span>
            </li>
            <li>
              <Tick />
              <span>
                <b>Results you can act on.</b> One CSV row per candidate, a
                column per section and per form field.
              </span>
            </li>
          </ul>
        </div>

        <div className="signal-panel">
          <p className="signal-panel__head">
            <b>campus-screening · section 2</b>
            <span>pool draw</span>
            <span>live</span>
          </p>
          <div className="signal-panel__body">
            <p className="signal-fine signal-fine--lead">
              Four questions drawn at random, per candidate, from everything
              tagged <code>quantitative</code> at medium difficulty.
            </p>
            <div className="signal-row">
              <b>Pool</b>
              <span>
                11 questions match · <em>4 drawn</em>
              </span>
            </div>
            <div className="signal-row">
              <b>Sets</b>
              <span>A / B / C · round-robin by registration order</span>
            </div>
            <div className="signal-row">
              <b>Shuffle</b>
              <span>
                questions and options · <em>pinned options stay put</em>
              </span>
            </div>
            <div className="signal-row">
              <b>Seed</b>
              <span>stored per attempt — a refresh returns the same paper</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const RESULTS = [
  {
    name: "Fatima Sheikh",
    score: "24.00 / 27",
    result: "Pass",
    flag: "clean",
    verdict: "—",
  },
  {
    name: "Ananya Rao",
    score: "21.50 / 27",
    result: "Pass",
    flag: "review",
    verdict: "Clear",
  },
  {
    name: "Divya Menon",
    score: "9.50 / 27",
    result: "Fail",
    flag: "high risk",
    verdict: "Suspicious",
  },
] as const;

const FLAG_CLASS: Record<string, string> = {
  clean: "signal-pill signal-pill--clean",
  review: "signal-pill signal-pill--review",
  "high risk": "signal-pill signal-pill--risk",
};

export function SignalIntegrity() {
  return (
    <section
      className="signal-field"
      id="integrity"
      aria-labelledby="integrity-heading"
    >
      <div className="signal-wrap signal-section">
        <p className="signal-eyebrow">Integrity</p>
        <h2 id="integrity-heading">No video. No audio. No verdicts.</h2>
        <div className="signal-split signal-split--spaced">
          <div>
            <p>
              Strict proctoring takes a 320×240 snapshot about every sixty
              seconds and stores no biometric template. Nothing is streamed.
              Nothing is recorded. Snapshots sit in your own private bucket
              behind links that expire in ten minutes.
            </p>
            <p>
              Tab switches, fullscreen exits and copy attempts are logged, and
              the candidate sees a counted warning rather than a silent mark
              against them. At the end Pariksha marks the attempt{" "}
              <strong>clean</strong>, <strong>review</strong> or{" "}
              <strong>high risk</strong> — and stops.
            </p>
            <p>
              Browser checks deter and record. They cannot prove: a second phone
              is invisible to every one of them, and our own documentation says
              so. That is precisely why no machine here reaches a verdict.
            </p>
          </div>
          <div>
            <div className="signal-panel">
              <p className="signal-panel__head">
                <b>results_20261017-1540.csv</b>
                <span>29 columns</span>
                <span>3 of 48 rows</span>
              </p>
              <div className="signal-scroll-x">
                <table className="signal-table">
                  <caption className="visually-hidden">
                    Three rows of the results CSV from the worked example
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Candidate</th>
                      <th scope="col">Score</th>
                      <th scope="col">Result</th>
                      <th scope="col">Integrity</th>
                      <th scope="col">Reviewer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RESULTS.map((row) => (
                      <tr key={row.name}>
                        <td className="signal-td-name">{row.name}</td>
                        <td className="signal-td-num">{row.score}</td>
                        <td>{row.result}</td>
                        <td>
                          <span className={FLAG_CLASS[row.flag]}>
                            {row.flag}
                          </span>
                        </td>
                        <td>{row.verdict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="signal-fine signal-fine--after">
              Five tab switches, three fullscreen exits, marked high risk —{" "}
              <strong>and her result was not cancelled.</strong> A reviewer
              looked, wrote a note, and invited her to a supervised re-test.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

const METRICS = [
  {
    figure: "$0",
    note: "per candidate, forever. Your only cost is infrastructure you already own.",
  },
  {
    figure: "55k",
    note: "Worker requests for one test of 500, against a free limit of 100,000 a day.",
  },
  {
    figure: "0.75 GB",
    note: "of snapshots, against a free limit of 10 GB a month.",
  },
  {
    figure: "30 min",
    note: "target from clone to a first live test, with no paid service.",
  },
] as const;

export function SignalCost() {
  return (
    <section
      className="signal-wrap signal-section"
      id="cost"
      aria-labelledby="cost-heading"
    >
      <p className="signal-eyebrow">What it costs</p>
      <h2 id="cost-heading">Five hundred candidates in an hour, for nothing.</h2>
      <p className="signal-lede signal-lede--after">
        By arithmetic rather than by a bill. Deploy serverless on
        Cloudflare&apos;s free tier or self-host with Docker and PostgreSQL /
        SQLite on your own servers — there is zero Pariksha billing of any kind.
      </p>
      <div className="signal-metrics">
        {METRICS.map((metric) => (
          <div className="signal-metric" key={metric.figure}>
            <b>{metric.figure}</b>
            <span>{metric.note}</span>
          </div>
        ))}
      </div>
      <p className="signal-fine signal-fine--after">
        An estimate with published arithmetic. The 500-candidate figure is a
        design target validated by Phase 11's k6 load test suite (<code>AC-29</code>).
        Free-tier limits can change — the mitigation is three adapter seams, so moving
        between Cloudflare, Docker (Postgres / SQLite) and on-premise infrastructure is
        configuration, not a rewrite.
      </p>
    </section>
  );
}

const COMPARISON: { need: string; form: string; paid: string; ours: string }[] =
  [
    {
      need: "Price per candidate",
      form: "None",
      paid: "Per candidate or per month, where published at all",
      ours: "None, and no Pariksha billing of any kind",
    },
    {
      need: "Where candidate data lives",
      form: "Their servers",
      paid: "Their servers",
      ours: "Your account — no Pariksha server in the path",
    },
    {
      need: "A different paper per candidate",
      form: "No",
      paid: "Yes",
      ours: "Pools, fixed sets, per-candidate shuffling",
    },
    {
      need: "Answer key hidden from the browser",
      form: "No",
      paid: "Yes",
      ours: "Yes, enforced on the server",
    },
    {
      need: "The clock",
      form: "The browser's",
      paid: "The server's",
      ours: "The server's — late answers refused after 30s",
    },
    {
      need: "Video or audio recorded",
      form: "—",
      paid: "Varies by vendor",
      ours: "Never. Snapshots only",
    },
    {
      need: "Who decides a candidate cheated",
      form: "—",
      paid: "Varies by vendor",
      ours: "A person. Pariksha flags; it never concludes",
    },
    {
      need: "If you want to leave",
      form: "Export a spreadsheet",
      paid: "Ask them",
      ours: "One JSON file. Open format, CC BY 4.0",
    },
  ];

export function SignalCompare() {
  return (
    <section
      className="signal-wrap signal-section"
      id="compare"
      aria-labelledby="compare-heading"
    >
      <p className="signal-eyebrow">Against the alternatives</p>
      <h2 id="compare-heading">What you keep, and what you give up.</h2>
      <div className="signal-scroll-x">
        <table className="signal-cmp">
          <caption className="visually-hidden">
            Pariksha compared with free form tools and paid assessment
            platforms, by category, not by named product
          </caption>
          <thead>
            <tr>
              <th scope="col">What you need</th>
              <th scope="col">A form tool</th>
              <th scope="col">A paid platform</th>
              <th scope="col">Pariksha</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.need}>
                <td>{row.need}</td>
                <td>{row.form}</td>
                <td>{row.paid}</td>
                <td>{row.ours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="signal-fine signal-fine--after">
        Nothing here is a benchmark. Every row is either what Pariksha does, or
        what the other two categories publish about themselves, read in October
        2026. <strong>Moodle</strong> is the nearest open-source comparison and
        is more capable today — Pariksha is lighter to run, and keeps the whole
        test in one portable file.
      </p>
    </section>
  );
}
