import { ButtonPrimary } from "./ButtonPrimary";

const EXAMPLE_URL =
  "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude";

// DESIGN.md's hero-section holds exactly the h1, one lead sentence and the
// CTA — nothing else. The pre-alpha caption that used to sit here moved to
// the band immediately below (see Landing), both for fidelity to the
// component spec and because cream text under 24px on the voltage canvas
// fails WCAG AA (DESIGN.md's Brand table sanctions cream-on-voltage only at
// 24px+); the lead sentence stays here only because it now has its own
// 24px `hero-lead` token.
export function HeroSection() {
  return (
    <section className="hero-section" aria-labelledby="hero-heading">
      <div className="hero-inner">
        <h1 id="hero-heading" className="hero-heading">
          Run real exams on the internet, for free, on infrastructure you own.
        </h1>
        <p className="hero-lead">
          Question pools, twelve question types, browser proctoring, a
          registration form builder and CSV results — self-hosted in under 30
          minutes, at zero hosting cost.
        </p>
        <ButtonPrimary href={EXAMPLE_URL}>
          Start with the worked example →
        </ButtonPrimary>
      </div>
    </section>
  );
}
