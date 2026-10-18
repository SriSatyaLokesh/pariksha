import { useId, useState } from "react";
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
 * commit pattern ReorderableList's own position field uses — not a style
 * choice, a correctness one: the field's own committed value doubles as
 * this item's ReorderableList identity (there is no separate id field in
 * the schema), so committing every keystroke would re-key, and remount,
 * the row the user is still typing into. */
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

/** One reorderable column of plain-string items — left, right, or ordering's
 * own list. All three are schema-level `stringList`s with no id field, so
 * identity for ReorderableList is the item's own (committed) text. */
function ItemList({
  legend,
  items,
  fieldLabel,
  removeLabel,
  addLabel,
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
  onReorder: (from: number, to: number) => void;
  onEditAt: (index: number, text: string) => void;
  onAdd: () => void;
  onRemoveAt: (index: number) => void;
}) {
  const uid = useId();

  return (
    <>
      <ReorderableList
        items={items}
        keyOf={(item) => item}
        labelOf={(item) => item.trim() || "item"}
        legend={legend}
        onReorder={onReorder}
        renderItem={(item, index) => (
          <div className="structured-item">
            <ItemText
              id={`${uid}-text-${index}`}
              label={fieldLabel(index)}
              value={item}
              onCommit={(text) => onEditAt(index, text)}
            />
            <button type="button" className="button-secondary" onClick={() => onRemoveAt(index)}>
              {removeLabel(item)}
            </button>
          </div>
        )}
      />
      <button type="button" className="prompt-editor__tool" onClick={onAdd}>
        {addLabel}
      </button>
    </>
  );
}

/** The key as a checkbox/radio grid — `matching` (radio, one right per left,
 * enforced natively by sharing a `name` per row) or `multi_matching`
 * (checkbox, no such limit). Every cell's accessible name states the pair
 * it represents directly (`aria-label`), not just "checkbox" or a row/column
 * index — the defect UX-review sent Task 3 back for once already. */
function MatchGrid({
  left,
  right,
  cellType,
  isChecked,
  isDisabled,
  onToggle,
}: {
  left: string[];
  right: string[];
  cellType: "radio" | "checkbox";
  isChecked: (left: string, right: string) => boolean;
  isDisabled: (left: string, right: string) => boolean;
  onToggle: (left: string, right: string, checked: boolean) => void;
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
        </tr>
      </thead>
      <tbody>
        {left.map((l) => (
          <tr key={l}>
            <th scope="row">{l}</th>
            {right.map((r) => (
              <td key={r}>
                <input
                  type={cellType}
                  name={cellType === "radio" ? `${uid}-row-${l}` : undefined}
                  aria-label={`${l} matches ${r}`}
                  checked={isChecked(l, r)}
                  disabled={isDisabled(l, r)}
                  onChange={(event) => onToggle(l, r, event.target.checked)}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MatchingAnswer({
  question,
  onChange,
}: {
  question: MatchingQuestion;
  onChange: (next: MatchingQuestion) => void;
}) {
  function moveLeft(from: number, to: number): void {
    const left = [...question.left];
    const [moved] = left.splice(from, 1);
    left.splice(to, 0, moved!);
    onChange({ ...question, left });
  }

  function moveRight(from: number, to: number): void {
    const right = [...question.right];
    const [moved] = right.splice(from, 1);
    right.splice(to, 0, moved!);
    onChange({ ...question, right });
  }

  function renameLeftAt(index: number, text: string): void {
    const from = question.left[index]!;
    const left = question.left.map((item, i) => (i === index ? text : item));
    onChange({ ...question, left, key: renameKeyFor(question.key, from, text) });
  }

  function renameRightAt(index: number, text: string): void {
    const from = question.right[index]!;
    const right = question.right.map((item, i) => (i === index ? text : item));
    const key: Record<string, string> = {};
    for (const [l, r] of Object.entries(question.key)) key[l] = r === from ? text : r;
    onChange({ ...question, right, key });
  }

  function removeLeftAt(index: number): void {
    const removed = question.left[index]!;
    const left = question.left.filter((_, i) => i !== index);
    onChange({ ...question, left, key: withoutKeyFor(question.key, removed) });
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
      <ItemList
        legend="Left items"
        items={question.left}
        fieldLabel={(index) => `Left item ${index + 1} text`}
        removeLabel={(text) => `Remove left item ${text}`}
        addLabel="Add left item"
        onReorder={moveLeft}
        onEditAt={renameLeftAt}
        onAdd={() => onChange({ ...question, left: [...question.left, nextDefaultText(question.left, "Left item")] })}
        onRemoveAt={removeLeftAt}
      />
      <ItemList
        legend="Right items"
        items={question.right}
        fieldLabel={(index) => `Right item ${index + 1} text`}
        removeLabel={(text) => `Remove right item ${text}`}
        addLabel="Add right item"
        onReorder={moveRight}
        onEditAt={renameRightAt}
        onAdd={() => onChange({ ...question, right: [...question.right, nextDefaultText(question.right, "Right item")] })}
        onRemoveAt={removeRightAt}
      />
      <MatchGrid
        left={question.left}
        right={question.right}
        cellType="radio"
        isChecked={isChecked}
        isDisabled={isDisabled}
        onToggle={onToggle}
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
  function moveLeft(from: number, to: number): void {
    const left = [...question.left];
    const [moved] = left.splice(from, 1);
    left.splice(to, 0, moved!);
    onChange({ ...question, left });
  }

  function moveRight(from: number, to: number): void {
    const right = [...question.right];
    const [moved] = right.splice(from, 1);
    right.splice(to, 0, moved!);
    onChange({ ...question, right });
  }

  function renameLeftAt(index: number, text: string): void {
    const from = question.left[index]!;
    const left = question.left.map((item, i) => (i === index ? text : item));
    onChange({ ...question, left, key: renameKeyFor(question.key, from, text) });
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

  function removeLeftAt(index: number): void {
    const removed = question.left[index]!;
    const left = question.left.filter((_, i) => i !== index);
    onChange({ ...question, left, key: withoutKeyFor(question.key, removed) });
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
      <ItemList
        legend="Left items"
        items={question.left}
        fieldLabel={(index) => `Left item ${index + 1} text`}
        removeLabel={(text) => `Remove left item ${text}`}
        addLabel="Add left item"
        onReorder={moveLeft}
        onEditAt={renameLeftAt}
        onAdd={() => onChange({ ...question, left: [...question.left, nextDefaultText(question.left, "Left item")] })}
        onRemoveAt={removeLeftAt}
      />
      <ItemList
        legend="Right items"
        items={question.right}
        fieldLabel={(index) => `Right item ${index + 1} text`}
        removeLabel={(text) => `Remove right item ${text}`}
        addLabel="Add right item"
        onReorder={moveRight}
        onEditAt={renameRightAt}
        onAdd={() => onChange({ ...question, right: [...question.right, nextDefaultText(question.right, "Right item")] })}
        onRemoveAt={removeRightAt}
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
  function moveItem(from: number, to: number): void {
    const items = [...question.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved!);
    onChange({ ...question, items });
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
        onReorder={moveItem}
        onEditAt={renameAt}
        onAdd={() => onChange({ ...question, items: [...question.items, nextDefaultText(question.items, "Item")] })}
        onRemoveAt={removeAt}
      />
      {/* UX-08: this is the one type where the author's view and the
          candidate's view deliberately differ — said in plain words, not
          left for the reader to infer from the absence of a key control. */}
      <p className="field-help">
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
