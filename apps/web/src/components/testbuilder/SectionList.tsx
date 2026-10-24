import { useEffect, useId, useState } from "react";
import { QUESTION_TYPES, type Difficulty, type PoolFilter, type QuestionSource, type QuestionType, type SetDefinition, type SourcePool, type SourceSets } from "@pariksha/core";
import type { ApiClient, Bank, StoredSection } from "../../lib/api";
import { ReorderableList } from "../authoring/ReorderableList";
import { RenderedHtml } from "../authoring/RenderedHtml";
import { QuestionPickerDrawer } from "./QuestionPickerDrawer";
import { SetsPanel, ShuffleFieldset } from "./SetsPanel";
import { useDialogKeys } from "../useDialogKeys";

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

/** Fix round (task 3 review, C3): the source-switch dialog used to name
 * "pool"'s own count and filter no matter which kind was actually being
 * discarded. This says what the *current* source is — the one the switch
 * is about to throw away — so an author with a hand-picked fixed list
 * does not see a warning about a pool that was never configured. */
function discardDescription(source: QuestionSource): string {
  if (source.kind === "fixed") {
    const n = source.questions.length;
    return `its hand-picked list of ${n} question${n === 1 ? "" : "s"}`;
  }
  if (source.kind === "pool") return "its bank, count and filter";
  const n = source.sets.length;
  return `its ${n} set${n === 1 ? "" : "s"}`;
}

/** Fix round (task 3 review, I13): a pool's filter could only be given
 * tags, though the server already filters on `difficulty` and `type` too
 * (`matchesFilter`, `@pariksha/core`) and `AC-10`'s own example is
 * "10 from pool, tag sql, medium". Sets or clears one filter key at a
 * time — `rest` first, so a later explicit key always wins over a stale
 * one spread before it, and the whole `filter` is dropped once every key
 * is empty, the same "configured means it names something" rule
 * `isConfigured` already applies to the source as a whole. */
function withFilterField<K extends keyof PoolFilter>(
  source: SourcePool,
  key: K,
  value: NonNullable<PoolFilter[K]> | undefined,
): SourcePool {
  const { [key]: _drop, ...rest } = source.filter ?? {};
  const next: PoolFilter = value === undefined || value.length === 0 ? rest : { ...rest, [key]: value };
  const { filter: _dropFilter, ...withoutFilter } = source;
  return Object.keys(next).length > 0 ? { ...withoutFilter, filter: next } : withoutFilter;
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

/** Fix round (task 3 review, I3): a pool's points figure is a range, not a
 * fact — "8–40 points" when the matching questions actually differ,
 * collapsing to "8 points" when every one of them is worth the same. */
function pointsLabel(range: { min: number; max: number } | undefined): string {
  if (range === undefined) return "0 points";
  return range.min === range.max ? `${range.min} points` : `${range.min}–${range.max} points`;
}

/** UX-12's collapsed-row sentence: "Title · kind · N questions · M points ·
 * T min" — the accessible name of the row's own `<button>`, so a screen
 * reader hears the same sentence a sighted reader reads. */
function collapsedLabel(
  section: StoredSection,
  draw: Readonly<Record<string, { matching: number; wanted: number }>>,
  points: Readonly<Record<string, { min: number; max: number }>>,
): string {
  return `${section.title || "Untitled section"} · ${section.source.kind} · ${countLabel(section, draw)} · ${pointsLabel(points[section.id])} · ${timeLabel(section)}`;
}

/** `D19`: the half of shuffling that exists, on the collapsed row. Reads
 * `shuffle_questions` — whose schema default is `true` (schemas/test-1.json,
 * `$defs/section`) — and never writes it: a chip that wrote back what it
 * renders would flip every draft relying on that default the moment the
 * screen opened. Both states are worded, not only the on one: a chip that
 * vanishes when shuffling is off is indistinguishable from one that failed
 * to render, and colour alone would carry the difference otherwise. */
function shuffleChipLabel(section: StoredSection): string {
  return (section.shuffle_questions ?? true) ? "Questions shuffled" : "Questions in order";
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
  // `points` field. `{ min, max }`, task 3 review I3 — a pool's estimate is
  // a range, not a fact.
  points: Readonly<Record<string, { min: number; max: number }>>;
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
  const [pendingSwitch, setPendingSwitch] = useState<{ sectionId: string; kind: SourceKind; discard: string } | null>(
    null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ section: StoredSection; index: number } | null>(null);
  const [picker, setPicker] = useState<{ sectionId: string; setIndex?: number } | null>(null);

  // Fix round (task 3 review, I9): Escape, initial focus and returning
  // focus to the control that opened each dialog. `trapTab: true` since
  // the fix round after that gave both dialogs a full-viewport scrim
  // (`M6`): `useDialogKeys`'s own doc comment says a caller that traps Tab
  // has earned `aria-modal`, which was true the moment a scrim made
  // "covers the viewport" literal — bank.tsx's own identical dialog
  // (`M2` there) is the precedent this copies.
  const switchDialog = useDialogKeys<HTMLDivElement>(pendingSwitch !== null, () => setPendingSwitch(null), {
    trapTab: true,
  });
  const deleteDialog = useDialogKeys<HTMLDivElement>(confirmDeleteId !== null, () => setConfirmDeleteId(null), {
    trapTab: true,
  });

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
      setPendingSwitch({ sectionId: section.id, kind, discard: discardDescription(section.source) });
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

              {/* `D19`: outside the summary button on purpose. The button's
                  accessible name is UX-12's fixed sentence, and folding a
                  sixth fact into it would change what a screen reader hears
                  for every row. */}
              <p className="section-row__chip">{shuffleChipLabel(section)}</p>

              {/* Fix round (task 3 review, I2): UX-15's live draw — "N drawn
                  from M matching" — is the normal-case sentence
                  (docs/design.md:225); the shortfall warning beside it is
                  the alarm, not a replacement for it. The server computes
                  `draw` for every pool section, healthy or not; this used
                  to throw it away unless the pool was short. */}
              {d !== undefined && (
                <p className="section-row__draw">
                  {Math.min(d.wanted, d.matching)} drawn from {d.matching} matching
                </p>
              )}

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
                  // Task 4 (#56, P5.3): `SetsPanel` reports both halves at
                  // once, and they are applied in one update — two separate
                  // callbacks fired from the same handler would each
                  // rebuild this section from the same stale `sections`
                  // prop, and the second would undo the first.
                  onChangeSets={(next) =>
                    updateSection(section.id, (s) => ({
                      ...s,
                      source: next.source,
                      shuffle_questions: next.shuffleQuestions,
                    }))
                  }
                  onChangeShuffle={(shuffle_questions) =>
                    updateSection(section.id, (s) => ({ ...s, shuffle_questions }))
                  }
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

      {/* Phase 8h Task 6 (`F5`): the disabled "Order of the sections
          themselves" control used to sit here — a checkbox that could never
          be checked, above Settings, on every builder page regardless of
          whether reordering sections is even a question yet. `D19`'s
          capability is still not built: `pariksha/test@1` has no
          `shuffle_sections` field, and adding one is a format bump plus a
          ruling on whether per-section time limits survive a shuffled
          order — a feature and an ADR, not a design control. A control
          that can never do anything is not a placeholder for that work;
          it is dead weight above the fold on the one screen the owner
          asked this phase to make more room on. Deleted rather than
          hidden: the day the capability lands, it gets a control that
          actually does something, not this one re-enabled. */}

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

      {/* Phase 8h fix round (`C1`/`M6`/`M7`/Minor "two scrim tokens"): this
          used to be a bespoke `.section-list__scrim`/`.section-list__confirm`
          pair — a second recipe for the exact construct `bank.tsx` built
          the same wave (`.bank-confirm` + `.card-hairline
          bank-confirm__dialog`), reading `--color-scrim`/`--color-shadow`
          (cream-only literals `test/theme.test.ts` forbids outside the
          candidate ground, and invisible on Signal dark either way) where
          `bank.tsx` already reads `--scrim` (ground-aware) and
          `.card-hairline` (a border that survives the dark ground instead
          of a shadow the dark ground swallows). Converged onto the bank
          shape rather than kept as a second one; `trapTab: true` above is
          the other half of what a full-viewport scrim owes focus. */}
      {pendingSwitch && (
        <div className="bank-confirm" onClick={() => setPendingSwitch(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Replace this section's source"
            ref={switchDialog.dialogRef}
            tabIndex={-1}
            onKeyDown={switchDialog.onKeyDown}
            className="card-hairline bank-confirm__dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="bank-confirm__message">
              Switching this section&apos;s source will discard <strong>{pendingSwitch.discard}</strong> — nothing is
              kept across a source change.
            </p>
            <div className="button-row">
              <button type="button" className="button-secondary" onClick={() => setPendingSwitch(null)}>
                Cancel
              </button>
              <button type="button" className="button-primary" onClick={confirmSourceSwitch}>
                Replace it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 8h (`O-22`, register `G3-02`/`G3-03`): this used to render
          inline at document end — below the fold on anything but a short
          test — with its confirm styled identically to every other
          button on the screen. An irreversible action now interrupts the
          screen it was asked from (the same `.bank-confirm` overlay the
          source-switch dialog above uses) and its confirm is
          `.button-danger` alone (`authoring.css`'s own class, built
          complete the same wave — `C2`: a second, redundant
          `.button-danger` rule and a `button-secondary button-danger`
          pairing on the element both deleted, not renamed around). */}
      {confirmDeleteId && (
        <div className="bank-confirm" onClick={() => setConfirmDeleteId(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete this section"
            ref={deleteDialog.dialogRef}
            tabIndex={-1}
            onKeyDown={deleteDialog.onKeyDown}
            className="card-hairline bank-confirm__dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="bank-confirm__message">Delete this section? This cannot be undone once you leave this screen.</p>
            <div className="button-row">
              <button type="button" className="button-secondary" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button type="button" className="button-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
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
  onChangeSets,
  onChangeShuffle,
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
  onChangeSets: (next: { source: SourceSets; shuffleQuestions: boolean }) => void;
  onChangeShuffle: (shuffleQuestions: boolean) => void;
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
                onChangeSource(withFilterField(source, "tags", tags));
              }}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${sourceId}-difficulty`}>
              Difficulty
            </label>
            <select
              id={`${sourceId}-difficulty`}
              className="text-input"
              value={source.filter?.difficulty?.[0] ?? ""}
              onChange={(event) => {
                const value = event.target.value as Difficulty | "";
                onChangeSource(withFilterField(source, "difficulty", value ? [value] : undefined));
              }}
            >
              <option value="">Any difficulty</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${sourceId}-type`}>
              Type
            </label>
            <select
              id={`${sourceId}-type`}
              className="text-input"
              value={source.filter?.types?.[0] ?? ""}
              onChange={(event) => {
                const value = event.target.value as QuestionType | "";
                onChangeSource(withFilterField(source, "types", value ? [value] : undefined));
              }}
            >
              <option value="">Any type</option>
              {QUESTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {source.kind === "sets" && (
        <div className="section-editor__source">
          {/* Task 4 (#56, P5.3): T-09's four strategies as radios, each
              carrying its consequence as persistent helper text, plus
              T-10's shuffle group — the `<select>` that used to sit here
              named the strategies and said nothing about what any of them
              does to a candidate. */}
          <SetsPanel
            source={source}
            shuffleQuestions={section.shuffle_questions ?? true}
            onChange={onChangeSets}
          />
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

      {/* Task 4 (#56, P5.3): `shuffle_questions` is a field of every
          section, not only a `sets` one — `SetsPanel` composes the same
          fieldset for `sets` sources, where it has to travel with the
          assignment in a single update. */}
      {source.kind !== "sets" && (
        <ShuffleFieldset shuffleQuestions={section.shuffle_questions ?? true} onChange={onChangeShuffle} />
      )}

      <button type="button" className="button-secondary" onClick={onDelete}>
        Delete section
      </button>
    </div>
  );
}
