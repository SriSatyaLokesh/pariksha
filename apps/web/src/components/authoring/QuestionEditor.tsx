import { useId, useState } from "react";
import type { Difficulty, Question, QuestionType, ScoringConfig } from "@pariksha/core";
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

/** The fields UX-06's type change carries forward. Everything else on the
 * current document is type-specific and is named in the confirmation
 * dialog before it is dropped (Review Focus 2: the save path never spreads
 * the old document, so a stale field cannot survive a round trip). */
function sharedFieldsOf(question: Question): Partial<Question> {
  const shared: Partial<Question> = { id: question.id, prompt: question.prompt };
  if (question.media !== undefined) shared.media = question.media;
  if (question.group !== undefined) shared.group = question.group;
  if (question.difficulty !== undefined) shared.difficulty = question.difficulty;
  if (question.tags !== undefined) shared.tags = question.tags;
  if (question.explanation !== undefined) shared.explanation = question.explanation;
  if (question.scoring !== undefined) shared.scoring = question.scoring;
  return shared;
}

const SHARED_FIELD_NAMES = new Set(["id", "prompt", "media", "group", "difficulty", "tags", "explanation", "scoring", "type"]);

// Controls the dialog's wording: the order a person reads the lost fields
// in, not the order Object.keys happens to return.
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
  const present = new Set(Object.keys(question).filter((key) => !SHARED_FIELD_NAMES.has(key)));
  return FIELD_ORDER.filter((field) => present.has(field));
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
  return { ...shared, ...defaultExtra(type), type } as Question;
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
    () => initial ?? withType({ id: "", prompt: "" }, "single"),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingType, setPendingType] = useState<QuestionType | null>(null);
  const [reveal, setReveal] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const metaId = useId();

  function applyType(type: QuestionType): void {
    setQuestion(withType(sharedFieldsOf(question), type));
    setPickerOpen(false);
    setPendingType(null);
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
          <button type="button" className="prompt-editor__tool" onClick={() => setPickerOpen((open) => !open)}>
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
        <div className="question-editor__dialog" role="dialog" aria-modal="true" aria-labelledby={`${metaId}-dialog-heading`}>
          <h2 id={`${metaId}-dialog-heading`}>Change question type?</h2>
          <p>
            Changing to {TYPE_LABELS[pendingType]} will remove: {lost.join(", ")}.
          </p>
          <button type="button" className="button-primary button-primary--surface" onClick={() => applyType(pendingType)}>
            Confirm
          </button>
          <button type="button" className="button-secondary" onClick={() => setPendingType(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
