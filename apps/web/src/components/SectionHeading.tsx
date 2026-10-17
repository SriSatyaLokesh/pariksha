import type { ReactNode } from "react";

// landing-page-v2-design.md §3.0: DESIGN.md's section-heading sets every h2
// at display-xl (56px, the h1's own size), which is right for a single-title
// application screen and wrong for a twelve-band page. `scale` is required,
// deliberately — so the default can never silently stay at 56px.
export type SectionHeadingScale = "chapter" | "band";

export function SectionHeading({
  id,
  scale,
  eyebrow,
  children,
}: {
  id: string;
  scale: SectionHeadingScale;
  /** mono-sm muted label above the heading — "band" sections always carry one. */
  eyebrow?: ReactNode;
  children: string;
}) {
  return (
    <>
      {eyebrow !== undefined && (
        <p className="section-eyebrow">{eyebrow}</p>
      )}
      <h2 id={id} className={`section-heading section-heading--${scale}`}>
        {children}
      </h2>
    </>
  );
}
