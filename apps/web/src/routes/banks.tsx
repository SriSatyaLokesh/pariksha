import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type ApiClient, type Bank } from "../lib/api";
import { CardHairline } from "../components/CardHairline";
import { MonoCaption } from "../components/MonoCaption";
import { TextField } from "../components/TextField";

// Screen 1 of the bank-first flow (docs/design.md, Flow 1): the bank list.
// UX-02: a bank is created with a name and nothing else required —
// description, licence and tags are editable later, from the browser this
// list opens into (routes/bank.tsx).

const NAME_HELP = "You can add a description, a licence and tags once it exists.";
const NAME_ERROR = "A bank name is 1 to 200 characters.";
const MAX_NAME = 200;

export function BankList({
  workspaceId,
  client,
  onOpenBank,
}: {
  workspaceId: string;
  client: ApiClient;
  onOpenBank: (bankId: string) => void;
}) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setBanks(await client.listBanks(workspaceId));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Banks could not be loaded.");
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const bankName = name.trim();
    if (bankName.length === 0 || bankName.length > MAX_NAME) {
      setError(NAME_ERROR);
      nameRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await client.createBank(workspaceId, { name: bankName });
      setName("");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The bank could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="organiser organiser--wide">
      <MonoCaption>Question banks</MonoCaption>
      <h1 className="organiser__title">Banks</h1>

      <CardHairline className="organiser__panel">
        <form className="organiser-form" onSubmit={(event) => void onSubmit(event)} noValidate>
          <TextField
            id="bank-name"
            label="Bank name"
            help={NAME_HELP}
            error={error}
            value={name}
            onChange={setName}
            inputRef={nameRef}
          />
          <button type="submit" className="button-primary button-primary--surface" disabled={busy}>
            Create bank
          </button>
        </form>
      </CardHairline>

      {banks.length === 0 ? (
        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">No banks yet</h2>
          <p className="organiser-empty__body">Create one above, then start writing questions into it.</p>
        </CardHairline>
      ) : (
        <ul className="bank-list">
          {banks.map((bank) => (
            <li key={bank.id}>
              <button type="button" className="bank-list__item" onClick={() => onOpenBank(bank.id)}>
                <span className="bank-list__name">{bank.name}</span>
                <span className="bank-list__count">{bank.questionCount} questions</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
