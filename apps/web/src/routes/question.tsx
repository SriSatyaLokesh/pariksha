import { useState } from "react";
import { can } from "@pariksha/core";
import type { Question } from "@pariksha/core";
import type { Actor, ApiClient } from "../lib/api";
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
  actor,
  onSaved,
}: {
  workspaceId: string;
  bankId: string;
  initial?: Question | undefined;
  client: ApiClient;
  actor: Actor;
  onSaved: (question: Question) => void;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const [regrade, setRegrade] = useState<{ offer: RegradeOffer; state: RegradeState } | undefined>(undefined);
  // Branch review MIN2: held in state and updated on every save, never read
  // back off the `initial` prop again after mount. `organiser.tsx` never
  // re-renders this screen with a fresh `initial` after a save (`onSaved`
  // there is a no-op), so comparing against the mount-time prop meant a
  // *reverted* key edit (b -> a, back to what `initial` already was) looked
  // unchanged and silently offered no regrade — even though the stored key
  // really had just changed twice. Comparing against the actual last save
  // instead gets both directions right.
  const [lastSaved, setLastSaved] = useState<Question | undefined>(initial);

  // Branch review M3: `attempts.grade`, the same action the route itself
  // requires — never a guess, and never `tests.edit`/`banks.edit` (what
  // saving the key itself needs). An Author holds the latter and not the
  // former; a Reviewer is the reverse. Matches the standard Task 2 set for
  // this same action (`routes/test.tsx`'s own `canGrade`): a control that
  // leads nowhere a role may go must not appear for that role at all.
  const role = actor.memberships.find((m) => m.workspaceId === workspaceId)?.role;
  const canRegrade = role !== undefined && can({ role, action: "attempts.grade" });

  async function onRegrade(offer: RegradeOffer): Promise<void> {
    if (!client.regradeQuestion || !canRegrade) return;
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
            {regrade.state.kind === "queued" ? (
              <p className="organiser__status" role="status">
                {regrade.state.versions === 0
                  ? "Not used by any published test yet — nothing to regrade."
                  : `${regrade.state.queued} attempt${regrade.state.queued === 1 ? "" : "s"} across ` +
                    `${regrade.state.versions} test${regrade.state.versions === 1 ? "" : "s"} queued for regrade.`}
              </p>
            ) : canRegrade ? (
              <>
                {/* Branch review MIN6: `role="status"` — a screen-reader
                   user who just heard "Saved." must also hear that a
                   Regrade control appeared, not discover it only by
                   tabbing past it. */}
                <p className="field-help" role="status">
                  This changes how the question is graded. Candidates already scored under the old key may now have
                  the wrong total. Regrading runs in the background in batches of 30, roughly every 5 minutes — a
                  large cohort can take a while to finish.
                </p>
                {regrade.state.kind === "failed" && (
                  <p className="field-error" role="alert">
                    {regrade.state.message}
                  </p>
                )}
                <button
                  type="button"
                  className="button-secondary"
                  disabled={regrade.state.kind === "queuing"}
                  onClick={() => void onRegrade(regrade.offer)}
                >
                  {regrade.state.kind === "queuing" ? "Queuing…" : "Regrade affected attempts"}
                </button>
              </>
            ) : (
              // Branch review M3: no dead-end button for a role that would
              // only ever get a 403 — a plain line naming who can act,
              // never a control with no retry that leads nowhere.
              <p className="field-help" role="status">
                This changes how the question is graded. Someone with grading permission can rerun affected attempts.
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
            // existed: `lastSaved` is undefined only for a brand-new
            // question's first save, and nothing has ever been graded
            // against a key that did not exist a moment ago.
            if (lastSaved !== undefined && gradingSignature(lastSaved) !== gradingSignature(question)) {
              setRegrade({ offer: { bankId, questionId }, state: { kind: "offered" } });
            } else {
              setRegrade(undefined);
            }
            setLastSaved(question);
            onSaved(question);
          }}
        />
    </>
  );
}
