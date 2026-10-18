import { useId, useState } from "react";
import type { PassageGroup } from "@pariksha/core";
import { ApiError, type ApiClient } from "../../lib/api";
import { PromptEditor } from "./PromptEditor";

// Phase 4 Task 6 (#50, P4.6): a passage group's whole shape is `id` + an
// optional `title` + a Markdown `passage` — `PromptEditor` already gives a
// toolbar and a live preview over `renderMarkdown`, so the passage field is
// that component reused outright, not a second Markdown editor.
//
// A group's `id` is author-visible, and the trap this phase has already
// paid for (Task 4's rename-unmounts-the-row bug) is a React key that is
// also editable content. `deleteGroup`'s refuse-when-referenced rule
// already keeps `group_ref` from dangling; the other half is here — an
// existing group's `id` cannot be edited at all, the same rule
// `apps/api/src/routes/questions.ts`'s PATCH applies to a question's own
// `id` — so wherever a list of groups keys a row by `group.id` (bank.tsx),
// that key is stable for the row's whole life.
export function GroupEditor({
  bankId,
  workspaceId,
  client,
  group,
  onSaved,
}: {
  bankId: string;
  workspaceId: string;
  client: ApiClient;
  group?: PassageGroup;
  onSaved: (group: PassageGroup) => void;
}) {
  const isEdit = group !== undefined;
  const [id, setId] = useState(group?.id ?? "");
  const [title, setTitle] = useState(group?.title ?? "");
  const [passage, setPassage] = useState(group?.passage ?? "");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const fieldId = useId();

  async function onSave(): Promise<void> {
    setNotice(undefined);
    setSaving(true);
    try {
      const saved = isEdit
        ? await client.updateGroup(workspaceId, bankId, group.id, {
            passage,
            ...(title !== "" && { title }),
          })
        : await client.createGroup(workspaceId, bankId, {
            id,
            passage,
            ...(title !== "" && { title }),
          });
      onSaved(saved);
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : "The group could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="group-editor">
      <label className="field-label" htmlFor={`${fieldId}-id`}>
        Group ID
      </label>
      <input
        className="text-input"
        id={`${fieldId}-id`}
        type="text"
        value={id}
        disabled={isEdit}
        onChange={(event) => setId(event.target.value)}
      />
      <p className="field-help">
        {isEdit ? "A group's ID cannot change once it exists." : "Up to 64 characters. Unique within this bank."}
      </p>

      <label className="field-label" htmlFor={`${fieldId}-title`}>
        Title
      </label>
      <input
        className="text-input"
        id={`${fieldId}-title`}
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />

      <PromptEditor value={passage} onChange={setPassage} label="Passage" />

      {notice !== undefined && (
        <p className="field-error" role="alert">
          {notice}
        </p>
      )}

      <button
        type="button"
        className="button-primary button-primary--surface"
        disabled={saving || id.trim() === "" || passage.trim() === ""}
        onClick={() => void onSave()}
      >
        Save
      </button>
    </div>
  );
}
