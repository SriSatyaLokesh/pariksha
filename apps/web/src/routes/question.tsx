import { useState } from "react";
import type { Question } from "@pariksha/core";
import type { ApiClient } from "../lib/api";
import { QuestionEditor } from "../components/authoring/QuestionEditor";

// The page shell around QuestionEditor, the same thin wrapping bank.tsx and
// banks.tsx give their screens (MonoCaption + organiser chrome). Fix round
// (whole-branch review, C1): this screen is now reached from the bank
// browser's "New question"/"Edit" controls, wired through `organiser.tsx`.

/**
 * Phase 8b Task 4 (`K17`/`K18`, `AC-08`): the fields a key edit can move a
 * score through. Everything else on a `Question` is prose or presentation —
 * `prompt`, `media`, `explanation`, `tags`, `difficulty`, `group`,
 * `shuffle_options` — and saving a typo fix must not offer a regrade nobody
 * asked for. Compared as a whole rather than switched per `type` (`key` vs
 * `blanks` vs `rubric` vs `items`/`left`/`right`): the cheaper mistake here
 * is a false offer the organiser ignores, not a missed one, so this errs
 * toward comparing too much rather than too little.
 */
const PRESENTATIONAL_FIELDS = [
  "$schema",
  "id",
  "prompt",
  "media",
  "group",
  "difficulty",
  "tags",
  "explanation",
  "shuffle_options",
] as const;

function gradingSignature(q: Question): string {
  const copy: Record<string, unknown> = { ...q };
  for (const field of PRESENTATIONAL_FIELDS) delete copy[field];
  return JSON.stringify(copy);
}

interface RegradeOffer {
  bankId: string;
  questionId: string;
}

type RegradeState =
  | { kind: "offered" }
  | { kind: "queuing" }
  | { kind: "queued"; queued: number; versions: number }
  | { kind: "failed"; message: string };

export function QuestionScreen({
  workspaceId,
  bankId,
  initial,
  client,
  onSaved,
}: {
  workspaceId: string;
  bankId: string;
  initial?: Question | undefined;
  client: ApiClient;
  onSaved: (question: Question) => void;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const [regrade, setRegrade] = useState<{ offer: RegradeOffer; state: RegradeState } | undefined>(undefined);

  async function onRegrade(offer: RegradeOffer): Promise<void> {
    if (!client.regradeQuestion) return;
    setRegrade({ offer, state: { kind: "queuing" } });
    try {
      const { queued, versions } = await client.regradeQuestion(workspaceId, offer.bankId, offer.questionId);
      setRegrade({ offer, state: { kind: "queued", queued, versions } });
    } catch {
      setRegrade({ offer, state: { kind: "failed", message: "Could not queue the regrade. Try again." } });
    }
  }

  return (
    <>
        {justSaved && (
          <p className="organiser__status" role="status">
            Saved.
          </p>
        )}

        {regrade && (
          <>
            {regrade.state.kind === "offered" || regrade.state.kind === "queuing" ? (
              <>
                <p className="field-help">
                  This changes how the question is graded. Candidates already scored under the old key may now have
                  the wrong total.
                </p>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={regrade.state.kind === "queuing"}
                  onClick={() => void onRegrade(regrade.offer)}
                >
                  {regrade.state.kind === "queuing" ? "Queuing…" : "Regrade affected attempts"}
                </button>
              </>
            ) : regrade.state.kind === "queued" ? (
              <p className="organiser__status" role="status">
                {regrade.state.versions === 0
                  ? "Not used by any published test yet — nothing to regrade."
                  : `${regrade.state.queued} attempt${regrade.state.queued === 1 ? "" : "s"} across ` +
                    `${regrade.state.versions} test${regrade.state.versions === 1 ? "" : "s"} queued for regrade.`}
              </p>
            ) : (
              <p className="field-error" role="alert">
                {regrade.state.message}
              </p>
            )}
          </>
        )}

        <QuestionEditor
          bankId={bankId}
          workspaceId={workspaceId}
          initial={initial}
          client={client}
          onDirty={() => {
            setJustSaved(false);
            setRegrade(undefined);
          }}
          onSaved={(question, questionId) => {
            setJustSaved(true);
            // A key edit only matters against a question that already
            // existed: `initial` is undefined for a brand-new one, and
            // nothing has ever been graded against a key that did not
            // exist a moment ago.
            if (initial !== undefined && gradingSignature(initial) !== gradingSignature(question)) {
              setRegrade({ offer: { bankId, questionId }, state: { kind: "offered" } });
            } else {
              setRegrade(undefined);
            }
            onSaved(question);
          }}
        />
    </>
  );
}
