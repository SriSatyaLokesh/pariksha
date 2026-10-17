import { SectionHeading } from "../../components/SectionHeading";
import { CardVoltage } from "../../components/CardVoltage";
import { CardHairline } from "../../components/CardHairline";
import { CodeBlock } from "../../components/CodeBlock";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;

// Design contract §3 S7 (2026-10-17-landing-page-v2-design.md), amended by
// landing-page-v3-interactive.md §4.4: the $0 card, both qualifications and
// the budget table are unchanged. The two deploy cards collapse to one line
// each; CB-5 (the three-line website deploy snippet) is deleted, its
// binding truth ("the exam API is Phase 2") kept as a clause beside the
// Cloudflare line. The band gains the interoperability strip — four text
// labels, no logos, no brand marks — and CB-4 (`npx ajv`), the only command
// on the page a visitor can run today that does something real.
export function CostSection() {
  return (
    <section id="cost" aria-labelledby="cost-heading" className="section wrap">
      <SectionHeading id="cost-heading" scale="chapter" eyebrow="COST">
        What does it cost to run an exam on Pariksha?
      </SectionHeading>
      <p>
        Pariksha estimates zero hosting cost for a 500-candidate exam hour, by
        arithmetic rather than by a bill: the reference deployment is
        designed to fit inside Cloudflare&apos;s free-tier limits for
        Workers, D1 and R2, or run on a single Docker server you already
        control, with no Pariksha billing of any kind.
      </p>

      <div className="cost-split">
        <CardVoltage heading="$0 of hosting for a 500-candidate hour — by arithmetic, not by measurement." />
        <CardHairline>
          <p className="cost-budget-note">
            An estimate with published arithmetic. The 500-candidate figure
            is a design target; the load test that would prove it (
            <code>AC-29</code>) is a Phase 12 gate and has not been run.
          </p>
          <table className="cost-budget-table">
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

      <p className="cost-deploy-line">
        <strong>Cloudflare, free plan</strong> — Workers, D1, R2 and Cron.
        This deploys the site you are reading; the exam API is Phase 2 and
        not built.
      </p>
      <p className="cost-deploy-line">
        <strong>Docker, any server · planned</strong> — Node 22 with SQLite
        or Postgres 16, MinIO, S3 or disk storage, and Caddy — Phase 11, not
        built yet.
      </p>

      <p className="cost-architecture">
        The architecture is three adapter seams — database, object storage,
        identity — so moving between them is configuration, not a rewrite.{" "}
        <a
          href={blob(
            "docs/adr/0002-cloudflare-reference-stack-with-adapters.md",
          )}
        >
          ADR 0002
        </a>
        ; the adapters are Phase 2 and not built.
      </p>
      <p className="cost-risk">
        Free-tier limits can change, which is the named risk against the
        zero-cost estimate. Password sign-in is not available on the
        Cloudflare free plan — a Worker gets 10 ms of CPU per request, too
        little for safe Argon2id — so organiser sign-in there uses OIDC or
        magic links instead.
      </p>

      <ul className="interop-strip">
        <li>JSON Schema in</li>
        <li>CSV out</li>
        <li>Cloudflare free plan</li>
        <li>Docker (planned, Phase 11)</li>
      </ul>

      <CodeBlock
        caption="Validate questions against the schema — no install"
        footer="Write your own questions, validate them, and they will import into Pariksha on day one."
      >
        {`git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \\
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"`}
      </CodeBlock>
    </section>
  );
}
