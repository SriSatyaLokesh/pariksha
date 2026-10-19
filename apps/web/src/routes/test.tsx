import { useCallback, useEffect, useState } from "react";
import { ApiError, type ApiClient, type StoredSection, type TestVersionRow } from "../lib/api";
import { OrganiserHeader } from "../components/OrganiserHeader";
import { MonoCaption } from "../components/MonoCaption";
import { SectionList } from "../components/testbuilder/SectionList";

// Screens 7, 9, 11, 12 (docs/design.md's screen inventory): the builder
// shell. Task 3 is only Screen 7 (sections, `SectionList`) — the access,
// checklist and version-banner panels are later tasks' own components,
// mounted into this same shell when they land, the same way `SectionList`
// is mounted here now.

/** The open section lives in the URL (`?section=<id>`), so a reload or a
 * shared link returns to it — read fresh on every render's first paint and
 * on `popstate` (the browser's own Back/Forward), the same convention
 * `TestList`'s own filter already follows. */
function sectionFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("section");
}

export function TestBuilder({
  workspaceId,
  testId,
  client,
  actorEmail,
  onSignOut,
  onBack,
}: {
  workspaceId: string;
  testId: string;
  client: ApiClient;
  actorEmail: string;
  onSignOut: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState<TestVersionRow | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [openSectionId, setOpenSectionId] = useState<string | null>(() => sectionFromUrl());

  const load = useCallback(async () => {
    try {
      const [test, version] = await Promise.all([client.test(workspaceId, testId), client.draft(workspaceId, testId)]);
      setName(test.name);
      setDraft(version);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The test could not be loaded.");
    }
  }, [client, workspaceId, testId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onPopState = () => setOpenSectionId(sectionFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function openSection(id: string | null): void {
    setOpenSectionId(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("section", id);
    else params.delete("section");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }

  // ponytail: saves on every `onChange`, with no debounce — a keystroke in
  // a section's title or instructions is one PATCH. Fine at today's scale
  // (one organiser editing one test); add a debounce (`TestList`'s own
  // filter already has the pattern to copy) if a slow connection or a large
  // test makes this feel laggy.
  async function saveSections(sections: StoredSection[]): Promise<void> {
    if (!draft) return;
    const previous = draft;
    setDraft({ ...draft, body: { ...draft.body, sections } });
    try {
      await client.patchDraft(workspaceId, testId, { sections });
      setDraft(await client.draft(workspaceId, testId));
    } catch (cause) {
      setDraft(previous);
      setError(cause instanceof ApiError ? cause.message : "The draft could not be saved.");
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <OrganiserHeader email={actorEmail} onSignOut={onSignOut} onBack={onBack} backLabel="Back to tests" />

      <main id="main-content" className="organiser organiser--wide">
        <MonoCaption>Test builder</MonoCaption>
        <h1 className="organiser__title">{name ?? "Test builder"}</h1>

        {error !== undefined && (
          <p className="organiser__notice" role="alert">
            {error}
          </p>
        )}

        {draft === null ? (
          <p className="organiser__status" role="status">
            Loading…
          </p>
        ) : (
          <SectionList
            sections={draft.body.sections}
            draw={draft.draw ?? {}}
            setPoints={draft.setPoints ?? {}}
            points={draft.points ?? {}}
            onChange={(sections) => void saveSections(sections)}
            openSectionId={openSectionId}
            onOpenSection={openSection}
            client={client}
            workspaceId={workspaceId}
          />
        )}
      </main>
    </>
  );
}
