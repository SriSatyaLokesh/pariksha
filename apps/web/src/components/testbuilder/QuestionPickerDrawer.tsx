import { useCallback, useEffect, useId, useState } from "react";
import { QUESTION_TYPES, type Difficulty, type QuestionType } from "@pariksha/core";
import { ApiError, type ApiClient, type Bank, type QuestionSummary } from "../../lib/api";
import { TextField } from "../TextField";

// UX-14: a drawer over the builder, with the bank browser's own filters
// (type/difficulty/tag/search — `BankBrowser`, apps/web/src/routes/bank.tsx)
// and a running "N selected · M points" footer. Not `aria-modal`: like
// `ImportDialog`'s own dialog, nothing here traps focus, so claiming
// "modal" would be a lie the keyboard does not back up.
//
// `client`/`workspaceId` are not in the plan's own signature sketch — a
// drawer that lists and filters a workspace's questions cannot do either
// without a way to ask for them. Added here the same way `SectionList`
// needed them for its own bank lookups; every name the plan did give
// (`bankId`, `selected`, `onConfirm`, `onCancel`) is unchanged.
//
// `bankId: null` means no bank is chosen yet (a `fixed` source names no
// bank of its own — it mixes rows from any bank by id) — the drawer's own
// first screen is picking one, not a second drawer.
export function QuestionPickerDrawer({
  bankId: initialBankId,
  selected,
  onConfirm,
  onCancel,
  client,
  workspaceId,
}: {
  bankId: string | null;
  selected: readonly string[];
  onConfirm: (questionIds: string[]) => void;
  onCancel: () => void;
  client: ApiClient;
  workspaceId: string;
}) {
  const headingId = useId();
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [bankId, setBankId] = useState<string | null>(initialBankId);
  const [questions, setQuestions] = useState<QuestionSummary[] | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected));
  const [pointsById, setPointsById] = useState<Map<string, number>>(new Map());
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [type, setType] = useState("");
  const [difficulty, setDifficulty] = useState("");

  useEffect(() => {
    void client.listBanks(workspaceId).then(setBanks);
  }, [client, workspaceId]);

  const load = useCallback(async () => {
    if (bankId === null) return;
    try {
      const page = await client.listQuestions(workspaceId, bankId, {
        ...(type && { type: type as QuestionType }),
        ...(difficulty && { difficulty: difficulty as Difficulty }),
        ...(tag && { tag }),
        ...(search && { search }),
      });
      setQuestions(page.questions);
      setPointsById((prev) => {
        const next = new Map(prev);
        for (const q of page.questions) next.set(q.id, q.points);
        return next;
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Questions could not be loaded.");
    }
  }, [client, workspaceId, bankId, type, difficulty, tag, search]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPoints = [...picked].reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0);

  return (
    <div role="dialog" aria-labelledby={headingId} className="picker-drawer">
      <h2 id={headingId}>Add questions</h2>

      {bankId === null ? (
        <div className="field">
          <label className="field-label" htmlFor="picker-bank">
            Bank
          </label>
          <select
            id="picker-bank"
            className="text-input"
            value=""
            onChange={(event) => setBankId(event.target.value || null)}
          >
            <option value="">Choose a bank…</option>
            {(banks ?? []).map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <form
            className="picker-drawer__filters"
            role="search"
            aria-label="Filter questions"
            onSubmit={(event) => event.preventDefault()}
          >
            <TextField id="picker-search" label="Search" help="By prompt text." value={search} onChange={setSearch} />
            <TextField id="picker-tag" label="Tag" help="Exact tag match." value={tag} onChange={setTag} />
            <div className="field">
              <label className="field-label" htmlFor="picker-type">
                Type
              </label>
              <select id="picker-type" className="text-input" value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">All</option>
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="picker-difficulty">
                Difficulty
              </label>
              <select
                id="picker-difficulty"
                className="text-input"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
              >
                <option value="">All</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </form>

          {error !== undefined && (
            <p className="field-error" role="alert">
              <span aria-hidden="true">⚠</span> <span>{error}</span>
            </p>
          )}

          <ul className="picker-drawer__list">
            {(questions ?? []).map((q) => {
              const checkboxId = `picker-q-${q.id}`;
              return (
                <li key={q.id} className="picker-drawer__row">
                  <input
                    type="checkbox"
                    id={checkboxId}
                    checked={picked.has(q.id)}
                    onChange={() => toggle(q.id)}
                  />
                  <label htmlFor={checkboxId}>
                    {q.document.prompt} <span className="picker-drawer__points">({q.points} pts)</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="picker-drawer__footer" role="status">
        {picked.size} selected · {totalPoints} points
      </p>

      <div className="picker-drawer__actions">
        <button type="button" className="button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button-primary" onClick={() => onConfirm([...picked])}>
          Confirm
        </button>
      </div>
    </div>
  );
}
