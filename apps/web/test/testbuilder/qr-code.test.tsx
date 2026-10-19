import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { QrCode } from "../../src/components/QrCode";

// Task 2 fix round, Critical 2: AC-02 says "each test's URL, short link and
// QR code open that test only" — nothing asserted what the QR actually
// encodes. `isDark(row, col)` is content-addressed (Reed-Solomon over the
// payload), so two different values that happened to produce the same dark
// cells would mean the library itself is broken, not this test.
function darkCells(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('rect[fill="currentColor"]'))
    .map((rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")}`)
    .join("|");
}

describe("QrCode", () => {
  it("encodes its value — two different short links render two different codes", () => {
    const a = render(<QrCode value="https://pariksha.example/t/ab12cd" label="QR code for the short link" />);
    const b = render(<QrCode value="https://pariksha.example/t/zz99yy" label="QR code for the short link" />);

    const cellsA = darkCells(a.container);
    const cellsB = darkCells(b.container);
    expect(cellsA.length).toBeGreaterThan(0);
    expect(cellsA).not.toEqual(cellsB);
  });

  it("the same value always renders the same code", () => {
    const a = render(<QrCode value="https://pariksha.example/t/ab12cd" label="QR code for the short link" />);
    const b = render(<QrCode value="https://pariksha.example/t/ab12cd" label="QR code for the short link" />);
    expect(darkCells(a.container)).toEqual(darkCells(b.container));
  });

  it("exposes only its accessible name, no visible text", () => {
    const { getByRole } = render(
      <QrCode value="https://pariksha.example/t/ab12cd" label="QR code for the short link" />,
    );
    expect(getByRole("img", { name: /qr code for the short link/i })).toBeVisible();
  });
});
