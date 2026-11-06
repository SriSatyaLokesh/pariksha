import { describe, expect, it } from "vitest";
import { SCI_START, sciReduce, sciView, type SciKey } from "../../src/components/exam/scientific";

const stateOf = (...keys: SciKey[]) => keys.reduce(sciReduce, SCI_START);
const run = (...keys: SciKey[]) => sciView(stateOf(...keys)).result;

describe("scientific engine", () => {
  it("precedence", () => {
    expect(run("2", "+", "3", "*", "4", "=")).toBe("14");
    expect(run("2", "^", "3", "^", "2", "=")).toBe("512"); // right-assoc
    expect(run("(", "2", "+", "3", ")", "*", "4", "=")).toBe("20");
    expect(run("1", "7", "mod", "5", "=")).toBe("2");
  });
  it("unary keys act on the entry at once", () => {
    expect(run("3", "0", "sin")).toBe("0.5"); // deg default
    expect(run("2", "+", "9", "sqrt", "=")).toBe("5");
    expect(run("5", "fact")).toBe("120");
    expect(run("4", "inv")).toBe("0.25");
    expect(run("5", "0", "pct")).toBe("0.5");
    expect(run("7", "neg")).toBe("-7");
    expect(run("2", "7", "cbrt")).toBe("3");
    expect(run("1", "0", "0", "log")).toBe("2");
  });
  it("logy is x first, base second", () => {
    expect(run("8", "logy", "2", "=")).toBe("3");
  });
  it("EXP", () => {
    expect(run("2", "EXP", "3")).toBe("2000");
  });
  it("deg/rad and trig snapping", () => {
    expect(run("1", "8", "0", "sin")).toBe("0");
    expect(run("9", "0", "cos")).toBe("0");
    expect(run("4", "5", "tan")).toBe("1");
    expect(run("rad", "pi", "sin")).toBe("0");
    expect(run("rad", "1", "asin")).toBe(String(Number((Math.PI / 2).toPrecision(12))));
    expect(run("1", "EXP", "1", "3", "inv")).toBe("1e-13"); // tiny non-trig result is NOT snapped (rule 8)
  });
  it("errors and recovery", () => {
    for (const seq of [
      ["1", "/", "0", "="],
      ["9", "0", "tan"],
      ["0", "log"],
      ["3", ".", "5", "fact"],
      ["2", "+", "="],
    ] as SciKey[][])
      expect(run(...seq)).toBe("Error");
    expect(run("1", "/", "0", "=", "7")).toBe("7");
    expect(run("1", "/", "0", "=", "C")).toBe("0");
  });
  it("unclosed brackets close at =", () => {
    expect(run("(", "2", "+", "3", "=")).toBe("5");
  });
  it("after a result: digit starts fresh, operator continues", () => {
    expect(run("2", "+", "3", "=", "4")).toBe("4");
    expect(run("2", "+", "3", "=", "*", "2", "=")).toBe("10");
    expect(run("3", "0", "=", "sin")).toBe("0.5");
  });
  it("pi replaces the entry (no implicit multiplication)", () => {
    expect(run("2", "pi")).toBe(String(Number(Math.PI.toPrecision(12))));
  });
  it("memory", () => {
    const s = stateOf("5", "MS", "C", "MR");
    expect(sciView(s).result).toBe("5");
    expect(sciView(s).memory).toBe(true);
    expect(run("5", "MS", "2", "M+", "C", "MR")).toBe("7");
    expect(sciView(stateOf("5", "MS", "MC")).memory).toBe(false);
    expect(run("1", "/", "0", "=", "MS", "C", "MR")).toBe("0"); // MS on Error does nothing
  });
  it("expression line", () => {
    const v = sciView(stateOf("3", "0", "sin", "+"));
    expect(v.expression).toBe("sin(30)+");
    expect(sciView(stateOf("8", "logy", "2")).expression).toContain("log");
  });

  // Beyond the brief: the places a wrong key sequence could give a wrong answer.
  it("a second operator replaces the first; ) with no ( is ignored", () => {
    expect(run("2", "+", "*", "3", "=")).toBe("6");
    expect(run("2", ")", "+", "3", "=")).toBe("5");
  });
  it("nested brackets and a group is one operand", () => {
    expect(run("2", "*", "(", "3", "+", "(", "4", "-", "1", ")", ")", "=")).toBe("12");
    expect(run("(", "1", "+", "2", ")", "^", "2", "=")).toBe("9");
  });
  it("trig edge cases", () => {
    expect(run("rad", "pi", "EXP", "0", "tan")).toBe("0");
    expect(run("1", "EXP", "1", "neg", "EXP", "5")).not.toBe("Error");
    expect(run("2", "7", "0", "sin")).toBe("-1");
    expect(run("2", "7", "0", "cos")).toBe("0");
    expect(run("1", "asin")).toBe("90");
    expect(run("1", "atan")).toBe("45");
  });
  it("deg/rad survive C and Error", () => {
    expect(run("rad", "C", "pi", "sin")).toBe("0");
    expect(run("rad", "1", "/", "0", "=", "C", "1", "asin")).toBe(String(Number((Math.PI / 2).toPrecision(12))));
  });
  it("overflow and domain errors", () => {
    expect(run("1", "7", "1", "fact")).toBe("Error");
    expect(run("1", "7", "0", "fact")).not.toBe("Error");
    expect(run("2", "neg", "sqrt")).toBe("Error");
    expect(run("0", "inv")).toBe("Error");
    expect(run("1", "0", "0", "0", "pow10")).toBe("Error");
  });

  it("is total: a long pseudo-random key sequence never throws or shows NaN", () => {
    const keys: SciKey[] = [
      ..."0123456789.+-*/^()=".split("").map((c) => c as SciKey),
      "mod", "logy", "C", "Backspace", "EXP", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh",
      "tanh", "log", "ln", "exp", "pow10", "sq", "sqrt", "cbrt", "fact", "abs", "inv", "neg", "pct", "pi",
      "e", "MC", "MR", "MS", "M+", "M-", "deg", "rad",
    ];
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    let s = SCI_START;
    for (let i = 0; i < 2000; i++) {
      s = sciReduce(s, keys[next() % keys.length] as SciKey);
      const { result, expression } = sciView(s);
      expect(result).not.toBe("");
      expect(result === "Error" || Number.isFinite(Number(result))).toBe(true);
      expect(expression).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
