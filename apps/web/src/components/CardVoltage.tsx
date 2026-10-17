// A display-lg emphasis block. DESIGN.md: "The in-body emphasis block...
// One per page, at most." It holds only its headline statement — no body
// copy — per the controller ruling that moved the cost band's explanatory
// sentence into the card-hairline beside it instead.
export function CardVoltage({ heading }: { heading: string }) {
  return (
    <div className="card-voltage">
      <h2 className="card-voltage__heading">{heading}</h2>
    </div>
  );
}
