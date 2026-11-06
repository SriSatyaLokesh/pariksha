import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ScientificCalculator } from "../../src/components/exam/ScientificCalculator";
import { SCI_START, type SciState } from "../../src/components/exam/scientific";

// Holds the lifted state the way Runner does.
function Host({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<SciState>(SCI_START);
  return <ScientificCalculator state={state} onState={setState} onClose={onClose} />;
}

function open() {
  const onClose = vi.fn();
  return { ...render(<Host onClose={onClose} />), onClose };
}

const result = () => screen.getByRole("status").textContent ?? "";
const click = (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
};
const press = (...keys: string[]) => {
  for (const key of keys) fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

describe("the scientific calculator", () => {
  it("is a dialog named Scientific calculator and axe passes", async () => {
    const { container } = open();
    expect(screen.getByRole("dialog", { name: "Scientific calculator" })).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("30 sin shows 0.5 in the status output", () => {
    open();
    click("3");
    click("0");
    click("Sine sin");
    expect(result()).toBe("0.5");
  });

  it.each([
    "sin", "cos", "tan", "(", ")", "⌫", "C", "±",
    "sin⁻¹", "cos⁻¹", "tan⁻¹", "÷", "%",
    "sinh", "cosh", "tanh", "×", "1/x",
    "log", "ln", "logᵧx", "−", "x²",
    "eˣ", "10ˣ", "xʸ", "π", "+", "√",
    "n!", "mod", "∛", "EXP", "e", "|x|", "=",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".",
    "MC", "MR", "MS", "M+", "M−",
  ])("has a button whose name contains the glyph %s (WCAG 2.5.3)", (glyph) => {
    open();
    const hit = screen
      .getAllByRole("button")
      .filter((b) => b.textContent === glyph && (b.getAttribute("aria-label") ?? glyph).includes(glyph));
    expect(hit).toHaveLength(1);
  });

  it("Deg and Rad are radios, Deg checked by default", () => {
    open();
    expect(screen.getByRole("radio", { name: "Deg" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Rad" }));
    expect(screen.getByRole("radio", { name: "Rad" })).toBeChecked();
  });

  it("types from the keyboard: 2 ^ 3 Enter is 8; c clears; Escape closes", () => {
    const { onClose } = open();
    press("2", "^", "3", "Enter");
    expect(result()).toBe("8");
    press("c");
    expect(result()).toBe("0");
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("% and brackets work from the keyboard", () => {
    open();
    press("5", "0", "%");
    expect(result()).toBe("0.5");
    press("c", "(", "2", "+", "3", ")", "*", "2", "Enter");
    expect(result()).toBe("10");
  });

  it("Enter on a focused key is that key's own activation", () => {
    open();
    const seven = screen.getByRole("button", { name: "7" });
    seven.focus();
    expect(fireEvent.keyDown(seven, { key: "Enter" })).toBe(true);
    expect(result()).toBe("0");
  });

  it("shows the M marker only while memory holds a value", () => {
    open();
    expect(screen.queryByLabelText("Memory holds a value")).toBeNull();
    click("5");
    click(/ MS$/);
    expect(screen.getByLabelText("Memory holds a value")).toBeVisible();
    click(/ MC$/);
    expect(screen.queryByLabelText("Memory holds a value")).toBeNull();
  });

  it("drag handle nudges with arrow keys and Close calculator closes", () => {
    const { onClose } = open();
    const handle = screen.getByTestId("calc-drag-handle");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(screen.getByRole("dialog").style.left).toBeTruthy();
    click("Close calculator");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
