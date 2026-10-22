// Signal — build status, the questions-and-answers band, the close and the
// footer. The nine FAQ answers are carried over verbatim from the previous
// page: they are the most search- and LLM-citable content the site has, and
// each is already sourced in `.planning/landing/content-inventory.md` §7.

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;
const tree = (path: string) => `${REPO}/tree/main/${path}`;

const LIVE = [
  "The question and test formats, and their JSON Schemas",
  "All 12 question types, graded and unit-tested",
  "All 5 scoring modes, enforced per type",
  "Pool draws, set assignment, seeded shuffling",
  "Cross-field import validation — one bad question imports nothing",
  "A 17-question worked example covering all 12 types",
] as const;

const NEXT = [
  "The authoring UI and the test builder",
  "The candidate runtime",
  "Proctoring — Off, Standard and Strict",
  "Results — CSV, live monitor, grading queue, item analysis",
  "The API and signed webhooks",
  "Organiser sign-in, roles and workspaces",
] as const;

export function SignalStatus() {
  return (
    <section
      className="signal-wrap signal-section"
      id="status"
      aria-labelledby="status-heading"
    >
      <p className="signal-eyebrow">Where it stands</p>
      <h2 id="status-heading">What exists today, and what lands with v0.1.</h2>
      <div className="signal-status-grid">
        <div>
          <div className="signal-chips" role="group" aria-label="Build status">
            <button
              className="signal-chip"
              type="button"
              aria-pressed="true"
              data-signal-status="live"
            >
              Live today
            </button>
            <button
              className="signal-chip"
              type="button"
              aria-pressed="false"
              data-signal-status="next"
            >
              Lands with v0.1
            </button>
          </div>
          <ul className="signal-list" data-signal-list="live">
            {LIVE.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <ul className="signal-list" data-signal-list="next">
            {NEXT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="signal-fine signal-fine--after">
            A paid platform you can buy today will do more than Pariksha does
            today, because the application is not built yet. What is built is
            the format, the schemas and the scoring engine — and you can run
            those today. <a href={blob("docs/ROADMAP.md")}>Read the roadmap</a>.
          </p>
        </div>

        <div className="signal-today" id="start">
          <h3>What you can do today</h3>
          <ol>
            <li>
              <b>Write your question bank.</b> The format is published and
              stable; questions written today import on day one — or into
              anything else, since the schemas are CC BY 4.0.
            </li>
            <li>
              <b>Validate it in one command.</b> One <code>npx ajv</code> run.
              No install, no account.
            </li>
            <li>
              <b>Read a whole exam.</b> Seventeen questions, three sections, the
              candidate&apos;s screen and the results CSV it produces.
            </li>
          </ol>
          <p className="signal-fine signal-fine--flush">
            <strong>What you cannot do yet:</strong> run a test.
          </p>
        </div>
      </div>
    </section>
  );
}

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Can I use Pariksha today?",
    answer:
      "You cannot run Pariksha as an application today. The repository holds the product requirements, the open question and test formats, their JSON Schemas, a complete worked example and the scoring engine, which is built and tested. The application lands with v0.1; the formats are stable enough to write questions against right now.",
  },
  {
    question: "Where is candidate data stored?",
    answer:
      "Pariksha stores candidate data in the organiser's own account — your Cloudflare D1 database and R2 bucket, or your own Postgres and disk under Docker. There is no Pariksha server in the path. You pick the database region and storage jurisdiction where the host allows it, and there is no telemetry or third-party script anywhere.",
  },
  {
    question: "How many question types does it support?",
    answer:
      "Pariksha supports twelve question types: single choice, multiple choice, select exactly K, true/false, assertion–reason, matching, multi-matching, ordering, fill in the blank, numeric with tolerance, short answer and long answer. Each takes Markdown, code blocks, LaTeX and images, and all twelve are implemented and unit-tested in packages/core today.",
  },
  {
    question: "How does it stop candidates copying from each other?",
    answer:
      "Pariksha gives each candidate a different paper to stop them copying from each other. A section draws N questions at random from a pool filtered by tag and difficulty, or hands out fixed sets A, B and C round-robin by registration order so neighbours never match, and question and option order shuffle per candidate while pinned options stay put.",
  },
  {
    question: "Does Pariksha record video of candidates?",
    answer:
      "Pariksha does not record video or audio of candidates. Strict proctoring instead takes 320×240 JPEG snapshots, about 25 KB each, every sixty seconds and on each violation, stored in a private bucket behind signed URLs that expire in ten minutes. No biometric template is produced or stored.",
  },
  {
    question: "Is Pariksha better than Google Forms for an exam?",
    answer:
      "Pariksha answers this with its own specified list rather than a claim about Google Forms: question pools so no two candidates share a paper, twelve question types including matching, ordering and numeric with tolerance, answer keys that never reach the browser, a server-enforced timer, and tab-switch logging. Compare that with Microsoft Forms as it stands in October 2026.",
  },
  {
    question: "How is it different from Mettl, HackerEarth or Testlify?",
    answer:
      "Pariksha differs from platforms such as Mettl, HackerEarth, Testlify and Testportal, whose pricing, as published in October 2026, is per candidate or per month, and which host candidate data on their own servers. Pariksha is Apache-2.0, self-hosted and free to run, with scoring code you can read and change and a whole test that exports as one portable JSON file.",
  },
  {
    question: "Can I write questions before the app exists?",
    answer:
      "Pariksha lets you write questions before the app exists, and doing so today is the most useful thing you can do. Write them against pariksha/question@1, validate them with one npx ajv command against the schemas in schemas/, and they will import into Pariksha on day one; the worked example in examples/reasoning-aptitude/ is a template to copy.",
  },
  {
    question: "Can Pariksha generate questions with AI?",
    answer:
      "Pariksha cannot generate questions with AI yet. Phase 9 plans bring-your-own-key drafting: your own Anthropic or OpenAI key, stored encrypted per workspace and never sent to the browser, drafting questions into a bank — never whole tests. Every draft is schema-validated and waits for a human to accept it, and nothing auto-publishes.",
  },
];

export function SignalFaq() {
  return (
    <section
      className="signal-wrap signal-section"
      id="faq"
      aria-labelledby="faq-heading"
    >
      <p className="signal-eyebrow">Questions and answers</p>
      <h2 id="faq-heading">FAQs</h2>
      {/* Native <details name="faq"> is an exclusive accordion: opening one
          closes the rest, with no JavaScript and no ARIA of our own. A
          browser without exclusive-accordion support simply lets more than
          one stay open, which is a smaller failure than a scripted one. */}
      <div className="signal-faq">
        {FAQ_ITEMS.map((item) => (
          <details className="signal-faq__item" name="faq" key={item.question}>
            <summary className="signal-faq__q">
              <h3>{item.question}</h3>
            </summary>
            <p className="signal-faq__a">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function SignalClose() {
  return (
    <section className="signal-field" aria-labelledby="close-heading">
      <div className="signal-wrap signal-close">
        <h2 id="close-heading">
          Start your question bank. It will import on day one.
        </h2>
        <p className="signal-lede signal-lede--after">
          The format is published and stable. Questions you write this week load
          into Pariksha when v0.1 lands — and into anything else, because the
          schemas are open.
        </p>
        <div className="signal-actions">
          <a className="signal-btn" href={tree("examples/reasoning-aptitude")}>
            Start your question bank
          </a>
          <a className="signal-btn signal-btn--ghost" href={REPO}>
            Watch the repo for v0.1
          </a>
        </div>
      </div>
    </section>
  );
}

export function SignalFooter() {
  return (
    <footer
      className="signal-wrap signal-footer"
      id="docs"
      aria-labelledby="footer-heading"
    >
      <h2 id="footer-heading" className="visually-hidden">
        Footer
      </h2>
      <div className="signal-footer__grid">
        <div>
          <h3>Documentation</h3>
          <p>
            <a href={blob("docs/PRD.md")}>PRD</a> ·{" "}
            <a href={blob("docs/question-format.md")}>Question format</a> ·{" "}
            <a href={blob("docs/test-format.md")}>Test format</a> ·{" "}
            <a href={tree("schemas")}>Schemas</a> ·{" "}
            <a href={tree("docs/adr")}>Architecture decisions</a> ·{" "}
            <a href={blob("docs/ROADMAP.md")}>Roadmap</a>
          </p>
        </div>
        <div>
          <h3>Project</h3>
          <p>
            <a href={REPO}>GitHub</a> ·{" "}
            <a href={blob("CONTRIBUTING.md")}>Contributing</a> ·{" "}
            <a href={blob("CODE_OF_CONDUCT.md")}>Code of conduct</a> ·{" "}
            <a href={blob("SECURITY.md")}>Security policy</a>
          </p>
        </div>
        <div>
          <h3>Licence</h3>
          <p>
            Apache-2.0 with an explicit patent grant. Documentation, schemas and
            example tests under CC BY 4.0. No contributor licence agreement.
          </p>
        </div>
        <div>
          <h3>Not for</h3>
          <p>
            A test you must run this week · invigilated or legally contestable
            exams · candidates on phones · lockdown browsers · anyone wanting it
            hosted for them.
          </p>
        </div>
      </div>
    </footer>
  );
}
