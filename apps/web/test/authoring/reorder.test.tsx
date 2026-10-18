import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { axe } from "jest-axe";

import { ReorderableList } from "../../src/components/authoring/ReorderableList";

// A thin harness: ReorderableList is generic over T, and the production
// callers (Choice.tsx's options list) aren't needed to prove the control
// itself reorders, announces and refocuses correctly. `keyOf`/`labelOf`
// return the item's own letter — a fixed identity, not a recomputed
// position, the same way Choice.tsx's "Option A"/"Option B" names stay put
// across a move.
function Options({ initial }: { initial: string[] }) {
  const [items, setItems] = useState(initial);
  return (
    <ReorderableList
      items={items}
      keyOf={(item) => item}
      labelOf={(item) => `Option ${item}`}
      legend="Options"
      onReorder={(from, to) => {
        setItems((prev) => {
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved!);
          return next;
        });
      }}
      renderItem={(item) => <span>{item}</span>}
    />
  );
}

// Reads the order straight from ReorderableList's own content wrapper
// (`.reorderable-list__content`), not from `li.textContent`, which also
// carries the move buttons' glyphs and the position field's label text.
function visibleOrder(): string[] {
  return Array.from(document.querySelectorAll(".reorderable-list__content")).map(
    (el) => el.textContent ?? "",
  );
}

describe("ReorderableList (Review Focus 5)", () => {
  // No @testing-library/user-event in this workspace (apps/web's
  // package.json carries @testing-library/react and jest-dom only, the
  // same pair every other apps/web test file uses) — a focused native
  // <button>'s real Enter/Space activation is a `click` in every browser,
  // so `fireEvent.click` after `.focus()` exercises the same code path a
  // keyboard user reaches without adding a dependency for one test.
  it("moves an item with the keyboard and keeps focus on the button that moved it", () => {
    render(<Options initial={["A", "B", "C"]} />);
    const down = screen.getByRole("button", { name: /move option a down/i });
    down.focus();
    fireEvent.click(down);
    expect(visibleOrder()).toEqual(["B", "A", "C"]);
    expect(document.activeElement).toHaveAccessibleName(/move option a down/i);
  });

  it("announces the new position in a live region", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.click(screen.getByRole("button", { name: /move option a down/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Option A moved to position 2 of 3");
  });

  it("the numeric position field moves an item to an arbitrary index", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /position of option c/i }), {
      target: { value: "1" },
    });
    expect(visibleOrder()).toEqual(["C", "A", "B"]);
  });

  it("move up on the first item and move down on the last are disabled, not no-ops", () => {
    render(<Options initial={["A", "B", "C"]} />);
    expect(screen.getByRole("button", { name: /move option a up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move option c down/i })).toBeDisabled();
  });

  it("a pinned item never moves", () => {
    function PinnedOptions() {
      const [items, setItems] = useState([
        { id: "A", pinned: true },
        { id: "B", pinned: false },
      ]);
      return (
        <ReorderableList
          items={items}
          keyOf={(item) => item.id}
          labelOf={(item) => `Option ${item.id}`}
          legend="Options"
          onReorder={(from, to) => {
            setItems((prev) => {
              const next = [...prev];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved!);
              return next;
            });
          }}
          renderItem={(item) => <span>{item.id}</span>}
        />
      );
    }
    render(<PinnedOptions />);
    expect(screen.getByRole("button", { name: /move option a up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move option a down/i })).toBeDisabled();
  });

  it("WCAG 2.1.1: every reorder is reachable without a pointer", async () => {
    const { container } = render(<Options initial={["A", "B", "C"]} />);
    expect(await axe(container)).toHaveNoViolations();
    // No drag at all in this phase (Known deferrals) — a pointer-only
    // affordance would be invisible to this assertion otherwise.
    expect(screen.queryByText(/drag/i)).toBeNull();
    cleanup();
  });
});
