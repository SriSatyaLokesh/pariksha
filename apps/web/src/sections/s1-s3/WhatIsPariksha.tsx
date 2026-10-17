import { SectionHeading } from "../../components/SectionHeading";
import { MonoCaption } from "../../components/MonoCaption";

const HEADING_ID = "what-it-is-heading";
const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;
const tree = (path: string) => `${REPO}/tree/main/${path}`;

/**
 * S2 — What is Pariksha? landing-page-v2-design.md §3 S2, amended by
 * landing-page-v3-interactive.md §4.2: a three-item verification strip
 * re-tenants the social-proof slot a product with no users cannot fill.
 * No star/fork/adoption counts (§4.2's standing prohibition) and no
 * coverage tuple (§4.2 declines it — that register belongs on the README,
 * not the landing page).
 *
 * The only band whose job is to be quoted: an answer-first paragraph
 * (content-inventory.md §7 Q1, PRD :31) and a numeral row rather than a
 * card grid. 12 and 5 are Measured (content-inventory.md §8); the third
 * figure is Specified, so its label carries the word and the line beneath
 * carries the date — a design decision and the G5 accuracy correction are
 * the same edit.
 */
export function WhatIsPariksha() {
  return (
    <section
      id="what-it-is"
      aria-labelledby={HEADING_ID}
      className="section-s2 wrap"
    >
      <SectionHeading id={HEADING_ID} scale="band" eyebrow="WHAT IT IS">
        What is Pariksha?
      </SectionHeading>
      <div className="section-s2__measure">
        <p>
          Pariksha is a free, open-source exam platform that any school,
          company or community can run on its own account at zero cost. One
          Pariksha deployment hosts many tests, each with its own URL,
          question set, registration form, access rules and proctoring
          policy. Candidates sit the test in a browser, and organisers get
          scores and integrity reports back as CSV.
        </p>
        <div className="numeral-row">
          <div className="numeral-row__item">
            <p className="numeral-row__value">12</p>
            <MonoCaption className="numeral-row__label">
              QUESTION TYPES
            </MonoCaption>
          </div>
          <div className="numeral-row__item">
            <p className="numeral-row__value">5</p>
            <MonoCaption className="numeral-row__label">
              SCORING MODES
            </MonoCaption>
          </div>
          <div className="numeral-row__item">
            <p className="numeral-row__value">3</p>
            <MonoCaption className="numeral-row__label">
              PROCTORING PROFILES · SPECIFIED
            </MonoCaption>
          </div>
        </div>
        <MonoCaption>Apache-2.0 · pre-alpha, October 2026</MonoCaption>
        <ul className="verification-strip">
          <li>
            <a href={blob("docs/adr/0003-license-apache-2-0.md")}>
              Apache-2.0
            </a>
            , with an explicit patent grant.
          </li>
          <li>
            A worked example of{" "}
            <a href={tree("examples/reasoning-aptitude")}>
              seventeen questions
            </a>
            , covering all twelve types.
          </li>
          <li>
            The <a href={tree("schemas")}>JSON Schemas</a> are published.
          </li>
        </ul>
      </div>
    </section>
  );
}
