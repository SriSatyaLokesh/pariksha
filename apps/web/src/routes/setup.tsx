import { useRef, useState, type FormEvent } from "react";
import { CardHairline } from "../components/CardHairline";
import { MonoCaption } from "../components/MonoCaption";
import { ScreenSplit } from "../components/organiser/ScreenSplit";
import { TextField } from "../components/TextField";
import { ApiError, type ApiClient } from "../lib/api";

// Screen 2 of 3: the first-run wizard. It runs once per instance, for the
// person who happens to be signed in when the instance still has no owner —
// POST /api/v1/setup/complete makes them the owner and creates their first
// workspace.
//
// "The wizard shows one field at a time", and the API contract exposes
// exactly one thing to ask for: the workspace name. The owner is taken from
// the current sign-in, so there is no name, no email and no password to
// collect. One field, one step, stated as such rather than padded out with
// questions the API would throw away.

const NAME_HELP =
  "The college, department, team or class this instance is for. You can rename it later.";
// Says what a name looks like, with an example. Never "Invalid format".
const NAME_ERROR =
  "A workspace name is 1 to 60 characters — for example, Placement cell.";
const MAX_NAME = 60;

export function Setup({
  client,
  onComplete,
}: {
  client: ApiClient;
  onComplete: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const workspaceName = name.trim();
    if (workspaceName.length === 0 || workspaceName.length > MAX_NAME) {
      setError(NAME_ERROR);
      nameRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await client.completeSetup({ workspaceName });
      onComplete();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "The workspace could not be created. Try again in a moment.",
      );
      setBusy(false);
    }
  }

  return (
    // `D18`: the same split as sign-in, under the headline of this moment —
    // an instance that has no owner yet, which happens once.
    <ScreenSplit headline="This instance has no owner yet. Naming a workspace makes you one.">
      <MonoCaption>First run · step 1 of 1</MonoCaption>
      <h1 className="organiser__title">Name your first workspace</h1>
      <p className="organiser__lead">
        A workspace holds question banks, tests and the people who work on them.
        Creating it makes you the owner of this instance.
      </p>

      <CardHairline className="organiser__panel">
        <form
          className="organiser-form"
          onSubmit={(event) => void onSubmit(event)}
          noValidate
        >
          <TextField
            id="workspace-name"
            label="Workspace name"
            help={NAME_HELP}
            error={error}
            value={name}
            onChange={setName}
            autoComplete="organization"
            inputRef={nameRef}
          />
          <button
            type="submit"
            className="button-primary button-primary--surface"
            disabled={busy}
          >
            Create workspace
          </button>
        </form>
      </CardHairline>
    </ScreenSplit>
  );
}
