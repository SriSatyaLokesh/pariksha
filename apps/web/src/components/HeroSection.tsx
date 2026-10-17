import type { ReactNode } from "react";

// Two instances on the page (§3.0): the opening hero (S1, an h1 at
// display-xl) and the closing band (S11, an h2 at display-lg, 6fr/6fr
// instead of 7fr/5fr). One component doing more, not a second one — the
// variant drives both the heading level/size and the column ratio, since
// those two facts move together for every instance this page has.
export type HeroSectionVariant = "display-xl" | "display-lg";

export function HeroSection({
  variant = "display-xl",
  headingId,
  heading,
  chip,
  lead,
  primaryCta,
  secondaryCta,
  mock,
}: {
  variant?: HeroSectionVariant;
  headingId: string;
  heading: ReactNode;
  /** The pre-alpha status chip — S1 only. */
  chip?: ReactNode;
  lead: ReactNode;
  primaryCta: ReactNode;
  secondaryCta?: ReactNode;
  /** The right-column slot: a ProductMock, or S11's file listing. */
  mock?: ReactNode;
}) {
  const HeadingTag = variant === "display-lg" ? "h2" : "h1";
  const sectionClassName =
    variant === "display-lg"
      ? "hero-section hero-section--display-lg"
      : "hero-section";

  return (
    <section className={sectionClassName} aria-labelledby={headingId}>
      <div className="hero-inner">
        <div className="hero-copy">
          {chip !== undefined && <p className="hero-chip">{chip}</p>}
          <HeadingTag
            id={headingId}
            className={`hero-heading hero-heading--${variant}`}
          >
            {heading}
          </HeadingTag>
          <p className="hero-lead">{lead}</p>
          <div className="hero-ctas">
            {primaryCta}
            {secondaryCta}
          </div>
        </div>
        {mock !== undefined && <div className="hero-mock">{mock}</div>}
      </div>
    </section>
  );
}
