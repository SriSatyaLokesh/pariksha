import { HeroSection } from "../../components/HeroSection";
import { ButtonPrimary } from "../../components/ButtonPrimary";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";

// B8 — the ask. landing-page-v3-interactive.md §4.7: four elements and
// nothing else — a declarative heading, one filled button (the page's only
// one below the fold), one secondary text link ("watch the repository for
// v0.1", the closest honest equivalent to a waitlist that collects
// nothing), and one mono line of honesty last. No artefact: M-4 (the file
// listing) is deleted outright, not carried — every pixel of evidence in
// the closer competes with the one decision being asked for. No email
// capture, no waitlist form, anywhere on the page (D3: it would need a
// network call nothing here is allowed to make).
export function Closing() {
  return (
    <HeroSection
      variant="display-lg"
      headingId="closing-heading"
      heading="Read one real test, end to end."
      primaryCta={
        <ButtonPrimary href={`${REPO}/tree/main/examples/reasoning-aptitude`}>
          Start with the worked example
        </ButtonPrimary>
      }
      secondaryCta={
        <a className="closing-watch-link" href={REPO}>
          Watch the repository for v0.1
        </a>
      }
      mock={
        <p className="closing-honesty">
          Pre-alpha. The formats are ready to write against; the application
          lands with v0.1.
        </p>
      }
    />
  );
}
