import { describe, it, expect, vi } from "vitest";
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
  // keyboard user reaches without adding a dependency for one test. Named
  // for what actually runs (activating a focused button), not "with the
  // keyboard" — no key event is dispatched here.
  it("activating a focused move button moves the item and keeps focus on that button", () => {
    render(<Options initial={["A", "B", "C"]} />);
    const down = screen.getByRole("button", { name: /move option a down/i });
    down.focus();
    fireEvent.click(down);
    expect(visibleOrder()).toEqual(["B", "A", "C"]);
    expect(document.activeElement).toHaveAccessibleName(/move option a down/i);
  });

  // Phase 6 Task 7 (#71) found this one: the move that lands an item at
  // an end disables the button that moved it, and a disabled button
  // cannot take focus — `focus()` did nothing and focus fell to
  // document.body, dropping a keyboard user out of the list entirely.
  it("moving an item to the last position keeps focus on that item's own controls", () => {
    render(<Options initial={["A", "B", "C"]} />);
    const down = screen.getByRole("button", { name: /move option b down/i });
    down.focus();
    fireEvent.click(down);
    expect(visibleOrder()).toEqual(["A", "C", "B"]);
    expect(screen.getByRole("button", { name: /move option b down/i })).toBeDisabled();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveAccessibleName("Move Option B up");
  });

  it("moving an item to the first position keeps focus on that item's own controls", () => {
    render(<Options initial={["A", "B", "C"]} />);
    const up = screen.getByRole("button", { name: /move option b up/i });
    up.focus();
    fireEvent.click(up);
    expect(visibleOrder()).toEqual(["B", "A", "C"]);
    expect(document.activeElement).toHaveAccessibleName("Move Option B down");
  });

  it("announces the new position in a live region", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.click(screen.getByRole("button", { name: /move option a down/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Option A moved to position 2 of 3");
  });

  it("re-announces even when the wording repeats (down, up, down)", () => {
    render(<Options initial={["A", "B", "C"]} />);
    const status = screen.getByRole("status");

    fireEvent.click(screen.getByRole("button", { name: /move option a down/i }));
    const first = status.textContent;
    expect(first).toContain("Option A moved to position 2 of 3");

    fireEvent.click(screen.getByRole("button", { name: /move option a up/i }));
    expect(status).toHaveTextContent("Option A moved to position 1 of 3");

    fireEvent.click(screen.getByRole("button", { name: /move option a down/i }));
    const third = status.textContent;
    // Same wording as the first announcement, but it must be a distinct
    // state value — otherwise React's bail-out on an unchanged value never
    // touches this text node, and a screen reader announces nothing.
    expect(third).toContain("Option A moved to position 2 of 3");
    expect(third).not.toBe(first);
  });

  it("the numeric position field commits on Enter, reaches positions >= 10, and leaves focus in the field", () => {
    const many = Array.from({ length: 11 }, (_, i) => String.fromCharCode(65 + i)); // A..K
    render(<Options initial={many} />);

    const input = screen.getByRole("spinbutton", { name: /position of option k/i });
    input.focus();
    // Typing "1" of "10" must not move anything yet — only Enter commits.
    fireEvent.change(input, { target: { value: "1" } });
    expect(visibleOrder()[0]).toBe("A");
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(visibleOrder()[9]).toBe("K");
    // The field commits in place; no button is refocused on its behalf.
    expect(document.activeElement).toBe(screen.getByRole("spinbutton", { name: /position of option k/i }));
  });

  it("the numeric position field also commits on blur", () => {
    render(<Options initial={["A", "B", "C"]} />);
    const input = screen.getByRole("spinbutton", { name: /position of option c/i });
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.blur(input);
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
    // Phase 6 Task 7 (#71) closed Phase 4's drag deferral, so drag now
    // exists — as an enhancement on top of the buttons, never instead of
    // them. The assertion that used to stand here ("no mention of drag
    // anywhere") would today only prove the feature was missing; what has
    // to stay true is that nothing is reachable by pointer alone.
    for (const item of ["A", "B", "C"]) {
      expect(screen.getByRole("button", { name: `Move Option ${item} up` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Move Option ${item} down` })).toBeInTheDocument();
      expect(
        screen.getByRole("spinbutton", { name: `Position of Option ${item}` }),
      ).toBeInTheDocument();
    }
    cleanup();
  });
});

// ---- the pointer-drag enhancement (AC-07, Phase 4's recorded deferral) ----
//
// Phase 4 shipped only the keyboard half of AC-07 and recorded the drag
// half with the exact shape it should take: `draggable` on the row with
// native HTML5 dragstart/dragover/drop handlers calling the `onReorder`
// Task 3 already exposes, plus a drop-position indicator — no dependency,
// and no change to ReorderableList's props. Everything above this line is
// Phase 4's own suite, unchanged but for the one note in place.

describe("drag reordering (AC-07, closing the Phase 4 deferral)", () => {
  function rowFor(item: string): HTMLElement {
    const content = [...document.querySelectorAll<HTMLElement>(".reorderable-list__content")].find(
      (el) => el.textContent === item,
    );
    const row = content?.closest<HTMLElement>(".reorderable-list__item");
    if (!row) throw new Error(`no row for ${item}`);
    return row;
  }

  it("every row is draggable, and dragging one onto another reorders the list", () => {
    render(<Options initial={["A", "B", "C"]} />);
    expect(rowFor("A")).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(rowFor("A"));
    fireEvent.dragOver(rowFor("C"));
    fireEvent.drop(rowFor("C"));
    expect(visibleOrder()).toEqual(["B", "C", "A"]);
  });

  it("dragging upwards works too, not only downwards", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.dragStart(rowFor("C"));
    fireEvent.dragOver(rowFor("A"));
    fireEvent.drop(rowFor("A"));
    expect(visibleOrder()).toEqual(["C", "A", "B"]);
  });

  it("dragover is prevented, which is what makes the browser fire a drop at all", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.dragStart(rowFor("A"));
    // fireEvent returns false exactly when a handler called preventDefault.
    expect(fireEvent.dragOver(rowFor("B"))).toBe(false);
    expect(fireEvent.drop(rowFor("B"))).toBe(false);
  });

  it("the row being dragged over is marked, and the mark is cleared on drop", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.dragStart(rowFor("A"));
    fireEvent.dragOver(rowFor("C"));
    expect(rowFor("C")).toHaveClass("is-drop-target");
    fireEvent.drop(rowFor("C"));
    expect(document.querySelectorAll(".is-drop-target")).toHaveLength(0);
  });

  it("dragend clears the mark even when the drag is abandoned off the list", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.dragStart(rowFor("A"));
    fireEvent.dragOver(rowFor("C"));
    fireEvent.dragEnd(rowFor("A"));
    expect(document.querySelectorAll(".is-drop-target")).toHaveLength(0);
    expect(visibleOrder()).toEqual(["A", "B", "C"]);
  });

  it("a drop with no drag in progress moves nothing", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.drop(rowFor("C"));
    expect(visibleOrder()).toEqual(["A", "B", "C"]);
  });

  it("dropping a row on itself is not a move, and announces nothing", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.dragStart(rowFor("B"));
    fireEvent.dragOver(rowFor("B"));
    fireEvent.drop(rowFor("B"));
    expect(visibleOrder()).toEqual(["A", "B", "C"]);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("a drag announces into the same live region the buttons use", () => {
    render(<Options initial={["A", "B", "C"]} />);
    fireEvent.dragStart(rowFor("A"));
    fireEvent.dragOver(rowFor("B"));
    fireEvent.drop(rowFor("B"));
    expect(screen.getByRole("status")).toHaveTextContent("Option A moved to position 2 of 3");
  });

  it("a pinned row is neither draggable nor a drop target", () => {
    function PinnedOptions() {
      const [items, setItems] = useState([
        { id: "A", pinned: true },
        { id: "B", pinned: false },
        { id: "C", pinned: false },
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
    expect(rowFor("A")).toHaveAttribute("draggable", "false");
    // A pinned row cannot be dragged away…
    fireEvent.dragStart(rowFor("A"));
    fireEvent.dragOver(rowFor("C"));
    fireEvent.drop(rowFor("C"));
    expect(visibleOrder()).toEqual(["A", "B", "C"]);
    // …nor displaced by another row landing on it.
    fireEvent.dragStart(rowFor("C"));
    fireEvent.dragOver(rowFor("A"));
    fireEvent.drop(rowFor("A"));
    expect(visibleOrder()).toEqual(["A", "B", "C"]);
  });

  it("dragstart sets a dataTransfer payload when the browser supplies one", () => {
    // Firefox refuses to start a drag unless dragstart sets data. jsdom's
    // synthetic event carries no dataTransfer at all, so the handler has
    // to cope with both; this asserts the real-browser half directly.
    render(<Options initial={["A", "B", "C"]} />);
    const setData = vi.fn();
    fireEvent.dragStart(rowFor("A"), { dataTransfer: { setData, effectAllowed: "none" } });
    expect(setData).toHaveBeenCalledWith("text/plain", "A");
  });

  it("drag never replaces the keyboard path: axe stays clean with it in place", async () => {
    const { container } = render(<Options initial={["A", "B", "C"]} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
