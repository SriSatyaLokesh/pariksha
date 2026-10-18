import { useEffect, useId, useRef, useState } from "react";
import { APPLICABLE_MODES, type Difficulty, type Question, type QuestionType, type ScoringConfig } from "@pariksha/core";
import { ApiError, type ApiClient } from "../../lib/api";
import { PromptEditor } from "./PromptEditor";
import { PreviewPane } from "./PreviewPane";
import { ScoringRow } from "./ScoringRow";
import { TypePicker, TYPE_LABELS } from "./TypePicker";
import { Choice, isChoiceQuestion } from "./answer/Choice";

// UX-07's five-block skeleton, built once for every one of the twelve
// types: prompt -> answer -> key and scoring -> meta -> preview, with only
// the answer block swapped. Tasks 4 and 5 add the structured and written
// answer blocks to the placeholder below; this task implements the choice
// family (`answer/Choice.tsx`).

/** The fields UX-06's type change carries forward — every field
 * `QuestionBase` declares (`packages/core/src/types.ts`), none of them
 * type-specific. `shuffle_options` and `$schema` belong here for the same
 * reason `prompt` and `scoring` do: nothing about them is tied to a
 * particular type, so a type change must not treat them as losses. */
function sharedFieldsOf(question: Question): Partial<Question> {
  const shared: Partial<Question> = { id: question.id, prompt: question.prompt };
  if (question["$schema"] !== undefined) shared["$schema"] = question["$schema"];
  if (question.media !== undefined) shared.media = question.media;
  if (question.group !== undefined) shared.group = question.group;
  if (question.difficulty !== undefined) shared.difficulty = question.difficulty;
  if (question.tags !== undefined) shared.tags = question.tags;
  if (question.explanation !== undefined) shared.explanation = question.explanation;
  if (question.scoring !== undefined) shared.scoring = question.scoring;
  if (question.shuffle_options !== undefined) shared.shuffle_options = question.shuffle_options;
  return shared;
}

const SHARED_FIELD_NAMES = new Set([
  "id",
  "prompt",
  "$schema",
  "media",
  "group",
  "difficulty",
  "tags",
  "explanation",
  "scoring",
  "shuffle_options",
  "type",
]);

// The order a person reads the lost-fields list in — not a second
// allowlist. `lostFields` below names every own key that isn't shared,
// ranking the ones this list knows about first; a field nobody has
// extended this list for yet still appears (at the end, in whatever order
// it was declared), rather than silently passing as "nothing lost".
const FIELD_ORDER = [
  "options",
  "assertion",
  "reason",
  "left",
  "right",
  "items",
  "blanks",
  "unit",
  "max_length",
  "model_answer",
  "rubric",
  "key",
  "k",
];

function lostFields(question: Question): string[] {
  const present = Object.keys(question).filter((key) => !SHARED_FIELD_NAMES.has(key));
  const rank = (field: string): number => {
    const index = FIELD_ORDER.indexOf(field);
    return index === -1 ? FIELD_ORDER.length : index;
  };
  // Array.prototype.sort is stable (ES2019+), so two fields of equal rank
  // (both unknown to FIELD_ORDER) keep their original relative order.
  return [...present].sort((a, b) => rank(a) - rank(b));
}

/** Every type's minimal, structurally valid extra fields — what a brand
 * new question of that type starts with, and what a type change rebuilds
 * from scratch rather than inheriting. */
function defaultExtra(type: QuestionType): Record<string, unknown> {
  switch (type) {
    case "single":
      return {
        options: [
          { id: "a", text: "" },
          { id: "b", text: "" },
        ],
        key: "a",
      };
    case "multiple":
      return {
        options: [
          { id: "a", text: "" },
          { id: "b", text: "" },
        ],
        key: [],
      };
    case "select_k":
      return {
        options: [
          { id: "a", text: "" },
          { id: "b", text: "" },
          { id: "c", text: "" },
        ],
        k: 1,
        key: [],
      };
    case "true_false":
      return { key: false };
    case "assertion_reason":
      return { assertion: "", reason: "", key: "both_true_explains" };
    case "matching":
      return { left: [], right: [], key: {} };
    case "multi_matching":
      return { left: [], right: [], key: {} };
    case "ordering":
      return { items: [] };
    case "fill_blank":
      return { blanks: [] };
    case "numeric":
      return { key: { value: 0 } };
    case "short_answer":
    case "long_answer":
      return {};
  }
}

function withType(shared: Partial<Question>, type: QuestionType): Question {
  const next = { ...shared, ...defaultExtra(type), type } as Question;
  // A carried-forward scoring mode can be one the new type doesn't support
  // (e.g. "partial" surviving multiple -> single). Left alone, the <select>
  // in ScoringRow renders blank (no option matches) while the invalid mode
  // is still what gets saved — clearing it here keeps display and state in
  // agreement, and is a straight drop, not a merge: points and
  // negative_fraction (unaffected by the type) are kept.
  if (next.scoring?.mode !== undefined && !APPLICABLE_MODES[type].includes(next.scoring.mode)) {
    const rest: ScoringConfig = {};
    if (next.scoring.points !== undefined) rest.points = next.scoring.points;
    if (next.scoring.negative_fraction !== undefined) rest.negative_fraction = next.scoring.negative_fraction;
    if (Object.keys(rest).length > 0) next.scoring = rest;
    else delete next.scoring;
  }
  return next;
}

/** A fresh question ID (`^[A-Za-z0-9_.-]{1,64}$` — `schemas/question-1.json`
 * and `apps/api/src/routes/questions.ts` both match the row on this value).
 * A UUID satisfies the pattern outright (hex digits and hyphens only) and
 * needs no uniqueness check here — the route already owns that. */
function freshQuestionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `qst-${Date.now()}`;
}

export function QuestionEditor({
  bankId,
  workspaceId,
  initial,
  client,
  onSaved,
}: {
  bankId: string;
  workspaceId: string;
  initial?: Question | undefined;
  client: ApiClient;
  onSaved: (question: Question) => void;
}) {
  const [question, setQuestion] = useState<Question>(
    () => initial ?? withType({ id: freshQuestionId(), prompt: "" }, "single"),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingType, setPendingType] = useState<QuestionType | null>(null);
  const [reveal, setReveal] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const metaId = useId();
  const changeTypeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Review Focus 2's dialog (UX-06) moves focus into itself on open and
  // back to the button that opened it on close — a real focus trap (Tab
  // cycling back in) is more than this control needs, so `aria-modal` is
  // left off rather than claimed and not honoured.
  useEffect(() => {
    if (pendingType !== null) dialogRef.current?.focus();
  }, [pendingType]);

  function applyType(type: QuestionType): void {
    setQuestion(withType(sharedFieldsOf(question), type));
    setPickerOpen(false);
    setPendingType(null);
    changeTypeButtonRef.current?.focus();
  }

  function cancelTypeChange(): void {
    setPendingType(null);
    changeTypeButtonRef.current?.focus();
  }

  function onPickType(type: QuestionType): void {
    if (type === question.type) {
      setPickerOpen(false);
      return;
    }
    if (lostFields(question).length === 0) {
      applyType(type);
      return;
    }
    setPendingType(type);
  }

  function setMetaField<K extends "difficulty" | "tags" | "explanation">(
    key: K,
    value: Question[K] | undefined,
  ): void {
    setQuestion((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function onSave(): Promise<void> {
    setNotice(undefined);
    setSaving(true);
    try {
      const saved = await client.saveQuestion(workspaceId, bankId, question);
      onSaved(saved.document);
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "The question could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const lost = pendingType !== null ? lostFields(question) : [];

  return (
    <div className="question-editor">
      <section>
        <h2>Prompt</h2>
        <PromptEditor
          value={question.prompt}
          onChange={(prompt) => setQuestion((prev) => ({ ...prev, prompt }))}
          label="Prompt"
        />
      </section>

      <section>
        <div className="question-editor__answer-bar">
          <h2>Answer</h2>
          <button
            type="button"
            className="prompt-editor__tool"
            ref={changeTypeButtonRef}
            onClick={() => setPickerOpen((open) => !open)}
          >
            Change type
          </button>
        </div>
        {pickerOpen && <TypePicker value={question.type} onPick={onPickType} />}
        {isChoiceQuestion(question) ? (
          <Choice key={question.type} question={question} onChange={setQuestion} />
        ) : (
          <p className="field-help">This question type&rsquo;s answer editor isn&rsquo;t available yet.</p>
        )}
      </section>

      <section>
        <h2>Key and scoring</h2>
        <ScoringRow
          type={question.type}
          value={question.scoring ?? {}}
          onChange={(scoring: ScoringConfig) => setQuestion((prev) => ({ ...prev, scoring }))}
        />
      </section>

      <section>
        <h2>Meta</h2>
        <label className="field-label" htmlFor={`${metaId}-id`}>
          Question ID
        </label>
        <input
          className="text-input"
          id={`${metaId}-id`}
          type="text"
          value={question.id}
          onChange={(event) => setQuestion((prev) => ({ ...prev, id: event.target.value }))}
          onBlur={() =>
            setQuestion((prev) => (prev.id.trim() === "" ? { ...prev, id: freshQuestionId() } : prev))
          }
        />
        <p className="field-help">Letters, numbers, underscore, dot or hyphen — up to 64 characters.</p>

        <label className="field-label" htmlFor={`${metaId}-difficulty`}>
          Difficulty
        </label>
        <select
          id={`${metaId}-difficulty`}
          value={question.difficulty ?? ""}
          onChange={(event) =>
            setMetaField("difficulty", event.target.value ? (event.target.value as Difficulty) : undefined)
          }
        >
          <option value="">Not set</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>

        <label className="field-label" htmlFor={`${metaId}-tags`}>
          Tags
        </label>
        <input
          className="text-input"
          id={`${metaId}-tags`}
          type="text"
          value={(question.tags ?? []).join(", ")}
          onChange={(event) => {
            const tags = event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean);
            setMetaField("tags", tags.length > 0 ? tags : undefined);
          }}
        />
        <p className="field-help">Comma-separated. A tag with a slash, like sdlc/agile, groups in the browser.</p>

        <PromptEditor
          value={question.explanation ?? ""}
          onChange={(value) => setMetaField("explanation", value === "" ? undefined : value)}
          label="Explanation"
        />
      </section>

      <PreviewPane question={question} reveal={reveal} onRevealChange={setReveal} />

      {notice !== undefined && (
        <p className="field-error" role="alert">
          {notice}
        </p>
      )}
      <button type="button" className="button-primary button-primary--surface" disabled={saving} onClick={() => void onSave()}>
        Save
      </button>

      {pendingType !== null && (
        // Not `aria-modal="true"`: nothing here traps Tab inside the
        // dialog, and claiming "modal" to assistive tech while a keyboard
        // user can still tab out to the rest of the page would strand them
        // worse than an honest non-modal `role="dialog"` does. Initial
        // focus still lands here on open (the effect above) and returns to
        // "Change type" on Confirm/Cancel/Escape.
        <div
          className="question-editor__dialog"
          role="dialog"
          aria-labelledby={`${metaId}-dialog-heading`}
          ref={dialogRef}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelTypeChange();
          }}
        >
          <h2 id={`${metaId}-dialog-heading`}>Change question type?</h2>
          <p>
            Changing to {TYPE_LABELS[pendingType]} will remove: {lost.join(", ")}.
          </p>
          <button type="button" className="button-primary button-primary--surface" onClick={() => applyType(pendingType)}>
            Confirm
          </button>
          <button type="button" className="button-secondary" onClick={cancelTypeChange}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
