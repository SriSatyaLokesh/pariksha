import { useId, useRef, useState } from "react";
import type {
  MatchingQuestion,
  MultiMatchingQuestion,
  OrderingQuestion,
  Question,
} from "@pariksha/core";
import { ReorderableList } from "../ReorderableList";

export type StructuredQuestion = MatchingQuestion | MultiMatchingQuestion | OrderingQuestion;

export const STRUCTURED_TYPES = ["matching", "multi_matching", "ordering"] as const;

export function isStructuredQuestion(question: { type: string }): question is StructuredQuestion {
  return (STRUCTURED_TYPES as readonly string[]).includes(question.type);
}

function reordered<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

function nextDefaultText(existing: readonly string[], noun: string): string {
  let n = existing.length + 1;
  while (existing.includes(`${noun} ${n}`)) n++;
  return `${noun} ${n}`;
}

/** Drops `left` as a key (whatever shape its value is). Shared because
 * removing or renaming a left item needs the exact same rewrite for both
 * matching's string key and multi_matching's string[] key. */
function withoutKeyFor<V>(key: Record<string, V>, left: string): Record<string, V> {
  const next: Record<string, V> = {};
  for (const [k, v] of Object.entries(key)) {
    if (k !== left) next[k] = v;
  }
  return next;
}

function renameKeyFor<V>(key: Record<string, V>, from: string, to: string): Record<string, V> {
  if (from === to || !(from in key)) return key;
  const next: Record<string, V> = {};
  for (const [k, v] of Object.entries(key)) next[k === from ? to : k] = v;
  return next;
}

/** A single text field that commits on Enter or blur, the same deferred-
 * commit pattern ReorderableList's own position field uses: a value mid
 * keystroke is not a committed item name yet. (Finding 1, round 1: this
 * alone used to be the only thing standing between a keystroke and a
 * remount, because the committed value *was* this row's React key — it no
 * longer is, see `ItemList`'s `rowId` below. This still exists because an
 * uncommitted draft is still the wrong thing to save on every keystroke.) */
function ItemText({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(): void {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text !== value) onCommit(text);
  }

  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        className="text-input"
        id={id}
        type="text"
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
    </>
  );
}

let nextRowId = 0;
function freshRowId(): string {
  nextRowId += 1;
  return `row-${nextRowId}`;
}

/** One reorderable column of plain-string items — left, right, or ordering's
 * own list. All three are schema-level `stringList`s with no id field of
 * their own, so this component mints one: a `useRef` array of synthetic row
 * ids, the same length as `items` and reordered/extended/shrunk in lockstep
 * with it by the three handlers below, is what `ReorderableList`'s `keyOf`
 * is actually given — not the item's own editable text.
 *
 * Round 1 finding: with text as the key, committing a rename changed the
 * `<li key>`, which unmounts and remounts the row — dropping focus to
 * `document.body` on Enter, swallowing a click on another control in the
 * same row (it's detached mid-gesture), and colliding outright whenever two
 * rows share text. A synthetic id never changes just because the text next
 * to it did, so none of that happens — renaming is purely a text update on
 * an otherwise untouched row. */
function ItemList({
  legend,
  items,
  fieldLabel,
  removeLabel,
  addLabel,
  describedBy,
  onReorder,
  onEditAt,
  onAdd,
  onRemoveAt,
}: {
  legend: string;
  items: string[];
  fieldLabel: (index: number) => string;
  removeLabel: (text: string) => string;
  addLabel: string;
  describedBy?: string | undefined;
  onReorder: (from: number, to: number) => void;
  onEditAt: (index: number, text: string) => void;
  onAdd: () => void;
  onRemoveAt: (index: number) => void;
}) {
  const uid = useId();
  const idsRef = useRef<string[] | null>(null);
  if (idsRef.current === null) idsRef.current = items.map(() => freshRowId());
  const ids = idsRef.current;

  function handleReorder(from: number, to: number): void {
    idsRef.current = reordered(ids, from, to);
    onReorder(from, to);
  }

  function handleAdd(): void {
    idsRef.current = [...ids, freshRowId()];
    onAdd();
  }

  function handleRemoveAt(index: number): void {
    idsRef.current = ids.filter((_, i) => i !== index);
    onRemoveAt(index);
  }

  const rows = items.map((text, index) => ({ id: ids[index] ?? freshRowId(), text }));

  return (
    <>
      <ReorderableList
        items={rows}
        keyOf={(row) => row.id}
        labelOf={(row) => row.text.trim() || "item"}
        legend={legend}
        describedBy={describedBy}
        onReorder={handleReorder}
        renderItem={(row, index) => (
          <div className="structured-item">
            <ItemText
              id={`${uid}-text-${index}`}
              label={fieldLabel(index)}
              value={row.text}
              onCommit={(text) => onEditAt(index, text)}
            />
            <button type="button" className="button-secondary" onClick={() => handleRemoveAt(index)}>
              {removeLabel(row.text)}
            </button>
          </div>
        )}
      />
      <button type="button" className="prompt-editor__tool" onClick={handleAdd}>
        {addLabel}
      </button>
    </>
  );
}

/** The key as a checkbox/radio grid — `matching` (radio, one right per left,
 * enforced natively by sharing a `name` per row) or `multi_matching`
 * (checkbox, no such limit). Every cell's accessible name states the pair
 * it represents directly (`aria-label`), not just "checkbox" or a row/column
 * index — the defect UX-review sent Task 3 back for once already.
 *
 * Rows and columns are keyed and grouped by *index*, not by the item's own
 * text: a grid cell's checked/disabled state is recomputed from `left`/
 * `right`/the key callbacks on every render regardless of whether React
 * reuses or recreates the DOM node, so there is no focus to lose here the
 * way there is in `ItemList` — which makes index safe, and is what keeps
 * two identically-named left items from sharing one native radio group
 * (`matching` has no way to disambiguate them in the key itself either,
 * since the key maps by text — a pre-existing format limit, not one this
 * grid can paper over, but at least the grid no longer compounds it). */
function MatchGrid({
  left,
  right,
  cellType,
  isChecked,
  isDisabled,
  onToggle,
  onClear,
}: {
  left: string[];
  right: string[];
  cellType: "radio" | "checkbox";
  isChecked: (left: string, right: string) => boolean;
  isDisabled: (left: string, right: string) => boolean;
  onToggle: (left: string, right: string, checked: boolean) => void;
  /** `matching` only: clears a row back to "no match" — the one-to-one
   * radio grid otherwise has no way to undo a mis-click once a row has a
   * selection (native radios can't be unchecked by clicking them again). */
  onClear?: (left: string) => void;
}) {
  const uid = useId();

  if (left.length === 0 || right.length === 0) {
    return <p className="field-help">Add at least one left item and one right item to build the key.</p>;
  }

  return (
    <table className="structured-grid">
      <caption className="structured-grid__caption">Key</caption>
      <thead>
        <tr>
          <th scope="col">Left item</th>
          {right.map((r) => (
            <th scope="col" key={r}>
              {r}
            </th>
          ))}
          {onClear && <th scope="col">No match</th>}
        </tr>
      </thead>
      <tbody>
        {left.map((l, leftIndex) => {
          const hasMatch = right.some((r) => isChecked(l, r));
          return (
            <tr key={leftIndex}>
              <th scope="row">{l}</th>
              {right.map((r) => (
                <td key={r}>
                  <input
                    type={cellType}
                    name={cellType === "radio" ? `${uid}-row-${leftIndex}` : undefined}
                    aria-label={`${l} matches ${r}`}
                    checked={isChecked(l, r)}
                    disabled={isDisabled(l, r)}
                    onChange={(event) => onToggle(l, r, event.target.checked)}
                  />
                </td>
              ))}
              {onClear && (
                <td>
                  <input
                    type="radio"
                    name={`${uid}-row-${leftIndex}`}
                    aria-label={`No match for ${l}`}
                    checked={!hasMatch}
                    onChange={(event) => {
                      if (event.target.checked) onClear(l);
                    }}
                  />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The left/right column editors shared, unchanged, by `matching` and
 * `multi_matching` (Finding 6, round 1): moving, renaming or removing a
 * left item is the exact same rewrite regardless of whether `key`'s values
 * are a `string` or a `string[]` — `withoutKeyFor`/`renameKeyFor` are
 * already generic over that. Only the right column's rename/remove differ
 * (the shape of what has to be rewritten inside `key`), so those two stay
 * the caller's own handlers; everything else — both `<ItemList>`s, the left
 * column's move/rename/remove/add — lives here exactly once. */
function ItemColumns<V>({
  left,
  right,
  matchKey,
  onLeftChange,
  onRightReorder,
  onRightAdd,
  onRenameRightAt,
  onRemoveRightAt,
}: {
  left: string[];
  right: string[];
  matchKey: Record<string, V>;
  onLeftChange: (left: string[], key: Record<string, V>) => void;
  onRightReorder: (from: number, to: number) => void;
  onRightAdd: () => void;
  onRenameRightAt: (index: number, text: string) => void;
  onRemoveRightAt: (index: number) => void;
}) {
  function moveLeft(from: number, to: number): void {
    onLeftChange(reordered(left, from, to), matchKey);
  }

  function renameLeftAt(index: number, text: string): void {
    const from = left[index]!;
    const nextLeft = left.map((item, i) => (i === index ? text : item));
    onLeftChange(nextLeft, renameKeyFor(matchKey, from, text));
  }

  function removeLeftAt(index: number): void {
    const removed = left[index]!;
    const nextLeft = left.filter((_, i) => i !== index);
    onLeftChange(nextLeft, withoutKeyFor(matchKey, removed));
  }

  return (
    <>
      <ItemList
        legend="Left items"
        items={left}
        fieldLabel={(index) => `Left item ${index + 1} text`}
        removeLabel={(text) => `Remove left item ${text}`}
        addLabel="Add left item"
        onReorder={moveLeft}
        onEditAt={renameLeftAt}
        onAdd={() => onLeftChange([...left, nextDefaultText(left, "Left item")], matchKey)}
        onRemoveAt={removeLeftAt}
      />
      <ItemList
        legend="Right items"
        items={right}
        fieldLabel={(index) => `Right item ${index + 1} text`}
        removeLabel={(text) => `Remove right item ${text}`}
        addLabel="Add right item"
        onReorder={onRightReorder}
        onEditAt={onRenameRightAt}
        onAdd={onRightAdd}
        onRemoveAt={onRemoveRightAt}
      />
    </>
  );
}

function MatchingAnswer({
  question,
  onChange,
}: {
  question: MatchingQuestion;
  onChange: (next: MatchingQuestion) => void;
}) {
  function moveRight(from: number, to: number): void {
    onChange({ ...question, right: reordered(question.right, from, to) });
  }

  function renameRightAt(index: number, text: string): void {
    const from = question.right[index]!;
    const right = question.right.map((item, i) => (i === index ? text : item));
    const key: Record<string, string> = {};
    for (const [l, r] of Object.entries(question.key)) key[l] = r === from ? text : r;
    onChange({ ...question, right, key });
  }

  function removeRightAt(index: number): void {
    const removed = question.right[index]!;
    const right = question.right.filter((_, i) => i !== index);
    const key: Record<string, string> = {};
    for (const [l, r] of Object.entries(question.key)) {
      if (r !== removed) key[l] = r;
    }
    onChange({ ...question, right, key });
  }

  function isChecked(left: string, right: string): boolean {
    return question.key[left] === right;
  }

  // One-to-one, enforced here because validateBank enforces it too (a
  // right item used by more than one left is an import error) — the grid
  // refuses what the format refuses, rather than letting the author build
  // something that fails later.
  function isDisabled(left: string, right: string): boolean {
    if (question.key[left] === right) return false;
    return Object.entries(question.key).some(([l, r]) => l !== left && r === right);
  }

  function onToggle(left: string, right: string, checked: boolean): void {
    if (!checked) return; // a radio only ever fires a change when newly checked
    onChange({ ...question, key: { ...question.key, [left]: right } });
  }

  return (
    <div className="structured-matching">
      <ItemColumns
        left={question.left}
        right={question.right}
        matchKey={question.key}
        onLeftChange={(left, key) => onChange({ ...question, left, key })}
        onRightReorder={moveRight}
        onRightAdd={() =>
          onChange({ ...question, right: [...question.right, nextDefaultText(question.right, "Right item")] })
        }
        onRenameRightAt={renameRightAt}
        onRemoveRightAt={removeRightAt}
      />
      <MatchGrid
        left={question.left}
        right={question.right}
        cellType="radio"
        isChecked={isChecked}
        isDisabled={isDisabled}
        onToggle={onToggle}
        onClear={(left) => onChange({ ...question, key: withoutKeyFor(question.key, left) })}
      />
      <p className="field-help">
        Each left item matches at most one right item, and a right item used once cannot be used again.
      </p>
    </div>
  );
}

function MultiMatchingAnswer({
  question,
  onChange,
}: {
  question: MultiMatchingQuestion;
  onChange: (next: MultiMatchingQuestion) => void;
}) {
  function moveRight(from: number, to: number): void {
    onChange({ ...question, right: reordered(question.right, from, to) });
  }

  function renameRightAt(index: number, text: string): void {
    const from = question.right[index]!;
    const right = question.right.map((item, i) => (i === index ? text : item));
    const key: Record<string, string[]> = {};
    for (const [l, rights] of Object.entries(question.key)) {
      key[l] = rights.map((r) => (r === from ? text : r));
    }
    onChange({ ...question, right, key });
  }

  function removeRightAt(index: number): void {
    const removed = question.right[index]!;
    const right = question.right.filter((_, i) => i !== index);
    const key: Record<string, string[]> = {};
    for (const [l, rights] of Object.entries(question.key)) {
      const filtered = rights.filter((r) => r !== removed);
      if (filtered.length > 0) key[l] = filtered;
    }
    onChange({ ...question, right, key });
  }

  function isChecked(left: string, right: string): boolean {
    return (question.key[left] ?? []).includes(right);
  }

  // No exclusivity: unlike `matching`, a right item may serve more than one
  // left item here (AC-07) — nothing to disable.
  function isDisabled(): boolean {
    return false;
  }

  function onToggle(left: string, right: string, checked: boolean): void {
    const current = question.key[left] ?? [];
    const next = checked ? [...current, right] : current.filter((r) => r !== right);
    const key = { ...question.key };
    if (next.length > 0) key[left] = next;
    else delete key[left];
    onChange({ ...question, key });
  }

  return (
    <div className="structured-matching">
      <ItemColumns
        left={question.left}
        right={question.right}
        matchKey={question.key}
        onLeftChange={(left, key) => onChange({ ...question, left, key })}
        onRightReorder={moveRight}
        onRightAdd={() =>
          onChange({ ...question, right: [...question.right, nextDefaultText(question.right, "Right item")] })
        }
        onRenameRightAt={renameRightAt}
        onRemoveRightAt={removeRightAt}
      />
      <MatchGrid
        left={question.left}
        right={question.right}
        cellType="checkbox"
        isChecked={isChecked}
        isDisabled={isDisabled}
        onToggle={onToggle}
      />
      <p className="field-help">A left item may match several right items.</p>
    </div>
  );
}

function OrderingAnswer({
  question,
  onChange,
}: {
  question: OrderingQuestion;
  onChange: (next: OrderingQuestion) => void;
}) {
  const noteId = useId();

  function moveItem(from: number, to: number): void {
    onChange({ ...question, items: reordered(question.items, from, to) });
  }

  function renameAt(index: number, text: string): void {
    const items = question.items.map((item, i) => (i === index ? text : item));
    onChange({ ...question, items });
  }

  function removeAt(index: number): void {
    const items = question.items.filter((_, i) => i !== index);
    onChange({ ...question, items });
  }

  return (
    <div className="structured-ordering">
      <ItemList
        legend="Items"
        items={question.items}
        fieldLabel={(index) => `Item ${index + 1} text`}
        removeLabel={(text) => `Remove item ${text}`}
        addLabel="Add item"
        describedBy={noteId}
        onReorder={moveItem}
        onEditAt={renameAt}
        onAdd={() => onChange({ ...question, items: [...question.items, nextDefaultText(question.items, "Item")] })}
        onRemoveAt={removeAt}
      />
      {/* UX-08: this is the one type where the author's view and the
          candidate's view deliberately differ — said in plain words, not
          left for the reader to infer from the absence of a key control.
          Linked to the list above via `describedBy` (not just placed next
          to it) so the association survives for assistive tech too. */}
      <p className="field-help" id={noteId}>
        Write the items in the correct order — the order you set here is the key. Candidates see these shuffled;
        there is no separate key control.
      </p>
    </div>
  );
}

export function StructuredAnswer({
  question,
  onChange,
}: {
  question: StructuredQuestion;
  onChange: (next: Question) => void;
}) {
  switch (question.type) {
    case "matching":
      return <MatchingAnswer question={question} onChange={onChange} />;
    case "multi_matching":
      return <MultiMatchingAnswer question={question} onChange={onChange} />;
    case "ordering":
      return <OrderingAnswer question={question} onChange={onChange} />;
  }
}
