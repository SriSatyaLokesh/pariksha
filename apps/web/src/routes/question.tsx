import { useState } from "react";
import type { Question } from "@pariksha/core";
import type { ApiClient } from "../lib/api";
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
  onSaved,
}: {
  workspaceId: string;
  bankId: string;
  initial?: Question | undefined;
  client: ApiClient;
  onSaved: (question: Question) => void;
}) {
  const [justSaved, setJustSaved] = useState(false);

  return (
    <>
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
    </>
  );
}
