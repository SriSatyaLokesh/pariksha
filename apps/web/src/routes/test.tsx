import { useCallback, useEffect, useRef, useState } from "react";
import { can } from "@pariksha/core";
import type {
  ProctoringOverrides,
  ProctoringProfile,
  TestAccess,
  TestBranding,
  TestRelease,
  TestTiming,
} from "@pariksha/core";
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
import { SectionList } from "../components/testbuilder/SectionList";
import { FormBuilder } from "../components/testbuilder/FormBuilder";
import { TimingPanel } from "../components/testbuilder/TimingPanel";
import { AccessPanel } from "../components/testbuilder/AccessPanel";
import { ResultsPanel } from "../components/testbuilder/ResultsPanel";
import { BrandingPanel } from "../components/testbuilder/BrandingPanel";
import { ProctoringPanel } from "../components/testbuilder/ProctoringPanel";
import {
  PANEL_KEYS,
  SettingRow,
  accessSummary,
  brandingSummary,
  identityFieldOf,
  proctoringSummary,
  registrationSummary,
  resultsSummary,
  timingSummary,
  type PanelKey,
} from "../components/testbuilder/SettingRow";
import { Icon, useRetractRail } from "../components/OrganiserShell";
import { VersionBanner, VersionHistory } from "../components/testbuilder/VersionBanner";
import { PublishChecklist } from "../components/testbuilder/PublishChecklist";
import { TestStateBadge } from "./tests";
import { useDialogKeys } from "../components/useDialogKeys";
import { readView, writeView } from "../lib/view-url";
import { readRailState, writeRailState, type RailState } from "../lib/rail-state";

// Screens 7, 9, 11, 12 (docs/design.md's screen inventory): the builder
// shell. Task 3 is only Screen 7 (sections, `SectionList`) — the access,
// checklist and version-banner panels are later tasks' own components,
// mounted into this same shell when they land, the same way `SectionList`
// is mounted here now.

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

/** `ProctoringPanel`'s `value` is required (unlike the draft's own optional
 * `proctoring` block), so a draft that has never set one gets the same
 * thing `resolveProctoring(undefined)` would resolve against anyway — the
 * `off` profile, no overrides. */
const DEFAULT_PROCTORING: { profile: ProctoringProfile; overrides: ProctoringOverrides } = {
  profile: "off",
  overrides: {},
};

/**
 * Which setting the URL says is open (`D7` in `D5`'s query string).
 *
 * Two claims this resolves, both of which a hand-edited or stale link can
 * make:
 *
 * 1. A `?panel=` that names nothing. `view-url.ts` is explicit that it does
 *    not validate — an id in a URL is a claim anyone can type, and the
 *    consumer decides — so the check against the five lives here, where the
 *    union does, and not in the shared parser.
 * 2. `?section=` and `?panel=` together. **The spine wins**: the section
 *    opens and no panel does (6.5d's ruling). A stale URL that opens a
 *    section instead of a setting costs one click to correct; the reverse
 *    hides the thing being edited behind a settings panel.
 *
 * Deliberately a question about the URL and not about the draft, which has
 * not been fetched when this first runs: `?section=` naming a section this
 * test does not have still suppresses the panel. The rule is "the URL
 * claims a section", not "a section is open", because the second is not
 * knowable on first paint and a rule that changes answer once the fetch
 * lands is worse than one that is stable and occasionally empty.
 */
function panelFromUrl(): PanelKey | null {
  const params = readView(window.location.search);
  if (params.section) return null;
  const claimed = params.panel;
  return (PANEL_KEYS as readonly string[]).includes(claimed ?? "")
    ? (claimed as PanelKey)
    : null;
}

export function TestBuilder({
  workspaceId,
  testId,
  client,
  actor,
}: {
  workspaceId: string;
  testId: string;
  client: ApiClient;
  actor: Actor;
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
  // Task 13 (#64, P5.11), re-sited by 6.5d's `D7`: `null` is "not read
  // yet", NOT "not open" — the checklist is a rail that is present from the
  // first paint, so this is filled by `load` below rather than by the
  // Publish button. `[]` would be the opposite claim ("every check passed")
  // and is what the rail prints once the load answers with no rows.
  // UX-17 survives the move: Publish still re-runs the checks and sends the
  // reader to the rail, and confirming inside the rail is what calls the
  // route.
  const [checklist, setChecklist] = useState<readonly ChecklistRow[] | null>(null);
  // `D7a`/`D7d`: which side the viewer left the checklist rail on, per
  // viewer. Only the checklist side is stored — `rail-state.ts`'s own header
  // says why the nav side is not.
  const [rail, setRail] = useState<RailState>(readRailState);
  const railRef = useRef<HTMLElement>(null);
  // `D7a`'s other side. `OrganiserShell` owns the nav rail's state under
  // `D18`; this is the one-call handle it hands its children. Transient and
  // unstored, which is what keeps it clear of `D18`'s width-derived default.
  const retractNavRail = useRetractRail();
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
  // The open section lives in the URL (`?section=<id>`), so a reload or a
  // shared link returns to it — read on first paint and on `popstate`
  // through `readView`, which is the organiser's one query-string parser
  // (`D5`). This screen used to carry its own two-line copy of it.
  const [openSectionId, setOpenSectionId] = useState<string | null>(
    () => readView(window.location.search).section ?? null,
  );
  // Phase 6.5d (`D7`): one open setting at a time, so this is one key and
  // not a set — and it lives in `?panel=`, through the same
  // `readView`/`writeView` pair `?section=` above already uses, so an
  // opened setting is a place a reload, a bookmark and Back all return to.
  const [openPanel, setOpenPanel] = useState<PanelKey | null>(panelFromUrl);
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

  /** The one writer of the rail's state, so the stored value and the
   *  rendered one cannot drift. Auto-retraction (`D7a`) goes through here
   *  too: a reader who opened a section meant the page to make room, and
   *  that is a preference worth remembering. */
  const setChecklistRail = useCallback((next: RailState["checklist"]) => {
    const state: RailState = { checklist: next };
    setRail(state);
    writeRailState(state);
  }, []);

  /**
   * `D7a` — "Opening a section or a setting retracts **both** sides
   * automatically", and the one place that is true of. Separate from
   * `setChecklistRail` above, which is also what the pin calls: pinning the
   * checklist back open is not an edit and must not touch the nav.
   *
   * "A convenience, never a lock": neither side is disabled by this. The nav
   * toggle in the top bar and the pin in the rail both still answer
   * immediately afterwards, which is what `checklist-rail.test.tsx`'s
   * "retracts both sides" case asserts after each retraction.
   */
  const retractSides = useCallback(() => {
    setChecklistRail("lights");
    retractNavRail();
  }, [setChecklistRail, retractNavRail]);

  const load = useCallback(async () => {
    try {
      const [summary, version, branding, listed, history, rows] = await Promise.all([
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
        // `D7`: the rail is present from the first paint, so its rows are
        // part of the screen's own load rather than something the Publish
        // button fetches. `requires("tests.edit")` on the route, which is
        // exactly who reaches this screen, so no role has to opt out of it
        // the way `candidates` above does.
        client.checklist(workspaceId, testId),
      ]);
      setTest(summary);
      setVersions(history);
      setWorkspaceBranding(branding);
      setCandidates(listed);
      setDraft(version);
      setChecklist(rows);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The test could not be loaded.");
    }
  }, [client, workspaceId, testId, canManageCandidates]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onPopState = () => {
      setOpenSectionId(readView(window.location.search).section ?? null);
      setOpenPanel(panelFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Written through `writeView` as well, so `?section=` has one owner
  // rather than a reader here and a writer there (`D5`; 6.5e takes this
  // over). It pushes where this used to replace: an opened section is a
  // place, and Back closing it is the behaviour the `popstate` listener
  // above already implements — before this, Back from an open section left
  // the builder outright and the section stayed open on the way back.
  //
  // The cost, plainly (fix round 1): Back now walks back through accordion
  // toggles, so an author who opened four sections presses it four times
  // before leaving the builder. The alternative was a `replace` option on
  // `writeView` — a knob with one caller, which would have left the
  // listener above describing behaviour its own writer contradicted.
  //
  // Rebuilding the whole view from the URL rather than from props is safe
  // only because `organiser.tsx` writes the URL before this screen mounts.
  // 6.5d and 6.5e must keep that invariant or pass the view in.
  function openSection(id: string | null): void {
    setOpenSectionId(id);
    // `D7a`: "Opening a section or a setting retracts both sides
    // automatically." Both, now: `retractSides` above collapses the nav rail
    // through `OrganiserShell`'s context as well. A convenience and never a
    // lock — the pin in the rail and the toggle in the bar both still answer.
    if (id !== null) retractSides();
    const params = readView(window.location.search);
    if (id) params.section = id;
    else delete params.section;
    writeView(params);
  }

  /** `D7`: one at a time, and its own row closes it — the same read-then-
   *  mutate shape as `openSection` above, for the same reason. `writeView`
   *  clears every id it owns that the params it is handed omit, so anything
   *  that built a `ViewParams` from scratch here would silently drop
   *  `?section=` (and `?test=`) on the way to writing `?panel=`. */
  function togglePanel(id: PanelKey): void {
    const next = openPanel === id ? null : id;
    setOpenPanel(next);
    if (next !== null) retractSides();
    const params = readView(window.location.search);
    if (next) params.panel = next;
    else delete params.panel;
    writeView(params);
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
  // `GET …/draft` — and, since `D7b`, by the one `GET …/checklist` that
  // rides it — because PATCH deliberately answers without
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
        //
        // `D7b`: the checklist rides that same settled save. "A rail that
        // reads only on mount lies while the author works" — it goes on
        // showing rows the author has already answered, and goes on offering
        // journeys into sections that are gone. One read per settled burst,
        // riding this save rather than a timer of its own: a second debounce
        // would be a second answer to the question this one already settled,
        // and the interval is not a knob (`AG2`).
        //
        // **Riding the same save is not sharing a fate** (fix round 2, review
        // Important). These are two reads of two different things. A single
        // `Promise.all` over them did two harms at once: a rejected checklist
        // discarded an already-resolved draft through the shared `catch`,
        // freezing exactly the `UX-15` draw and `UX-12` points this read
        // exists to refresh — and, on the normal path, held those figures
        // until the heavier call answered, because `checklistFor` scans every
        // question in the workspace (apps/api/src/routes/tests.ts). So: two
        // chains, each applying its own answer the moment it lands, each
        // behind its own `saveSeq` check so a reply from an older burst
        // cannot overwrite a newer one, and neither able to fail the other.
        //
        // The rows are taken exactly as the server sends them — the gate's
        // own order, words and severities (#64). Nothing here re-counts or
        // re-sorts them; `PublishChecklist` counts, and counts only what it
        // was given.
        //
        // No join over the two, deliberately (fix round 2 re-review). An
        // `await Promise.all([…])` here would be inert — nothing follows it,
        // and each chain already applies its own answer from inside itself —
        // but it is the one line a later reader could mistake for the
        // coupling this round removed. Two statements say what happens.
        void (async () => {
          try {
            const fresh = await client.draft(workspaceId, testId);
            if (saveSeq.current !== seq) return;
            setDraft((prev) => (prev === null ? prev : { ...fresh, body: prev.body }));
          } catch {
            // The save itself landed; only the derived figures are a beat
            // behind, and the next settled burst corrects them. Reporting a
            // failure over a save that succeeded would be the worse lie.
          }
        })();
        void (async () => {
          try {
            const rows = await client.checklist(workspaceId, testId);
            if (saveSeq.current !== seq) return;
            setChecklist(rows);
          } catch {
            // A rail that emptied itself on a read that did not answer
            // would be a louder lie than one a beat stale, so the rows it
            // is holding stay up until a read succeeds.
          }
        })();
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

  /** Re-runs the checks — from the Publish button, and from inside the rail.
   * The rows are the server's; this screen never computes one. */
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
      {/* No wrapper element here. `admin.css`'s `.organiser__panel` is
          `display:flex; flex-direction:column; gap: var(--space-lg)` —
          byte-identical to what `.organiser` already applies to
          `.shell__page`, so a <div> carrying it inside the page was a
          layout no-op (measured in Chrome at 1440 and 400: every child's
          rect unchanged). Removing it also removes the trap of 6.5e
          styling the builder's root as a panel by accident, and it gives
          each panel below its own `overflow-x: auto` under 719px —
          `overflow-x` on these children went `visible` -> `auto` in the
          same measurement — which is one scroll container per panel, as
          `D3a` intends, rather than one around the whole screen
          (whole-branch review, Minor 3). */}
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
              if (!canPublish || publishing) return;
              // UX-17 is unchanged by `D7`'s move: this still opens the
              // checklist rather than publishing. What "open" means is now
              // "re-read it, dock the rail, and take the reader there" —
              // the rows were already on screen, and a control whose whole
              // effect is elsewhere on the page has to move focus with it.
              void runChecklist();
              setChecklistRail("docked");
              railRef.current?.focus();
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
          {test.reviewRequested && <span className="test-badge"><Icon name="review" /> In review</span>}

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

      {/* `D18` — the flag above is the whole of ADR 0007 that shipped.
          `docs/design.md`'s screen 10 — the reviewers list, per-question
          comments, the Approved / Changes-requested marks — is NOT
          DESIGNED, and a builder that quietly showed a flag and nothing
          else leaves the organiser waiting for a panel that is not coming.
          So this states the gap and builds none of it: no reviewer names,
          no comment box, no approval control. Inventing one here would
          promise a workflow with no server route, no permission and no
          screen behind it. It appears only while the flag is set, because
          with no review pending there is no gap to name. */}
      {test?.reviewRequested === true && (
        <p className="review-note">
          Comments and approvals arrive with ADR 0007&apos;s second half.
        </p>
      )}

      {/* `D7`: the rail, before the spine rather than after it. A direct
          child of `.shell__page`, deliberately — testbuilder.css lays the
          builder's page out as two columns and puts this one in the second,
          and a wrapper around the spine would take shell.css's phone-width
          `overflow-x: auto` off each panel and give it to the wrapper
          instead, which is the per-panel scroll container `D3a` wants.
          Early in the document order, because a rail a keyboard reader
          reaches only after the whole builder is a rail they never reach. */}
      {draft !== null && (
        <PublishChecklist
          railRef={railRef}
          rows={checklist}
          // `D7b` fix round 1: the rows and the sections answer questions
          // asked at different moments — the rows were read before the
          // author's last keystroke — so the rail is handed both and decides
          // which rows still lead anywhere.
          //
          // Id AND title, because the rail has two questions to answer about
          // a destination and they need different halves: `onGoTo` opens by
          // id, and the journey label names the section the way the spine
          // does (`D7a`: "Go to Section B", not "Go to quant").
          sections={draft.body.sections.map(({ id, title }) => ({ id, title }))}
          version={draft.version}
          rerunning={rerunning}
          busy={publishing}
          state={rail.checklist}
          onState={setChecklistRail}
          // `D7b`, the other half: a row can outlive the section it names —
          // a delete is a save, and the read that clears the row is a
          // debounce and two round trips behind it. Fix round 1 moved that
          // judgement into `destinationOf`, which is the one predicate the
          // strip and the panel both read, so a stale row stops ANNOUNCING
          // the journey rather than offering one this then declines — the
          // same defect task 3's review ruled on for field rows.
          //
          // **The premise, because it is what a later edit would break:**
          // `sections` above and this closure are sibling attributes of one
          // JSX element, built in ONE render from the SAME `draft`. That — not
          // the predicate on its own — is what makes a membership check here
          // redundant rather than defensive: the ids that gated the control
          // and the ids this would test are the same value, so there is no
          // window between them, not even a torn one.
          //
          // Break that and the hole re-opens with no test watching it. It
          // breaks if the two are ever sourced from different renders: a
          // `useCallback` around this handler with stale deps, a memoised or
          // hoisted `sections`, ids derived from `pending` rather than
          // `draft`, or a `React.memo` comparator on `PublishChecklist` that
          // lets one prop through while holding the other back. Any of those
          // and this guard has to come back.
          onGoTo={(row) => {
            if (row.sectionId !== undefined) openSection(row.sectionId);
          }}
          onRerun={() => void runChecklist()}
          onConfirm={() => void onPublish()}
        />
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

      {/* Fix round 1, Minor 1: `draft === null` is also where a refused
          load leaves this screen, so the error above used to be
          announced beside a "Loading…" that would never resolve. Under
          `D5` that pair is the first thing a stale bookmark shows. The
          notice is the whole answer when there is one. */}
      {draft === null ? (
        error === undefined && (
          <p className="organiser__status" role="status">
            Loading…
          </p>
        )
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
        /* `D7`: one panel of rows, each stating its own setting. The five
           panels below are unchanged — they are `children` now, mounted
           only while their row is open. Every summary is called HERE, at
           render, from the draft this screen already holds: a summary
           cached anywhere would still read 60 minutes after the organiser
           typed 90. */
        <section className="setting-rows" aria-labelledby="settings-heading">
          <h2 id="settings-heading">Settings</h2>

          <SettingRow
            id="timing"
            icon={<Icon name="timing" />}
            label="Timing"
            summary={timingSummary(draft.body.settings.timing ?? DEFAULT_TIMING)}
            open={openPanel === "timing"}
            onToggle={togglePanel}
          >
            <TimingPanel
              timing={draft.body.settings.timing ?? DEFAULT_TIMING}
              sections={draft.body.sections}
              published={published}
              onChange={(timing) => saveSettings({ timing })}
            />
          </SettingRow>

          <SettingRow
            id="access"
            icon={<Icon name="access" />}
            label="Access"
            summary={accessSummary(
              draft.body.settings.access ?? DEFAULT_ACCESS,
              // `load` asks for the list only with `candidates.manage`, so
              // without it there is no count to state — only the reason.
              canManageCandidates ? candidates.length : null,
            )}
            open={openPanel === "access"}
            onToggle={togglePanel}
          >
            <AccessPanel
              access={draft.body.settings.access ?? DEFAULT_ACCESS}
              onChange={(access) => saveSettings({ access })}
              candidates={candidates}
              identityField={identityFieldOf(draft.body.settings.registration_form)}
              canManageCandidates={canManageCandidates}
              onImportCandidates={async (csv, opts) => {
                const report = await client.importCandidates(workspaceId, testId, csv, opts);
                // A dry run changed nothing, so there is nothing to
                // re-read; a real one replaced the list, and the count the
                // panel prints has to come from storage rather than from
                // the report it just rendered.
                if (!opts.dryRun && report.issues.length === 0) {
                  setCandidates(await client.candidates(workspaceId, testId));
                }
                return report;
              }}
            />
          </SettingRow>

          <SettingRow
            id="registration"
            icon={<Icon name="registration" />}
            label="Registration"
            summary={registrationSummary(draft.body.settings.registration_form)}
            open={openPanel === "registration"}
            onToggle={togglePanel}
          >
            <FormBuilder
              form={draft.body.settings.registration_form}
              onChange={(registration_form) => saveSettings({ registration_form })}
              checkUrl={(url) => client.checkUrl(workspaceId, testId, url)}
            />
          </SettingRow>

          <SettingRow
            id="results"
            icon={<Icon name="results" />}
            label="Results"
            summary={resultsSummary(draft.body.settings.release ?? DEFAULT_RELEASE)}
            open={openPanel === "results"}
            onToggle={togglePanel}
          >
            <ResultsPanel
              release={draft.body.settings.release ?? DEFAULT_RELEASE}
              onReleaseChange={(release) => saveSettings({ release })}
              retention={draft.body.settings.retention}
              onRetentionChange={(retention) => saveSettings({ retention })}
              // No route emits a cost figure yet (`K35`'s estimator has no
              // caller until 8d/8e/the publish checklist thread it
              // through) — omitted here, not a stray `undefined`, which is
              // also `K36`'s own shape on `node`: absent is correct on
              // both targets until one exists.
            />
          </SettingRow>

          <SettingRow
            id="branding"
            icon={<Icon name="branding" />}
            label="Branding"
            summary={brandingSummary(draft.body.settings.branding ?? NO_BRANDING, workspaceBranding)}
            open={openPanel === "branding"}
            onToggle={togglePanel}
          >
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
          </SettingRow>

          <SettingRow
            id="proctoring"
            icon={<Icon name="proctoring" />}
            label="Proctoring"
            summary={proctoringSummary(
              draft.body.settings.proctoring,
              draft.body.settings.timing?.duration_minutes ?? null,
            )}
            open={openPanel === "proctoring"}
            onToggle={togglePanel}
          >
            <ProctoringPanel
              // `ProctoringPanel`'s `value` requires both members — unlike
              // the draft's own `proctoring` block, which (like every
              // settings block here) may be present with either left
              // unset. Each is defaulted on its own rather than falling
              // back to `DEFAULT_PROCTORING` wholesale, which would also
              // discard a stored `overrides` beside a missing `profile` —
              // the same per-field care `DEFAULT_PROCTORING`'s own members
              // match anyway.
              value={{
                profile: draft.body.settings.proctoring?.profile ?? DEFAULT_PROCTORING.profile,
                overrides: draft.body.settings.proctoring?.overrides ?? DEFAULT_PROCTORING.overrides,
              }}
              durationMinutes={draft.body.settings.timing?.duration_minutes ?? null}
              onChange={(proctoring) => saveSettings({ proctoring })}
            />
          </SettingRow>
        </section>
      )}
    </>
  );
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
