import type { ReactNode } from "react";

// Two instances on the page (§3.0): the opening hero (S1, an h1 at
// display-xl) and the closing band (S11, an h2 at display-lg, 6fr/6fr
// instead of 7fr/5fr). One component doing more, not a second one — the
// variant drives both the heading level/size and the column ratio, since
// those two facts move together for every instance this page has.
//
// v3 §3.1 changes display-xl's shape only: the source order is now
// chip → h1 → demo → lead → links → bridge, with the demo placed in the
// grid's 5fr column by CSS (grid-column/grid-row on .hero-demo in
// components.css), never by nesting it inside a column wrapper — nesting
// is what would have forced a choice between the right DOM order and the
// right visual column. display-lg (S11/Closing) keeps v2's own shape
// untouched: chip/heading/lead/ctas in one column, mock in the other.
export type HeroSectionVariant = "display-xl" | "display-lg";

export function HeroSection({
  variant = "display-xl",
  headingId,
  heading,
  chip,
  demo,
  masthead,
  lead,
  links,
  bridge,
  primaryCta,
  secondaryCta,
  mock,
}: {
  variant?: HeroSectionVariant;
  headingId: string;
  heading: ReactNode;
  /** The pre-alpha status chip — S1 only. */
  chip?: ReactNode;
  /** display-xl only: the prerendered exam demo (v3 §3). */
  demo?: ReactNode;
  /** display-xl only: the Kalam wordmark filling the head row's right
   * column (v4 §3). aria-hidden at its call site — the nav already
   * announces the product name. */
  masthead?: ReactNode;
  /** Optional: B8 carries four elements and no lead paragraph (v3 §4.7). */
  lead?: ReactNode;
  /** display-xl only: the hero's two secondary text links (v3 §3.1) — the
   * primary CTA moved to the closing band, so there is no button here. */
  links?: ReactNode;
  /** display-xl only: the bridge band closing the hero's foot (v3 §3.8). */
  bridge?: ReactNode;
  /** display-lg only (S11/Closing). */
  primaryCta?: ReactNode;
  secondaryCta?: ReactNode;
  /** display-lg only (S11/Closing): the right-column slot. */
  mock?: ReactNode;
}) {
  if (variant === "display-lg") {
    return (
      <section
        className="hero-section hero-section--display-lg"
        aria-labelledby={headingId}
      >
        <div className="hero-inner">
          <div className="hero-copy">
            {chip !== undefined && <p className="hero-chip">{chip}</p>}
            <h2
              id={headingId}
              className="hero-heading hero-heading--display-lg"
            >
              {heading}
            </h2>
            {lead !== undefined && <p className="hero-lead">{lead}</p>}
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

  // v4 §3: the hero is exactly one screen and never scrolls inside itself
  // (owner approval 2026-10-17, from .planning/landing/v4-hero-prototype.html).
  // Two rows — head, then the demo — so the three cards take every pixel the
  // head does not. The masthead sits in the head row's right-hand column, the
  // voltage space the copy column leaves empty. The bridge band left the hero
  // entirely: a code block and a one-screen hero cannot both be true, so it
  // renders below the hero now (see routes/landing.tsx).
  return (
    <section
      className="hero-section hero-section--screen"
      aria-labelledby={headingId}
    >
      <div className="hero-inner">
        <div className="hero-copy">
          {chip !== undefined && <p className="hero-chip">{chip}</p>}
          <h1 id={headingId} className="hero-heading hero-heading--display-xl">
            {heading}
          </h1>
          {lead !== undefined && <p className="hero-lead">{lead}</p>}
          {links !== undefined && <div className="hero-links">{links}</div>}
        </div>
        {masthead}
      </div>
      {demo}
      {bridge}
    </section>
  );
}
