import type { ReactNode } from "react";

export function ButtonSecondary({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="button-secondary" href={href}>
      {children}
    </a>
  );
}
