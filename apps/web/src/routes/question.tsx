import { useState } from "react";
import type { Question } from "@pariksha/core";
import type { ApiClient } from "../lib/api";
import { MonoCaption } from "../components/MonoCaption";
import { QuestionEditor } from "../components/authoring/QuestionEditor";

// The page shell around QuestionEditor, the same thin wrapping bank.tsx and
// banks.tsx give their screens (MonoCaption + organiser chrome). Neither of
// those is wired into OrganiserApp's own routing yet either — this screen
// is reached the same way they will be, from the bank browser a later task
// wires up, not from this file.
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
  const title = initial ? "Edit question" : "New question";

  return (
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
        onSaved={(question) => {
          setJustSaved(true);
          onSaved(question);
        }}
      />
    </main>
  );
}
