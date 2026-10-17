import type { ReactNode } from "react";

export function ButtonPrimary({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="button-primary" href={href}>
      {children}
    </a>
  );
}
