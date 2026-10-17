import type { ReactNode } from "react";

export function FeatureCell({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: ReactNode;
}) {
  return (
    <div className="feature-cell">
      <span className="feature-cell__label">{label}</span>
      <h3 className="feature-cell__title">{title}</h3>
      <p className="feature-cell__body">{body}</p>
    </div>
  );
}
