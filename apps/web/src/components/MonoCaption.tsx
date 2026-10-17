import type { ReactNode } from "react";

export function MonoCaption({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const classes = className ? `mono-caption ${className}` : "mono-caption";
  return <p className={classes}>{children}</p>;
}
