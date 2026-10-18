import { useCallback, useEffect, useMemo, useState } from "react";
import { QUESTION_TYPES, type Question } from "@pariksha/core";
import { ApiError, type ApiClient, type QuestionSummary } from "../lib/api";
import { MonoCaption } from "../components/MonoCaption";

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
}: {
  bankId: string;
  workspaceId: string;
  client: ApiClient;
}) {
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<Filter>({});
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [{ questions: rows }, workspaceTags] = await Promise.all([
        client.listQuestions(workspaceId, bankId, filter),
        client.listTags(workspaceId),
      ]);
      setQuestions(rows);
      setTags(workspaceTags);
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "Questions could not be loaded.");
    }
  }, [client, workspaceId, bankId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <div className="bank-browser">
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
        {selected.size > 0 && (
          <div className="bank-browser__bulk-bar" role="status">
            {selected.size} selected
          </div>
        )}

        {notice !== undefined && (
          <p className="bank-browser__notice" role="alert">
            {notice}
          </p>
        )}

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
                  <button type="button" className="button-secondary" onClick={() => void onDelete(question)}>
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
  );
}
