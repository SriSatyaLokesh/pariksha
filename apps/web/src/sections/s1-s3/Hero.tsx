import { HeroSection } from "../../components/HeroSection";
import { ButtonPrimary } from "../../components/ButtonPrimary";
import { ButtonSecondary } from "../../components/ButtonSecondary";
import { ProductMock } from "../../components/ProductMock";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";

// design contract §3 S1: the h1 is a 45-character budget, not a fixed
// string — T19 asserts the string, the contract governs any replacement.
const HEADING = "Pariksha — run real exams you host yourself.";

/**
 * S1 — Hero. landing-page-v2-design.md §3 S1, ui-direction.md §1.
 *
 * The runner mock (M-1) is content-inventory.md §4.5 (README.md:71-85),
 * trimmed to the fields ui-direction.md §1.2's sketch keeps, at true token
 * sizes (ui-direction.md §3.3). Two deliberate departures from the README's
 * own ASCII art, both named in the contract: the candidate line reads
 * "Candidate · 21CS0147" rather than a person's name (S1, "source order"),
 * and the locked-section glyph is the word "Locked" (A13, no emoji).
 */
export function Hero() {
  return (
    <HeroSection
      headingId="hero-heading"
      heading={HEADING}
      chip="PRE-ALPHA · APACHE-2.0"
      lead={
        <>
          Pariksha is an open-source exam platform you deploy yourself —
          question pools, twelve question types in the format, browser
          proctoring and CSV results, running on infrastructure you own. As
          of October 2026 the formats, the schemas, a worked example and the
          scoring engine are published; the application itself lands with
          v0.1.
        </>
      }
      primaryCta={
        <ButtonPrimary href={`${REPO}/tree/main/examples/reasoning-aptitude`}>
          Start with the worked example
        </ButtonPrimary>
      }
      secondaryCta={<ButtonSecondary href={REPO}>Read the code on GitHub</ButtonSecondary>}
      mock={
        <ProductMock
          className="runner-mock"
          description="A rendered mock of the candidate's test screen: a logical-reasoning question with four options, one selected, an eight-square navigation palette showing answered, marked, current and locked states, and an autosave status line."
        >
          <div className="runner-mock__header">
            <span className="runner-mock__section">
              Section 2 of 3 · Logical reasoning
            </span>
            <span className="runner-mock__timer">08:41</span>
          </div>
          <div className="runner-mock__stem-row">
            <span className="runner-mock__question-of">
              Question 6 of 12
            </span>
            <span className="runner-mock__points">2 pts</span>
          </div>
          <p className="runner-mock__stem">
            What comes next in the series?
            <br />
            3, 7, 15, 31, 63, ?
          </p>
          <div className="runner-mock__options">
            <span className="runner-mock__option">95</span>
            <span className="runner-mock__option runner-mock__option--selected">
              127
            </span>
            <span className="runner-mock__option">117</span>
            <span className="runner-mock__option">131</span>
          </div>
          <div className="runner-mock__palette">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className="runner-mock__square runner-mock__square--answered">
                {n}
              </span>
            ))}
            <span className="runner-mock__square runner-mock__square--marked">
              5
            </span>
            <span className="runner-mock__square runner-mock__square--current">
              6
            </span>
            <span className="runner-mock__square">7</span>
            <span className="runner-mock__square runner-mock__square--locked">
              Locked
            </span>
          </div>
          <div className="runner-mock__footer">
            <span className="runner-mock__saved">Saved 2 seconds ago</span>
            <span className="runner-mock__candidate">
              Candidate · 21CS0147
            </span>
          </div>
        </ProductMock>
      }
    />
  );
}
