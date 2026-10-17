import type { ReactNode } from "react";
import { useId } from "react";

// ui-direction.md §3.1–§3.3: the code-block object. Three parts (caption
// bar, block, footer line) on a light band; on the voltage canvas the whole
// thing collapses onto one cream plane and the caption detaches above it,
// per the "nothing under 24px sets cream on voltage" rule. Syntax colour is
// four hand-written span classes (.tok-key/.tok-string/.tok-number/.tok-punct)
// in blocks.css — no highlighting dependency, per §3.2.
export function CodeBlock({
  caption,
  footer,
  surface = "light",
  children,
}: {
  caption: string;
  footer?: ReactNode;
  surface?: "light" | "voltage";
  children: ReactNode;
}) {
  const captionId = useId();
  return (
    <figure className={`code-block code-block--${surface}`}>
      <figcaption id={captionId} className="code-block__caption">
        {caption}
      </figcaption>
      {/* A7: every scrolling container carries tabIndex, role="region" and
          a real accessible name — this is one of the three things on the
          page permitted to be wider than the body measure (U §3.5). */}
      <div
        className="code-block__scroll"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        <pre className="code-block__pre">
          <code>{children}</code>
        </pre>
      </div>
      {footer ? <p className="code-block__footer">{footer}</p> : null}
    </figure>
  );
}
