import { useEffect, useId, useState } from "react";
import type { QuestionSource, SetAssignment, SetDefinition } from "@pariksha/core";
import type { ApiClient, Bank, StoredSection } from "../../lib/api";
import { ReorderableList } from "../authoring/ReorderableList";
import { RenderedHtml } from "../authoring/RenderedHtml";
import { QuestionPickerDrawer } from "./QuestionPickerDrawer";

/** A fresh section id (`^[a-z0-9_-]{1,40}$` — schemas/test-1.json's
 * `$defs/section`). Same precedent as `QuestionEditor.tsx`'s own
 * `freshQuestionId`: a UUID is lowercase hex and hyphens only, which
 * already satisfies the pattern, so there is nothing else to check here. */
function freshSectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `section-${Date.now()}`;
}

const SOURCE_KINDS = ["fixed", "pool", "sets"] as const;
type SourceKind = (typeof SOURCE_KINDS)[number];
const SOURCE_KIND_LABEL: Record<SourceKind, string> = { fixed: "Fixed", pool: "Pool", sets: "Sets" };

function emptySource(kind: SourceKind): QuestionSource {
  switch (kind) {
    case "fixed":
      return { kind: "fixed", questions: [] };
    case "pool":
      return { kind: "pool", count: 1 };
    case "sets":
      return { kind: "sets", sets: [] };
  }
}

/** A source counts as "configured" (Review Focus: warn before discarding
 * it) once it names anything a switch to another kind would throw away —
 * a brand-new, still-empty source of any kind is not. */
function isConfigured(source: QuestionSource): boolean {
  if (source.kind === "fixed") return source.questions.length > 0;
  if (source.kind === "pool") return source.bank !== undefined || source.filter !== undefined;
  return source.sets.length > 0;
}

function timeLabel(section: StoredSection): string {
  return section.time_limit_minutes !== undefined ? `${section.time_limit_minutes} min` : "no time limit";
}

function pluralQuestions(n: number): string {
  return `${n} question${n === 1 ? "" : "s"}`;
}

function countLabel(section: StoredSection, draw: Readonly<Record<string, { matching: number; wanted: number }>>): string {
  const source = section.source;
  if (source.kind === "fixed") return pluralQuestions(source.questions.length);
  if (source.kind === "pool") return pluralQuestions(draw[section.id]?.wanted ?? source.count);
  return pluralQuestions(source.sets[0]?.questions.length ?? 0);
}

/** UX-12's collapsed-row sentence: "Title · kind · N questions · M points ·
 * T min" — the accessible name of the row's own `<button>`, so a screen
 * reader hears the same sentence a sighted reader reads. */
function collapsedLabel(
  section: StoredSection,
  draw: Readonly<Record<string, { matching: number; wanted: number }>>,
  points: Readonly<Record<string, number>>,
): string {
  return `${section.title || "Untitled section"} · ${section.source.kind} · ${countLabel(section, draw)} · ${points[section.id] ?? 0} points · ${timeLabel(section)}`;
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item));
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** The picker's own `selected` prop: a fixed source's whole list, or one
 * `sets` entry's — never both, the same "one picker, one target" `picker`
 * state already enforces. */
function pickerSelection(
  sections: readonly StoredSection[],
  picker: { sectionId: string; setIndex?: number },
): string[] {
  const source = sections.find((s) => s.id === picker.sectionId)?.source;
  if (picker.setIndex === undefined) {
    return source?.kind === "fixed" ? source.questions : [];
  }
  return source?.kind === "sets" ? (source.sets[picker.setIndex]?.questions ?? []) : [];
}

export function SectionList({
  sections,
  draw,
  setPoints,
  points,
  onChange,
  openSectionId,
  onOpenSection,
  client,
  workspaceId,
}: {
  sections: readonly StoredSection[];
  draw: Readonly<Record<string, { matching: number; wanted: number }>>;
  setPoints: Readonly<Record<string, { set: string; points: number }[]>>;
  // Additive (see this file's own header note on `client`/`workspaceId`
  // below): UX-12's points figure, one per section — `GET .../draft`'s own
  // `points` field.
  points: Readonly<Record<string, number>>;
  onChange: (next: StoredSection[]) => void;
  openSectionId: string | null;
  onOpenSection: (id: string | null) => void;
  // Not in the plan's own prop sketch: a pool source's bank select and the
  // question picker both need a way to reach the API, which no prop the
  // plan named provides. Every named prop is unchanged; these two are
  // additive, the same note `QuestionPickerDrawer`'s header carries.
  client: ApiClient;
  workspaceId: string;
}) {
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ sectionId: string; kind: SourceKind } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ section: StoredSection; index: number } | null>(null);
  const [picker, setPicker] = useState<{ sectionId: string; setIndex?: number } | null>(null);

  useEffect(() => {
    void client.listBanks(workspaceId).then(setBanks);
  }, [client, workspaceId]);

  // Takes an updater rather than a `Partial<StoredSection>` patch:
  // `exactOptionalPropertyTypes` means an optional field (`time_limit_minutes`,
  // `instructions`) is set or *absent*, never explicitly `undefined` — a
  // patch object cannot say "remove this key" the way a function that
  // returns a whole new section can.
  function updateSection(id: string, updater: (section: StoredSection) => StoredSection): void {
    onChange(sections.map((s) => (s.id === id ? updater(s) : s)));
  }

  function changeSourceKind(section: StoredSection, kind: SourceKind): void {
    if (section.source.kind !== kind && isConfigured(section.source)) {
      setPendingSwitch({ sectionId: section.id, kind });
      return;
    }
    updateSection(section.id, (s) => ({ ...s, source: emptySource(kind) }));
  }

  function confirmSourceSwitch(): void {
    if (!pendingSwitch) return;
    updateSection(pendingSwitch.sectionId, (s) => ({ ...s, source: emptySource(pendingSwitch.kind) }));
    setPendingSwitch(null);
  }

  function addSection(): void {
    const id = freshSectionId();
    const next: StoredSection = { id, title: "", source: { kind: "fixed", questions: [] } };
    onChange([...sections, next]);
    onOpenSection(id);
  }

  function requestDelete(id: string): void {
    setConfirmDeleteId(id);
  }

  function confirmDelete(): void {
    if (!confirmDeleteId) return;
    const index = sections.findIndex((s) => s.id === confirmDeleteId);
    const section = sections[index];
    if (section) {
      onChange(sections.filter((s) => s.id !== confirmDeleteId));
      setUndo({ section, index });
      if (openSectionId === confirmDeleteId) onOpenSection(null);
    }
    setConfirmDeleteId(null);
  }

  function restoreDeleted(): void {
    if (!undo) return;
    const next = sections.slice();
    next.splice(undo.index, 0, undo.section);
    onChange(next);
    setUndo(null);
  }

  function confirmPicker(questionIds: string[]): void {
    if (!picker) return;
    const section = sections.find((s) => s.id === picker.sectionId);
    if (!section) {
      setPicker(null);
      return;
    }
    if (picker.setIndex === undefined) {
      updateSection(section.id, (s) => ({ ...s, source: { kind: "fixed", questions: questionIds } }));
    } else if (section.source.kind === "sets") {
      const setIndex = picker.setIndex;
      const sourceSets = section.source;
      const sets = replaceAt(sourceSets.sets, setIndex, { ...sourceSets.sets[setIndex]!, questions: questionIds });
      updateSection(section.id, (s) => ({ ...s, source: { ...sourceSets, sets } }));
    }
    setPicker(null);
  }

  return (
    <div className="section-list">
      <h2>Sections</h2>

      <ReorderableList
        items={sections}
        keyOf={(s) => s.id}
        labelOf={(s) => `section ${s.title || "Untitled section"}`}
        onReorder={(from, to) => onChange(moveItem(sections, from, to))}
        legend="Sections"
        renderItem={(section) => {
          const isOpen = openSectionId === section.id;
          const d = section.source.kind === "pool" ? draw[section.id] : undefined;
          const shortfall = d !== undefined && d.matching < d.wanted ? d.wanted - d.matching : 0;

          return (
            <div className="section-row">
              <button
                type="button"
                className="section-row__summary"
                onClick={() => onOpenSection(isOpen ? null : section.id)}
                aria-expanded={isOpen}
              >
                {collapsedLabel(section, draw, points)}
              </button>

              {shortfall > 0 && (
                <p className="section-row__flag-risk">
                  <span aria-hidden="true">⚠</span> {shortfall} short — needs {d!.wanted}, {d!.matching} match
                </p>
              )}

              {section.source.kind === "sets" && (setPoints[section.id]?.length ?? 0) > 0 && (
                <table className="section-row__balance" aria-label="points per set">
                  <thead>
                    <tr>
                      <th scope="col">Set</th>
                      <th scope="col">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setPoints[section.id]!.map((row) => (
                      <tr key={row.set}>
                        <td>{row.set}</td>
                        <td>{row.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {isOpen && (
                <SectionEditor
                  section={section}
                  banks={banks ?? []}
                  onChangeTitle={(title) => updateSection(section.id, (s) => ({ ...s, title }))}
                  onChangeInstructions={(instructions) => updateSection(section.id, (s) => ({ ...s, instructions }))}
                  onChangeTimeLimit={(time_limit_minutes) =>
                    updateSection(section.id, (s) => {
                      if (time_limit_minutes === undefined) {
                        const { time_limit_minutes: _drop, ...rest } = s;
                        return rest;
                      }
                      return { ...s, time_limit_minutes };
                    })
                  }
                  onChangeKind={(kind) => changeSourceKind(section, kind)}
                  onChangeSource={(source) => updateSection(section.id, (s) => ({ ...s, source }))}
                  onPickFixed={() => setPicker({ sectionId: section.id })}
                  onPickSet={(setIndex) => setPicker({ sectionId: section.id, setIndex })}
                  onDelete={() => requestDelete(section.id)}
                />
              )}
            </div>
          );
        }}
      />

      <button type="button" className="button-secondary" onClick={addSection}>
        Add section
      </button>

      {picker && (
        <QuestionPickerDrawer
          bankId={
            sections.find((s) => s.id === picker.sectionId)?.source.kind === "pool"
              ? ((sections.find((s) => s.id === picker.sectionId)!.source as { bank?: string }).bank ?? null)
              : null
          }
          selected={pickerSelection(sections, picker)}
          onConfirm={confirmPicker}
          onCancel={() => setPicker(null)}
          client={client}
          workspaceId={workspaceId}
        />
      )}

      {pendingSwitch && (
        <div role="dialog" aria-label="Replace this section's source">
          <p>
            Switching this section&apos;s source away from <strong>pool</strong> will discard its configured{" "}
            <strong>count</strong> and <strong>filter</strong> — nothing is kept across a source change.
          </p>
          <button type="button" className="button-secondary" onClick={() => setPendingSwitch(null)}>
            Cancel
          </button>
          <button type="button" className="button-primary" onClick={confirmSourceSwitch}>
            Replace it
          </button>
        </div>
      )}

      {confirmDeleteId && (
        <div role="dialog" aria-label="Delete this section">
          <p>Delete this section? This cannot be undone once you leave this screen.</p>
          <button type="button" className="button-secondary" onClick={() => setConfirmDeleteId(null)}>
            Cancel
          </button>
          <button type="button" className="button-primary" onClick={confirmDelete}>
            Delete
          </button>
        </div>
      )}

      {undo && (
        <p className="section-row__undo" role="status" aria-label="Section deleted">
          Section deleted.{" "}
          <button type="button" className="button-secondary" onClick={restoreDeleted}>
            Undo
          </button>
        </p>
      )}
    </div>
  );
}

function SectionEditor({
  section,
  banks,
  onChangeTitle,
  onChangeInstructions,
  onChangeTimeLimit,
  onChangeKind,
  onChangeSource,
  onPickFixed,
  onPickSet,
  onDelete,
}: {
  section: StoredSection;
  banks: readonly Bank[];
  onChangeTitle: (title: string) => void;
  onChangeInstructions: (instructions: string) => void;
  onChangeTimeLimit: (minutes: number | undefined) => void;
  onChangeKind: (kind: SourceKind) => void;
  onChangeSource: (source: QuestionSource) => void;
  onPickFixed: () => void;
  onPickSet: (setIndex: number) => void;
  onDelete: () => void;
}) {
  const titleId = useId();
  const instructionsId = useId();
  const timeId = useId();
  const sourceId = useId();
  const source = section.source;

  function addSet(): void {
    if (source.kind !== "sets") return;
    const set: SetDefinition = { set: String.fromCharCode(65 + source.sets.length), questions: [] };
    onChangeSource({ ...source, sets: [...source.sets, set] });
  }

  function removeSet(index: number): void {
    if (source.kind !== "sets") return;
    onChangeSource({ ...source, sets: source.sets.filter((_, i) => i !== index) });
  }

  return (
    <div className="section-editor">
      <div className="field">
        <label className="field-label" htmlFor={titleId}>
          Title
        </label>
        <input
          className="text-input"
          id={titleId}
          value={section.title}
          onChange={(event) => onChangeTitle(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={instructionsId}>
          Instructions
        </label>
        <textarea
          className="text-input"
          id={instructionsId}
          value={section.instructions ?? ""}
          onChange={(event) => onChangeInstructions(event.target.value)}
        />
        {section.instructions !== undefined && section.instructions.length > 0 && (
          <RenderedHtml markdown={section.instructions} className="section-editor__preview" />
        )}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={timeId}>
          Time limit (minutes)
        </label>
        <input
          className="text-input"
          id={timeId}
          type="number"
          min={1}
          value={section.time_limit_minutes ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChangeTimeLimit(value === "" ? undefined : Number(value));
          }}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={sourceId}>
          Source
        </label>
        <select
          id={sourceId}
          className="text-input"
          value={source.kind}
          onChange={(event) => onChangeKind(event.target.value as SourceKind)}
        >
          {SOURCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {SOURCE_KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </div>

      {source.kind === "fixed" && (
        <div className="section-editor__source">
          <p>{source.questions.length} question(s) selected.</p>
          <button type="button" className="button-secondary" onClick={onPickFixed}>
            Add questions
          </button>
        </div>
      )}

      {source.kind === "pool" && (
        <div className="section-editor__source">
          <div className="field">
            <label className="field-label" htmlFor={`${sourceId}-bank`}>
              Bank
            </label>
            <select
              id={`${sourceId}-bank`}
              className="text-input"
              value={source.bank ?? ""}
              onChange={(event) => {
                const { bank: _drop, ...rest } = source;
                const bankId = event.target.value;
                onChangeSource(bankId ? { ...rest, bank: bankId } : rest);
              }}
            >
              <option value="">Any bank</option>
              {banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${sourceId}-count`}>
              Count
            </label>
            <input
              className="text-input"
              id={`${sourceId}-count`}
              type="number"
              min={1}
              value={source.count}
              onChange={(event) => onChangeSource({ ...source, count: Number(event.target.value) || 1 })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${sourceId}-tags`}>
              Tags (comma-separated)
            </label>
            <input
              className="text-input"
              id={`${sourceId}-tags`}
              value={source.filter?.tags?.join(", ") ?? ""}
              onChange={(event) => {
                const tags = event.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter((t) => t.length > 0);
                const { filter: _drop, ...rest } = source;
                // Only `tags` has an editor yet, so this is the one filter
                // key this field owns — `difficulty`/`types` wait for a
                // later task's own UI, same reason `isConfigured` above only
                // asks whether a filter exists at all.
                onChangeSource(tags.length > 0 ? { ...rest, filter: { tags } } : rest);
              }}
            />
          </div>
        </div>
      )}

      {source.kind === "sets" && (
        <div className="section-editor__source">
          <div className="field">
            <label className="field-label" htmlFor={`${sourceId}-assignment`}>
              Assignment
            </label>
            <select
              id={`${sourceId}-assignment`}
              className="text-input"
              value={source.assignment ?? "round_robin"}
              onChange={(event) =>
                onChangeSource({ ...source, assignment: event.target.value as SetAssignment })
              }
            >
              <option value="round_robin">Round robin</option>
              <option value="random">Random</option>
              <option value="hash">Hash (stable per candidate)</option>
              <option value="from_candidate_list">From candidate list</option>
            </select>
          </div>
          <ul className="section-editor__sets">
            {source.sets.map((set, index) => (
              <li key={set.set}>
                <strong>{set.set}</strong> — {set.questions.length} question(s){" "}
                <button type="button" className="button-secondary" onClick={() => onPickSet(index)}>
                  Add questions
                </button>{" "}
                <button type="button" className="button-secondary" onClick={() => removeSet(index)}>
                  Remove set
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="button-secondary" onClick={addSet}>
            Add set
          </button>
        </div>
      )}

      <button type="button" className="button-secondary" onClick={onDelete}>
        Delete section
      </button>
    </div>
  );
}
