import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useDialogKeys } from "../useDialogKeys";
import { sciReduce, sciView, type SciKey, type SciState } from "./scientific";

/**
 * The GATE-style scientific calculator (spec 2026-11-06). The maths lives in
 * `scientific.ts`; this is the keypad. State is lifted to Runner so memory,
 * Deg/Rad and the last expression survive closing and reopening (rule 10).
 */
interface Key {
  key: SciKey;
  label: string;
  /** Word for the glyph; the accessible name is "word glyph" (WCAG 2.5.3). */
  name?: string | undefined;
  className?: string;
}

const fn = (key: SciKey, label: string, name: string): Key => ({ key, label, name, className: "exam-sci-fn" });
const num = (key: SciKey, name?: string): Key => ({ key, label: key, name, className: "exam-sci-num" });

/** Row-major, 8 columns (spec "Decided by the owner"). */
const KEYS: readonly Key[] = [
  fn("sin", "sin", "Sine"), fn("cos", "cos", "Cosine"), fn("tan", "tan", "Tangent"),
  fn("(", "(", "Open bracket"), fn(")", ")", "Close bracket"),
  { key: "Backspace", label: "⌫", name: "Backspace", className: "exam-sci-clr" },
  { key: "C", label: "C", name: "Clear", className: "exam-sci-clr" },
  fn("neg", "±", "Negate"),

  fn("asin", "sin⁻¹", "Inverse sine"), fn("acos", "cos⁻¹", "Inverse cosine"), fn("atan", "tan⁻¹", "Inverse tangent"),
  num("7"), num("8"), num("9"), fn("/", "÷", "Divide"), fn("pct", "%", "Percent"),

  fn("sinh", "sinh", "Hyperbolic sine"), fn("cosh", "cosh", "Hyperbolic cosine"), fn("tanh", "tanh", "Hyperbolic tangent"),
  num("4"), num("5"), num("6"), fn("*", "×", "Multiply"), fn("inv", "1/x", "Reciprocal"),

  fn("log", "log", "Log base 10"), fn("ln", "ln", "Natural log"), fn("logy", "logᵧx", "Log base y"),
  num("1"), num("2"), num("3"), fn("-", "−", "Subtract"), fn("sq", "x²", "Square"),

  fn("exp", "eˣ", "e to the power"), fn("pow10", "10ˣ", "Ten to the power"), fn("^", "xʸ", "Power"),
  num("0"), num(".", "Decimal point"), fn("pi", "π", "Pi"), fn("+", "+", "Add"), fn("sqrt", "√", "Square root"),

  fn("fact", "n!", "Factorial"), fn("mod", "mod", "Modulo"), fn("cbrt", "∛", "Cube root"),
  fn("EXP", "EXP", "Exponent"), fn("e", "e", "Euler's number"), fn("abs", "|x|", "Absolute value"),
  { key: "=", label: "=", name: "Equals", className: "exam-sci-eq" },
];

const MEMORY: readonly { key: SciKey; label: string; name: string }[] = [
  { key: "MC", label: "MC", name: "Memory clear" },
  { key: "MR", label: "MR", name: "Memory recall" },
  { key: "MS", label: "MS", name: "Memory store" },
  { key: "M+", label: "M+", name: "Memory add" },
  { key: "M-", label: "M−", name: "Memory subtract" },
];

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), Math.max(min, max));
}

export function ScientificCalculator({
  state,
  onState,
  onClose,
}: {
  state: SciState;
  onState: (next: SciState | ((s: SciState) => SciState)) => void;
  onClose: () => void;
}) {
  const view = sciView(state);
  const press = (key: SciKey) => {
    onState((s) => sciReduce(s, key));
  };
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const { dialogRef, onKeyDown } = useDialogKeys<HTMLDivElement>(true, onClose, { trapTab: true });

  const getBounds = () => {
    const rect = dialogRef.current?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : 440;
    const height = rect && rect.height > 0 ? rect.height : 420;
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
    const minX = 10;
    const minY = 10;
    const maxX = Math.max(minX, viewportW - width - 10);
    const maxY = Math.max(minY, viewportH - height - 10);
    const curX =
      position !== null ? position.x : rect && rect.left > 0 ? rect.left : Math.max(minX, viewportW - width - 32);
    const curY =
      position !== null ? position.y : rect && rect.top > 0 ? rect.top : Math.max(minY, viewportH - height - 32);
    return { minX, minY, maxX, maxY, curX, curY };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const { curX, curY } = getBounds();
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: curX, originY: curY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { startX, startY, originX, originY } = dragRef.current;
    const { minX, minY, maxX, maxY } = getBounds();
    setPosition({
      x: clamp(originX + event.clientX - startX, minX, maxX),
      y: clamp(originY + event.clientY - startY, minY, maxY),
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const NUDGE: Record<string, [number, number]> = {
    ArrowUp: [0, -20],
    ArrowDown: [0, 20],
    ArrowLeft: [-20, 0],
    ArrowRight: [20, 0],
  };
  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = NUDGE[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const { minX, minY, maxX, maxY, curX, curY } = getBounds();
    setPosition({ x: clamp(curX + delta[0], minX, maxX), y: clamp(curY + delta[1], minY, maxY) });
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown(event);
    if (event.defaultPrevented || event.key === "Escape") return;
    // Enter/Space on a focused control is that control's own activation
    // (same rule as Basic): only the dialog itself turns Enter into "=".
    if (event.target !== dialogRef.current && (event.key === "Enter" || event.key === " ")) return;
    const key = event.key === "Enter" ? "=" : event.key;
    let sci: SciKey | null = null;
    if (/^[\d.+\-*/()^=]$/.test(key) || key === "Backspace") sci = key as SciKey;
    else if (key === "%") sci = "pct";
    else if (key === "c" || key === "C") sci = "C";
    if (sci === null) return;
    event.preventDefault();
    press(sci);
  };

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.style.position = position ? "fixed" : "";
    el.style.left = position ? `${position.x}px` : "";
    el.style.top = position ? `${position.y}px` : "";
    el.style.right = position ? "auto" : "";
    el.style.bottom = position ? "auto" : "";
  }, [position, dialogRef]);

  return (
    <div
      className="exam-calculator exam-sci"
      role="dialog"
      aria-modal="true"
      aria-label="Scientific calculator"
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <div
        className="exam-calc-handle"
        data-testid="calc-drag-handle"
        tabIndex={0}
        role="toolbar"
        aria-label="Drag calculator handle. Use arrow keys to reposition."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onHandleKeyDown}
      >
        <span className="exam-calc-title">Scientific calculator</span>
        <span className="exam-calc-grip" aria-hidden="true">
          ⋮⋮
        </span>
      </div>
      <div className="exam-sci-display">
        <div className="exam-sci-expr">{view.expression}</div>
        <div className="exam-sci-line">
          {view.memory && (
            <span className="exam-sci-mem" role="img" aria-label="Memory holds a value">
              M
            </span>
          )}
          <output className="exam-sci-result" role="status">
            {view.result}
          </output>
        </div>
      </div>
      <div className="exam-sci-modes">
        <div role="radiogroup" aria-label="Angle unit" className="exam-sci-angle">
          {(["deg", "rad"] as const).map((unit) => (
            <label key={unit}>
              <input
                type="radio"
                name="sci-angle"
                checked={view.angle === unit}
                onChange={() => {
                  press(unit);
                }}
              />
              {unit === "deg" ? "Deg" : "Rad"}
            </label>
          ))}
        </div>
        <div className="exam-sci-memory">
          {MEMORY.map((m) => (
            <button
              key={m.key}
              type="button"
              className="exam-sci-key exam-sci-mem-key"
              aria-label={`${m.name} ${m.label}`}
              onClick={() => {
                press(m.key);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="exam-sci-keys">
        {KEYS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`exam-sci-key ${entry.className ?? ""}`}
            aria-label={entry.name === undefined ? undefined : `${entry.name} ${entry.label}`}
            onClick={() => {
              press(entry.key);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <button type="button" className="exam-calc-close" onClick={onClose}>
        Close calculator
      </button>
    </div>
  );
}
