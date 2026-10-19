import { useMemo } from "react";
import qrcode from "qrcode-generator";

// T-02: the short link's QR code, as one inline `<svg role="img">` with a
// `<title>` — no canvas, no data URI, so the CSP (`default-src 'self'`,
// S-11) needs no extra allowance for it. `qrcode-generator` is admin entry
// only (apps/web/test/bundle.test.ts pins it out of the island/candidate
// bundle): a QR code is something an organiser hands to candidates, never
// something the public page itself renders.
//
// The module grid is drawn as one `<rect>` per dark cell rather than
// `createSvgTag`'s own HTML-string output, so the accessible name and the
// `<title>` are under this component's control rather than baked into a
// string the library owns.
export function QrCode({
  value,
  label,
  size = 128,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const modules = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    const cells: boolean[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) cells.push(code.isDark(row, col));
    }
    return { count, cells };
  }, [value]);

  const { count, cells } = modules;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${count} ${count}`}
      width={size}
      height={size}
      className="qr-code"
    >
      <title>{label}</title>
      <rect width={count} height={count} fill="var(--color-canvas)" />
      {cells.map((dark, index) => {
        if (!dark) return null;
        const row = Math.floor(index / count);
        const col = index % count;
        return <rect key={index} x={col} y={row} width={1} height={1} fill="currentColor" />;
      })}
    </svg>
  );
}
