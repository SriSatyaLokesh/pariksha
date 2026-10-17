import type { ReactNode } from "react";

export function CardVoltage({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="card-voltage">
      <h2 className="card-voltage__heading">{heading}</h2>
      <p className="card-voltage__body">{children}</p>
    </div>
  );
}
