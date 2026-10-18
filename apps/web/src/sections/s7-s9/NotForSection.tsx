import { SectionHeading } from "../../components/SectionHeading";
import { CardHairline } from "../../components/CardHairline";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;

// Design contract §3 S8 (2026-10-17-landing-page-v2-design.md), amended by
// landing-page-v3-interactive.md §4.5: B6 — "Who it is not for, and what is
// built". S8's sentences survive unshortened, uncarded and unsoftened, with
// the four that actually disqualify a buyer first, and gain a ninth
// absorbing FAQ Q9's substance. Then an h3 on #status carries S9 minus its
// twelve-row roadmap ledger (deleted; v3-cull.md §3, §4.1 of the contract):
// one sentence and a link to docs/ROADMAP.md replace it, and every barred
// phrase from v2 §3 S9 stays barred.
export function NotForSection() {
  return (
    <section
      id="not-for"
      aria-labelledby="not-for-heading"
      className="section wrap"
    >
      <SectionHeading id="not-for-heading" scale="band" eyebrow="SCOPE">
        Who is Pariksha not for?
      </SectionHeading>
      <div className="not-for-list">
        <p>
          Pariksha is not for every exam, and the product says so without
          hedging. It is pre-alpha software with nine specific situations
          where a different tool is the right call, and if any of the nine
          match what you need this week, this is not it yet.
        </p>
        <p>
          Anyone who needs to run a test this week. Pariksha is pre-alpha
          software; the formats are ready to write against, but the
          application is not ready to run.
        </p>
        <p>
          Anyone who wants somebody else to host it. There is no Pariksha
          SaaS — hosting it is the organiser&apos;s own Cloudflare account or
          server, by design.
        </p>
        <p>
          High-stakes examinations that must be invigilated — licensing
          boards, public service commissions, anything where a result is
          legally contestable. Browser checks deter and record; they cannot
          prove.
        </p>
        <p>
          Tests candidates will sit on a phone. With Standard or Strict
          proctoring, phones and tablets are blocked by design, including an
          iPad sending a desktop user agent.
        </p>
        <p>
          Anyone who needs live human proctoring or a lockdown browser. Both
          are explicit non-goals for this project.
        </p>
        <p>
          Coding interviews that need a code runner. It is not in v1 and is
          planned only as a later plugin.
        </p>
        <p>
          Organisations whose policy requires a vendor to carry the
          liability. Self-hosting means the data, the retention and the
          consent text are an organiser&apos;s own to get right; what
          Pariksha specifies is a template, not an indemnity.
        </p>
        <p>
          Anyone who wants an AI to decide who cheated. Pariksha flags an
          attempt; a person decides — and that is not a limitation to be
          lifted later, it is the design.
        </p>
        <p>
          Anyone who believes browser proctoring prevents cheating. Our own
          documentation says it does not.
        </p>
      </div>

      <h3 id="status" className="status-heading">
        What is built today, and what is not?
      </h3>
      <p>
        Pariksha has not been released yet; it is pre-alpha as of October
        2026. The formats, their JSON Schemas, a worked example and the
        scoring engine are published and tested, and the application itself
        lands with v0.1, one of twelve build phases complete, a second part
        done, and this page is itself that second phase&apos;s output.
      </p>

      <h4 className="status-group__heading">Built and tested</h4>
      <ul className="status-list">
        <li>The question and test formats, and their JSON Schemas.</li>
        <li>A worked example of 17 questions, covering all 12 types.</li>
        <li>
          <code>packages/core</code>: all 12 types graded, all 5 scoring
          modes, cross-field import validation, seeded selection and
          shuffling.
        </li>
        <li>Phase 1 landed with 173 tests, gated in CI.</li>
      </ul>

      <h4 className="status-group__heading">Specified, not built</h4>
      <ul className="status-list">
        <li>The authoring UI</li>
        <li>The test builder</li>
        <li>The candidate runtime</li>
        <li>Proctoring</li>
        <li>Results</li>
        <li>The API</li>
      </ul>
      <p className="status-group__links">
        Read the <a href={blob("docs/PRD.md")}>PRD</a> and the{" "}
        <a href={blob("docs/ROADMAP.md")}>roadmap</a>.
      </p>

      <p className="status-group__lead">
        Twelve build phases under four milestones; one is complete and a
        second part done — this website is its output. Read the full{" "}
        <a href={blob("docs/ROADMAP.md")}>roadmap</a>.
      </p>

      <CardHairline className="status-byok">
        <p>
          <strong>BYOK question drafting · Phase 9, not built.</strong> Your
          own Anthropic or OpenAI key, encrypted per workspace, never sent to
          the browser. Drafts questions into a bank, never whole tests.
          Validated like an import, rejected whole if it fails, reviewed by a
          human before use. You set a spend cap.
        </p>
      </CardHairline>
      <p className="status-byok-note">
        Pariksha ships no model keys and makes no outbound AI request on its
        own behalf, and a deployment with no key configured behaves exactly
        as it does now; the decision record comes before any of it is
        written.
      </p>
    </section>
  );
}
