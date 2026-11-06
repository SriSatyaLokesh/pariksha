/**
 * Maths engine for the scientific calculator: a pure reducer, no React, no
 * dependency (candidate bundle budget). Input model is GATE's: binary keys
 * build an expression, unary keys act on the current entry at once.
 * Expression line uses the glyphs × ÷ − for display only.
 */
export type SciKey =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "."
  | "+" | "-" | "*" | "/" | "^" | "mod" | "logy"
  | "(" | ")" | "=" | "C" | "Backspace" | "EXP"
  | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "sinh" | "cosh" | "tanh"
  | "log" | "ln" | "exp" | "pow10" | "sq" | "sqrt" | "cbrt" | "fact" | "abs" | "inv" | "neg" | "pct"
  | "pi" | "e" | "MC" | "MR" | "MS" | "M+" | "M-" | "deg" | "rad";

type Op = "+" | "-" | "*" | "/" | "mod" | "^" | "logy";
type Tok = { k: "n"; v: number; t: string } | { k: "o"; o: Op; t: string } | { k: "("; t: string };

export interface SciState {
  /** Finished operands and operators of the expression so far. Closed `( … )`
   * groups are folded into one operand, so only `(` ever stays open. */
  toks: readonly Tok[];
  /** The typed text (or `"Error"`); only meaningful while `typing`. */
  entry: string;
  /** The entry's value when it is not being typed (a result, a constant…). */
  val: number;
  typing: boolean;
  /** Top-line record of the entry when a key produced it (`sin(30)`). */
  label: string | null;
  /** The entry was consumed by a binary operator or `(`; an operand is due. */
  waiting: boolean;
  /** The entry is the result of `=`. */
  done: boolean;
  angle: "deg" | "rad";
  memory: number;
}

export const SCI_START: SciState = {
  toks: [],
  entry: "0",
  val: 0,
  typing: false,
  label: null,
  waiting: false,
  done: false,
  angle: "deg",
  memory: 0,
};

// Same 12-significant-digit rule as Basic's show(), ported not imported
// (Calculator.tsx stays untouched). Values are stored rounded too, so what
// the candidate reads is what the next key computes with.
const r = (v: number): number => Number(v.toPrecision(12));
const show = (v: number): string => (Number.isFinite(v) ? String(r(v)) : "Error");

const clear = (s: SciState): SciState => ({ ...SCI_START, angle: s.angle, memory: s.memory });
const fail = (s: SciState): SciState => ({ ...clear(s), entry: "Error" });

const EXP_OPEN = /e-?$/;

function entryText(s: SciState): string {
  if (!s.typing) return show(s.val);
  // "2e" -> "2e0" so the line always reads as a number.
  if (EXP_OPEN.test(s.entry)) return s.entry.replace(/e(-?)$/, "e$10");
  return s.entry.includes("e") ? show(Number(s.entry)) : s.entry;
}

function entryVal(s: SciState): number {
  if (!s.typing) return s.val;
  const n = Number(s.entry.replace(EXP_OPEN, ""));
  return Number.isNaN(n) ? 0 : n;
}

const GLYPH: Record<Op, string> = { "+": "+", "-": "−", "*": "×", "/": "÷", mod: " mod ", "^": "^", logy: " logᵧ " };
const PREC: Record<Op, number> = { "+": 1, "-": 1, "*": 2, "/": 2, mod: 2, "^": 3, logy: 3 };
const BIN: Record<Op, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  mod: (a, b) => a % b, // ponytail: JS remainder (sign of the dividend); no floored-mod variant
  "^": Math.pow,
  logy: (a, b) => Math.log(a) / Math.log(b),
};

const text = (ts: readonly Tok[]): string => ts.map((t) => t.t).join("");

/** Shunting-yard over a bracket-free `n o n o n` list. NaN if malformed. */
function evalFlat(ts: readonly Tok[]): number {
  if (ts.length % 2 === 0) return NaN;
  const nums: number[] = [];
  const ops: Op[] = [];
  const apply = () => {
    const op = ops.pop() as Op;
    const b = nums.pop() as number;
    const a = nums.pop() as number;
    nums.push(BIN[op](a, b));
  };
  for (const t of ts) {
    if (t.k === "n") nums.push(t.v);
    else if (t.k === "o") {
      // `^` and `logy` are right-associative: they do not pop an equal.
      while (ops.length > 0) {
        const top = ops[ops.length - 1] as Op;
        if (PREC[top] > PREC[t.o] || (PREC[top] === PREC[t.o] && PREC[t.o] < 3)) apply();
        else break;
      }
      ops.push(t.o);
    } else return NaN;
  }
  while (ops.length > 0) apply();
  return nums.length === 1 ? (nums[0] as number) : NaN;
}

/** Fold the innermost open group (the last `(`) into a single operand. */
function closeLast(ts: readonly Tok[]): { rest: readonly Tok[]; v: number; text: string } | null {
  const i = ts.map((t) => t.k).lastIndexOf("(");
  const inner = ts.slice(i + 1);
  const v = evalFlat(inner);
  return Number.isFinite(v) ? { rest: ts.slice(0, i), v: r(v), text: `(${text(inner)})` } : null;
}

const snap = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v);

function trig(kind: "sin" | "cos" | "tan", x: number, deg: boolean): number {
  if (deg) {
    if (x % 90 === 0) {
      // Exact values at multiples of 90 degrees.
      const k = (((x / 90) % 4) + 4) % 4;
      if (kind === "sin") return [0, 1, 0, -1][k] ?? 0;
      if (kind === "cos") return [1, 0, -1, 0][k] ?? 0;
      return k % 2 === 0 ? 0 : NaN; // tan at an odd multiple of 90
    }
    x = (x * Math.PI) / 180;
  }
  // Rad-mode tan at pi/2 is not 1.6e16, it is undefined: refuse when cos snaps to 0.
  if (kind === "tan") return Math.abs(Math.cos(x)) < 1e-12 ? NaN : snap(Math.tan(x));
  return snap(kind === "sin" ? Math.sin(x) : Math.cos(x));
}

function fact(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** [function of (value, degrees?), label of the entry it was applied to]. */
const UNARY = {
  sin: [(x, d) => trig("sin", x, d), (i) => `sin(${i})`],
  cos: [(x, d) => trig("cos", x, d), (i) => `cos(${i})`],
  tan: [(x, d) => trig("tan", x, d), (i) => `tan(${i})`],
  asin: [(x, d) => (d ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)), (i) => `sin⁻¹(${i})`],
  acos: [(x, d) => (d ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)), (i) => `cos⁻¹(${i})`],
  atan: [(x, d) => (d ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)), (i) => `tan⁻¹(${i})`],
  sinh: [(x) => Math.sinh(x), (i) => `sinh(${i})`],
  cosh: [(x) => Math.cosh(x), (i) => `cosh(${i})`],
  tanh: [(x) => Math.tanh(x), (i) => `tanh(${i})`],
  log: [(x) => Math.log10(x), (i) => `log(${i})`],
  ln: [(x) => Math.log(x), (i) => `ln(${i})`],
  exp: [(x) => Math.exp(x), (i) => `e^(${i})`],
  pow10: [(x) => Math.pow(10, x), (i) => `10^(${i})`],
  sq: [(x) => x * x, (i) => `(${i})²`],
  sqrt: [(x) => Math.sqrt(x), (i) => `√(${i})`],
  cbrt: [(x) => Math.cbrt(x), (i) => `∛(${i})`],
  fact: [fact, (i) => `(${i})!`],
  abs: [(x) => Math.abs(x), (i) => `|${i}|`],
  inv: [(x) => 1 / x, (i) => `1/(${i})`],
  neg: [(x) => -x, (i) => `−(${i})`],
  pct: [(x) => x / 100, (i) => `(${i})%`],
} satisfies Record<string, [(x: number, deg: boolean) => number, (inner: string) => string]>;
type UnaryKey = keyof typeof UNARY;

const OPKEYS: ReadonlySet<string> = new Set<SciKey>(["+", "-", "*", "/", "^", "mod", "logy"]);
const MEMKEYS: ReadonlySet<string> = new Set<SciKey>(["MC", "MR", "MS", "M+", "M-"]);

function setEntry(s: SciState, v: number, label: string | null): SciState {
  if (!Number.isFinite(v)) return fail(s);
  return { ...s, entry: show(v), val: r(v), typing: false, label, waiting: false, done: false };
}

/** The entry as an operand: its top-line record if a key made it. */
function operand(s: SciState): Tok {
  return { k: "n", v: entryVal(s), t: s.done || s.label === null ? entryText(s) : s.label };
}

const isFresh = (s: SciState): boolean =>
  s.entry === "0" && !s.typing && s.toks.length === 0 && s.label === null && !s.done;

/** Total: no key sequence throws, and nothing non-finite reaches the display. */
export function sciReduce(s: SciState, key: SciKey): SciState {
  if (key === "C") return clear(s);
  if (key === "deg" || key === "rad") return { ...s, angle: key };
  if (s.entry === "Error") {
    // Memory keys do nothing on an Error; any other key recovers, then acts.
    return MEMKEYS.has(key) ? s : sciReduce(clear(s), key);
  }

  if (/^\d$/.test(key)) {
    if (!s.typing) return { ...s, entry: key, typing: true, label: null, waiting: false, done: false };
    const [mant = "", expo] = s.entry.split("e");
    // 15 mantissa digits / 3 exponent digits keep typed numbers finite.
    if (expo === undefined ? mant.replace(/[-.]/g, "").length >= 15 : expo.replace("-", "").length >= 3) return s;
    const entry = expo === undefined ? mant.replace(/^(-?)0$/, "$1") + key : `${s.entry}${key}`;
    return Number.isFinite(Number(entry)) ? { ...s, entry } : fail(s);
  }
  if (key === ".") {
    if (!s.typing) return { ...s, entry: "0.", typing: true, label: null, waiting: false, done: false };
    return s.entry.includes(".") || s.entry.includes("e") ? s : { ...s, entry: `${s.entry}.` };
  }
  if (key === "Backspace") {
    if (!s.typing) return s;
    const entry = s.entry.slice(0, -1);
    return { ...s, entry: entry === "" || entry === "-" ? "0" : entry };
  }
  // ponytail: EXP only extends a number being typed; after a result or a constant it does nothing.
  if (key === "EXP") return s.typing && !s.entry.includes("e") ? { ...s, entry: `${s.entry}e` } : s;

  if (key === "pi") return setEntry(s, Math.PI, "π");
  if (key === "e") return setEntry(s, Math.E, "e");

  if (key === "MC") return { ...s, memory: 0 };
  if (key === "MR") return setEntry(s, s.memory, null);
  if (key === "MS" || key === "M+" || key === "M-") {
    // The entry is spent: the next digit starts a new number, as on GATE.
    const v = entryVal(s);
    const m = key === "MS" ? v : key === "M+" ? s.memory + v : s.memory - v;
    return Number.isFinite(m)
      ? { ...s, memory: r(m), entry: show(v), val: v, typing: false }
      : fail(s);
  }

  if (OPKEYS.has(key)) {
    const op = key as Op;
    const tok: Tok = { k: "o", o: op, t: GLYPH[op] };
    if (s.waiting) {
      // A second operator replaces the first; after `(` there is nothing to replace.
      return s.toks[s.toks.length - 1]?.k === "o" ? { ...s, toks: [...s.toks.slice(0, -1), tok] } : s;
    }
    const v = entryVal(s);
    return { ...s, toks: [...s.toks, operand(s), tok], entry: show(v), val: v, typing: false, label: null, waiting: true, done: false };
  }

  if (key === "(") {
    if (!(s.waiting || s.done || isFresh(s))) return s;
    return { ...s, toks: [...s.toks, { k: "(", t: "(" }], label: null, waiting: true, done: false };
  }
  if (key === ")") {
    if (!s.toks.some((t) => t.k === "(")) return s;
    if (s.waiting) return fail(s);
    const closed = closeLast([...s.toks, operand(s)]);
    return closed ? { ...setEntry(s, closed.v, closed.text), toks: closed.rest } : fail(s);
  }
  if (key === "=") {
    if (s.waiting) return fail(s);
    let ts: readonly Tok[] = [...s.toks, operand(s)];
    const full = text(ts) + ")".repeat(ts.filter((t) => t.k === "(").length);
    while (ts.some((t) => t.k === "(")) {
      const c = closeLast(ts);
      if (!c) return fail(s);
      ts = [...c.rest, { k: "n", v: c.v, t: c.text }];
    }
    const v = evalFlat(ts);
    return Number.isFinite(v) ? { ...setEntry(s, v, `${full}=`), toks: [], done: true } : fail(s);
  }

  if (key in UNARY) {
    const [fn, label] = UNARY[key as UnaryKey];
    if (key === "neg" && s.typing) {
      // Flip the sign of what is being typed (of the exponent once EXP is pressed).
      const entry = s.entry.includes("e")
        ? s.entry.replace(/e(-?)/, (_, m: string) => (m === "" ? "e-" : "e"))
        : s.entry.startsWith("-") ? s.entry.slice(1) : `-${s.entry}`;
      return { ...s, entry };
    }
    const inner = s.done || s.label === null ? entryText(s) : s.label;
    return setEntry(s, fn(entryVal(s), s.angle === "deg"), label(inner));
  }
  return s;
}

export function sciView(s: SciState): { expression: string; result: string; memory: boolean; angle: "deg" | "rad" } {
  const error = s.entry === "Error";
  return {
    expression: error ? "" : text(s.toks) + (s.label ?? ""),
    result: error ? "Error" : entryText(s),
    memory: s.memory !== 0,
    angle: s.angle,
  };
}
