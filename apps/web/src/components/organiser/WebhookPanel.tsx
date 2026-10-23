import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, WEBHOOK_EVENTS, type ApiClient, type Webhook, type WebhookEvent } from "../../lib/api";
import { CardHairline } from "../CardHairline";
import { TextField } from "../TextField";

// Phase 8d Task 1: the organiser's webhook CRUD screen (`K35`, `K36`,
// `KG5`). Built entirely from tokens and primitives the test builder's
// Results panel (`testbuilder/ResultsPanel.tsx`) already established and
// `admin-main.tsx` already loads for every organiser screen —
// `.release-panel__group`/`.release-panel__fact` for the fieldsets and the
// cost line, `.organiser-form`/`.field`/`TextField` for the create form,
// `.organiser-empty` for the empty state, `.button-secondary` for every
// action — so this screen adds no new colour and no new visual language.
// `.webhook-secret` and `.webhook-list__actions` (admin.css) are the only
// two rules this task adds, and both are declared in tokens, not literals.

const EVENT_LABEL: Readonly<Record<WebhookEvent, string>> = {
  "attempt.started": "Attempt started",
  "attempt.submitted": "Attempt submitted",
  "test.closed": "Test closed",
};

export function WebhookPanel({ workspaceId, client }: { workspaceId: string; client: ApiClient }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  // Absent on the `node` target (`K36`) — the route omits the field rather
  // than sending `null`, and `undefined` here is what tells the cost line
  // not to render at all.
  const [costPerCandidate, setCostPerCandidate] = useState<number | undefined>(undefined);

  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // The secret this screen's own `createWebhook` call just answered —
  // never re-fetched, because `listWebhooks` never carries it (`KG5`).
  // Cleared the moment the organiser revokes that same webhook, or creates
  // another: there is only ever one reveal on screen.
  const [revealed, setRevealed] = useState<{ id: string; signingSecret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await client.listWebhooks(workspaceId);
      setWebhooks(res.webhooks);
      setCostPerCandidate(res.costPerCandidate);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Webhooks could not be loaded.");
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleEvent(event: WebhookEvent) {
    setEvents((current) => (current.includes(event) ? current.filter((e) => e !== event) : [...current, event]));
  }

  async function onSubmit(formEvent: FormEvent) {
    formEvent.preventDefault();
    const target = url.trim();
    if (target.length === 0) {
      setError("A webhook needs an endpoint URL.");
      return;
    }
    if (events.length === 0) {
      setError("Select at least one event.");
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      const created = await client.createWebhook(workspaceId, { url: target, events });
      setRevealed({ id: created.id, signingSecret: created.signingSecret });
      setCopied(false);
      setUrl("");
      setEvents([]);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The webhook could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleActive(webhook: Webhook) {
    try {
      await client.setWebhookActive(workspaceId, webhook.id, !webhook.active);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "That could not be changed. Try again.");
    }
  }

  async function onRevoke(webhookId: string) {
    try {
      await client.deleteWebhook(workspaceId, webhookId);
      setConfirmingDelete(null);
      if (revealed?.id === webhookId) setRevealed(null);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The webhook could not be revoked. Try again.");
    }
  }

  return (
    <>
      <CardHairline className="organiser__panel">
        <form className="organiser-form" onSubmit={(formEvent) => void onSubmit(formEvent)} noValidate>
          <TextField
            id="webhook-url"
            label="Endpoint URL"
            help="Pariksha sends a signed JSON POST here for every event you select below."
            error={error}
            value={url}
            onChange={setUrl}
          />

          <fieldset className="release-panel__group">
            <legend>Events</legend>
            {WEBHOOK_EVENTS.map((event) => (
              <div className="field" key={event}>
                <label className="field-label" htmlFor={`webhook-event-${event}`}>
                  {EVENT_LABEL[event]}
                </label>
                <input
                  type="checkbox"
                  id={`webhook-event-${event}`}
                  checked={events.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
              </div>
            ))}
            {/* `K35`: `estimateCost`'s "webhooks" line, read with exactly
                one active hook — the marginal cost of turning this one on,
                shown before it is saved. `K36`: absent entirely on the
                `node` target, not a zero. */}
            {costPerCandidate !== undefined && (
              <p className="release-panel__fact">
                {`Once active, this webhook costs ≈${String(costPerCandidate)} request per candidate.`}
              </p>
            )}
          </fieldset>

          <button type="submit" className="button-primary button-primary--surface" disabled={busy}>
            Create webhook
          </button>
        </form>
      </CardHairline>

      {revealed !== null && (
        <CardHairline className="release-panel__group">
          <p className="release-panel__fact">
            <strong>This signing secret is shown once.</strong> Store it now — Pariksha cannot show it to you
            again, and creating or revoking another webhook clears it from this screen.
          </p>
          <code className="webhook-secret">{revealed.signingSecret}</code>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(revealed.signingSecret).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            Copy the signing secret
          </button>
          <p role="status" aria-label="Signing-secret clipboard" className="release-panel__fact">
            {copied ? "Copied." : ""}
          </p>
        </CardHairline>
      )}

      {webhooks.length === 0 ? (
        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">No webhooks yet</h2>
          <p className="organiser-empty__body">
            Create one above to let another system learn when an attempt starts, is submitted, or a test closes.
          </p>
        </CardHairline>
      ) : (
        <div className="organiser__panel">
          {webhooks.map((webhook) => (
            <CardHairline className="release-panel__group" key={webhook.id}>
              <p className="release-panel__fact">{webhook.url}</p>
              <p className="release-panel__fact">
                {webhook.events.map((event) => EVENT_LABEL[event]).join(", ")}
                {" — "}
                {webhook.active ? "Active" : "Paused"}
              </p>
              <div className="webhook-list__actions">
                <button type="button" className="button-secondary" onClick={() => void onToggleActive(webhook)}>
                  {webhook.active ? "Pause" : "Resume"}
                </button>
                {confirmingDelete === webhook.id ? (
                  <>
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={`Confirm revoking the webhook to ${webhook.url}`}
                      onClick={() => void onRevoke(webhook.id)}
                    >
                      Confirm revoke
                    </button>
                    <button type="button" className="button-secondary" onClick={() => setConfirmingDelete(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    aria-label={`Revoke the webhook to ${webhook.url}`}
                    onClick={() => setConfirmingDelete(webhook.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </CardHairline>
          ))}
        </div>
      )}
    </>
  );
}
