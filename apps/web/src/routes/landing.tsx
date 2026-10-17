import { TopNav } from "../components/TopNav";
import { HeroSection } from "../components/HeroSection";
import { SectionHeading } from "../components/SectionHeading";
import { FeatureCell } from "../components/FeatureCell";
import { CardHairline } from "../components/CardHairline";
import { CardVoltage } from "../components/CardVoltage";
import { ButtonSecondary } from "../components/ButtonSecondary";
import { MonoCaption } from "../components/MonoCaption";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;
const tree = (path: string) => `${REPO}/tree/main/${path}`;

const FEATURES = [
  {
    label: "ONE DEPLOYMENT",
    title: "Many tests, one account",
    body: (
      <>
        Each test gets its own name, <code>tst_</code> ID, URL, short link, QR
        code, sections and settings. Clone one, export it as JSON, import it
        somewhere else.
      </>
    ),
  },
  {
    label: "TWELVE TYPES",
    title: "Every type a paper needs",
    body: "Choice, select exactly K, true/false, assertion–reason, matching, multi-matching, ordering, fill in the blank, numeric with tolerance, short and long answer with a rubric.",
  },
  {
    label: "PER CANDIDATE",
    title: "A different paper for everyone",
    body: "Draw N questions from a pool filtered by tag and difficulty, or hand out fixed sets A/B/C round-robin so neighbours never match. Options shuffle; pinned options stay put.",
  },
  {
    label: "PROCTORING",
    title: "Off, Standard or Strict",
    body: "Desktop-only, fullscreen, tab-switch logging, copy-paste blocking, watermarking; and in Strict, camera snapshots and on-device face counting. No video or audio is ever recorded.",
  },
  {
    label: "FLAGS, NOT VERDICTS",
    title: "The app flags, a person decides",
    body: (
      <>
        Every attempt comes out <code>clean</code>, <code>review</code> or{" "}
        <code>high_risk</code>, with the events behind it. Pariksha never
        decides that someone cheated.
      </>
    ),
  },
  {
    label: "RESULTS",
    title: "Results that fit your spreadsheet",
    body: "Live monitor, grading queue, item analysis, and a CSV with one column per form field and section. A REST API and signed webhooks for everything else.",
  },
] as const;

export function Landing() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <TopNav />
      <main id="main-content">
        <HeroSection />

        {/* DESIGN.md's hero-section holds only the h1, lead sentence and
            CTA. This caption used to sit on the voltage canvas at 12px,
            which fails WCAG AA for cream-on-voltage (legal only at 24px+),
            so it lives here instead: mono-sm muted on cream, 5.18:1. */}
        <div className="hero-status-band wrap">
          <MonoCaption>
            Apache-2.0 · pre-alpha · the application lands with v0.1
          </MonoCaption>
        </div>

        <section
          id="what-it-does"
          aria-labelledby="what-it-does-heading"
          className="section wrap"
        >
          <SectionHeading id="what-it-does-heading">
            What it does
          </SectionHeading>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <FeatureCell
                key={feature.label}
                label={feature.label}
                title={feature.title}
                body={feature.body}
              />
            ))}
          </div>
        </section>

        <section aria-label="Cost" className="section wrap">
          <div className="split-band">
            <CardVoltage heading="$0 to run a test for 500 candidates in one hour." />
            <CardHairline>
              <p className="budget-note">
                Not a trial, not a free tier with a candidate cap. The reference
                deployment fits inside Cloudflare&apos;s free plan, and the
                numbers are in the requirements document.
              </p>
              <table className="budget-table">
                <caption className="visually-hidden">
                  Free-tier budget for one test of 500 candidates
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Resource</th>
                    <th scope="col">Free limit</th>
                    <th scope="col">One test of 500</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Worker requests</th>
                    <td>100,000 / day</td>
                    <td>about 55,000</td>
                  </tr>
                  <tr>
                    <th scope="row">D1 rows written</th>
                    <td>100,000 / day</td>
                    <td>about 55,000</td>
                  </tr>
                  <tr>
                    <th scope="row">R2 storage</th>
                    <td>10 GB / month</td>
                    <td>about 0.75 GB</td>
                  </tr>
                </tbody>
              </table>
            </CardHairline>
          </div>
        </section>

        <section
          id="question-types"
          aria-labelledby="question-types-heading"
          className="section wrap"
        >
          <SectionHeading id="question-types-heading">
            Why not a form tool
          </SectionHeading>
          <div className="table-scroll">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="visually-hidden">Capability</span>
                  </th>
                  <th scope="col">Free form tools</th>
                  <th scope="col">Assessment platforms</th>
                  <th scope="col">Pariksha</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Cost</th>
                  <td>Free</td>
                  <td>Per candidate, per month</td>
                  <td>Free</td>
                </tr>
                <tr>
                  <th scope="row">Question pools and sets</th>
                  <td>No</td>
                  <td>Yes</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Rich question types</th>
                  <td>3–4</td>
                  <td>Yes</td>
                  <td>12</td>
                </tr>
                <tr>
                  <th scope="row">Camera, fullscreen, tab-switch checks</th>
                  <td>No</td>
                  <td>Yes</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Where candidate data lives</th>
                  <td>Their servers</td>
                  <td>Their servers</td>
                  <td>Your account</td>
                </tr>
                <tr>
                  <th scope="row">Answer keys hidden from the browser</th>
                  <td>No</td>
                  <td>Yes</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <th scope="row">You can read and change the code</th>
                  <td>No</td>
                  <td>No</td>
                  <td>Yes</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="privacy-heading" className="section wrap">
          <SectionHeading id="privacy-heading">
            Your data stays in your account
          </SectionHeading>
          <div className="privacy-grid">
            <p>
              No telemetry. No third-party scripts. No fonts loaded from someone
              else&apos;s CDN.
            </p>
            <p>
              Answer keys never reach the browser; every rule is enforced on the
              server.
            </p>
            <p>
              Configurable retention, per-candidate export and deletion, and an
              append-only audit log.
            </p>
            <p>
              Questions and results go in and out as documented JSON and CSV, so
              leaving costs nothing.
            </p>
          </div>
        </section>

        <section
          id="hosting"
          aria-labelledby="hosting-heading"
          className="section wrap"
        >
          <SectionHeading id="hosting-heading">
            Two ways to run it
          </SectionHeading>
          <div className="hosting-grid">
            <CardHairline>
              <h3 className="hosting-card__title">Cloudflare, free plan</h3>
              <p className="hosting-card__body">
                Workers, D1, R2 and Cron Triggers.
              </p>
              <p className="hosting-card__stats">
                about 55,000 requests and 55,000 row writes for 500 candidates
                in an hour, against daily limits of 100,000.
              </p>
              <ButtonSecondary href={tree("deploy/cloudflare")}>
                Cloudflare setup
              </ButtonSecondary>
            </CardHairline>
            <CardHairline>
              <h3 className="hosting-card__title">Docker, any server</h3>
              <p className="hosting-card__body">
                Node with SQLite or Postgres, and S3 or MinIO for snapshots.
              </p>
              <p className="hosting-card__stats">
                For organisers who will not use a managed platform, or who have
                outgrown the free limits.
              </p>
              <ButtonSecondary href={tree("deploy/docker")}>
                Docker setup
              </ButtonSecondary>
            </CardHairline>
          </div>
          <p className="hosting-note">
            One codebase, three adapter seams — database, object storage and
            identity. Moving between the two is a configuration change, not a
            rewrite.
          </p>
        </section>

        <section aria-labelledby="status-heading" className="section wrap">
          <CardHairline>
            <MonoCaption>STATUS</MonoCaption>
            <h2 id="status-heading" className="status-band__lead">
              Pre-alpha, and honest about it.
            </h2>
            <p className="status-band__body">
              The product requirements, the open question and test formats,
              their JSON Schemas and a complete worked example are in the
              repository today. The scoring core landed with Phase 1. The
              application itself lands with v0.1 — the roadmap lists what is
              built and what is not.
            </p>
            <p className="status-band__links">
              <a href={blob("docs/ROADMAP.md")}>Roadmap</a>
              <a href={blob("docs/PRD.md")}>Read the PRD</a>
            </p>
          </CardHairline>
        </section>
      </main>

      <footer id="docs" className="site-footer">
        <h2 className="visually-hidden">Footer</h2>
        <div className="footer-grid wrap">
          <div className="footer-col">
            <h3 className="footer-col__heading">Documentation</h3>
            <ul>
              <li>
                <a href={blob("docs/PRD.md")}>PRD</a>
              </li>
              <li>
                <a href={blob("docs/question-format.md")}>Question format</a>
              </li>
              <li>
                <a href={blob("docs/test-format.md")}>Test format</a>
              </li>
              <li>
                <a href={blob("DESIGN.md")}>Design system</a>
              </li>
              <li>
                <a href={tree("docs/adr")}>Architecture decisions</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h3 className="footer-col__heading">Project</h3>
            <ul>
              <li>
                <a href={REPO}>GitHub</a>
              </li>
              <li>
                <a href={blob("CONTRIBUTING.md")}>Contributing</a>
              </li>
              <li>
                <a href={blob("CODE_OF_CONDUCT.md")}>Code of conduct</a>
              </li>
              <li>
                <a href={blob("SECURITY.md")}>Security policy</a>
              </li>
            </ul>
          </div>
          <div className="footer-col">
            <h3 className="footer-col__heading">Licence</h3>
            <p>
              Code under Apache-2.0. Documentation, schemas and the example
              tests under CC BY 4.0. No contributor licence agreement.
            </p>
          </div>
        </div>
        <MonoCaption className="footer-closing">
          <span lang="te">పరీక్ష</span> · <span lang="hi">परीक्षा</span> —
          &quot;examination&quot;
        </MonoCaption>
      </footer>
    </>
  );
}
