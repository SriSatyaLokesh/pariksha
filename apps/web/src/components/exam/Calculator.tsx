import { useReducer, type KeyboardEvent } from "react";
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

export function Calculator({ onClose }: { onClose: () => void }) {
  const [state, press] = useReducer(reduce, START);
  // `trapTab` because this overlays a live attempt and claims
  // `aria-modal`; the hook returns focus to the control that opened it.
  const { dialogRef, onKeyDown } = useDialogKeys<HTMLDivElement>(true, onClose, { trapTab: true });

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
    >
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
