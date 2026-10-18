import type { ReactNode } from "react";

// The → lives in its own aria-hidden span (issue 137): the accessible name
// is the label alone, never "label →". `surface` is the one documented
// variant — DESIGN.md's "already-sanctioned hover state" (voltage-deep fill,
// cream label, 5.66:1) taken as the resting state instead, for a CTA placed
// on a cream band where the default cream-on-cream pill would be invisible.
export function ButtonPrimary({
  href,
  children,
  surface = false,
}: {
  href: string;
  children: ReactNode;
  surface?: boolean;
}) {
  const className = surface
    ? "button-primary button-primary--surface"
    : "button-primary";
  return (
    <a className={className} href={href}>
      {children} <span aria-hidden="true">→</span>
    </a>
  );
}
