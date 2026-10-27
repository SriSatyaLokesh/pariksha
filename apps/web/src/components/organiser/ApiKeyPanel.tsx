import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, type Action, type ApiClient, type ApiKey } from "../../lib/api";
import { CardHairline } from "../CardHairline";
import { TextField } from "../TextField";
import { ByokSettings } from "../admin/ByokSettings";

// Phase 8d Task 2: the organiser's scoped-API-key CRUD screen (`K25`,
// `K26`, `KG5`). Built from the same tokens and primitives
// `WebhookPanel.tsx` already established for this exact shape of screen —
// a create form, a one-time secret reveal, a list with a confirmed revoke
// — so this adds no new colour and no new visual language. `.webhook-secret`
// and `.webhook-list__actions` (admin.css) are reused as-is: both are pure
// token-driven layout, named after their first caller rather than their
// one caller, and a second one here costs no new rule.
//
// `SCOPE_GROUPS` below hand-lists every action except `K26`'s two
// forbidden ones (`keys.manage`, `members.manage`) — the create form never
// offers either as a checkbox, so there is no "you can't have this one"
// error to design for; the route's own 422 stays as the defense-in-depth
// behind a client that should never send it. Coverage is proven by a test
// (`api-key-panel.test.tsx`'s "SCOPE_GROUPS covers exactly API_KEY_SCOPES"),
// not the compiler — see the note on `SCOPE_GROUPS` itself.

const SCOPE_LABEL: Readonly<Record<Action, string>> = {
  "members.manage": "Manage members",
  "workspace.settings": "Workspace settings",
  "tests.edit": "Edit tests",
  "banks.edit": "Edit question banks",
  "tests.publish": "Publish tests",
  "candidates.manage": "Manage candidates",
  "attempts.monitor": "Monitor attempts",
  "candidates.read_personal": "View candidate details",
  "attempts.read_evidence": "View proctoring evidence",
  "attempts.grade": "Grade attempts",
  "results.export": "Export results",
  "candidates.delete": "Delete candidates",
  "keys.manage": "Manage API keys",
};

// Eleven checkboxes in one flat list is a wall nobody scans; grouped under
// a `<legend>` each, the way the PRD's own permission matrix reads top to
// bottom. `ACTIONS`'s own order inside each group.
//
// MINOR-2 (whole-branch review): this used to claim "`satisfies` below
// would fail the build if a scope were left out" — there is no `satisfies`
// operator anywhere in this file, and a false claim about a safety net is
// worse than none. Coverage that `SCOPE_GROUPS` lists every action `K26`
// does not forbid, and none twice, is proven by a test
// (`SCOPE_GROUPS_FLAT`, exported below, and `api-key-panel.test.tsx`'s own
// assertion against it) — not the compiler.
const SCOPE_GROUPS: readonly { title: string; scopes: Action[] }[] = [
  { title: "Workspace", scopes: ["workspace.settings"] },
  { title: "Tests & banks", scopes: ["tests.edit", "banks.edit", "tests.publish"] },
  { title: "Candidates", scopes: ["candidates.manage", "candidates.read_personal", "candidates.delete"] },
  { title: "Attempts & proctoring", scopes: ["attempts.monitor", "attempts.read_evidence", "attempts.grade"] },
  { title: "Results", scopes: ["results.export"] },
];

export function ApiKeyPanel({ workspaceId, client }: { workspaceId: string; client: ApiClient }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Action[]>([]);
  // Three errors, each rendered where the thing it is about lives — the
  // same split `WebhookPanel.tsx`'s own MINOR-6 fix settled on: a failed
  // list load or revoke is not about the Name field, so it never becomes
  // that field's `aria-invalid`.
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [scopesError, setScopesError] = useState<string | undefined>(undefined);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  // The secret this screen's own `createApiKey` call just answered — never
  // re-fetched, because `listApiKeys` never carries it (`KG5`). Cleared the
  // moment the organiser revokes that same key, or creates another: there
  // is only ever one reveal on screen.
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.listApiKeys(workspaceId);
      setKeys(res.keys);
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "Keys could not be loaded.");
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleScope(scope: Action) {
    setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  }

  async function onSubmit(formEvent: FormEvent) {
    formEvent.preventDefault();
    setNameError(undefined);
    setScopesError(undefined);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError("A key needs a name, so you can tell it apart from the next one.");
      return;
    }
    if (scopes.length === 0) {
      setScopesError("Select at least one scope.");
      return;
    }
    setBusy(true);
    try {
      const created = await client.createApiKey(workspaceId, { name: trimmed, scopes });
      setRevealed({ id: created.id, secret: created.secret });
      setCopied(false);
      setName("");
      setScopes([]);
      await load();
    } catch (cause) {
      // Creation only ever fails on this screen over the scopes (K26's
      // 422, or the creator's-own-subset 403) — never over the name — so
      // the error belongs beside the checkboxes, not the Name field.
      setScopesError(cause instanceof ApiError ? cause.message : "The key could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(keyId: string) {
    if (busyRowId !== null) return;
    setBusyRowId(keyId);
    try {
      await client.revokeApiKey(workspaceId, keyId);
      setConfirmingRevoke(null);
      if (revealed?.id === keyId) setRevealed(null);
      await load();
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "The key could not be revoked. Try again.");
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <>
      {panelError !== undefined && (
        <p className="release-panel__risk" role="alert">
          <span aria-hidden="true">⚠ </span>
          {panelError}
        </p>
      )}

      <CardHairline className="organiser__panel">
        <form className="organiser-form" onSubmit={(formEvent) => void onSubmit(formEvent)} noValidate>
          <TextField
            id="api-key-name"
            label="Name"
            help="A name you'll recognise later — the system this key is for, say."
            error={nameError}
            value={name}
            onChange={setName}
          />

          {SCOPE_GROUPS.map((group) => (
            <fieldset className="release-panel__group" key={group.title}>
              <legend>{group.title}</legend>
              {group.scopes.map((scope) => (
                <div className="field" key={scope}>
                  <label className="field-label field-choice" htmlFor={`api-key-scope-${scope}`}>
                    <input
                      type="checkbox"
                      id={`api-key-scope-${scope}`}
                      checked={scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    {SCOPE_LABEL[scope]}
                  </label>
                </div>
              ))}
            </fieldset>
          ))}
          {scopesError !== undefined && (
            <p className="release-panel__risk" role="alert">
              <span aria-hidden="true">⚠ </span>
              {scopesError}
            </p>
          )}
          <p className="release-panel__fact">
            A key can only ever do what you can do — it never reaches further than your own role.
          </p>
          {/* MAJOR-3 (whole-branch review): a key is an independent
              credential once minted — it is not revoked by revoking or
              demoting the member who created it. Stated here because the
              product does not yet enforce it (tracked as a follow-up:
              recording who created each key, and revoking their keys when
              they are). */}
          <p className="release-panel__fact">
            Revoking or demoting a member does not revoke the keys they created — revoke those keys yourself before
            removing someone from this workspace.
          </p>

          <button type="submit" className="button-primary button-primary--surface" disabled={busy}>
            Create key
          </button>
        </form>
      </CardHairline>

      {revealed !== null && (
        <div className="card-hairline release-panel__group" role="status">
          <p className="release-panel__fact">
            <strong>This key is shown once.</strong> Store it now — Pariksha cannot show it to you again, and
            creating or revoking another key clears it from this screen.
          </p>
          <code className="webhook-secret">{revealed.secret}</code>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(revealed.secret).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            Copy the key
          </button>
          {/* MINOR-5 (whole-branch review): no `role="status"` here — the
              outer card above already is one, and a `role="status"` nested
              inside another has undefined announcement behaviour. One live
              region, not two. */}
          <p className="release-panel__fact">{copied ? "Copied." : ""}</p>
        </div>
      )}

      {keys.length === 0 ? (
        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">No API keys yet</h2>
          <p className="organiser-empty__body">
            Create one above to let another system authenticate as you, within the scopes you choose.
          </p>
        </CardHairline>
      ) : (
        <div className="organiser__panel">
          {keys.map((key) => (
            <CardHairline className="release-panel__group" key={key.id}>
              <p className="release-panel__fact">{key.name}</p>
              <p className="release-panel__fact">
                {key.scopes.map((scope) => SCOPE_LABEL[scope]).join(", ")}
                {" — "}
                {key.revokedAt !== null ? "Revoked" : "Active"}
              </p>
              {/* MAJOR-2 (whole-branch review): the column the API already
                  wrote and paid 86,400 writes/day for showed up nowhere on
                  this screen. Same `toLocaleDateString()` the rest of the
                  organiser app uses for a stored epoch-ms timestamp
                  (`tests.tsx`'s version table). */}
              <p className="release-panel__fact">
                {key.lastUsedAt === null ? "Never used" : `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`}
              </p>
              {key.revokedAt === null && (
                <div className="webhook-list__actions">
                  {confirmingRevoke === key.id ? (
                    <>
                      <button
                        type="button"
                        className="button-secondary"
                        aria-label={`Confirm revoking the key ${key.name}`}
                        disabled={busyRowId !== null}
                        onClick={() => void onRevoke(key.id)}
                      >
                        Confirm revoke
                      </button>
                      <button type="button" className="button-secondary" onClick={() => setConfirmingRevoke(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={`Revoke the key ${key.name}`}
                      disabled={busyRowId !== null}
                      onClick={() => setConfirmingRevoke(key.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              )}
            </CardHairline>
          ))}
        </div>
      )}

      <div className="byok-section">
        <ByokSettings client={client} workspaceId={workspaceId} />
      </div>
    </>
  );
}

/** `SCOPE_GROUPS` flattened, for the test that proves it covers exactly
 * `API_KEY_SCOPES` — no action left ungrouped, no forbidden one snuck in. */
export const SCOPE_GROUPS_FLAT: readonly Action[] = SCOPE_GROUPS.flatMap((g) => g.scopes);
