import { useEffect, useId, useRef, useState } from "react";
import {
  APPLICABLE_MODES,
  type Blank,
  type Difficulty,
  type FillBlankQuestion,
  type Question,
  type QuestionType,
  type ScoringConfig,
} from "@pariksha/core";
import { ApiError, type ApiClient, type PassageGroupSummary } from "../../lib/api";
import { PromptEditor } from "./PromptEditor";
import { PreviewPane } from "./PreviewPane";
import { ScoringRow } from "./ScoringRow";
import { TypePicker, TYPE_LABELS } from "./TypePicker";
import { Choice, isChoiceQuestion } from "./answer/Choice";
import { StructuredAnswer, isStructuredQuestion } from "./answer/Structured";
import { WrittenAnswer, fillBlankIssues, freshBlank, isWrittenQuestion, placeholdersIn } from "./answer/Written";

// UX-07's five-block skeleton, built once for every one of the twelve
// types: prompt -> answer -> key and scoring -> meta -> preview, with only
// the answer block swapped — choice (`answer/Choice.tsx`), structured
// (`answer/Structured.tsx`) and written (`answer/Written.tsx`).

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

/**
 * UX-21: `blanks` is derived from the prompt on every render, never carried
 * as state that is only ever pushed into from the prompt's own `onChange`
 * handler — a push only fires on a keystroke in that one textarea, so it
 * misses both a type change into `fill_blank` (the prompt already has
 * `{{1}}`, carried forward by `sharedFieldsOf`, but nothing typed after the
 * switch) and a question loaded from the API already out of sync. Deriving
 * at render/emit time instead means both self-heal on the very next render,
 * with no separate code path for "already correct" vs. "needs fixing up".
 *
 * `graveyard` is every blank this `QuestionEditor` instance has ever seen,
 * keyed by id — a author who clears a placeholder (a typo, a select-all
 * retype) and then retypes the same id gets that blank's accepted answers
 * and match mode back, rather than a blank one, because the row was merged
 * into the graveyard before it dropped out of `blanks`. This is a
 * session-only recovery net (the graveyard lives only as long as this
 * component instance, in a `useRef`, and is lost on navigation or reload) —
 * not a replacement for actually saving; `dropped` is what still has
 * answers attached but no current placeholder, so the author can be told
 * before those answers are silently left out of what gets saved.
 */
function deriveBlanks(
  question: FillBlankQuestion,
  graveyard: Map<string, Blank>,
): { blanks: Blank[]; dropped: Blank[] } {
  for (const blank of question.blanks) graveyard.set(blank.id, blank);
  const ids = placeholdersIn(question.prompt);
  const idSet = new Set(ids);
  const blanks = ids.map((id) => graveyard.get(id) ?? freshBlank(id));
  const dropped = [...graveyard.values()].filter((blank) => !idSet.has(blank.id) && blank.accepted.length > 0);
  return { blanks, dropped };
}

export function QuestionEditor({
  bankId,
  workspaceId,
  initial,
  client,
  onDirty,
  onSaved,
}: {
  bankId: string;
  workspaceId: string;
  initial?: Question | undefined;
  client: ApiClient;
  /**
   * Fix round (whole-branch review, M4): fires on every edit after the
   * first render, including a type change — never on the save itself
   * (`onSave` never calls `setQuestion`, see below). `question.tsx` uses it
   * to reset "Saved.", which used to be set once and never cleared.
   */
  onDirty?: () => void;
  onSaved: (question: Question) => void;
}) {
  const [question, setQuestion] = useState<Question>(
    () => initial ?? withType({ id: freshQuestionId(), prompt: "" }, "single"),
  );
  const [groups, setGroups] = useState<PassageGroupSummary[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingType, setPendingType] = useState<QuestionType | null>(null);
  const [reveal, setReveal] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const metaId = useId();
  const changeTypeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fillBlankGraveyard = useRef(new Map<string, Blank>());
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) onDirty?.();
    else mounted.current = true;
    // `question` is the one piece of state every edit path above funnels
    // through — deliberately not depending on `onDirty` itself, which
    // question.tsx passes as a fresh closure every render.
  }, [question]);

  // Review Focus 2's dialog (UX-06) moves focus into itself on open and
  // back to the button that opened it on close — a real focus trap (Tab
  // cycling back in) is more than this control needs, so `aria-modal` is
  // left off rather than claimed and not honoured.
  useEffect(() => {
    if (pendingType !== null) dialogRef.current?.focus();
  }, [pendingType]);

  // The meta block's group select, and the preview's passage, both need
  // every group the bank has — a handful at most (#50, P4.6), so one fetch
  // on mount is enough; nothing here edits a group, so there is nothing to
  // keep in sync afterwards.
  //
  // Fix round 1, finding 3: an un-caught rejection here (a 403, a dropped
  // connection) used to become an unhandled promise rejection with the
  // select silently stuck on "No group" — the same try/catch-into-`notice`
  // shape `bank.tsx`'s `load()` already uses for the same failure.
  useEffect(() => {
    let current = true;
    client
      .listGroups(workspaceId, bankId)
      .then((rows) => {
        if (current) setGroups(rows);
      })
      .catch((cause: unknown) => {
        if (current) {
          setNotice(cause instanceof ApiError ? cause.message : "Passage groups could not be loaded.");
        }
      });
    return () => {
      current = false;
    };
  }, [client, workspaceId, bankId]);

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

  function setMetaField<K extends "group" | "difficulty" | "tags" | "explanation">(
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
      const saved = await client.saveQuestion(workspaceId, bankId, effectiveQuestion);
      onSaved(saved.document);
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "The question could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const lost = pendingType !== null ? lostFields(question) : [];

  const { blanks: derivedBlanks, dropped: droppedBlanks } =
    question.type === "fill_blank"
      ? deriveBlanks(question, fillBlankGraveyard.current)
      : { blanks: [], dropped: [] };
  const effectiveQuestion: Question =
    question.type === "fill_blank" ? { ...question, blanks: derivedBlanks } : question;
  // UX-21: an unsafe regex blank (or, defensively, a blank/placeholder
  // mismatch — structurally impossible given `effectiveQuestion` above, but
  // checked anyway) is caught here as fast, author-facing feedback while
  // they type.
  //
  // Fix round 1, finding 4: this used to be the *only* check — the comment
  // here said `saveQuestion` ran no `validateBank` check at all. That is no
  // longer true: `apps/api/src/routes/questions.ts`'s `assertValid` now
  // blocks a save server-side for exactly two of `validateBank`'s rules, a
  // bad `group` reference and an unsafe regex (the same rule this local
  // check already enforces) — not the rest of what `validateBank` covers,
  // which stays deferred to import and publish so a half-built question can
  // still be saved. So this client-side check is redundant with the regex
  // half of the server's guard (fast feedback while typing vs. a round
  // trip), not a stand-in for a guard that doesn't exist yet; the `group`
  // half has no client-side equivalent because the select above only ever
  // offers groups the bank actually has.
  const blockingIssues = effectiveQuestion.type === "fill_blank" ? fillBlankIssues(effectiveQuestion) : [];
  const groupPassage = groups.find((group) => group.id === effectiveQuestion.group)?.passage;

  return (
    <div className="question-editor">
      <section>
        <h2>Prompt</h2>
        <PromptEditor
          value={question.prompt}
          onChange={(prompt) => setQuestion((prev) => ({ ...prev, prompt }))}
          label="Prompt"
        />
        {droppedBlanks.length > 0 && (
          <p className="field-help" role="status">
            {`${droppedBlanks.map((blank) => `Blank ${blank.id}`).join(", ")} no longer match a placeholder in the prompt. Their answers are kept if you retype the placeholder, but will be dropped from what you save.`}
          </p>
        )}
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
        ) : isStructuredQuestion(question) ? (
          <StructuredAnswer key={question.type} question={question} onChange={setQuestion} />
        ) : isWrittenQuestion(effectiveQuestion) ? (
          <WrittenAnswer
            key={effectiveQuestion.type}
            question={effectiveQuestion}
            onChange={setQuestion}
            fillBlankIssues={blockingIssues}
          />
        ) : null}
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
        {/* `D16`: Meta is two rows of two, not eight stacked elements. Each
            row is one grid with a label, a control and a help track, and each
            field is a subgrid spanning all three — so the field that states a
            constraint and the field beside it that states nothing still put
            their controls on one line. Both rows here are deliberately mixed,
            which is the case the rule exists for. */}
        <div className="field-row">
          <div className="field">
            <label className="field-label" htmlFor={`${metaId}-id`}>
              Question ID
            </label>
            <input
              className="text-input"
              id={`${metaId}-id`}
              type="text"
              value={question.id}
              aria-describedby={`${metaId}-id-help`}
              onChange={(event) => setQuestion((prev) => ({ ...prev, id: event.target.value }))}
              onBlur={() =>
                setQuestion((prev) => (prev.id.trim() === "" ? { ...prev, id: freshQuestionId() } : prev))
              }
            />
            <p className="field-help" id={`${metaId}-id-help`}>
              Letters, numbers, underscore, dot or hyphen — up to 64 characters.
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${metaId}-group`}>
              Passage group
            </label>
            <select
              id={`${metaId}-group`}
              value={question.group ?? ""}
              onChange={(event) =>
                setMetaField("group", event.target.value === "" ? undefined : event.target.value)
              }
            >
              <option value="">No group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.title ?? group.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
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
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${metaId}-tags`}>
              Tags
            </label>
            <input
              className="text-input"
              id={`${metaId}-tags`}
              type="text"
              value={(question.tags ?? []).join(", ")}
              aria-describedby={`${metaId}-tags-help`}
              onChange={(event) => {
                const tags = event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean);
                setMetaField("tags", tags.length > 0 ? tags : undefined);
              }}
            />
            <p className="field-help" id={`${metaId}-tags-help`}>
              Comma-separated. A tag with a slash, like sdlc/agile, groups in the browser.
            </p>
          </div>
        </div>

        <PromptEditor
          value={question.explanation ?? ""}
          onChange={(value) => setMetaField("explanation", value === "" ? undefined : value)}
          label="Explanation"
        />
      </section>

      <PreviewPane
        question={effectiveQuestion}
        {...(groupPassage !== undefined && { passage: groupPassage })}
        reveal={reveal}
        onRevealChange={setReveal}
      />

      {notice !== undefined && (
        <p className="field-error" role="alert">
          {notice}
        </p>
      )}
      <button
        type="button"
        className="button-primary button-primary--surface"
        disabled={saving || blockingIssues.length > 0}
        onClick={() => void onSave()}
      >
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
