import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { QUESTION_TYPES, type Question } from "@pariksha/core";
import { ApiError, type ApiClient, type PassageGroupSummary, type QuestionSummary } from "../lib/api";
import { MonoCaption } from "../components/MonoCaption";
import { OrganiserHeader } from "../components/OrganiserHeader";
import { GroupEditor } from "../components/authoring/GroupEditor";
import { ImportDialog } from "../components/authoring/ImportDialog";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

// Screen 2 of the bank-first flow (docs/design.md, Flow 1): the bank
// browser. UX-04 wants a table, not a card grid, with type/tag/difficulty/
// "not used in any test" filters in a left rail and a checkbox per row for
// the bulk affordances Tasks 3-9 hang off `selected`. UX-03's hierarchical
// tags (`sdlc/agile`) group that rail by the text before the first `/` and
// render the whole tag as a breadcrumb chip. UX-05 refuses a delete a
// published test holds, naming the tests.

/** Tags with a `/` group the rail by their text before the first one
 * (UX-03); a tag with no `/` has no group and is not shown there — it still
 * reaches `listWorkspaceTags`' autocomplete, which this screen does not
 * build (no free-text tag editor exists yet; that is Tasks 3-6's). */
function groupedTags(tags: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const tag of tags) {
    const slash = tag.indexOf("/");
    if (slash === -1) continue;
    const group = tag.slice(0, slash);
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
function exportFilename(bankName: string): string {
  const slug = bankName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${slug || "bank"}.json`;
}

function downloadJson(doc: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
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
  actorEmail,
  onSignOut,
  onBack,
  onNewQuestion,
  onEditQuestion,
}: {
  bankId: string;
  workspaceId: string;
  client: ApiClient;
  actorEmail: string;
  onSignOut: () => void;
  onBack: () => void;
  onNewQuestion: () => void;
  onEditQuestion: (question: QuestionSummary) => void;
}) {
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [passageGroups, setPassageGroups] = useState<PassageGroupSummary[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>({});
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // `undefined`: no passage-group form open. `"new"`: the "New group" form.
  // A `PassageGroupSummary`: editing that existing group.
  const [editingGroup, setEditingGroup] = useState<PassageGroupSummary | "new" | undefined>(undefined);
  // Fix round 1 (this review round), finding 4: Task 7's ImportDialog had no
  // host — unreachable from the running app. A toggle next to "New group"
  // is the smallest wiring; Task 8 (CSV/GIFT) and Task 9 (export) are what
  // this screen's import/export affordances actually grow into later.
  const [importing, setImporting] = useState(false);
  // Fix round 1, finding 9: a static id collides if `BankBrowser` is ever
  // rendered twice on one page — `PreviewPane` and `QuestionEditor` both use
  // `useId()` for exactly this reason.
  const groupsHeadingId = useId();

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
    try {
      await client.deleteQuestion(workspaceId, bankId, question.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(question.id);
        return next;
      });
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "question_in_use") {
        const blockedBy = (cause.details as { blockedBy?: string[] } | undefined)?.blockedBy ?? [];
        setNotice(`This question is used by: ${blockedBy.join(", ")}.`);
      } else {
        setNotice(cause instanceof ApiError ? cause.message : "The question could not be deleted.");
      }
    }
  }

  // Task 9 (#53, P4.9): the bulk bar's export control — the whole bank with
  // nothing selected, or just the selected rows (named by `refId`, the
  // document id `?ids=` matches on, never `question.id`, the row id a URL
  // path segment uses) with something selected.
  async function onExport() {
    setNotice(undefined);
    try {
      const ids =
        selected.size > 0 ? questions.filter((q) => selected.has(q.id)).map((q) => q.refId) : undefined;
      const doc = await client.exportBank(workspaceId, bankId, ids);
      downloadJson(doc, exportFilename(doc.name));
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "The bank could not be exported.");
    }
  }

  async function onDeleteGroup(group: PassageGroupSummary) {
    setNotice(undefined);
    try {
      await client.deleteGroup(workspaceId, bankId, group.id);
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "group_in_use") {
        const names = (cause.details as { questions?: string[] } | undefined)?.questions ?? [];
        setNotice(`This group is used by: ${names.join(", ")}.`);
      } else {
        setNotice(cause instanceof ApiError ? cause.message : "The group could not be deleted.");
      }
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <OrganiserHeader email={actorEmail} onSignOut={onSignOut} onBack={onBack} backLabel="Back to banks" />
      <div id="main-content" className="bank-browser">
      <nav className="bank-browser__rail" aria-label="Filters">
        <MonoCaption>Filters</MonoCaption>

        <ul className="bank-browser__groups">
          {[...groups.entries()].map(([group, groupTags]) => (
            <li key={group} className="bank-browser__group">
              <p className="bank-browser__group-label">{group}</p>
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
                {type}
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

        {/* Fix round (whole-branch review, C1): the only way into
            `QuestionScreen`/`QuestionEditor` — previously nothing in this
            screen, or any screen above it, ever mounted one. */}
        <button type="button" className="button-primary button-primary--surface" onClick={onNewQuestion}>
          New question
        </button>

        <button
          type="button"
          className="button-secondary"
          aria-expanded={importing}
          onClick={() => setImporting((prev) => !prev)}
        >
          {importing ? "Cancel import" : "Import"}
        </button>

        {importing && (
          <ImportDialog
            workspaceId={workspaceId}
            bankId={bankId}
            client={client}
            onImported={() => {
              setImporting(false);
              void load();
            }}
          />
        )}

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
                    onClick={() => void onDeleteGroup(group)}
                  >
                    Delete
                  </button>
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
              <th scope="col">
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
                <td>{question.document.type}</td>
                <td>{question.document.difficulty ?? "—"}</td>
                <td>{(question.document.tags ?? []).join(", ") || "—"}</td>
                <td>{question.points}</td>
                <td>{new Date(question.updatedAt).toLocaleDateString()}</td>
                <td>{question.usedInTests}</td>
                <td>
                  <button
                    type="button"
                    className="button-secondary"
                    aria-label={`Edit question: ${excerpt(question.document.prompt, 60)}`}
                    onClick={() => onEditQuestion(question)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    // Fixture-review finding 10: "Delete" alone repeats once
                    // per row, which a screen reader listing buttons on the
                    // page hears as N identical entries — the per-row prompt
                    // excerpt (same idea as the checkbox's own aria-label
                    // above) makes each one distinct.
                    aria-label={`Delete question: ${excerpt(question.document.prompt, 60)}`}
                    onClick={() => void onDelete(question)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {questions.length === 0 && <p className="bank-browser__empty">No questions match these filters yet.</p>}
      </div>
      </div>
    </>
  );
}
