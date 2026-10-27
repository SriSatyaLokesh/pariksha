// Draft with AI Modal (Phase 12).
// Generates question batches directly into the question bank using workspace BYOK keys.

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

const SUPPORTED_TYPES: Array<{ type: QuestionType; label: string }> = [
  { type: "single", label: "Single Choice" },
  { type: "multiple", label: "Multiple Choice" },
  { type: "true_false", label: "True / False" },
  { type: "numeric", label: "Numerical" },
  { type: "short_answer", label: "Short Answer" },
];

export function DraftAiModal({
  client,
  workspaceId,
  bankId,
  isOpen,
  onClose,
  onSuccess,
}: DraftAiModalProps) {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(3);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    "single",
    "multiple",
    "true_false",
  ]);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<Question[] | null>(null);

  const dialog = useDialogKeys<HTMLDivElement>(
    isOpen,
    () => {
      if (!loading) onClose();
    },
    { trapTab: true },
  );

  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setDrafted(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

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

    try {
      setLoading(true);
      setError(null);
      const res = await client.draftAiQuestions(workspaceId, bankId, {
        prompt: prompt.trim(),
        count,
        types: selectedTypes,
        provider,
      });

      setDrafted(res.questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft questions.");
    } finally {
      setLoading(false);
    }
  };

  const handleDone = () => {
    setDrafted(null);
    setPrompt("");
    onSuccess();
  };

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  return (
    <div className="bank-confirm" onClick={handleClose}>
      <div
        className="bank-confirm__dialog draft-ai-modal"
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
              Draft Questions with AI
            </h2>
            <button
              type="button"
              className="icon-button"
              onClick={handleClose}
              aria-label="Close dialog"
              disabled={loading}
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

          {drafted ? (
            <div className="draft-ai-form">
              <p className="release-panel__fact" role="status">
                ✓ Successfully drafted {drafted.length} question
                {drafted.length === 1 ? "" : "s"} into this bank.
              </p>

              <div className="draft-ai-preview">
                {drafted.map((q, idx) => (
                  <div key={idx} className="draft-ai-preview__item">
                    <div className="draft-ai-preview__item-meta">
                      <span>{q.type}</span>
                      <span>{q.difficulty ?? "medium"}</span>
                    </div>
                    <p className="draft-ai-preview__item-prompt">{q.prompt}</p>
                  </div>
                ))}
              </div>

              <div className="button-row">
                <button
                  type="button"
                  className="button-primary button-primary--surface"
                  onClick={handleDone}
                >
                  View in Bank
                </button>
              </div>
            </div>
          ) : (
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
                    onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}
                    disabled={loading}
                  >
                    <option value="anthropic">Anthropic (Claude 3.5)</option>
                    <option value="openai">OpenAI (GPT-4o)</option>
                  </select>
                </div>

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
                  {loading ? "Drafting with AI..." : "Generate Drafts"}
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
          )}
        </CardHairline>
      </div>
    </div>
  );
}
