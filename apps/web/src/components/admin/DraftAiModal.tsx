// Draft with AI Modal (Phase 12, Task 3).
// In-modal preview, validation status badges, flagging, and inline edit before committing to bank.

import { useState, useEffect, type FormEvent } from "react";
import type { ApiClient, Question, QuestionType } from "../../lib/api";
import { CardHairline } from "../CardHairline";
import { useDialogKeys } from "../useDialogKeys";

export interface DraftAiModalProps {
  client: ApiClient;
  workspaceId: string;
  bankId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Provider = "anthropic" | "openai" | "openrouter";
type ModalStep = "config" | "review";

const SUPPORTED_TYPES: Array<{ type: QuestionType; label: string }> = [
  { type: "single", label: "Single Choice" },
  { type: "multiple", label: "Multiple Choice" },
  { type: "true_false", label: "True / False" },
  { type: "numeric", label: "Numerical" },
  { type: "short_answer", label: "Short Answer" },
];

const CURATED_MODELS: Record<
  Provider,
  Array<{ id: string; label: string }>
> = {
  anthropic: [
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (Recommended)" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
    { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet" },
    { id: "custom", label: "Custom model..." },
  ],
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini (Recommended)" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "o1-preview", label: "o1 Preview" },
    { id: "o3-mini", label: "o3 Mini" },
    { id: "custom", label: "Custom model..." },
  ],
  openrouter: [
    { id: "deepseek/deepseek-chat", label: "DeepSeek V3 (Recommended)" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct" },
    { id: "mistralai/mistral-large-2411", label: "Mistral Large 2411" },
    { id: "custom", label: "Custom model..." },
  ],
};

export function DraftAiModal({
  client,
  workspaceId,
  bankId,
  isOpen,
  onClose,
  onSuccess,
}: DraftAiModalProps) {
  // Step
  const [step, setStep] = useState<ModalStep>("config");

  // Config inputs
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(3);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    "single",
    "multiple",
    "true_false",
  ]);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [selectedModel, setSelectedModel] = useState<string>("claude-3-5-sonnet-20241022");
  const [customModel, setCustomModel] = useState("");

  // Review states
  const [questions, setQuestions] = useState<Question[]>([]);
  const [validationIssues, setValidationIssues] = useState<
    Array<{ field?: string; message: string }>
  >([]);
  const [usage, setUsage] = useState<{
    promptTokens: number;
    completionTokens: number;
    estimatedCostCents: number;
  } | null>(null);
  const [flaggedIndices, setFlaggedIndices] = useState<Set<number>>(new Set());

  // Inline edit state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editOptions, setEditOptions] = useState<Array<{ id: string; text: string }>>([]);
  const [editKey, setEditKey] = useState<unknown>(null);

  // Status
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialog = useDialogKeys<HTMLDivElement>(
    isOpen,
    () => {
      if (!loading && !committing) onClose();
    },
    { trapTab: true },
  );

  useEffect(() => {
    if (!isOpen) {
      setStep("config");
      setError(null);
      setQuestions([]);
      setValidationIssues([]);
      setUsage(null);
      setFlaggedIndices(new Set());
      setEditingIndex(null);
      setLoading(false);
      setCommitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleProviderChange = (newProvider: Provider) => {
    setProvider(newProvider);
    const defaultModel = CURATED_MODELS[newProvider][0]?.id ?? "custom";
    setSelectedModel(defaultModel);
    if (defaultModel !== "custom") {
      setCustomModel("");
    }
  };

  const toggleType = (type: QuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError("Please provide a prompt or topic for question generation.");
      return;
    }
    if (selectedTypes.length === 0) {
      setError("Please select at least one question type.");
      return;
    }

    const effectiveModel =
      selectedModel === "custom" ? customModel.trim() : selectedModel;

    try {
      setLoading(true);
      setError(null);
      const res = await client.draftAiQuestions(workspaceId, bankId, {
        prompt: prompt.trim(),
        count,
        types: selectedTypes,
        provider,
        model: effectiveModel || undefined,
      });

      setQuestions(res.questions ?? []);
      setValidationIssues(res.validationIssues ?? []);
      setUsage(res.usage);
      setFlaggedIndices(new Set());
      setEditingIndex(null);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft questions.");
    } finally {
      setLoading(false);
    }
  };

  const toggleFlag = (index: number) => {
    setFlaggedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const startEdit = (index: number) => {
    const q = questions[index];
    if (!q) return;
    setEditingIndex(index);
    setEditPrompt(q.prompt);
    setEditOptions(q.options ? q.options.map((opt) => ({ ...opt })) : []);
    setEditKey(q.key);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditPrompt("");
    setEditOptions([]);
    setEditKey(null);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const currentQ = questions[editingIndex];
    if (!currentQ) return;

    const updatedQ: Question = {
      ...currentQ,
      prompt: editPrompt.trim(),
      ...(editOptions.length > 0 ? { options: editOptions } : {}),
      key: editKey as Question["key"],
    };

    setQuestions((prev) =>
      prev.map((q, idx) => (idx === editingIndex ? updatedQ : q)),
    );
    cancelEdit();
  };

  const updateEditOptionText = (optIdx: number, text: string) => {
    setEditOptions((prev) =>
      prev.map((opt, i) => (i === optIdx ? { ...opt, text } : opt)),
    );
  };

  const toggleOptionKey = (optId: string, qType: QuestionType) => {
    if (qType === "multiple") {
      const currentKeys = Array.isArray(editKey) ? [...editKey] : [];
      if (currentKeys.includes(optId)) {
        setEditKey(currentKeys.filter((k) => k !== optId));
      } else {
        setEditKey([...currentKeys, optId]);
      }
    } else {
      setEditKey(optId);
    }
  };

  const isOptionKey = (optId: string): boolean => {
    if (Array.isArray(editKey)) {
      return editKey.includes(optId);
    }
    return editKey === optId;
  };

  const handleCommit = async () => {
    const approvedQuestions = questions.filter((_, idx) => !flaggedIndices.has(idx));
    if (approvedQuestions.length === 0) return;

    try {
      setCommitting(true);
      setError(null);
      await client.commitDraftQuestions(workspaceId, bankId, approvedQuestions);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import questions.");
    } finally {
      setCommitting(false);
    }
  };

  const handleClose = () => {
    if (loading || committing) return;
    onClose();
  };

  const approvedCount = questions.length - flaggedIndices.size;
  const flaggedCount = flaggedIndices.size;

  return (
    <div className="bank-confirm" onClick={handleClose}>
      <div
        className={`bank-confirm__dialog draft-ai-modal ${step === "review" ? "draft-ai-modal--review" : ""}`}
        role="dialog"
        aria-labelledby="draft-ai-heading"
        aria-modal="true"
        ref={dialog.dialogRef}
        tabIndex={-1}
        onKeyDown={dialog.onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <CardHairline>
          <div className="byok-card__header">
            <h2 id="draft-ai-heading" className="bank-confirm__title">
              {step === "config" ? "Draft Questions with AI" : "Review Drafted Questions"}
            </h2>
            <button
              type="button"
              className="icon-button"
              onClick={handleClose}
              aria-label="Close dialog"
              disabled={loading || committing}
            >
              ✕
            </button>
          </div>

          {error && (
            <p className="release-panel__risk" role="alert">
              <span aria-hidden="true">⚠ </span>
              {error}
            </p>
          )}

          {step === "config" ? (
            <form className="draft-ai-form" onSubmit={(e) => void handleGenerate(e)} noValidate>
              <div className="field">
                <label className="field-label" htmlFor="draft-prompt">
                  Topic, Syllabus, or Text Material *
                </label>
                <textarea
                  id="draft-prompt"
                  className="text-input"
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. Distributed Consensus Algorithms (Raft vs Paxos), with practical edge case scenarios"
                  disabled={loading}
                  aria-describedby="draft-prompt-help"
                  required
                />
                <span className="field-help" id="draft-prompt-help">
                  Describe the subject, provide learning objectives, or paste source material.
                </span>
              </div>

              <div className="draft-ai-form__row">
                <div className="field">
                  <label className="field-label" htmlFor="draft-provider">
                    AI Provider
                  </label>
                  <select
                    id="draft-provider"
                    className="text-input"
                    value={provider}
                    onChange={(e) => handleProviderChange(e.target.value as Provider)}
                    disabled={loading}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="openrouter">OpenRouter (OpenAI-compatible)</option>
                  </select>
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="draft-model">
                    AI Model
                  </label>
                  <select
                    id="draft-model"
                    className="text-input"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={loading}
                  >
                    {CURATED_MODELS[provider].map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedModel === "custom" && (
                <div className="field">
                  <label className="field-label" htmlFor="draft-custom-model">
                    Custom Model ID
                  </label>
                  <input
                    id="draft-custom-model"
                    type="text"
                    className="text-input"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder={
                      provider === "openrouter"
                        ? "e.g. meta-llama/llama-3.3-70b-instruct"
                        : "e.g. claude-3-7-sonnet"
                    }
                    disabled={loading}
                    required
                  />
                </div>
              )}

              <div className="field">
                <label className="field-label" htmlFor="draft-count">
                  Question Count (1-10)
                </label>
                <input
                  id="draft-count"
                  type="number"
                  min="1"
                  max="10"
                  className="text-input"
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
                  disabled={loading}
                />
              </div>

              <div className="field">
                <span className="field-label" id="draft-types-label">Question Types</span>
                <div className="draft-ai-types" role="group" aria-labelledby="draft-types-label">
                  {SUPPORTED_TYPES.map(({ type, label }) => {
                    const isChecked = selectedTypes.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        className="bank-browser__tag-chip"
                        aria-pressed={isChecked}
                        onClick={() => toggleType(type)}
                        disabled={loading}
                      >
                        {isChecked ? "✓ " : "+ "}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="button-row">
                <button
                  type="submit"
                  className="button-primary button-primary--surface"
                  disabled={loading}
                >
                  {loading ? "Drafting with AI..." : "Generate Draft Questions"}
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleClose}
                  disabled={loading}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="draft-ai-review">
              {/* Header stats bar */}
              <div className="draft-ai-review__stats" role="status">
                <span className="draft-ai-stat draft-ai-stat--approved">
                  ● {approvedCount} Approved
                </span>
                <span className="draft-ai-stat draft-ai-stat--flagged">
                  ▲ {flaggedCount} Flagged
                </span>
                <span className="draft-ai-stat">
                  {usage
                    ? `${usage.promptTokens + usage.completionTokens} Tokens`
                    : "0 Tokens"}
                </span>
                <span className="draft-ai-stat">
                  ${usage ? (usage.estimatedCostCents / 100).toFixed(2) : "0.00"}
                </span>
              </div>

              {/* Cards List */}
              <div className="draft-ai-cards">
                {questions.map((q, idx) => {
                  const isFlagged = flaggedIndices.has(idx);
                  const isEditing = editingIndex === idx;

                  // Find issues matching this item
                  const itemIssues = validationIssues.filter((issue) => {
                    if (!issue.field) return true;
                    return (
                      issue.field.includes(`[${idx}]`) ||
                      issue.field.includes(`.${idx}.`) ||
                      issue.field.endsWith(`.${idx}`)
                    );
                  });
                  const hasWarning = itemIssues.length > 0;

                  return (
                    <div
                      key={q.id || idx}
                      className={`draft-ai-card ${isFlagged ? "draft-ai-card--flagged" : ""}`}
                    >
                      <div className="draft-ai-card__meta">
                        <div className="draft-ai-card__meta-left">
                          <strong>Question {idx + 1}</strong>
                          <span className="draft-ai-type-badge">{q.type}</span>
                          <span className="draft-ai-diff-badge">
                            {q.difficulty ?? "medium"}
                          </span>
                        </div>

                        <div>
                          {hasWarning ? (
                            <span className="draft-ai-badge draft-ai-badge--warning">
                              ⚠️ Validation Warning
                            </span>
                          ) : (
                            <span className="draft-ai-badge draft-ai-badge--valid">
                              ✓ Schema Valid
                            </span>
                          )}
                        </div>
                      </div>

                      {hasWarning && (
                        <div className="draft-ai-card__warnings" role="alert">
                          {itemIssues.map((iss, i) => (
                            <p key={i} className="draft-ai-card__warning-msg">
                              {iss.message}
                            </p>
                          ))}
                        </div>
                      )}

                      {isEditing ? (
                        <div className="draft-ai-card__edit-form">
                          <div className="field">
                            <label className="field-label" htmlFor={`edit-prompt-${idx}`}>
                              Edit Prompt
                            </label>
                            <textarea
                              id={`edit-prompt-${idx}`}
                              className="text-input"
                              rows={3}
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                            />
                          </div>

                          {editOptions.length > 0 && (
                            <div className="field">
                              <span className="field-label">Options & Answer Key</span>
                              <div className="draft-ai-edit-options">
                                {editOptions.map((opt, optIdx) => (
                                  <div key={opt.id} className="draft-ai-edit-option-row">
                                    <input
                                      type="text"
                                      className="text-input"
                                      aria-label={`Option ${optIdx + 1} text`}
                                      value={opt.text}
                                      onChange={(e) =>
                                        updateEditOptionText(optIdx, e.target.value)
                                      }
                                    />
                                    <label className="draft-ai-key-select">
                                      <input
                                        type={q.type === "multiple" ? "checkbox" : "radio"}
                                        name={`edit-key-${idx}`}
                                        checked={isOptionKey(opt.id)}
                                        onChange={() => toggleOptionKey(opt.id, q.type)}
                                      />
                                      Correct
                                    </label>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {q.type === "true_false" && (
                            <div className="field">
                              <label className="field-label" htmlFor={`edit-tf-${idx}`}>
                                Correct Answer
                              </label>
                              <select
                                id={`edit-tf-${idx}`}
                                className="text-input"
                                value={editKey === true ? "true" : "false"}
                                onChange={(e) => setEditKey(e.target.value === "true")}
                              >
                                <option value="true">True</option>
                                <option value="false">False</option>
                              </select>
                            </div>
                          )}

                          {q.type === "numeric" && (
                            <div className="field">
                              <label className="field-label" htmlFor={`edit-num-${idx}`}>
                                Correct Number
                              </label>
                              <input
                                id={`edit-num-${idx}`}
                                type="number"
                                className="text-input"
                                value={
                                  typeof editKey === "object" && editKey !== null && "value" in editKey
                                    ? (editKey as { value: number }).value
                                    : typeof editKey === "number"
                                      ? editKey
                                      : 0
                                }
                                onChange={(e) =>
                                  setEditKey({ value: parseFloat(e.target.value) || 0 })
                                }
                              />
                            </div>
                          )}

                          {q.type === "short_answer" && (
                            <div className="field">
                              <label className="field-label" htmlFor={`edit-sa-${idx}`}>
                                Accepted Answer
                              </label>
                              <input
                                id={`edit-sa-${idx}`}
                                type="text"
                                className="text-input"
                                value={typeof editKey === "string" ? editKey : ""}
                                onChange={(e) => setEditKey(e.target.value)}
                              />
                            </div>
                          )}

                          <div className="button-row">
                            <button
                              type="button"
                              className="button-primary button-primary--surface"
                              onClick={saveEdit}
                            >
                              Save Edit
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={cancelEdit}
                            >
                              Cancel Edit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="draft-ai-card__prompt">{q.prompt}</p>

                          {q.options && q.options.length > 0 && (
                            <ul className="draft-ai-card__options">
                              {q.options.map((opt) => {
                                const isCorrect = Array.isArray(q.key)
                                  ? q.key.includes(opt.id)
                                  : q.key === opt.id;
                                return (
                                  <li
                                    key={opt.id}
                                    className={isCorrect ? "draft-ai-option--correct" : ""}
                                  >
                                    {isCorrect ? "✓ " : "• "} {opt.text}
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {!q.options && q.key !== undefined && (
                            <div className="draft-ai-card__key">
                              Answer Key:{" "}
                              <strong>
                                {typeof q.key === "object" && q.key !== null && "value" in q.key
                                  ? String((q.key as { value: unknown }).value)
                                  : String(q.key)}
                              </strong>
                            </div>
                          )}

                          <div className="draft-ai-card__actions">
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => toggleFlag(idx)}
                              disabled={committing}
                            >
                              {isFlagged ? "Unflag & Keep" : "Flag as Incorrect"}
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => startEdit(idx)}
                              disabled={committing}
                            >
                              Edit
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Bottom action bar */}
              <div className="draft-ai-bottom-bar">
                <span className="draft-ai-bottom-bar__summary">
                  {flaggedCount} flagged item{flaggedCount === 1 ? "" : "s"} will be excluded
                </span>

                <div className="button-row">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setStep("config")}
                    disabled={committing}
                  >
                    Back to Config
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={handleClose}
                    disabled={committing}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button-primary button-primary--surface"
                    onClick={() => void handleCommit()}
                    disabled={approvedCount === 0 || committing}
                  >
                    {committing
                      ? "Importing..."
                      : `Import ${approvedCount} Approved Question${approvedCount === 1 ? "" : "s"} to Bank →`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </CardHairline>
      </div>
    </div>
  );
}
