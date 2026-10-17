import type { ReactNode } from "react";
import { useId } from "react";

// §6 "New — 4": step label, heading-sm title, body, artefact slot —
// repeated three times in S3. ui-direction.md §2.4: the ordinal sets large
// (display-lg scale, mono-sm face, --color-muted) but is not a badge — no
// icon, no coloured circle, no voltage.
export function StepRow({
  ordinal,
  title,
  artefact,
  children,
}: {
  ordinal: string;
  title: string;
  artefact?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div className="step-row">
      <span className="step-row__ordinal">{ordinal}</span>
      <div className="step-row__content">
        <h3 id={titleId} className="step-row__title">
          {title}
        </h3>
        <div className="step-row__body">{children}</div>
        {artefact ? (
          <div className="step-row__artefact">{artefact}</div>
        ) : null}
      </div>
    </div>
  );
}
