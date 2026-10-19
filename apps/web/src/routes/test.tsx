import { useCallback, useEffect, useRef, useState } from "react";
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
  const [pendingSections, setPendingSections] = useState<StoredSection[] | null>(null);
  // Fix round (task 3 review, I4): every save increments this, and a
  // response is applied only when it is still the current one by the time
  // it arrives — the guard against a slow request resolving after a faster,
  // later one already has.
  const saveSeq = useRef(0);

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

  // Fix round (task 3 review, I4): a keystroke in a section's title or
  // instructions used to cost one PATCH *and* one full GET, with no
  // debounce and no in-flight guard — eleven keystrokes on a slow link cost
  // eleven round trips, and a reply landing after a later keystroke reset
  // the controlled input mid-type. Debounced the way `TestList`'s own
  // filter already is (same pattern, copied); the PATCH response's own
  // `body` replaces local state directly rather than a follow-up GET —
  // nothing here needs `draw`/`setPoints`/`points` fresher than the next
  // full reload — and `saveSeq` (above) drops a response whose request is
  // no longer the latest.
  useEffect(() => {
    if (pendingSections === null) return;
    const seq = ++saveSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const updated = await client.patchDraft(workspaceId, testId, { sections: pendingSections });
          if (saveSeq.current !== seq) return;
          setDraft((prev) => (prev === null ? prev : { ...prev, body: updated.body }));
          setError(undefined);
        } catch (cause) {
          if (saveSeq.current !== seq) return;
          setError(cause instanceof ApiError ? cause.message : "The draft could not be saved.");
        }
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [pendingSections, client, workspaceId, testId]);

  function saveSections(sections: StoredSection[]): void {
    setDraft((prev) => (prev === null ? prev : { ...prev, body: { ...prev.body, sections } }));
    setPendingSections(sections);
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
            onChange={saveSections}
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
