import { useCallback, useEffect, useRef, useState } from "react";
import { can } from "@pariksha/core";
import type { TestAccess, TestBranding, TestRelease, TestTiming } from "@pariksha/core";
import {
  ApiError,
  type Actor,
  type ApiClient,
  type DraftPatch,
  type StoredSection,
  type TestVersionRow,
} from "../lib/api";
import { OrganiserHeader } from "../components/OrganiserHeader";
import { MonoCaption } from "../components/MonoCaption";
import { SectionList } from "../components/testbuilder/SectionList";
import { FormBuilder } from "../components/testbuilder/FormBuilder";
import { TimingPanel } from "../components/testbuilder/TimingPanel";
import { AccessPanel } from "../components/testbuilder/AccessPanel";
import { ReleasePanel } from "../components/testbuilder/ReleasePanel";
import { BrandingPanel } from "../components/testbuilder/BrandingPanel";

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

/** What `createTest` seeds a draft with, and what the panel edits when the
 * draft has no `timing` yet — `duration_minutes` is the one member
 * schemas/test-1.json's `$defs/timing` requires, and every other field has
 * a documented default it is omitted until the organiser overrides. */
const DEFAULT_TIMING: TestTiming = { duration_minutes: 60 };

/** `mode` is the one member `$defs/access` requires, and `link_code` is
 * the mode docs/test-format.md describes first — the public link plus a
 * code announced in the room. The code itself is typed next, which is a
 * separate keystroke and therefore a separate save (see `draftSchema`,
 * apps/api/src/routes/tests.ts). */
const DEFAULT_ACCESS: TestAccess = { mode: "link_code" };

/** `when` is the one member `$defs/release` requires. `on_submit` is the
 * least surprising of the three and the only one that needs nothing else
 * chosen. */
const DEFAULT_RELEASE: TestRelease = { when: "on_submit" };

const NO_BRANDING: TestBranding = {};

export function TestBuilder({
  workspaceId,
  testId,
  client,
  actor,
  onSignOut,
  onBack,
}: {
  workspaceId: string;
  testId: string;
  client: ApiClient;
  actor: Actor;
  onSignOut: () => void;
  onBack: () => void;
}) {
  // T-23: only an owner holds `workspace.settings`, and the workspace half
  // of the branding panel is read-only without it. The server refuses
  // either way — this is so an Author is told rather than 403'd after
  // filling the form in.
  const role = actor.memberships.find((m) => m.workspaceId === workspaceId)?.role;
  const canEditWorkspace = role !== undefined && can({ role, action: "workspace.settings" });
  const [name, setName] = useState<string | null>(null);
  // UX-18 (Task 7): a test with a published version behind it is the case
  // where a timing change has to say what happens to attempts already
  // running, so the panel is told. `currentVersion` is what names one — the
  // draft row itself is always unpublished.
  const [published, setPublished] = useState(false);
  // T-23's workspace half (Task 10). Loaded beside the draft rather than
  // inside `BrandingPanel`, so the panel stays a controlled component like
  // every other one in this shell and the shell keeps owning every call.
  const [workspaceBranding, setWorkspaceBranding] = useState<TestBranding>(NO_BRANDING);
  const [draft, setDraft] = useState<TestVersionRow | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [openSectionId, setOpenSectionId] = useState<string | null>(() => sectionFromUrl());
  // Task 5 (#57, P5.4): a whole `DraftPatch` rather than a sections array —
  // the registration form is a `settings` block and saves through the same
  // debounce, the same in-flight guard and the same one route. Each panel
  // this shell grows (Tasks 7, 8, 10) is one more `save…` helper, not one
  // more effect.
  const [pending, setPending] = useState<DraftPatch | null>(null);
  // Fix round (task 3 review, I4): every save increments this, and a
  // response is applied only when it is still the current one by the time
  // it arrives — the guard against a slow request resolving after a faster,
  // later one already has.
  const saveSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const [test, version, branding] = await Promise.all([
        client.test(workspaceId, testId),
        client.draft(workspaceId, testId),
        // An Author cannot write workspace branding but can read it — the
        // route is `requireMember`, not `workspace.settings` — and has to,
        // because the preview below is what their candidates will see.
        client.workspaceBranding(workspaceId),
      ]);
      setName(test.name);
      setPublished(test.currentVersion !== null);
      setWorkspaceBranding(branding);
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
    if (pending === null) return;
    const seq = ++saveSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const updated = await client.patchDraft(workspaceId, testId, pending);
          if (saveSeq.current !== seq) return;
          setDraft((prev) => (prev === null ? prev : { ...prev, body: updated.body }));
          setError(undefined);
          // Landed, so it stops being pending — otherwise the merge above
          // would carry every block already saved into every later patch
          // for the life of the screen. Only when this is still the
          // current save: a keystroke during the request has already
          // bumped `saveSeq` and returned above, so its patch is never
          // the one cleared.
          setPending(null);
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
  }, [pending, client, workspaceId, testId]);

  /**
   * T-23's logo, through Phase 4's `POST .../banks/:bankId/media` — the
   * only media route this product has, and the one the plan names.
   *
   * ponytail: the logo therefore lives in a *bank*'s media store, and this
   * picks the workspace's first bank to hang it on. The bank id is only an
   * existence and permission anchor there (the key itself is
   * `media/<workspaceId>/<sha256>.<ext>`, workspace-scoped already), and
   * every actor who holds `workspace.settings` is an owner and so holds
   * `banks.edit` too. The lookup is lazy — one `listBanks` when Upload is
   * pressed, never on render. Upgrade path: Phase 6 needs a public
   * branding read anyway and should give the logo its own key space.
   */
  async function uploadLogo(file: File): Promise<{ key: string }> {
    const banks = await client.listBanks(workspaceId);
    const bank = banks[0];
    if (bank === undefined) {
      throw new ApiError(
        409,
        "no_bank",
        "A logo is stored with this workspace's media. Create a question bank first, then upload it.",
      );
    }
    return client.uploadMedia(workspaceId, bank.id, file);
  }

  // Merged, never replaced (task 7/8/10 review, M8). Both of these used
  // to call `setPending({ … })` outright, so two panels touched inside
  // the 250 ms debounce dropped the first patch — silently, because
  // `setDraft` had already applied it locally and the follow-up GET keeps
  // `body: prev.body`. Reorder a section, click a navigation radio within
  // a quarter second, reload, and the reorder is gone. Pre-existing in
  // shape, but Tasks 7, 8 and 10 took this screen from two writers to six.
  function saveSections(sections: StoredSection[]): void {
    setDraft((prev) => (prev === null ? prev : { ...prev, body: { ...prev.body, sections } }));
    setPending((prev) => ({ ...prev, sections }));
  }

  function saveSettings(settings: Partial<TestVersionRow["body"]["settings"]>): void {
    setDraft((prev) =>
      prev === null ? prev : { ...prev, body: { ...prev.body, settings: { ...prev.body.settings, ...settings } } },
    );
    setPending((prev) => ({ ...prev, settings: { ...prev?.settings, ...settings } }));
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <OrganiserHeader email={actor.email} onSignOut={onSignOut} onBack={onBack} backLabel="Back to tests" />

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

        {draft !== null && (
          <TimingPanel
            timing={draft.body.settings.timing ?? DEFAULT_TIMING}
            sections={draft.body.sections}
            published={published}
            onChange={(timing) => saveSettings({ timing })}
          />
        )}

        {draft !== null && (
          <AccessPanel
            access={draft.body.settings.access ?? DEFAULT_ACCESS}
            onChange={(access) => saveSettings({ access })}
          />
        )}

        {draft !== null && (
          <ReleasePanel
            release={draft.body.settings.release ?? DEFAULT_RELEASE}
            onChange={(release) => saveSettings({ release })}
          />
        )}

        {draft !== null && (
          <BrandingPanel
            branding={draft.body.settings.branding ?? NO_BRANDING}
            workspaceBranding={workspaceBranding}
            canEditWorkspace={canEditWorkspace}
            onChange={(branding) => saveSettings({ branding })}
            onSaveWorkspace={async (next) => {
              setWorkspaceBranding(await client.saveWorkspaceBranding(workspaceId, next));
            }}
            onUploadLogo={uploadLogo}
          />
        )}

        {draft !== null && (
          <FormBuilder
            form={draft.body.settings.registration_form}
            onChange={(registration_form) => saveSettings({ registration_form })}
            checkUrl={(url) => client.checkUrl(workspaceId, testId, url)}
          />
        )}
      </main>
    </>
  );
}
