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

// By code point rather than a literal invisible character in this source
// file (easy to lose or mis-copy otherwise).
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

function isPinned(item: unknown): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { pinned?: unknown }).pinned === true
  );
}

/**
 * The position field commits on Enter or blur, not on every keystroke:
 * committing immediately made any position >= 10 unreachable (typing "1"
 * of "10" fired a move right away) and a mid-typing value is not a
 * position yet. Local `draft` state holds what the user is typing until
 * then; a move leaves focus right here rather than asking ReorderableList
 * to refocus anything, since the DOM node this input renders into doesn't
 * change across a reorder (same item, same place in its row).
 */
function PositionInput({
  label,
  index,
  total,
  disabled,
  onCommit,
}: {
  label: string;
  index: number;
  total: number;
  disabled: boolean;
  onCommit: (position: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(): void {
    if (draft === null) return;
    const position = Number(draft);
    setDraft(null);
    if (Number.isInteger(position)) onCommit(position);
  }

  return (
    <label className="reorderable-list__position">
      {`Position of ${label}`}
      <input
        type="number"
        min={1}
        max={total}
        value={draft ?? String(index + 1)}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
    </label>
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
  // A trailing run of zero-width spaces, one longer every call, so every
  // announcement this instance ever makes is a distinct string — not just
  // distinct from whatever is on screen right now. Two moves can land on
  // identical wording (e.g. "A" down, then up, then down again); without
  // this, a screen reader that compares a new announcement against a
  // recently-spoken one (not only the DOM's current value) can treat the
  // second one as a repeat and skip it. Invisible, and `toHaveTextContent`'s
  // substring match doesn't care that it's there.
  const moveCount = useRef(0);

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
    moveCount.current += 1;
    const nonce = ZERO_WIDTH_SPACE.repeat(moveCount.current);
    setAnnouncement(`${labelOf(item)} moved to position ${to + 1} of ${items.length}${nonce}`);
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
    // No `pendingFocus` here, unlike `moveBy`: this move came from the
    // position field, and the field itself keeps focus (PositionInput's
    // own DOM node is untouched by the reorder), which is a better outcome
    // than yanking focus to a button the user didn't press.
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
                <PositionInput
                  label={label}
                  index={index}
                  total={items.length}
                  disabled={pinned}
                  onCommit={(position) => moveToPosition(index, position)}
                />
              </div>
              <div className="reorderable-list__content">{renderItem(item, index)}</div>
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
