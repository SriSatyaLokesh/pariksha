import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Calculator } from "../../src/components/exam/Calculator";

// C-04's "optional on-screen calculator". Four functions, no dependency —
// a candidate's bundle budget is 300 KB gzipped and an arithmetic library
// is the easiest 30 KB in the world to spend by accident.
//
// No `@testing-library/user-event` in this workspace (see
// `test/exam/runner.test.tsx`'s header); the keyboard tests dispatch real
// `keydown` events on the real `document.activeElement`.

// Each operator's accessible name is the word AND the glyph ("Divide ÷"),
// because WCAG 2.5.3 wants the name to be a superset of the visible label.
const KEY_LABEL: Record<string, RegExp> = {
  "+": /^add\b/i,
  "-": /^subtract\b/i,
  "*": /^multiply\b/i,
  "/": /^divide\b/i,
  "=": /^equals\b/i,
  ".": /^decimal point\b/i,
  C: /^clear\b/i,
};

function display(): string {
  return screen.getByRole("status").textContent ?? "";
}

function keyFor(key: string): HTMLElement {
  return screen.getByRole("button", { name: KEY_LABEL[key] ?? new RegExp(`^${key}$`) });
}

/** Presses the real buttons a candidate would, one per character. */
function type(keys: string): void {
  for (const key of keys) {
    const button = keyFor(key);
    button.focus();
    fireEvent.click(button);
  }
}

/** A real `keydown` on whatever has focus — the calculator dialog, which
 * the hook focuses on open. */
function press(...keys: string[]): void {
  for (const key of keys) {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  }
}

function open() {
  const onClose = vi.fn();
  const view = render(<Calculator onClose={onClose} />);
  return { ...view, onClose };
}

describe("the calculator's four functions", () => {
  it.each([
    ["2+3=", "5"],
    ["7/2=", "3.5"],
    ["9-10=", "-1"],
    ["5*0.2=", "1"],
    ["1/0=", "Error"],
  ])("%s gives %s", (keys, shown) => {
    open();
    type(keys);
    expect(display()).toBe(shown);
  });

  it("starts at zero and clears back to it", () => {
    open();
    expect(display()).toBe("0");
    type("4+4=");
    expect(display()).toBe("8");
    type("C");
    expect(display()).toBe("0");
  });

  it("recovers from Error instead of wedging (a candidate cannot reload)", () => {
    open();
    type("1/0=");
    expect(display()).toBe("Error");
    type("6*7=");
    expect(display()).toBe("42");
  });

  it("chains without an equals between the operators", () => {
    open();
    type("2+3+4=");
    expect(display()).toBe("9");
  });

  it("shows no floating-point noise", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754. A candidate reading
    // that under a clock loses time deciding whether it matters.
    open();
    type("0.1+0.2=");
    expect(display()).toBe("0.3");
  });

  it("takes one decimal point per number, not two", () => {
    open();
    type("1.2.5");
    expect(display()).toBe("1.25");
  });

  it("an equals with nothing pending leaves the number alone", () => {
    open();
    type("42=");
    expect(display()).toBe("42");
  });
});

describe("the calculator's keyboard and focus behaviour", () => {
  it("every key is reachable by keyboard and labelled", async () => {
    const { container } = open();
    expect(await axe(container)).toHaveNoViolations();
    press("1", "2", "+", "3", "Enter");
    expect(display()).toBe("15");
  });

  it("every key carries an accessible name, and none is a bare glyph", () => {
    open();
    for (const key of ["0", "1", "7", "9", "+", "-", "*", "/", "=", ".", "C"]) {
      expect(keyFor(key)).toBeVisible();
    }
    // WCAG 2.5.3 both ways: the word is added to the glyph, never
    // substituted for it, so "press divide" and the visible "÷" agree.
    expect(keyFor("/")).toHaveAttribute("aria-label", "Divide ÷");
    expect(keyFor("/").textContent).toBe("÷");
  });

  it("the keyboard reaches every operator, not only the digits", () => {
    open();
    press("9", "/", "2", "=");
    expect(display()).toBe("4.5");
    press("C");
    expect(display()).toBe("0");
  });

  // ---- keys fired on the focused control, not on the dialog -------------
  //
  // Fix round 1, I1. Every keyboard assertion above goes through
  // `press()`, which targets `document.activeElement` — and after
  // `open()` that is the dialog, because the hook focuses it. So the
  // whole block above exercises the type-on-the-dialog path and never the
  // tab-to-a-key-then-Enter path, which is where the defect lived. These
  // fire on the button that really has focus.

  it("Enter on a focused key activates that key, it does not apply an equals", () => {
    open();
    const seven = keyFor("7");
    seven.focus();
    // `fireEvent` returns false when a handler called preventDefault() —
    // which is what used to cancel the browser's own button activation.
    const notCancelled = fireEvent.keyDown(seven, { key: "Enter" });
    expect(notCancelled).toBe(true);
    expect(display()).toBe("0");
    // ...and the activation the browser then performs enters a 7.
    fireEvent.click(seven);
    expect(display()).toBe("7");
  });

  it("Enter on a focused operator key does not short-circuit to equals", () => {
    open();
    type("8");
    const plus = keyFor("+");
    plus.focus();
    expect(fireEvent.keyDown(plus, { key: "Enter" })).toBe(true);
    fireEvent.click(plus);
    type("9=");
    expect(display()).toBe("17");
  });

  it("Enter on Close calculator closes it", () => {
    const { onClose } = open();
    const close = screen.getByRole("button", { name: /close calculator/i });
    close.focus();
    expect(fireEvent.keyDown(close, { key: "Enter" })).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Space on a focused key is left to the button too", () => {
    open();
    const three = keyFor("3");
    three.focus();
    expect(fireEvent.keyDown(three, { key: " " })).toBe(true);
    expect(display()).toBe("0");
  });

  it("but typing carries on from a focused key, so a mouse user is not stranded", () => {
    // The handler still answers every other key wherever it comes from:
    // click "7" with the mouse (focus is now on that button) and type the
    // rest.
    open();
    type("7");
    expect(document.activeElement).toBe(keyFor("7"));
    fireEvent.keyDown(keyFor("7"), { key: "*" });
    fireEvent.keyDown(keyFor("7"), { key: "6" });
    fireEvent.click(keyFor("="));
    expect(display()).toBe("42");
  });

  it("Enter on the dialog itself still applies an equals", () => {
    open();
    press("5", "+", "5");
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: /calculator/i }));
    press("Enter");
    expect(display()).toBe("10");
  });

  it("Escape still closes from a focused key, not only from the dialog", () => {
    const { onClose } = open();
    keyFor("4").focus();
    fireEvent.keyDown(keyFor("4"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Backspace drops the last digit", () => {
    open();
    press("1", "2", "3", "Backspace");
    expect(display()).toBe("12");
  });

  it("Escape closes it and returns focus to the control that opened it", () => {
    function Host() {
      const [isOpen, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
          >
            Calculator
          </button>
          {isOpen && (
            <Calculator
              onClose={() => {
                setOpen(false);
              }}
            />
          )}
        </>
      );
    }

    render(<Host />);
    const trigger = screen.getByRole("button", { name: /calculator/i });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: /calculator/i })).toHaveFocus();
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toHaveAccessibleName(/calculator/i);
  });

  it("Close calculator closes it too, for a candidate who never finds Escape", () => {
    const { onClose } = open();
    const close = screen.getByRole("button", { name: /close calculator/i });
    close.focus();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tab is trapped inside it, because it claims aria-modal", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: /calculator/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const stops = screen.getAllByRole("button");
    const first = stops[0];
    const last = stops[stops.length - 1];
    last?.focus();
    fireEvent.keyDown(last as HTMLElement, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first as HTMLElement, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("a Tab in the middle of the keypad is left to the browser", () => {
    // The trap only acts at the two edges; preventing every Tab would
    // make the keypad unnavigable.
    open();
    const stops = screen.getAllByRole("button");
    const middle = stops[3];
    middle?.focus();
    const handled = fireEvent.keyDown(middle as HTMLElement, { key: "Tab" });
    expect(handled).toBe(true);
    expect(document.activeElement).toBe(middle);
  });

  it("nothing in it animates (DESIGN.md: not inside a live attempt)", () => {
    const { container } = open();
    for (const el of container.querySelectorAll("*")) {
      expect(getComputedStyle(el).animationName).toBe("none");
    }
  });
});
