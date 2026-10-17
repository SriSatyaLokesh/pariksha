import { SectionHeading } from "../../components/SectionHeading";
import { CardVoltage } from "../../components/CardVoltage";
import { CardHairline } from "../../components/CardHairline";
import { CodeBlock } from "../../components/CodeBlock";
import { ButtonSecondary } from "../../components/ButtonSecondary";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const tree = (path: string) => `${REPO}/tree/main/${path}`;
const blob = (path: string) => `${REPO}/blob/main/${path}`;

// Design contract §3 S7 (2026-10-17-landing-page-v2-design.md): the page's
// one in-body voltage object, beside the published arithmetic and the two
// deploy targets. Every number is sourced in content-inventory.md §8 — the
// $0/500 pair is explicitly an estimate and a design target, never a
// measured claim (T26b), and the CB-5 deploy block carries its own caveat
// that this deploys the website, not the exam API.
export function CostSection() {
  return (
    <section id="cost" aria-labelledby="cost-heading" className="section wrap">
      <SectionHeading id="cost-heading" scale="chapter">
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

      <div className="cost-deploy-grid">
        <CardHairline>
          <h3 className="cost-deploy-card__title">Cloudflare, free plan</h3>
          <p className="cost-deploy-card__body">Workers, D1, R2 and Cron.</p>
          <ButtonSecondary href={tree("deploy/cloudflare")}>
            Cloudflare setup
          </ButtonSecondary>
        </CardHairline>
        <CardHairline>
          <h3 className="cost-deploy-card__title">
            Docker, any server · planned
          </h3>
          <p className="cost-deploy-card__body">
            Node 22 with SQLite or Postgres 16, MinIO, S3 or disk storage, and
            Caddy — Phase 11, not built yet.
          </p>
          <ButtonSecondary href={tree("deploy/docker")}>
            Docker setup
          </ButtonSecondary>
        </CardHairline>
      </div>

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

      <CodeBlock
        caption="deploy/cloudflare/README.md"
        footer="this deploys the site you are reading. The exam API is Phase 2."
      >
        {
          "pnpm install && pnpm build\npnpm --filter @pariksha/web exec wrangler login\npnpm --filter @pariksha/web deploy"
        }
      </CodeBlock>
    </section>
  );
}
