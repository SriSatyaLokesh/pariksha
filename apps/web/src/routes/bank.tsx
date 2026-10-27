import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { QUESTION_TYPES, type ImportIssue, type Question } from "@pariksha/core";
import { ApiError, type ApiClient, type PassageGroupSummary, type QuestionSummary } from "../lib/api";
import { downloadJson } from "../lib/download";
import { MonoCaption } from "../components/MonoCaption";
import { GroupEditor } from "../components/authoring/GroupEditor";
import { useDialogKeys } from "../components/useDialogKeys";
import { DraftAiModal } from "../components/admin/DraftAiModal";
// G4-10: `TYPE_LABELS` already exists for the type picker's own cards —
// reused here rather than duplicated, so the filter dropdown and the type
// column never learn to spell `select_k` one way and `assertion_reason`
// another.
import { TYPE_LABELS } from "../components/authoring/TypePicker";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

// Screen 2 of the bank-first flow (docs/design.md, Flow 1): the bank
// browser. UX-04 wants a table, not a card grid, with type/tag/difficulty/
// "not used in any test" filters in a left rail and a checkbox per row for
// the bulk affordances Tasks 3-9 hang off `selected`. UX-03's hierarchical
// tags (`sdlc/agile`) group that rail by the text before the first `/` and
// render the whole tag as a breadcrumb chip. UX-05 refuses a delete a
// published test holds, naming the tests.

/** `UNGROUPED` key for a tag with no `/` (G4-04). It used to be dropped on
 * the floor here — `continue`d past, never rendered anywhere on this
 * screen — which is worse than an awkward cluster: a tag an author typed
 * that silently cannot be filtered on looks like the tag was never saved. */
const UNGROUPED = "";

/** Tags with a `/` group the rail by their text before the first one
 * (UX-03); every other tag lands in one `UNGROUPED` cluster rather than
 * being left out of the rail entirely. */
function groupedTags(tags: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const tag of tags) {
    const slash = tag.indexOf("/");
    const group = slash === -1 ? UNGROUPED : tag.slice(0, slash);
    groups.set(group, [...(groups.get(group) ?? []), tag]);
  }
  return groups;
}

function breadcrumb(tag: string): string {
  return tag.split("/").join(" / ");
}

function excerpt(prompt: string, max = 120): string {
  return prompt.length > max ? `${prompt.slice(0, max - 1)}…` : prompt;
}

/** A download is still a fetch (repo convention) — `client.exportBank`
 * (apps/web/src/lib/api.ts) is what makes the network call; everything here
 * only turns an already-fetched document into a saved file, with no
 * `fetch(` of its own. */
function exportFilename(name: string, fallback = "bank"): string {
  const slug = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${slug || fallback}.json`;
}

/**
 * Fix round (whole-branch review, I4): `question_in_use` and `group_in_use`
 * are the same "blocked by other rows" shape (UX-05's refusal), now both
 * named `details.blockedBy` — one parsing branch for both delete handlers
 * below, rather than one per error code.
 */
function blockedByMessage(cause: unknown, kind: "question" | "group"): string {
  if (cause instanceof ApiError && (cause.code === "question_in_use" || cause.code === "group_in_use")) {
    const blockedBy = (cause.details as { blockedBy?: string[] } | undefined)?.blockedBy ?? [];
    return `This ${kind} is used by: ${blockedBy.join(", ")}.`;
  }
  return cause instanceof ApiError ? cause.message : `The ${kind} could not be deleted.`;
}

interface Filter {
  type?: Question["type"];
  difficulty?: "easy" | "medium" | "hard";
  tag?: string;
  unused?: boolean;
}

export function BankBrowser({
  bankId,
  workspaceId,
  client,
  onNewQuestion,
  onEditQuestion,
  onImport,
}: {
  bankId: string;
  workspaceId: string;
  client: ApiClient;
  onNewQuestion: () => void;
  onEditQuestion: (question: QuestionSummary) => void;
  /** `D18`: import is a page of its own now, so this screen navigates to
   * it rather than mounting it. */
  onImport: () => void;
}) {
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [passageGroups, setPassageGroups] = useState<PassageGroupSummary[]>([]);
  const [isAiDraftOpen, setAiDraftOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>({});
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // Fix round (whole-branch review, I1): a 422 `not_exportable` names every
  // offending question (`apps/api/src/export/bank.ts`'s `exportIssues`
  // already carries `questionId` per issue) — `notice` alone only ever
  // showed `cause.message`, a generic sentence with no way to tell a draft
  // 50-question bank which one question to deselect via "Export selected".
  const [exportIssues, setExportIssues] = useState<ImportIssue[] | undefined>(undefined);
  // `undefined`: no passage-group form open. `"new"`: the "New group" form.
  // A `PassageGroupSummary`: editing that existing group.
  const [editingGroup, setEditingGroup] = useState<PassageGroupSummary | "new" | undefined>(undefined);
  // G4-01: a question or a group used to delete the instant its row's
  // Delete button was clicked — no confirmation, no undo, one stray click
  // away from losing authoring work for good. `undefined` is "no dialog
  // open"; otherwise this names exactly what a confirmed click would do.
  const [confirmDelete, setConfirmDelete] = useState<
    { kind: "question"; question: QuestionSummary } | { kind: "group"; group: PassageGroupSummary } | undefined
  >(undefined);
  // M4: a double-click on Delete used to fire two DELETEs for the same id —
  // the button carried no disabled state of its own and both clicks read the
  // same `confirmDelete` closure, so the second request's 404 surfaced as
  // "could not be deleted" over a delete that had, in fact, already
  // succeeded. `CandidateDataPanel.tsx`'s own confirm dialog guards the same
  // way (`disabled={… || busy}`).
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Fix round 1, finding 9: a static id collides if `BankBrowser` is ever
  // rendered twice on one page — `PreviewPane` and `QuestionEditor` both use
  // `useId()` for exactly this reason.
  const groupsHeadingId = useId();
  const confirmTitleId = useId();
  const confirmMessageId = useId();

  const load = useCallback(async () => {
    try {
      const [{ questions: rows }, workspaceTags, bankGroups] = await Promise.all([
        client.listQuestions(workspaceId, bankId, filter),
        client.listTags(workspaceId),
        client.listGroups(workspaceId, bankId),
      ]);
      setQuestions(rows);
      setTags(workspaceTags);
      setPassageGroups(bankGroups);
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "Questions could not be loaded.");
    }
  }, [client, workspaceId, bankId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fixture-review finding 12: a selection made under one filter can name
  // rows a different filter no longer shows, and a bulk action on an
  // invisible row is worse than a bulk action on none — so a filter change
  // (identity change of `filter`, which `load` already depends on) clears
  // it rather than carrying it forward.
  useEffect(() => {
    setSelected(new Set());
  }, [filter]);

  // M2 fix: this used to be a bespoke window-level Escape listener plus a
  // manual focus-on-open ref — re-implementing `useDialogKeys`, which
  // already does initial focus, Escape and (via its cleanup) returning
  // focus to the control that opened the dialog, the same shape
  // `CandidateDataPanel.tsx`'s own delete confirmation uses. `trapTab: true`
  // because this dialog claims `aria-modal="true"`, which `useDialogKeys`'s
  // own doc comment says a caller has to earn by actually trapping Tab — a
  // window listener fired regardless of focus, which is also why Escape
  // used to fire while `GroupEditor` was open on the same screen (m2); the
  // hook's `onKeyDown` is scoped to the dialog element instead.
  const confirmDialog = useDialogKeys<HTMLDivElement>(
    confirmDelete !== undefined,
    () => setConfirmDelete(undefined),
    { trapTab: true },
  );
  // `useDialogKeys` focuses the DIALOG itself (it has to: `trapTab`'s own Tab
  // stops are read off `dialogRef`, so that ref has to be the container, not
  // one button inside it). G4-01 specifically wants Cancel focused rather
  // than the container — "opening the dialog must never leave the
  // destructive action one Enter key away" — so this runs right after the
  // hook's own focus effect and wins.
  const confirmCancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (confirmDelete !== undefined) confirmCancelRef.current?.focus();
  }, [confirmDelete]);

  const groups = useMemo(() => groupedTags(tags), [tags]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setFilterField<K extends keyof Filter>(key: K, value: Filter[K] | undefined) {
    setFilter((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function toggleTagFilter(tag: string) {
    setFilterField("tag", filter.tag === tag ? undefined : tag);
  }

  async function onDelete(question: QuestionSummary) {
    setNotice(undefined);
    setExportIssues(undefined);
    try {
      await client.deleteQuestion(workspaceId, bankId, question.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(question.id);
        return next;
      });
      await load();
    } catch (cause) {
      setNotice(blockedByMessage(cause, "question"));
    }
  }

  // Fix round (whole-branch review, I1): shared by every export handler
  // below — a 422 `not_exportable` names every offending `questionId`
  // (`apps/api/src/export/bank.ts`'s `exportIssues`), which this renders
  // the way the import page already renders an import report, rather than
  // the `cause.message` generic alone.
  function handleExportFailure(cause: unknown, fallback: string): void {
    if (cause instanceof ApiError && cause.code === "not_exportable") {
      setNotice(cause.message);
      setExportIssues((cause.details as { issues?: ImportIssue[] } | undefined)?.issues ?? []);
    } else {
      setNotice(cause instanceof ApiError ? cause.message : fallback);
    }
  }

  // Task 9 (#53, P4.9): the bulk bar's export control — the whole bank with
  // nothing selected, or just the selected rows (named by `refId`, the
  // document id `?ids=` matches on, never `question.id`, the row id a URL
  // path segment uses) with something selected.
  async function onExport() {
    setNotice(undefined);
    setExportIssues(undefined);
    try {
      const ids =
        selected.size > 0 ? questions.filter((q) => selected.has(q.id)).map((q) => q.refId) : undefined;
      const doc = await client.exportBank(workspaceId, bankId, ids);
      downloadJson(doc, exportFilename(doc.name));
    } catch (cause) {
      handleExportFailure(cause, "The bank could not be exported.");
    }
  }

  // Fix round (whole-branch review, M3): `exportBank`'s single-question
  // sibling had a route, a budget line and five tests but no caller
  // anywhere in this app.
  async function onExportQuestion(question: QuestionSummary) {
    setNotice(undefined);
    setExportIssues(undefined);
    try {
      const doc = await client.exportQuestion(workspaceId, bankId, question.id);
      downloadJson(doc, exportFilename(doc.id, "question"));
    } catch (cause) {
      handleExportFailure(cause, "The question could not be exported.");
    }
  }

  async function onDeleteGroup(group: PassageGroupSummary) {
    setNotice(undefined);
    setExportIssues(undefined);
    try {
      await client.deleteGroup(workspaceId, bankId, group.id);
      await load();
    } catch (cause) {
      setNotice(blockedByMessage(cause, "group"));
    }
  }

  /** G4-01: the one place either delete actually runs, once the dialog has
   * confirmed it. M4: `confirmBusy` makes this fire at most once per open
   * dialog — a second call while the first is still in flight (a
   * double-click, or Enter repeated) is a no-op rather than a second
   * DELETE.
   *
   * Reviewer note (fix round 4): the `|| confirmBusy` guard here is belt,
   * not braces. Two clicks dispatched in the same tick both read
   * `confirmBusy` from the SAME pre-flush render — this check alone would
   * not stop them. What actually stops the second DELETE is the Delete
   * button's `disabled={confirmBusy}` below: React flushes the state
   * update from the first click before the second can be dispatched, and a
   * disabled native button fires no click at all. Keep both — do not strip
   * `disabled` believing this closure check is the defence; it is not. */
  async function confirmDeletion() {
    if (confirmDelete === undefined || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (confirmDelete.kind === "question") await onDelete(confirmDelete.question);
      else await onDeleteGroup(confirmDelete.group);
      setConfirmDelete(undefined);
    } finally {
      setConfirmBusy(false);
    }
  }

  return (
    <>
      <div className="bank-browser">
      <nav className="bank-browser__rail" aria-label="Filters">
        <MonoCaption>Filters</MonoCaption>

        <ul className="bank-browser__groups">
          {/* m1 fix: the no-group bucket used to key off `group || "ungrouped"`
              and sit wherever the `Map` happened to insert it. A tag spelled
              `ungrouped/x` produces a REAL group literally named "ungrouped",
              which collided on that key with this bucket (React rendering
              one `<li>` for what should have been two), and the bucket's
              position moved with insertion order rather than staying put.
              A prefix no real group's key can share, and a stable sort that
              always pins it last, fix both at once.

              Reviewer note (fix round 4): this comparator is not a strict
              weak ordering — compare(UNGROUPED, UNGROUPED) returns 1, not
              0, which a general-purpose sort is not supposed to see from
              a consistent comparator. It is safe only because `groups` is
              a `Map`, so there is at most one UNGROUPED entry to compare
              against itself, and because it leans on `Array.prototype.sort`
              having been stable since ES2019 to keep every REAL group in
              the Map's own insertion order. Both hold today; neither is
              enforced by a type, so do not copy this comparator somewhere
              a key can repeat. */}
          {[...groups.entries()]
            .sort(([a], [b]) => (a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : 0))
            .map(([group, groupTags]) => (
            <li key={group === UNGROUPED ? "\0ungrouped" : `tag:${group}`} className="bank-browser__group">
              <p className="bank-browser__group-label">{group === UNGROUPED ? "Ungrouped" : group}</p>
              <ul className="bank-browser__chips">
                {groupTags.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      className="bank-browser__tag-chip"
                      aria-pressed={filter.tag === tag}
                      onClick={() => toggleTagFilter(tag)}
                    >
                      {breadcrumb(tag)}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <label className="bank-browser__filter-select">
          Type
          <select
            value={filter.type ?? ""}
            onChange={(event) =>
              setFilterField("type", event.target.value ? (event.target.value as Question["type"]) : undefined)
            }
          >
            <option value="">Any</option>
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="bank-browser__filter-select">
          Difficulty
          <select
            value={filter.difficulty ?? ""}
            onChange={(event) =>
              setFilterField(
                "difficulty",
                event.target.value ? (event.target.value as Filter["difficulty"]) : undefined,
              )
            }
          >
            <option value="">Any</option>
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </label>

        <label className="bank-browser__filter-check">
          <input
            type="checkbox"
            checked={filter.unused === true}
            onChange={(event) => setFilterField("unused", event.target.checked ? true : undefined)}
          />
          Not used in any test
        </label>
      </nav>

      <div className="bank-browser__main">
        {/* Task 9 (#53, P4.9): the export control lives here whether or not
            anything is selected — selecting nothing exports the whole bank,
            the same way the filters above answer "no filter" with
            everything. `role="status"` stays on the count text alone, not
            the bar itself, so the live region announces only what changes.
            Fix round 1, finding 3 (WCAG 2.1 SC 2.5.3, Label in Name): the
            accessible name must contain the visible label verbatim, or
            speech input ("click Export bank") cannot match it — so the
            `aria-label` below only ever appends to the visible text, never
            replaces it. */}
        <div className="bank-browser__bulk-bar">
          <span role="status">{selected.size > 0 ? `${selected.size} selected` : ""}</span>
          <button
            type="button"
            className="button-secondary"
            {...(selected.size > 0 && {
              "aria-label": `Export selected (${selected.size} question${selected.size === 1 ? "" : "s"})`,
            })}
            onClick={() => void onExport()}
          >
            {selected.size > 0 ? "Export selected" : "Export bank"}
          </button>
        </div>

        {notice !== undefined && (
          <p className="bank-browser__notice" role="alert">
            {notice}
          </p>
        )}

        {/* Fix round (whole-branch review, I1): the same table shape
            the import page already renders for an import report, so an
            Author sees exactly which question(s) an export refused on and
            can deselect them (or select the rest) rather than getting a
            whole-bank refusal with no way to act on it. Keeps the Task 9
            ruling intact: export still refuses a document its own import
            would reject — this only makes the refusal actionable. */}
        {exportIssues !== undefined && exportIssues.length > 0 && (
          <table className="import-dialog__table">
            <caption className="visually-hidden">Export issues, one row per problem found</caption>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Field</th>
                <th scope="col">Problem</th>
              </tr>
            </thead>
            <tbody>
              {exportIssues.map((issue, index) => (
                <tr key={index}>
                  <td>{issue.questionId ?? `entry ${issue.index}`}</td>
                  <td>{issue.field}</td>
                  <td>{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* O-24: these two used to be bare siblings with no gap, reading as
            one run of text — `.button-row` is the shared primitive that
            fixes this once rather than per screen. */}
        <div className="button-row">
          {/* Fix round (whole-branch review, C1): the only way into
              `QuestionScreen`/`QuestionEditor` — previously nothing in this
              screen, or any screen above it, ever mounted one. */}
          <button type="button" className="button-primary button-primary--surface" onClick={onNewQuestion}>
            New question
          </button>

          <button type="button" className="button-secondary" onClick={() => setAiDraftOpen(true)}>
            Draft with AI
          </button>

          {/* `D18`: a link to a page, not a toggle that unfolds a dialog.
              `aria-expanded` went with the dialog — nothing here expands. */}
          <button type="button" className="button-secondary" onClick={onImport}>
            Import
          </button>
        </div>

        <section aria-labelledby={groupsHeadingId}>
          <div className="question-editor__answer-bar">
            <h2 id={groupsHeadingId}>Passage groups</h2>
            <button
              type="button"
              className="button-primary button-primary--surface"
              onClick={() => setEditingGroup((prev) => (prev === "new" ? undefined : "new"))}
            >
              New group
            </button>
          </div>

          {passageGroups.length > 0 && (
            // Fix round 1, finding 10: `bank-browser__groups` is the filter
            // rail's own tag-group list reset — borrowed here only because
            // the name was free, not because this list belongs to that
            // block. No rule needs this list styled yet.
            <ul>
              {passageGroups.map((group) => (
                // `group.id` is immutable once a group exists (GroupEditor
                // disables the field on edit) — Task 4's "editable content
                // as a React key" bug has no path to reach it here.
                <li key={group.id}>
                  {group.title ?? group.id} ({group.questionCount} question
                  {group.questionCount === 1 ? "" : "s"})
                  <div className="button-row">
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={`Edit passage group: ${group.title ?? group.id}`}
                      onClick={() => setEditingGroup((prev) => (prev === group ? undefined : group))}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={`Delete passage group: ${group.title ?? group.id}`}
                      onClick={() => setConfirmDelete({ kind: "group", group })}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {editingGroup !== undefined && (
            <GroupEditor
              bankId={bankId}
              workspaceId={workspaceId}
              client={client}
              {...(editingGroup !== "new" && { group: editingGroup })}
              onSaved={() => {
                setEditingGroup(undefined);
                void load();
              }}
            />
          )}
        </section>

        {/* `D21a`: the table's OWN scroll container, so `th.acts`/`td.acts`
            resolve `position: sticky` against this box rather than against
            the document. The same wrapper the test list takes, and the same
            one rule in `primitives.css` paints both. */}
        <div className="table-scroll">
          <table className="bank-browser__table">
            <thead>
              <tr>
                <th scope="col" className="bank-browser__select-col">
                  <span className="visually-hidden">Select</span>
                </th>
                <th scope="col">Prompt</th>
                <th scope="col">Type</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Tags</th>
                <th scope="col">Points</th>
                <th scope="col">Last edited</th>
                <th scope="col">Used in</th>
                <th scope="col" className="acts">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {questions.map((question) => (
                <tr key={question.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select question: ${excerpt(question.document.prompt, 60)}`}
                      checked={selected.has(question.id)}
                      onChange={() => toggleSelected(question.id)}
                    />
                  </td>
                  <td>{excerpt(question.document.prompt)}</td>
                  <td>{TYPE_LABELS[question.document.type]}</td>
                  <td>{question.document.difficulty ?? "—"}</td>
                  <td>{(question.document.tags ?? []).join(", ") || "—"}</td>
                  <td>{question.points}</td>
                  <td>{new Date(question.updatedAt).toLocaleDateString()}</td>
                  <td>{question.usedInTests}</td>
                  {/* `D21a`: the row-action gutter, whose rule lives in
                      primitives.css so every table inherits it. It is the LAST
                      cell deliberately — a cell pinned to the inline end with a
                      column after it slides over that column's content. */}
                  <td className="acts">
                    {/* O-25: these three used to be `.button-secondary` text
                        hidden at `opacity: 0` until the row was hovered —
                        unreachable on touch. Persistent icon buttons now
                        (owner's own shape: "show the icons, and on hover we
                        can make them clear"); the glyph is decorative, the
                        `aria-label` is the real name (unchanged from the
                        text-button version, fixture-review finding 10's
                        per-row excerpt still what keeps three Deletes on
                        the page from reading as one to a screen reader),
                        and `title` repeats it as the hover label. O-24:
                        `.button-row` for the gap between them. */}
                    <div className="button-row">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Edit question: ${excerpt(question.document.prompt, 60)}`}
                        title={`Edit question: ${excerpt(question.document.prompt, 60)}`}
                        onClick={() => onEditQuestion(question)}
                      >
                        <span aria-hidden="true">✎</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Export question: ${excerpt(question.document.prompt, 60)}`}
                        title={`Export question: ${excerpt(question.document.prompt, 60)}`}
                        onClick={() => void onExportQuestion(question)}
                      >
                        <span aria-hidden="true">⇩</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        data-tone="danger"
                        aria-label={`Delete question: ${excerpt(question.document.prompt, 60)}`}
                        title={`Delete question: ${excerpt(question.document.prompt, 60)}`}
                        onClick={() => setConfirmDelete({ kind: "question", question })}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {questions.length === 0 && <p className="bank-browser__empty">No questions match these filters yet.</p>}
      </div>
      </div>

      {/* G4-01: deleting a question or a passage group used to run the
          instant the row's Delete button was clicked, with no confirmation
          and no undo. Reachable without scrolling (`place-items: center`
          over the whole viewport) — the owner reported the opposite on the
          builder's own delete and this must not repeat it. */}
      {confirmDelete !== undefined && (
        <div
          className="bank-confirm"
          onClick={() => setConfirmDelete(undefined)}
        >
          <div
            className="card-hairline bank-confirm__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            aria-describedby={confirmMessageId}
            ref={confirmDialog.dialogRef}
            tabIndex={-1}
            onKeyDown={confirmDialog.onKeyDown}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="bank-confirm__title" id={confirmTitleId}>
              {confirmDelete.kind === "question" ? "Delete this question?" : "Delete this passage group?"}
            </h2>
            <p className="bank-confirm__message" id={confirmMessageId}>
              {confirmDelete.kind === "question"
                ? `"${excerpt(confirmDelete.question.document.prompt, 80)}" will be deleted for good.`
                : `"${confirmDelete.group.title ?? confirmDelete.group.id}" will be deleted for good.`}
            </p>
            <div className="button-row">
              <button type="button" className="button-secondary" ref={confirmCancelRef} onClick={() => setConfirmDelete(undefined)}>
                Cancel
              </button>
              <button type="button" className="button-danger" disabled={confirmBusy} onClick={() => void confirmDeletion()}>
                {confirmBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DraftAiModal
        client={client}
        workspaceId={workspaceId}
        bankId={bankId}
        isOpen={isAiDraftOpen}
        onClose={() => setAiDraftOpen(false)}
        onSuccess={() => {
          setAiDraftOpen(false);
          void load();
        }}
      />
    </>
  );
}
