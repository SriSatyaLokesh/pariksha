// A display-lg emphasis block. DESIGN.md: "The in-body emphasis block...
// One per page, at most." It holds only its headline statement — no body
// copy — per the controller ruling that moved the cost band's explanatory
// sentence into the card-hairline beside it instead.
//
// A <p>, not a heading: its one call site (S7) already has its own
// SectionHeading h2 ("What does it cost to run an exam on Pariksha?"); a
// second h2 for the $0 statement inside the same band is a landmark/heading
// duplicate, not a second section title.
export function CardVoltage({ heading }: { heading: string }) {
  return (
    <div className="card-voltage">
      <p className="card-voltage__heading">{heading}</p>
    </div>
  );
}
