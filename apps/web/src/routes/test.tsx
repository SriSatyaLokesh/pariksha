import { useCallback, useEffect, useRef, useState } from "react";
import { can } from "@pariksha/core";
import type { FormField, TestAccess, TestBranding, TestRelease, TestTiming } from "@pariksha/core";
import {
  ApiError,
  type Actor,
  type ApiClient,
  type CandidateRow,
  type ChecklistRow,
  type DraftPatch,
  type StoredSection,
  type TestSummary,
  type TestVersionRow,
  type TestVersionSummary,
} from "../lib/api";
import { OrganiserHeader } from "../components/OrganiserHeader";
import { MonoCaption } from "../components/MonoCaption";
import { SectionList } from "../components/testbuilder/SectionList";
import { FormBuilder } from "../components/testbuilder/FormBuilder";
import { TimingPanel } from "../components/testbuilder/TimingPanel";
import { AccessPanel } from "../components/testbuilder/AccessPanel";
import { ReleasePanel } from "../components/testbuilder/ReleasePanel";
import { BrandingPanel } from "../components/testbuilder/BrandingPanel";
import { VersionBanner, VersionHistory } from "../components/testbuilder/VersionBanner";
import { PublishChecklist } from "../components/testbuilder/PublishChecklist";
import { TestStateBadge } from "./tests";
import { useDialogKeys } from "../components/useDialogKeys";

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
  // Task 11 (#62, P5.9): the whole summary, not just the name — the header
  // shows the derived state, the lifecycle buttons depend on it, and
  // `currentVersion` is what `UX-18`'s banner compares the draft against.
  const [test, setTest] = useState<TestSummary | null>(null);
  const [versions, setVersions] = useState<readonly TestVersionSummary[]>([]);
  const [confirming, setConfirming] = useState<"close" | "archive" | null>(null);
  // Task 13 (#64, P5.11): `null` is "the checklist is not open". Publish
  // opens it rather than publishing (UX-17: "a publish checklist, not a
  // publish button"), and confirming inside it is what calls the route.
  const [checklist, setChecklist] = useState<readonly ChecklistRow[] | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // UX-18 (Task 7): a test with a published version behind it is the case
  // where a timing change has to say what happens to attempts already
  // running, so the panel is told. `currentVersion` is what names one — the
  // draft row itself is always unpublished.
  const published = test !== null && test.currentVersion !== null;
  const canPublish = role !== undefined && can({ role, action: "tests.publish" });
  // T-23's workspace half (Task 10). Loaded beside the draft rather than
  // inside `BrandingPanel`, so the panel stays a controlled component like
  // every other one in this shell and the shell keeps owning every call.
  const canManageCandidates = role !== undefined && can({ role, action: "candidates.manage" });
  const [workspaceBranding, setWorkspaceBranding] = useState<TestBranding>(NO_BRANDING);
  // Task 9 (#60 / #56, P5.7b). Loaded beside the draft, and only when this
  // actor holds `candidates.manage` — the route 403s otherwise, and an
  // Author opening the builder must not meet an error banner for a panel
  // they are only being shown read-only.
  const [candidates, setCandidates] = useState<readonly CandidateRow[]>([]);
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

  const historyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [summary, version, branding, listed, history] = await Promise.all([
        client.test(workspaceId, testId),
        client.draft(workspaceId, testId),
        // An Author cannot write workspace branding but can read it — the
        // route is `requireMember`, not `workspace.settings` — and has to,
        // because the preview below is what their candidates will see.
        client.workspaceBranding(workspaceId),
        // Unlike branding, the candidate list is not readable without
        // `candidates.manage`, so an Author asks for nothing rather than
        // collecting a 403 that would fail this whole load.
        canManageCandidates ? client.candidates(workspaceId, testId) : Promise.resolve([]),
        client.versions(workspaceId, testId),
      ]);
      setTest(summary);
      setVersions(history);
      setWorkspaceBranding(branding);
      setCandidates(listed);
      setDraft(version);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The test could not be loaded.");
    }
  }, [client, workspaceId, testId, canManageCandidates]);

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

  /** Opens the checklist (and re-runs it from inside). The rows are the
   * server's — this screen never computes one. */
  async function runChecklist(): Promise<void> {
    setRerunning(true);
    try {
      setChecklist(await client.checklist(workspaceId, testId));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The checklist could not be read.");
    } finally {
      setRerunning(false);
    }
  }

  async function onPublish(): Promise<void> {
    setPublishing(true);
    try {
      setTest(await client.publishTest(workspaceId, testId));
      setChecklist(null);
      setError(undefined);
      // The publish opened the next numbered draft server-side (UX-18), so
      // the whole screen is re-read rather than patched up field by field:
      // the draft row, its version number and the history all moved at once.
      await load();
    } catch (cause) {
      // A 422 means the gate disagreed with the list this screen was
      // showing — something changed between opening it and confirming. The
      // honest answer is to show what the gate just said, not to argue.
      const rows = cause instanceof ApiError ? (cause.details as { rows?: ChecklistRow[] } | undefined)?.rows : undefined;
      if (rows !== undefined) setChecklist(rows);
      else setError(cause instanceof ApiError ? cause.message : "The test could not be published.");
    } finally {
      setPublishing(false);
    }
  }

  // UX-10 / ADR 0007: an Author who cannot publish flags the test for an
  // Admin instead. One field on the test row, the same `PATCH .../tests/:id`
  // the list screen already uses for the slug.
  async function onRequestReview(): Promise<void> {
    try {
      setTest(await client.updateTest(workspaceId, testId, { reviewRequested: true }));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The review request could not be saved.");
    }
  }

  async function onTransition(kind: "close" | "archive"): Promise<void> {
    setPublishing(true);
    try {
      setTest(
        await (kind === "close"
          ? client.closeTest(workspaceId, testId)
          : client.archiveTest(workspaceId, testId)),
      );
      setError(undefined);
      setConfirming(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The test could not be updated.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <OrganiserHeader email={actor.email} onSignOut={onSignOut} onBack={onBack} backLabel="Back to tests" />

      <main id="main-content" className="organiser organiser--wide">
        <MonoCaption>Test builder</MonoCaption>
        <h1 className="organiser__title">{test?.name ?? "Test builder"}</h1>

        {test !== null && (
          <div className="testbuilder-lifecycle">
            <TestStateBadge state={test.state} />

            {/* UX-11: the button is in place and disabled for an Author,
                not hidden — a control that vanishes teaches nothing, and
                the reason has to be reachable by keyboard, which a
                `disabled` button is not. `aria-disabled` plus a no-op
                handler keeps it in the tab order so a reader meets the
                explanation `aria-describedby` points at. */}
            <button
              type="button"
              className="button-primary button-primary--surface"
              aria-disabled={!canPublish || publishing || draft === null}
              aria-describedby={canPublish ? undefined : "publish-why"}
              onClick={() => {
                if (canPublish && !publishing) void runChecklist();
              }}
            >
              Publish
            </button>
            {!canPublish && <span id="publish-why">Needs an Admin — request review instead</span>}

            {!canPublish && !test.reviewRequested && (
              <button type="button" className="button-secondary" onClick={() => void onRequestReview()}>
                Request review
              </button>
            )}
            {test.reviewRequested && <span className="test-badge"><span aria-hidden="true">◆</span> In review</span>}

            {canPublish && test.state !== "closed" && test.state !== "archived" && published && (
              <button type="button" className="button-secondary" onClick={() => setConfirming("close")}>
                Close
              </button>
            )}
            {canPublish && test.state === "closed" && (
              <button type="button" className="button-secondary" onClick={() => setConfirming("archive")}>
                Archive
              </button>
            )}
          </div>
        )}

        {test !== null && draft !== null && (
          <VersionBanner
            draftVersion={draft.version}
            publishedVersion={test.currentVersion}
            onOpenPublished={() => historyRef.current?.focus()}
          />
        )}

        {error !== undefined && (
          <p className="organiser__notice" role="alert">
            {error}
          </p>
        )}

        {checklist !== null && draft !== null && (
          <PublishChecklist
            rows={checklist}
            version={draft.version}
            rerunning={rerunning}
            busy={publishing}
            onGoTo={(row) => {
              if (row.sectionId !== undefined) openSection(row.sectionId);
            }}
            onRerun={() => void runChecklist()}
            onConfirm={() => void onPublish()}
            onClose={() => setChecklist(null)}
          />
        )}

        {confirming !== null && (
          <ConfirmTransition
            kind={confirming}
            busy={publishing}
            onCancel={() => setConfirming(null)}
            onConfirm={() => void onTransition(confirming)}
          />
        )}

        {versions.some((v) => v.publishedAt !== null) && (
          <div ref={historyRef} tabIndex={-1}>
            <VersionHistory versions={versions} />
          </div>
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
            candidates={candidates}
            identityField={identityFieldOf(draft.body.settings.registration_form)}
            canManageCandidates={canManageCandidates}
            onImportCandidates={async (csv, opts) => {
              const report = await client.importCandidates(workspaceId, testId, csv, opts);
              // A dry run changed nothing, so there is nothing to re-read;
              // a real one replaced the list, and the count the panel
              // prints has to come from storage rather than from the
              // report it just rendered.
              if (!opts.dryRun && report.issues.length === 0) {
                setCandidates(await client.candidates(workspaceId, testId));
              }
              return report;
            }}
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

/** The field a candidate list is keyed on: the first `unique: true` field
 * in the registration form's own order. The same rule
 * `apps/api/src/import/candidates.ts` applies — stated in both places
 * because the panel prints it and the converter keys on it, and a screen
 * naming one column while the server wants another is the defect this
 * exists to avoid. */
function identityFieldOf(form: { fields: FormField[] } | undefined): FormField | null {
  return form?.fields.find((field) => field.unique === true) ?? null;
}


/** T-04's two confirmations. Each names **what a candidate will see
 * afterwards** rather than asking "are you sure?": closing is the moment
 * the public link stops working, and an organiser pressing it needs to be
 * told that, not asked to agree with themselves. */
const TRANSITION_COPY: Readonly<Record<"close" | "archive", { title: string; body: string; confirm: string }>> = {
  close: {
    title: "Close this test?",
    body: "Candidates opening the link will see that the test has closed. Attempts already in progress keep running to their own deadline.",
    confirm: "Close the test",
  },
  archive: {
    title: "Archive this test?",
    body: "Candidates opening the link will see that the test has closed. Archiving is the last state a test has — it cannot be reopened, and the test is never deleted.",
    confirm: "Archive the test",
  },
};

function ConfirmTransition({
  kind,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: "close" | "archive";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = TRANSITION_COPY[kind];
  const { dialogRef, onKeyDown } = useDialogKeys<HTMLDivElement>(true, onCancel);
  return (
    <div
      className="organiser__panel"
      role="dialog"
      aria-label={copy.title}
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      <button type="button" className="button-primary button-primary--surface" disabled={busy} onClick={onConfirm}>
        {copy.confirm}
      </button>
      <button type="button" className="button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
