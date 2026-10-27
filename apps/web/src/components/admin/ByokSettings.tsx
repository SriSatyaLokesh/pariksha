// BYOK Settings Component (Phase 12, S-15).
// Allows workspace owners to configure encrypted Anthropic / OpenAI keys and monthly spend caps.

import { useState, useEffect, useCallback, type FormEvent } from "react";
import type { ApiClient, ByokCredential, ByokUsage } from "../../lib/api";
import { CardHairline } from "../CardHairline";
import { TextField } from "../TextField";
import { MonoCaption } from "../MonoCaption";

export interface ByokSettingsProps {
  client: ApiClient;
  workspaceId: string;
}

type ByokProvider = "anthropic" | "openai" | "openrouter";

function providerLabel(provider: ByokProvider): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
  }
}

export function ByokSettings({ client, workspaceId }: ByokSettingsProps) {
  const [credentials, setCredentials] = useState<ByokCredential[]>([]);
  const [usage, setUsage] = useState<ByokUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [editingProvider, setEditingProvider] = useState<ByokProvider | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<ByokProvider | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [spendLimitInput, setSpendLimitInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await client.getByok(workspaceId);
      setCredentials(data.credentials);
      setUsage(data.usage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load BYOK credentials.");
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOpenEdit = (provider: ByokProvider) => {
    const cred = credentials.find((c) => c.provider === provider);
    setEditingProvider(provider);
    setConfirmingDelete(null);
    setKeyInput("");
    setSpendLimitInput(cred?.spendLimitCents != null ? (cred.spendLimitCents / 100).toString() : "");
    setError(null);
    setSuccess(null);
  };

  const handleCancelEdit = () => {
    setEditingProvider(null);
    setKeyInput("");
    setSpendLimitInput("");
    setError(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProvider) return;
    if (!keyInput.trim()) {
      setError("API key is required.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      let spendLimitCents: number | null = null;
      if (spendLimitInput.trim()) {
        const parsed = parseFloat(spendLimitInput.trim());
        if (isNaN(parsed) || parsed < 0) {
          setError("Monthly spend cap must be a valid non-negative number.");
          setSaving(false);
          return;
        }
        spendLimitCents = Math.round(parsed * 100);
      }

      await client.saveByokKey(
        workspaceId,
        editingProvider,
        keyInput.trim(),
        spendLimitCents,
      );

      setSuccess(`Successfully configured ${providerLabel(editingProvider)} API key.`);
      setEditingProvider(null);
      setKeyInput("");
      setSpendLimitInput("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (provider: ByokProvider) => {
    try {
      setSaving(true);
      setError(null);
      await client.deleteByokKey(workspaceId, provider);
      setSuccess(`Removed ${providerLabel(provider)} key.`);
      setConfirmingDelete(null);
      if (editingProvider === provider) {
        setEditingProvider(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete key.");
    } finally {
      setSaving(false);
    }
  };

  const anthropicCred = credentials.find((c) => c.provider === "anthropic");
  const openAiCred = credentials.find((c) => c.provider === "openai");
  const openRouterCred = credentials.find((c) => c.provider === "openrouter");

  return (
    <div className="byok-settings">
      <header className="byok-header">
        <h2 className="byok-title">Bring Your Own Key</h2>
        <p className="release-panel__fact">
          Store your own Anthropic or OpenAI API keys securely. Keys are encrypted at rest with AES-256-GCM
          using workspace secrets and never exposed to candidate browsers or logs.
        </p>
      </header>

      {error && (
        <p className="release-panel__risk" role="alert">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}

      {success && (
        <p className="release-panel__fact" role="status">
          ✓ {success}
        </p>
      )}

      {/* Editing Form */}
      {editingProvider && (
        <CardHairline className="organiser__panel">
          <form className="organiser-form byok-form" onSubmit={(e) => void handleSave(e)} noValidate>
            <h3 className="byok-card__title">
              Configure {providerLabel(editingProvider)} Key
            </h3>

            <TextField
              id="byok-api-key"
              type="password"
              label={`${providerLabel(editingProvider)} API Key`}
              help={
                editingProvider === "anthropic"
                  ? "Begins with sk-ant-..."
                  : editingProvider === "openai"
                    ? "Begins with sk-proj-... or sk-..."
                    : "Begins with sk-or-..."
              }
              value={keyInput}
              onChange={setKeyInput}
              required
            />

            <TextField
              id="byok-spend-cap"
              type="text"
              label="Monthly Spend Cap (USD, Optional)"
              help="Hard stop ceiling in dollars. Leave blank for no cap."
              value={spendLimitInput}
              onChange={setSpendLimitInput}
            />

            <div className="button-row">
              <button
                type="submit"
                className="button-primary button-primary--surface"
                disabled={saving}
              >
                {saving ? "Encrypting & Saving..." : "Save Key"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={handleCancelEdit}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </CardHairline>
      )}

      {/* Provider Cards */}
      <div className="byok-grid">
        {/* Anthropic Card */}
        <CardHairline className="byok-card">
          <div className="byok-card__header">
            <h3 className="byok-card__title">Anthropic</h3>
            <span
              className={
                anthropicCred
                  ? "byok-card__badge byok-card__badge--active"
                  : "byok-card__badge byok-card__badge--inactive"
              }
            >
              {anthropicCred ? "Active" : "Not configured"}
            </span>
          </div>

          <p className="byok-card__desc">
            Claude 3.5 Sonnet and Haiku models for structured and scenario questions.
          </p>

          {anthropicCred && (
            <div className="byok-card__meta">
              <div>
                Key: <code>{anthropicCred.keyHint}</code>
              </div>
              <div>
                Monthly Cap:{" "}
                {anthropicCred.spendLimitCents != null
                  ? `$${(anthropicCred.spendLimitCents / 100).toFixed(2)} / month`
                  : "No cap"}
              </div>
            </div>
          )}

          <div className="byok-card__actions">
            <button
              type="button"
              className="button-primary button-primary--surface"
              onClick={() => handleOpenEdit("anthropic")}
              disabled={loading || saving}
            >
              {anthropicCred ? "Update Key" : "Configure Key"}
            </button>
            {anthropicCred &&
              (confirmingDelete === "anthropic" ? (
                <>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void handleDelete("anthropic")}
                    disabled={loading || saving}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setConfirmingDelete(null)}
                    disabled={loading || saving}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setConfirmingDelete("anthropic")}
                  disabled={loading || saving}
                >
                  Delete
                </button>
              ))}
          </div>
        </CardHairline>

        {/* OpenAI Card */}
        <CardHairline className="byok-card">
          <div className="byok-card__header">
            <h3 className="byok-card__title">OpenAI</h3>
            <span
              className={
                openAiCred
                  ? "byok-card__badge byok-card__badge--active"
                  : "byok-card__badge byok-card__badge--inactive"
              }
            >
              {openAiCred ? "Active" : "Not configured"}
            </span>
          </div>

          <p className="byok-card__desc">
            GPT-4o and GPT-4o-mini models with strict JSON schema mode.
          </p>

          {openAiCred && (
            <div className="byok-card__meta">
              <div>
                Key: <code>{openAiCred.keyHint}</code>
              </div>
              <div>
                Monthly Cap:{" "}
                {openAiCred.spendLimitCents != null
                  ? `$${(openAiCred.spendLimitCents / 100).toFixed(2)} / month`
                  : "No cap"}
              </div>
            </div>
          )}

          <div className="byok-card__actions">
            <button
              type="button"
              className="button-primary button-primary--surface"
              onClick={() => handleOpenEdit("openai")}
              disabled={loading || saving}
            >
              {openAiCred ? "Update Key" : "Configure Key"}
            </button>
            {openAiCred &&
              (confirmingDelete === "openai" ? (
                <>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void handleDelete("openai")}
                    disabled={loading || saving}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setConfirmingDelete(null)}
                    disabled={loading || saving}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setConfirmingDelete("openai")}
                  disabled={loading || saving}
                >
                  Delete
                </button>
              ))}
          </div>
        </CardHairline>

        {/* OpenRouter Card */}
        <CardHairline className="byok-card">
          <div className="byok-card__header">
            <h3 className="byok-card__title">OpenRouter</h3>
            <span
              className={
                openRouterCred
                  ? "byok-card__badge byok-card__badge--active"
                  : "byok-card__badge byok-card__badge--inactive"
              }
            >
              {openRouterCred ? "Active" : "Not configured"}
            </span>
          </div>

          <p className="byok-card__desc">
            DeepSeek, Llama 3.3, Mistral, and other models via OpenRouter (OpenAI-compatible).
          </p>

          {openRouterCred && (
            <div className="byok-card__meta">
              <div>
                Key: <code>{openRouterCred.keyHint}</code>
              </div>
              <div>
                Monthly Cap:{" "}
                {openRouterCred.spendLimitCents != null
                  ? `$${(openRouterCred.spendLimitCents / 100).toFixed(2)} / month`
                  : "No cap"}
              </div>
            </div>
          )}

          <div className="byok-card__actions">
            <button
              type="button"
              className="button-primary button-primary--surface"
              onClick={() => handleOpenEdit("openrouter")}
              disabled={loading || saving}
            >
              {openRouterCred ? "Update Key" : "Configure Key"}
            </button>
            {openRouterCred &&
              (confirmingDelete === "openrouter" ? (
                <>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void handleDelete("openrouter")}
                    disabled={loading || saving}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setConfirmingDelete(null)}
                    disabled={loading || saving}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setConfirmingDelete("openrouter")}
                  disabled={loading || saving}
                >
                  Delete
                </button>
              ))}
          </div>
        </CardHairline>
      </div>

      {/* Usage summary */}
      <CardHairline className="byok-usage-card">
        <MonoCaption>Monthly Usage Telemetry</MonoCaption>
        <div className="byok-usage-grid">
          <div className="byok-usage-stat">
            <span className="byok-usage-stat__value">
              {usage
                ? (usage.totalPromptTokens + usage.totalCompletionTokens).toLocaleString()
                : "0"}
            </span>
            <span className="byok-usage-stat__label">Total Tokens</span>
          </div>
          <div className="byok-usage-stat">
            <span className="byok-usage-stat__value">
              ${usage ? (usage.totalCostCents / 100).toFixed(2) : "0.00"}
            </span>
            <span className="byok-usage-stat__label">Estimated Cost</span>
          </div>
          <div className="byok-usage-stat">
            <span className="byok-usage-stat__value">
              {usage ? usage.totalPromptTokens.toLocaleString() : "0"}
            </span>
            <span className="byok-usage-stat__label">Prompt Tokens</span>
          </div>
          <div className="byok-usage-stat">
            <span className="byok-usage-stat__value">
              {usage ? usage.totalCompletionTokens.toLocaleString() : "0"}
            </span>
            <span className="byok-usage-stat__label">Completion Tokens</span>
          </div>
        </div>
      </CardHairline>
    </div>
  );
}
