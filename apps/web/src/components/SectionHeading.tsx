export function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: string;
}) {
  return (
    <h2 id={id} className="section-heading">
      {children}
    </h2>
  );
}
