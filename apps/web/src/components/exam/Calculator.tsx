import { useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useDialogKeys } from "../useDialogKeys";

/**
 * C-04's optional on-screen calculator. Four functions, written by hand:
 * a candidate's bundle is budgeted at 300 KB gzipped (PRD non-functional
 * table) and an arithmetic dependency is the easiest 30 KB in the world to
 * spend by accident. Nothing here animates.
 */
type Op = "+" | "-" | "*" | "/";

interface CalcState {
  /** What the display shows. `"Error"` is a value, not a flag. */
  shown: string;
  /** The left-hand side, once an operator has been pressed. */
  acc: number | null;
  op: Op | null;
  /** The next digit starts a new number rather than extending this one. */
  fresh: boolean;
}

const START: CalcState = { shown: "0", acc: null, op: null, fresh: true };

const OPS: Readonly<Record<Op, (a: number, b: number) => number>> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
};

/** 0.1 + 0.2 is 0.30000000000000004 in IEEE 754. A candidate reading that
 * under a clock loses time deciding whether it matters. */
function show(value: number): string {
  if (!Number.isFinite(value)) return "Error";
  return String(Number(value.toPrecision(12)));
}

function isOp(key: string): key is Op {
  return key === "+" || key === "-" || key === "*" || key === "/";
}

function reduce(state: CalcState, key: string): CalcState {
  // A wedged calculator is worse than a wrong one: a candidate cannot
  // reload the page to get a working tool back.
  if (state.shown === "Error") return key === "C" ? START : reduce(START, key);
  if (key === "C") return START;

  if (/^\d$/.test(key)) {
    const shown = state.fresh || state.shown === "0" ? key : state.shown + key;
    return { ...state, shown, fresh: false };
  }
  if (key === ".") {
    if (state.fresh) return { ...state, shown: "0.", fresh: false };
    return state.shown.includes(".") ? state : { ...state, shown: `${state.shown}.` };
  }
  if (key === "Backspace") {
    if (state.fresh) return state;
    const shown = state.shown.slice(0, -1);
    return { ...state, shown: shown === "" || shown === "-" ? "0" : shown };
  }
  if (isOp(key)) {
    // A pending operator with a freshly typed right-hand side folds first,
    // so `2+3+4=` is 9 and not 7.
    const folded =
      state.acc !== null && state.op !== null && !state.fresh
        ? OPS[state.op](state.acc, Number(state.shown))
        : Number(state.shown);
    return { shown: show(folded), acc: folded, op: key, fresh: true };
  }
  if (key === "=") {
    if (state.acc === null || state.op === null) return { ...state, fresh: true };
    const result = OPS[state.op](state.acc, Number(state.shown));
    return { shown: show(result), acc: null, op: null, fresh: true };
  }
  return state;
}

/** Visible label plus the word for it. The digits are their own label; an
 * operator is a glyph, and "×" read aloud as "times sign" is not what a
 * candidate wants from a key. The accessible name keeps the glyph as well
 * as the word, because WCAG 2.5.3 wants the name to be a superset of the
 * visible label, not a replacement for it. */
const KEYS: readonly { key: string; label: string; name?: string; className?: string }[] = [
  { key: "C", label: "C", name: "Clear" },
  { key: "/", label: "÷", name: "Divide" },
  { key: "*", label: "×", name: "Multiply" },
  { key: "-", label: "−", name: "Subtract" },
  { key: "7", label: "7" },
  { key: "8", label: "8" },
  { key: "9", label: "9" },
  { key: "+", label: "+", name: "Add" },
  { key: "4", label: "4" },
  { key: "5", label: "5" },
  { key: "6", label: "6" },
  { key: "1", label: "1" },
  { key: "2", label: "2" },
  { key: "3", label: "3" },
  { key: "=", label: "=", name: "Equals", className: "exam-calc-equals" },
  { key: "0", label: "0" },
  { key: ".", label: ".", name: "Decimal point" },
];

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), Math.max(min, max));
}

export function Calculator({ onClose }: { onClose: () => void }) {
  const [state, press] = useReducer(reduce, START);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // `trapTab` because this overlays a live attempt and claims
  // `aria-modal`; the hook returns focus to the control that opened it.
  const { dialogRef, onKeyDown } = useDialogKeys<HTMLDivElement>(true, onClose, { trapTab: true });

  const getBounds = () => {
    const rect = dialogRef.current?.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : 240;
    const height = rect && rect.height > 0 ? rect.height : 340;
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
    const minX = 10;
    const minY = 10;
    const maxX = Math.max(minX, viewportW - width - 10);
    const maxY = Math.max(minY, viewportH - height - 10);
    const curX =
      position !== null
        ? position.x
        : rect && rect.left > 0
          ? rect.left
          : Math.max(minX, viewportW - width - 32);
    const curY =
      position !== null
        ? position.y
        : rect && rect.top > 0
          ? rect.top
          : Math.max(minY, viewportH - height - 32);
    return { minX, minY, maxX, maxY, curX, curY };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const { curX, curY } = getBounds();
    dragRef.current = {
      isDragging: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: curX,
      originY: curY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current?.isDragging) return;
    const { startX, startY, originX, originY } = dragRef.current;
    const { minX, minY, maxX, maxY } = getBounds();
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const nextX = clamp(originX + deltaX, minX, maxX);
    const nextY = clamp(originY + deltaY, minY, maxY);
    setPosition({ x: nextX, y: nextY });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.isDragging) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const { minX, minY, maxX, maxY, curX, curY } = getBounds();
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowUp") deltaY = -20;
    if (event.key === "ArrowDown") deltaY = 20;
    if (event.key === "ArrowLeft") deltaX = -20;
    if (event.key === "ArrowRight") deltaX = 20;

    const nextX = clamp(curX + deltaX, minX, maxX);
    const nextY = clamp(curY + deltaY, minY, maxY);
    setPosition({ x: nextX, y: nextY });
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown(event);
    if (event.defaultPrevented || event.key === "Escape") return;
    // Fix round 1, I1. This handler sits on the dialog and therefore sees
    // every keydown bubbling out of the eighteen controls inside it.
    // Enter and Space on a focused button are that button's own
    // activation and belong to it: Enter on "7" must enter a 7, not an
    // equals, and Enter on "Close calculator" must close the calculator.
    // Rewriting Enter to "=" and calling preventDefault() cancelled both,
    // silently, because Space still worked. Every other key is still
    // handled from anywhere inside, so a candidate who clicked a key with
    // the mouse can carry on typing without clicking the dialog first.
    const onAKey = event.target !== dialogRef.current;
    if (onAKey && (event.key === "Enter" || event.key === " ")) return;
    const key = event.key === "Enter" ? "=" : event.key;
    if (/^[\d.+\-*/=]$/.test(key) || key === "Backspace" || key === "c" || key === "C") {
      event.preventDefault();
      press(key === "c" ? "C" : key);
    }
  };

  return (
    <div
      className="exam-calculator"
      role="dialog"
      aria-modal="true"
      aria-label="Calculator"
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={onKey}
      style={
        position !== null
          ? {
              position: "fixed",
              left: `${position.x}px`,
              top: `${position.y}px`,
              right: "auto",
              bottom: "auto",
            }
          : undefined
      }
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
        <span className="exam-calc-title">Calculator</span>
        <span className="exam-calc-grip" aria-hidden="true">
          ⋮⋮
        </span>
      </div>
      <output className="exam-calc-display" role="status">
        {state.shown}
      </output>
      <div className="exam-calc-keys">
        {KEYS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={["exam-calc-key", entry.className].filter(Boolean).join(" ")}
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
