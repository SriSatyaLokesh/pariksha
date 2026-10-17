import { ButtonPrimary } from "./ButtonPrimary";
import { MonoCaption } from "./MonoCaption";

const EXAMPLE_URL =
  "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude";

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
        <MonoCaption className="mono-caption--on-voltage hero-caption">
          Apache-2.0 · pre-alpha · the application lands with v0.1
        </MonoCaption>
      </div>
    </section>
  );
}
