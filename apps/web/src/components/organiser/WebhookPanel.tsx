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

// MAJOR-3 (whole-branch review): "Attempt started" used to be offered
// here with no route ever firing it — `WEBHOOK_EVENTS` (`lib/api.ts`) no
// longer lists it, so this record's keys now exhaust every event there is.
const EVENT_LABEL: Readonly<Record<WebhookEvent, string>> = {
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
  // MINOR-6 (whole-branch review): one shared `error` used to be rendered
  // as `TextField`'s error for Endpoint URL no matter what caused it — a
  // failed list load, pause, resume or revoke all showed up attached to
  // an empty, untouched URL field, and `aria-invalid="true"` followed it
  // there. Three errors now, each rendered where the thing it is about
  // lives: `urlError` stays the field error (empty-URL validation and the
  // create call's own SSRF refusal both are genuinely about the URL),
  // `eventsError` sits beside the event `<fieldset>`, and `panelError`
  // covers everything that is about the panel as a whole, not one field.
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [eventsError, setEventsError] = useState<string | undefined>(undefined);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // MINOR-8: guards Pause/Resume/Revoke against a double-click firing a
  // second request (and, for Revoke, a second `DELETE` whose 404 would
  // surface as a failure after the first call already succeeded). One id
  // at a time, since these actions are never meant to run concurrently.
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

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
      setPanelError(cause instanceof ApiError ? cause.message : "Webhooks could not be loaded.");
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
    setUrlError(undefined);
    setEventsError(undefined);
    const target = url.trim();
    if (target.length === 0) {
      setUrlError("A webhook needs an endpoint URL.");
      return;
    }
    if (events.length === 0) {
      setEventsError("Select at least one event.");
      return;
    }
    setBusy(true);
    try {
      const created = await client.createWebhook(workspaceId, { url: target, events });
      setRevealed({ id: created.id, signingSecret: created.signingSecret });
      setCopied(false);
      setUrl("");
      setEvents([]);
      await load();
    } catch (cause) {
      // Genuinely a field error: creation only ever fails on this screen
      // over the URL (the SSRF refusal, `webhooks.test.ts`'s `422`), so it
      // belongs on the field it is about, not the panel-wide region.
      setUrlError(cause instanceof ApiError ? cause.message : "The webhook could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleActive(webhook: Webhook) {
    if (busyRowId !== null) return; // MINOR-8: already mid-request
    setBusyRowId(webhook.id);
    try {
      await client.setWebhookActive(workspaceId, webhook.id, !webhook.active);
      await load();
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "That could not be changed. Try again.");
    } finally {
      setBusyRowId(null);
    }
  }

  async function onRevoke(webhookId: string) {
    if (busyRowId !== null) return; // MINOR-8: already mid-request
    setBusyRowId(webhookId);
    try {
      await client.deleteWebhook(workspaceId, webhookId);
      setConfirmingDelete(null);
      if (revealed?.id === webhookId) setRevealed(null);
      await load();
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "The webhook could not be revoked. Try again.");
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <>
      {/* MINOR-6: the panel-wide region — list load, pause/resume and
          revoke failures — separate from the create form's own field
          errors below, so a failed revoke no longer renders as the URL
          field being invalid. */}
      {panelError !== undefined && (
        <p className="release-panel__risk" role="alert">
          <span aria-hidden="true">⚠ </span>
          {panelError}
        </p>
      )}

      <CardHairline className="organiser__panel">
        <form className="organiser-form" onSubmit={(formEvent) => void onSubmit(formEvent)} noValidate>
          <TextField
            id="webhook-url"
            label="Endpoint URL"
            help="Pariksha sends a signed JSON POST here for every event you select below."
            error={urlError}
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
            {/* MINOR-6: was `error` — the shared field error — rendered
                nowhere a screen reader would connect it to this fieldset.
                Now its own alert, beside the control it is actually about. */}
            {eventsError !== undefined && (
              <p className="release-panel__risk" role="alert">
                <span aria-hidden="true">⚠ </span>
                {eventsError}
              </p>
            )}
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
        // MINOR-7: no live region and no focus move meant a screen reader
        // never heard the one credential this screen ever shows appear.
        // `role="status"` on the card itself announces its arrival the
        // same way the existing "Copied." paragraph already announces a
        // later change inside it.
        <div className="card-hairline release-panel__group" role="status">
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
        </div>
      )}

      {webhooks.length === 0 ? (
        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">No webhooks yet</h2>
          <p className="organiser-empty__body">
            Create one above to let another system learn when an attempt is submitted or a test closes.
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
                {/* MINOR-8: `busyRowId !== null` while ANY row's
                    pause/resume/revoke is in flight — these actions are
                    never meant to run concurrently, so one busy row is
                    reason enough to hold every row's buttons still rather
                    than track one in-flight id per row. */}
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busyRowId !== null}
                  onClick={() => void onToggleActive(webhook)}
                >
                  {webhook.active ? "Pause" : "Resume"}
                </button>
                {confirmingDelete === webhook.id ? (
                  <>
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={`Confirm revoking the webhook to ${webhook.url}`}
                      disabled={busyRowId !== null}
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
                    disabled={busyRowId !== null}
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
