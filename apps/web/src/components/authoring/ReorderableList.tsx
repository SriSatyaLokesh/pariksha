import { useEffect, useRef, useState, type JSX } from "react";

// Buttons-first reordering (WCAG 2.1.1) — no drag, and no drag-and-drop
// dependency; that stays a deferred enhancement. `onReorder(from, to)` is
// the one mutation every control calls, and the seam a later drag handler
// would attach to without changing these props.
//
// Review Focus item 5: moving a row with React re-keys the list, and a
// naive implementation loses focus to document.body. This component tracks
// which button was just pressed and refocuses it — now at the item's new
// position — once the reordered `items` prop lands, and narrates the move
// into a `role="status"` region so a screen-reader user hears it too.

interface MoveTarget {
  key: string;
  dir: "up" | "down";
}

function isPinned(item: unknown): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { pinned?: unknown }).pinned === true
  );
}

export function ReorderableList<T>({
  items,
  keyOf,
  labelOf,
  onReorder,
  renderItem,
  legend,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  onReorder: (from: number, to: number) => void;
  renderItem: (item: T, index: number) => JSX.Element;
  legend: string;
}) {
  const [announcement, setAnnouncement] = useState("");
  const buttons = useRef(new Map<string, { up: HTMLButtonElement | null; down: HTMLButtonElement | null }>());
  const pendingFocus = useRef<MoveTarget | null>(null);

  // Runs after `items` has actually been reordered by the caller (the
  // `onReorder` below only asks for that; the caller's own state update is
  // what produces the new array this effect reacts to).
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const entry = buttons.current.get(pending.key);
    const button = pending.dir === "up" ? entry?.up : entry?.down;
    button?.focus();
  }, [items]);

  function announce(item: T, to: number): void {
    setAnnouncement(`${labelOf(item)} moved to position ${to + 1} of ${items.length}`);
  }

  function moveBy(from: number, dir: "up" | "down"): void {
    const to = dir === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= items.length) return;
    const item = items[from]!;
    pendingFocus.current = { key: keyOf(item), dir };
    onReorder(from, to);
    announce(item, to);
  }

  function moveToPosition(from: number, position: number): void {
    const to = position - 1;
    if (!Number.isInteger(to) || to < 0 || to >= items.length || to === from) return;
    const item = items[from]!;
    // The position field has no up/down identity of its own; the up button
    // is the closest thing to refocus, since it exists at every position
    // this move can land on except the very first (where it is disabled,
    // which is still a defined, reachable focus target).
    pendingFocus.current = { key: keyOf(item), dir: "up" };
    onReorder(from, to);
    announce(item, to);
  }

  return (
    <fieldset className="reorderable-list">
      <legend className="reorderable-list__legend">{legend}</legend>
      <div className="reorderable-list__announcement" role="status" aria-live="polite">
        {announcement}
      </div>
      <ol className="reorderable-list__items">
        {items.map((item, index) => {
          const key = keyOf(item);
          const label = labelOf(item);
          const pinned = isPinned(item);
          return (
            <li className="reorderable-list__item" key={key}>
              <div className="reorderable-list__controls">
                <button
                  type="button"
                  className="prompt-editor__tool reorderable-list__move"
                  aria-label={`Move ${label} up`}
                  disabled={pinned || index === 0}
                  onClick={() => moveBy(index, "up")}
                  ref={(element) => {
                    const entry = buttons.current.get(key) ?? { up: null, down: null };
                    entry.up = element;
                    buttons.current.set(key, entry);
                  }}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  type="button"
                  className="prompt-editor__tool reorderable-list__move"
                  aria-label={`Move ${label} down`}
                  disabled={pinned || index === items.length - 1}
                  onClick={() => moveBy(index, "down")}
                  ref={(element) => {
                    const entry = buttons.current.get(key) ?? { up: null, down: null };
                    entry.down = element;
                    buttons.current.set(key, entry);
                  }}
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <label className="reorderable-list__position">
                  {`Position of ${label}`}
                  <input
                    type="number"
                    min={1}
                    max={items.length}
                    value={index + 1}
                    disabled={pinned}
                    onChange={(event) => moveToPosition(index, Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="reorderable-list__content">{renderItem(item, index)}</div>
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
