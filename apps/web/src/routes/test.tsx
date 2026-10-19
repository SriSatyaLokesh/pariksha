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
  // the controlled input mid-type.
  //
  // What it does now (task 4 review, MIN-2 — this comment used to claim
  // there was no follow-up GET, eight lines above the one there is):
  // the save is debounced the way `TestList`'s own filter already is (same
  // pattern, copied), so a burst of keystrokes costs one round trip rather
  // than one each. One *settled* save is then followed by one
  // `GET …/draft`, because PATCH deliberately answers without
  // `draw`/`setPoints`/`points` (apps/api/src/routes/tests.ts) and without
  // the re-fetch UX-15's live draw and UX-12's points froze from the first
  // keystroke onward. Only the derived figures are taken from it —
  // `{ ...fresh, body: prev.body }` — so a slow GET cannot type over the
  // author, and `saveSeq` (above) drops both responses outright once a
  // newer save has started.
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
          return;
        }

        // Task 3 re-review: PATCH deliberately answers without
        // `draw`/`setPoints`/`points` (apps/api/src/routes/tests.ts), on
        // the stated grounds that a screen wanting fresh numbers re-fetches
        // the GET — which is what this is. The I4 fix removed that
        // re-fetch and left UX-15's live draw and UX-12's points frozen
        // from the first edit onward. One GET per *settled* burst, not one
        // per keystroke, so I4's complaint stays answered. Only the derived
        // figures are taken: `body` stays the local one, because a reply
        // landing after the next keystroke would otherwise type over the
        // author, and `saveSeq` drops it outright once a newer save has
        // started.
        try {
          const fresh = await client.draft(workspaceId, testId);
          if (saveSeq.current !== seq) return;
          setDraft((prev) => (prev === null ? prev : { ...fresh, body: prev.body }));
        } catch {
          // The save itself landed; only the derived figures are a beat
          // behind, and the next load corrects them. Reporting a failure
          // over a save that succeeded would be the worse lie.
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
