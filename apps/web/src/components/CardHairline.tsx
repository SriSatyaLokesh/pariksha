import type { ReactNode } from "react";

export function CardHairline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const classes = className ? `card-hairline ${className}` : "card-hairline";
  return <div className={classes}>{children}</div>;
}
