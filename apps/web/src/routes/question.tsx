import { useState } from "react";
import type { Question } from "@pariksha/core";
import type { ApiClient } from "../lib/api";
import { MonoCaption } from "../components/MonoCaption";
import { OrganiserHeader } from "../components/OrganiserHeader";
import { QuestionEditor } from "../components/authoring/QuestionEditor";

// The page shell around QuestionEditor, the same thin wrapping bank.tsx and
// banks.tsx give their screens (MonoCaption + organiser chrome). Fix round
// (whole-branch review, C1): this screen is now reached from the bank
// browser's "New question"/"Edit" controls, wired through `organiser.tsx`.
export function QuestionScreen({
  workspaceId,
  bankId,
  initial,
  client,
  actorEmail,
  onSignOut,
  onBack,
  onSaved,
}: {
  workspaceId: string;
  bankId: string;
  initial?: Question | undefined;
  client: ApiClient;
  actorEmail: string;
  onSignOut: () => void;
  onBack: () => void;
  onSaved: (question: Question) => void;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const title = initial ? "Edit question" : "New question";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <OrganiserHeader email={actorEmail} onSignOut={onSignOut} onBack={onBack} backLabel="Back to bank" />

      <main id="main-content" className="organiser organiser--wide">
        <MonoCaption>{title}</MonoCaption>
        <h1 className="organiser__title">{title}</h1>

        {justSaved && (
          <p className="organiser__status" role="status">
            Saved.
          </p>
        )}

        <QuestionEditor
          bankId={bankId}
          workspaceId={workspaceId}
          initial={initial}
          client={client}
          onDirty={() => setJustSaved(false)}
          onSaved={(question) => {
            setJustSaved(true);
            onSaved(question);
          }}
        />
      </main>
    </>
  );
}
