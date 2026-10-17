import type { ReactNode } from "react";

// §6 "New — 4": the aria-hidden plane plus its adjacent visually-hidden
// description must not be re-derived per instance. The mock's own markup
// (M-1, M-2) stays at its call site — this component only owns the two
// accessibility carriers (A8 / T25). Reuses the existing .visually-hidden
// utility from base.css rather than defining a second one.
export function ProductMock({
  description,
  className,
  children,
}: {
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <div aria-hidden="true" className={className}>
        {children}
      </div>
      <p className="visually-hidden">{description}</p>
    </>
  );
}
