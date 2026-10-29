// Signal — build status, the questions-and-answers band, the close and the
// footer. The nine FAQ answers are the most search- and LLM-citable content
// the site has, and each is sourced in
// `.planning/landing/content-inventory.md` §7.
//
// **Rewritten for issue 253.** This section used to read "live today / lands
// with v0.1", and every one of the six things in its "lands with v0.1"
// column had already shipped. Phases 1-8 are on `main`: authoring, the
// builder, the candidate runtime, proctoring, results, grading, exports
// and retention. The two lists below are therefore *built* and *next*, and
// "next" is the real next — Phase 8.5 and Phases 9-12, named in
// docs/ROADMAP.md — rather than a restatement of what exists.
//
// What has NOT changed is the honesty rule the old copy got right: the
// section still says plainly what Pariksha has not done. It has not been
// run at scale. The v0.1 exit gate is one real exam, 300+ candidates, no
// lost answer, and until that happens the word is alpha.

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;
const tree = (path: string) => `${REPO}/tree/main/${path}`;

const LIVE = [
  "All 12 question types — authored, previewed, sat and scored",
  "Question banks, with import from Pariksha JSON, CSV and Moodle GIFT",
  "The test builder: pools, sets, registration forms, access codes, versions",
  "The candidate runtime: offline save queue, server clock, resume after a crash",
  "Proctoring — Off, Standard and Strict, with the violation limit and the lock",
  "Results: live counts, item analysis, grading queue, regrade, CSV and evidence exports",
  "Webhooks, scoped API keys, retention jobs, candidate export and erasure",
  "Organiser sign-in (OIDC, magic link, password + 2FA), workspaces, roles, audit log",
  "Deploy anywhere: Cloudflare free tier or Docker self-host (Postgres/SQLite + MinIO)",
  "Zero-SDK BYOK AI question drafting (Anthropic, OpenAI, OpenRouter with spend caps)",
] as const;

const NEXT = [
  "One real exam with 300+ candidates — the gate that ends alpha",
  "Microphone monitoring (Phase 8.5)",
] as const;

export function SignalStatus() {
  return (
    <section
      className="signal-wrap signal-section"
      id="status"
      aria-labelledby="status-heading"
    >
      <p className="signal-eyebrow">Where it stands</p>
      <h2 id="status-heading">What is built, and what is honestly not.</h2>
      <div className="signal-status-grid">
        <div>
          <div className="signal-chips" role="group" aria-label="Build status">
            <button
              className="signal-chip"
              type="button"
              aria-pressed="true"
              data-signal-status="live"
            >
              Built today
            </button>
            <button
              className="signal-chip"
              type="button"
              aria-pressed="false"
              data-signal-status="next"
            >
              Still to come
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
            The word is <b>alpha</b>, and it is doing work: every part of the
            path runs, and none of it has been run at scale. Pariksha has not
            yet carried one real exam with 300 candidates and no lost answer,
            which is the gate that ends alpha. Until it does, run it beside
            what you use now rather than instead of it.{" "}
            <a href={blob("docs/ROADMAP.md")}>Read the roadmap</a>.
          </p>
        </div>

        <div className="signal-today" id="start">
          <h3>What you can do today</h3>
          <ol>
            <li>
              <b>Deploy it.</b> One setup script against your own Cloudflare
              account — Worker, D1 and R2, all on the free plan — or launch
              with Docker Compose on any server or private network (Postgres or
              SQLite, MinIO S3 storage, and automated HTTPS).
            </li>
            <li>
              <b>Import a bank and build a test.</b> Pariksha JSON, CSV or
              Moodle GIFT; sections from pools or sets; a registration form you
              design; publish when the checklist is clear.
            </li>
            <li>
              <b>Sit it, score it, export it.</b> Send the link, watch the
              counts, grade what needs a person, download the results CSV.
            </li>
          </ol>
          <p className="signal-fine signal-fine--flush">
            <strong>What is still unproven:</strong> Pariksha at 300
            candidates at once.
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
      "You can run Pariksha today. Deploy it to your own Cloudflare account on the free plan, or self-host on any server or private cloud with Docker Compose (Postgres or SQLite, MinIO S3 storage, and Caddy for automatic HTTPS). Import a question bank, build a test, send the link, and download the results CSV — the whole path is built and on the main branch. You can also test-drive the candidate exam runtime immediately with zero setup: click 'Try Live Demo' or visit /exam?demo=true (access code: DEMO) to try all 12 question types, timed sections, floating calculator, and local proctoring with no server subrequests. It is alpha: the one thing Pariksha has not yet done is carry a real exam with 300 candidates at once, so run it beside what you use now rather than instead of it.",
  },
  {
    question: "Where is candidate data stored?",
    answer:
      "Pariksha stores candidate data in the organiser's own account — your Cloudflare D1 database and R2 bucket, or your own on-premise Postgres and disk/MinIO under Docker. There is no Pariksha server in the path. You pick the database region and storage jurisdiction where the host allows it, and there is no telemetry or third-party script anywhere. Air-gapped and local network deployments are fully supported.",
  },
  {
    question: "How many question types does it support?",
    answer:
      "Pariksha supports twelve question types: single choice, multiple choice, select exactly K, true/false, assertion–reason, matching, multi-matching, ordering, fill in the blank, numeric with tolerance, short answer and long answer. Each takes Markdown, code blocks, LaTeX and images, and all twelve can be authored with live preview, sat by a candidate and scored today.",
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
      "Pariksha differs from platforms such as Mettl, HackerEarth, Testlify and Testportal, whose pricing, as published in October 2026, is per candidate or per month, and which host candidate data on their own servers. Pariksha is AGPL-3.0, self-hosted and free to run, with scoring code you can read and change and a whole test that exports as one portable JSON file.",
  },
  {
    question: "Can I write questions outside Pariksha and import them?",
    answer:
      "You can write questions outside Pariksha and import them. Write them against pariksha/question@1 and validate them with one npx ajv command against the schemas in schemas/, or bring a CSV or a Moodle GIFT file — whole-bank import is all-or-nothing with a line-by-line error report, and export gives the bank back as portable JSON. The worked example in examples/reasoning-aptitude/ is a template to copy.",
  },
  {
    question: "Can Pariksha generate questions with AI?",
    answer:
      "Yes. Pariksha supports Bring-Your-Own-Key (BYOK) AI question drafting with zero external AI SDKs (using native fetch and WebCrypto AES-256-GCM encryption at rest). Workspace organisers can connect their own Anthropic (Claude 3.5 Sonnet / 3.7 Sonnet), OpenAI (GPT-4o, o1, o3-mini), or OpenRouter (DeepSeek, Llama 3.3, Mistral) API keys with hard monthly spend caps. Generated questions are previewed in-modal with schema validation badges, 1-click flagging/exclusion of inaccurate items, and inline editing before atomic commit to a bank. Questions are never auto-published without author approval.",
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
          Run your first exam this afternoon.
        </h2>
        <p className="signal-lede signal-lede--after">
          Clone it, point the setup script at your own Cloudflare account, and
          you own the instance — the questions, the candidates, the results and
          the code. Free plan, no per-candidate fee, no Pariksha server in the
          path.
        </p>
        <div className="signal-actions">
          <a className="signal-btn" href={blob("README.md")}>
            Run your first exam
          </a>
          <a className="signal-btn signal-btn--ghost" href="/exam?demo=true">
            Try Live Demo
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
            AGPL-3.0 copyleft protecting self-hosters. Documentation, schemas and
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
