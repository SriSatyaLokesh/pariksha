// `D7` / `D7a` / `D7d` — the publish checklist stops being the last thing on
// the page and becomes a right rail that is present from the first paint,
// collapses to a strip of indicator lights, and floats the full panel back
// over the page rather than reflowing what is being edited.
//
// `D14`: every assertion starts at `OrganiserApp` and clicks its way to the
// builder, so the wiring under test is the real one — which rows the rail is
// given, what a light does, what opening a section does to it.
//
// WHAT THIS FILE CANNOT ANSWER, named here so nobody mistakes a green run for
// the whole gate: jsdom performs no layout. `getBoundingClientRect()` returns
// zeros for every element, so "the floating panel is visible, has a non-zero
// box, and lies inside the viewport" is unaskable here and a `toEqual` over
// two zero rects would pass before the feature existed. That half is measured
// in a real browser at 1280px and at 390px by
// `apps/web/e2e/measurement/checklist-rail.spec.ts`. What is asserted below
// is the state machine: what hovering, focusing, pinning and opening a
// section do to the rail.

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import { ApiError } from "../../src/lib/api";
import type {
  ApiClient,
  Actor,
  ChecklistRow,
  DraftPatch,
  StoredSection,
  TestSummary,
  TestVersionRow,
  Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "admin", grants: [] }],
};

const TEST_ROW: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  closesAt: null,
  state: "draft",
  currentVersion: 1,
  draftVersion: 2,
  reviewRequested: false,
  tags: [],
  updatedAt: 0,
};

const DRAFT: TestVersionRow = {
  id: "ver_2",
  testId: "tst_1",
  version: 2,
  body: {
    settings: {},
    sections: [
      { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } },
      { id: "reasoning", title: "Logical reasoning", source: { kind: "fixed", questions: [] } },
    ],
  },
  publishedAt: null,
  createdAt: 0,
  draw: {},
  setPoints: {},
  points: {},
};

/** Seven rows, two of them blocking — so the readiness figure is "5 / 7" and
 *  the strip carries seven lights. The first row's words are the server's
 *  own: the light's accessible name is built from them, never written here.
 *
 *  Three of the seven name a SECTION and four name a setting field, and that
 *  split is deliberate: `onGoTo` opens a section, so only the first three are
 *  places the builder can take you. Fix round 1 — before it, all seven
 *  rendered as controls that named a destination and did nothing. */
const ROWS: ChecklistRow[] = [
  {
    id: "pool_short",
    severity: "blocking",
    message: "a pool cannot fill",
    field: "source.count",
    sectionId: "Section B",
  },
  {
    id: "section_empty",
    severity: "blocking",
    message: 'section "Quantitative aptitude" has no questions',
    field: "section.source",
    sectionId: "quant",
  },
  {
    id: "sets_unbalanced",
    severity: "advisory",
    message: "sets have unequal total points",
    field: "source.sets",
    sectionId: "reasoning",
  },
  { id: "access_code_missing", severity: "advisory", message: "no access code is set", field: "access.access_code" },
  { id: "release_at_missing", severity: "advisory", message: "results have no release rule", field: "release.at" },
  { id: "logo_missing", severity: "advisory", message: "no logo is set", field: "branding.logo" },
  { id: "window_long", severity: "advisory", message: "the window is longer than a week", field: "timing.closes_at" },
];

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    createBank: async () => {
      throw new Error("not used");
    },
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    saveQuestion: async () => {
      throw new Error("not used");
    },
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: async () => {
      throw new Error("not used");
    },
    updateGroup: async () => {
      throw new Error("not used");
    },
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: async () => {
      throw new Error("not used");
    },
    tests: async () => [TEST_ROW],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => TEST_ROW,
    updateTest: async () => TEST_ROW,
    draft: async () => DRAFT,
    patchDraft: async () => DRAFT,
    publishTest: async () => TEST_ROW,
    closeTest: async () => TEST_ROW,
    archiveTest: async () => TEST_ROW,
    versions: async () => [],
    checklist: async () => ROWS,
    cloneTest: async () => {
      throw new Error("not used by this test file");
    },
    exportTest: async () => {
      throw new Error("not used by this test file");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: async () => {
      throw new Error("not used");
    },
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: async () => {
      throw new Error("not used");
    },
    uploadMedia: async () => {
      throw new Error("not used");
    },
    candidates: async () => [],
    importCandidates: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

/** Home -> Tests -> the builder. Nothing presses Publish: the rail is what
 *  this file is about, and it has to be there before anyone asks. */
async function openBuilder(client: ApiClient = fakeClient()): Promise<HTMLElement> {
  const { container } = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  return container;
}

const rail = (): HTMLElement => screen.getByRole("region", { name: /publish checklist/i });

/** The rail's one dock toggle: a pin when the rail is a strip of lights, a
 *  collapse when the panel is docked. One control in both states, so it is
 *  operable whether or not a panel is open (`D7a`). */
const pin = (): HTMLElement => screen.getByRole("button", { name: /pin the checklist open/i });
const collapse = (): HTMLElement => screen.getByRole("button", { name: /collapse the checklist to lights/i });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the checklist rail", () => {
  it("shows the checklist beside the spine from the first paint", async () => {
    const checklist = vi.fn(async () => ROWS);
    await openBuilder(fakeClient({ checklist }));

    // Read as part of the screen's own load, not behind the Publish button.
    await waitFor(() => expect(checklist).toHaveBeenCalledWith("wsp_1", "tst_1"));

    const region = rail();
    expect(region).toBeVisible();
    // Not at the end: the rail precedes the spine in the document, which is
    // what lets it sit beside the sections rather than under them.
    const spine = screen.getByRole("heading", { name: /^sections$/i });
    expect(region.compareDocumentPosition(spine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a readiness figure matching the rows", async () => {
    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());
    // The figure is not alone: two of the seven stop a publish, and the rail
    // says so in words rather than leaving it to a colour.
    expect(within(rail()).getByText(/2 must fix/i)).toBeVisible();
  });

  // Fix round 1. The figure used to be followed by the literal word "clear"
  // with the qualifier suppressed at zero, so seven advisory rows read
  // "7 / 7 clear" directly above seven rows each labelled "Worth checking" —
  // the rail contradicting its own panel, which is the failure the rail
  // exists to prevent. The arithmetic is unchanged; the words are not.
  it("does not call advisory rows clear when nothing blocks", async () => {
    const advisory = ROWS.filter((row) => row.severity === "advisory");
    await openBuilder(fakeClient({ checklist: async () => advisory }));

    await waitFor(() => expect(within(rail()).getByText("5 / 5")).toBeVisible());
    expect(within(rail()).getByText(/not blocking, 0 must fix/i)).toBeVisible();
    expect(within(rail()).queryByText(/\bclear\b/i)).toBeNull();
    // ...and the rows it is a figure about are still there, still called what
    // the gate calls them.
    expect(within(rail()).getAllByText(/worth checking/i)).toHaveLength(5);
  });

  it("collapses to a strip of lights and back", async () => {
    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());

    // Docked: the panel's own controls are there and there are no lights.
    expect(screen.getByRole("button", { name: /re-run the checks/i })).toBeVisible();
    expect(screen.queryByRole("list", { name: /checklist lights/i })).toBeNull();

    fireEvent.click(collapse());

    expect(rail()).toHaveAttribute("data-state", "lights");
    const lights = within(screen.getByRole("list", { name: /checklist lights/i }));
    // One light per row, every time — the strip is the rows, not a selection
    // from them.
    expect(lights.getAllByRole("listitem")).toHaveLength(7);

    // ...but only a row that names a section the draft STILL HAS is a
    // control. Three of the seven name a section and all three are lit — the
    // count above does not move — and the one naming `Section B`, which is in
    // no draft this fixture ever had, says what is wrong and promises no
    // journey, exactly as a setting-level row does.
    //
    // Fix round 1. Before it, `hasDestination` asked only whether the ROW
    // carried a `sectionId`, so a row could announce a destination that was
    // not there and do nothing when pressed — the defect task 3's review
    // already ruled on for field rows, reaching the strip by the other door.
    expect(lights.getByText("Blocking — a pool cannot fill.")).toBeInTheDocument();
    expect(
      lights.getByText('Blocking — section "Quantitative aptitude" has no questions. Go to quant.'),
    ).toBeInTheDocument();
    expect(lights.getByText("Advisory — sets have unequal total points. Go to reasoning.")).toBeInTheDocument();
    expect(lights.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /re-run the checks/i })).toBeNull();

    fireEvent.click(pin());

    expect(rail()).toHaveAttribute("data-state", "docked");
    expect(screen.getByRole("button", { name: /re-run the checks/i })).toBeVisible();
  });

  it("gives every light a name that says what and where", async () => {
    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());
    fireEvent.click(collapse());

    // A row naming a section the draft does not have is in the same case as
    // a setting-level row: it states the problem and promises nothing (fix
    // round 1 — it used to read "Go to Section B" and then not go).
    expect(screen.getByText("Blocking — a pool cannot fill.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /a pool cannot fill/ })).toBeNull();

    // A row that names a setting field says what is wrong and promises no
    // journey, because there is none to make: `onGoTo` opens a section and
    // this row names none. It is text in the strip, not a control.
    expect(screen.getByText("Advisory — no access code is set.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /no access code is set/i })).toBeNull();

    // And a light that does name a section is the way there, not only a label.
    fireEvent.click(screen.getByRole("button", { name: /Blocking — section "Quantitative aptitude" has no questions\. Go to quant\./ }));
    expect(new URLSearchParams(window.location.search).get("section")).toBe("quant");
  });

  it("floats the panel over the page without reflowing the spine", async () => {
    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());
    fireEvent.click(collapse());

    // Hovering the strip floats the panel; the rail STAYS collapsed, which
    // is the whole of "it must never reflow what is being edited" that a
    // layout-free DOM can answer. The box that proves it paints is measured
    // in Chromium by e2e/measurement/checklist-rail.spec.ts.
    fireEvent.mouseEnter(rail());
    const panel = screen.getByRole("button", { name: /re-run the checks/i }).closest(".checklist-rail__panel");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("data-floating", "true");
    expect(rail()).toHaveAttribute("data-state", "lights");

    fireEvent.mouseLeave(rail());
    expect(screen.queryByRole("button", { name: /re-run the checks/i })).toBeNull();

    // Tabbing into the strip floats it too — a keyboard reader never hovers.
    // The full accessible name, anchored, the way every other query in this
    // file names a light: the target moved in fix round 1 (`Section B` is no
    // longer a control), the matcher's discipline did not (fix round 2,
    // review Minor 4).
    fireEvent.focus(
      screen.getByRole("button", {
        name: /^Blocking — section "Quantitative aptitude" has no questions\. Go to quant\.$/,
      }),
    );
    expect(screen.getByRole("button", { name: /re-run the checks/i })).toBeVisible();
  });

  it("retracts both sides when a section opens, and both toggles still work", async () => {
    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());
    expect(rail()).toHaveAttribute("data-state", "docked");

    // The section's own summary button, anchored at the start of its name:
    // the reorder controls beside it are "Move section Quantitative aptitude
    // up" and would match a looser pattern.
    const shell = document.querySelector(".shell") as HTMLElement;
    expect(shell.dataset.rail).toBe("open");

    fireEvent.click(screen.getByRole("button", { name: /^Quantitative aptitude/ }));

    // BOTH sides, which is what `D7a` says and what this test is named for.
    // Fix round 1: the nav half used to be missing and this assertion was a
    // comment explaining its absence.
    expect(rail()).toHaveAttribute("data-state", "lights");
    expect(shell.dataset.rail).toBe("collapsed");

    // "Auto-collapse is a convenience, never a lock" — so both toggles still
    // answer, immediately, with no second click to wake them.
    fireEvent.click(screen.getByRole("button", { name: /navigation/i }));
    expect(shell.dataset.rail).toBe("open");

    fireEvent.click(pin());
    expect(rail()).toHaveAttribute("data-state", "docked");

    // And opening a SETTING retracts both the same way a section does.
    fireEvent.click(screen.getByRole("button", { name: /^Timing/ }));
    expect(rail()).toHaveAttribute("data-state", "lights");
    expect(shell.dataset.rail).toBe("collapsed");
  });

  it("renders with the default rail state when localStorage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("The operation is insecure.");
      },
      setItem() {
        throw new Error("The operation is insecure.");
      },
    });

    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());
    expect(rail()).toHaveAttribute("data-state", "docked");

    // And a choice that cannot be remembered still applies to this tab.
    fireEvent.click(collapse());
    expect(rail()).toHaveAttribute("data-state", "lights");
  });

  it("the rail has no axe violations, docked and collapsed", async () => {
    const container = await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(collapse());
    expect(await axe(container)).toHaveNoViolations();
  });
});

// `D7b` — the rail refetches `GET …/checklist` once per settled save burst,
// riding the follow-up draft read the builder already fires (test.tsx's save
// effect). A rail that reads only on mount lies while the author works: it
// goes on showing rows the author has already fixed, and it goes on offering
// journeys into sections that no longer exist.
//
// Everything below counts REAL calls on the client the screen was handed, and
// drives the real debounce on real timers — the interval is the builder's and
// is not a knob this file may touch (`AG2`).
describe("the rail refetches as the author works", () => {
  /** Echoes the patch back, the way the route does. The file's own
   *  `patchDraft` answers the fixed `DRAFT`, which would restore a section
   *  the moment it was deleted — fine for a file that never saved, useless
   *  here. */
  const echo = async (_ws: string, _id: string, patch: DraftPatch): Promise<TestVersionRow> => ({
    ...DRAFT,
    body: { ...DRAFT.body, ...patch },
  });

  /** Three keystrokes in one section title: one burst, one settled save. */
  function typeSeveralEdits(): void {
    fireEvent.click(screen.getByRole("button", { name: /^Quantitative aptitude/ }));
    const title = screen.getByLabelText("Title");
    for (const value of ["Quant", "Quanti", "Quantit"]) fireEvent.change(title, { target: { value } });
  }

  /** Long enough for the 250 ms debounce, the PATCH and the reads that ride
   *  it — and then some, so a SECOND read would have landed if one were
   *  coming. */
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
  }

  it("refetches the checklist once after a burst of edits settles", async () => {
    const checklist = vi.fn(async () => ROWS);
    await openBuilder(fakeClient({ checklist, patchDraft: echo }));
    // The first paint's own read, which `D7` already owns. Everything after
    // this is the refetch under test.
    await waitFor(() => expect(checklist).toHaveBeenCalledTimes(1));
    const checklistCalls = () => checklist.mock.calls.slice(1);

    typeSeveralEdits();
    await settle();

    expect(checklistCalls()).toHaveLength(1);
    expect(checklistCalls()[0]).toEqual(["wsp_1", "tst_1"]);
  });

  it("does not refetch per keystroke", async () => {
    const checklist = vi.fn(async () => ROWS);
    const patchDraft = vi.fn(echo);
    await openBuilder(fakeClient({ checklist, patchDraft }));
    await waitFor(() => expect(checklist).toHaveBeenCalledTimes(1));
    const checklistCalls = () => checklist.mock.calls.slice(1);

    typeSeveralEdits();
    // Mid-burst: the save itself has not gone yet, so neither has the read.
    expect(patchDraft).not.toHaveBeenCalled();
    expect(checklistCalls()).toHaveLength(0);

    await settle();

    // Three keystrokes, one save, one read. Not three — and not zero, which
    // is what a rail that only reads on mount would show here.
    expect(patchDraft).toHaveBeenCalledTimes(1);
    expect(checklistCalls()).toHaveLength(1);
  });

  // Fix round 2 (review, Important). The two reads ride the same settled save
  // burst, but they are not one read and must not share a fate. `GET
  // …/checklist` is the heavier of the two — it scans every question in the
  // workspace (`checklistFor`, apps/api/src/routes/tests.ts) — and it can
  // fail on its own. Coupling them through a single `Promise.all` let a
  // checklist fault discard an already-resolved draft, which silently freezes
  // `UX-15`'s live draw and `UX-12`'s points: precisely the regression the
  // follow-up read exists to prevent.
  //
  // This is the guard that fails if they are ever recoupled.
  it("applies the draft figures when the checklist read fails", async () => {
    const pool: StoredSection = {
      id: "quant",
      title: "Quantitative aptitude",
      source: { kind: "pool", count: 10, filter: { tags: ["sql"] } },
    };
    let reads = 0;
    const draft = vi.fn(async (): Promise<TestVersionRow> => {
      reads += 1;
      return {
        ...DRAFT,
        body: { ...DRAFT.body, sections: [pool] },
        // UX-15's live draw, and the only figure that can say whether the
        // draft read was applied: 14 matching on the load, 11 after the save.
        draw: { quant: { matching: reads === 1 ? 14 : 11, wanted: 10 } },
      };
    });
    let checks = 0;
    const checklist = vi.fn(async () => {
      checks += 1;
      if (checks > 1) throw new ApiError(500, "server_error", "The checklist could not be read.");
      return ROWS;
    });
    await openBuilder(fakeClient({ draft, checklist, patchDraft: echo }));

    expect(await screen.findByText(/10 drawn from 14 matching/i)).toBeVisible();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());

    typeSeveralEdits();
    await settle();

    // The read that answered is applied. The read that failed does not get to
    // discard it, and does not get to hold it up either.
    expect(checklist).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/10 drawn from 11 matching/i)).toBeVisible();
    // ...and the rail keeps the rows it is holding rather than blanking over
    // a read that did not answer. The save itself landed; saying otherwise
    // would be the louder lie.
    expect(within(rail()).getByText("5 / 7")).toBeVisible();
  });

  it("shows a row that a save just cleared", async () => {
    const TIMING_MISSING: ChecklistRow = {
      id: "timing_missing",
      severity: "blocking",
      message: "no duration is set",
      field: "timing.duration_minutes",
    };
    const advisory = ROWS.filter((row) => row.severity === "advisory");
    let reads = 0;
    const checklist = vi.fn(async () => {
      reads += 1;
      return reads === 1 ? [TIMING_MISSING, ...advisory] : advisory;
    });
    await openBuilder(fakeClient({ checklist, patchDraft: echo }));

    // The gate's own sentence, in the rail, before the fix.
    await waitFor(() => expect(within(rail()).getByText(/no duration is set/i)).toBeInTheDocument());
    expect(within(rail()).getByText(/1 must fix/i)).toBeInTheDocument();

    // Set the duration. Opening a setting retracts the rail to its lights
    // (`D7a`), so the row leaving is watched in the collapsed state — the
    // strip and the panel are the same rows and both have to be right.
    fireEvent.click(screen.getByRole("button", { name: /^Timing/ }));
    expect(rail()).toHaveAttribute("data-state", "lights");
    fireEvent.change(screen.getByLabelText(/overall duration \(minutes\)/i), { target: { value: "90" } });
    // This fixture's test is published (`currentVersion: 1`), so `UX-18`'s
    // confirmation stands between the keystroke and the save. Named here
    // rather than reached by a loose button query, so the ledger's claim that
    // the dialog is answered is something the test actually asserts (fix
    // round 2, review Minor 5).
    const confirm = screen.getByRole("dialog", { name: /change timing on a published test/i });
    fireEvent.click(within(confirm).getByRole("button", { name: /apply the change/i }));

    await waitFor(() => expect(within(rail()).queryByText(/no duration is set/i)).toBeNull());
    expect(within(rail()).getByText(/0 must fix/i)).toBeInTheDocument();
  });

  it("does not navigate into a section deleted since the rail was read", async () => {
    // The rail's rows are a reading of a moment, and this one outlives the
    // section it names: the fixture keeps reporting `quant` after the author
    // has deleted it, which is exactly the window between a delete and the
    // gate's next answer.
    await openBuilder(fakeClient({ patchDraft: echo }));
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: /^Quantitative aptitude/ }));
    fireEvent.click(screen.getByRole("button", { name: /delete section/i }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /delete this section/i })).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Quantitative aptitude/ })).toBeNull());

    // The row is still in the rail, because the rail is still holding what it
    // was given — but there is now nothing to press. A `?section=` naming
    // nothing opens nothing AND suppresses every setting panel
    // (`panelFromUrl`), so a control that offered that journey and then
    // declined it would be the same keyboard-reachable lie as a field row
    // dressed as a destination (fix round 1).
    expect(within(rail()).getByText(/section "Quantitative aptitude" has no questions/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Go to quant\./ })).toBeNull();

    // Nowhere was navigated to, and the builder is where it was.
    expect(new URLSearchParams(window.location.search).get("section")).toBeNull();
    expect(screen.getByRole("heading", { name: /^sections$/i })).toBeVisible();
  });

  // Concern 3, answered in its narrow form: `D7b` makes the rail change under
  // the reader, so the one string that summarises what moved says so. ONLY
  // that string — a strip announcing every row while an author types would be
  // worse than silence — and `aria-atomic`, because without it a reader hears
  // the half that changed ("2 must fix") with nothing to measure it against.
  it("announces the readiness figure, and only it, when a save moves the rows", async () => {
    const advisory = ROWS.filter((row) => row.severity === "advisory");
    let reads = 0;
    const checklist = vi.fn(async () => {
      reads += 1;
      return reads === 1 ? ROWS : advisory;
    });
    await openBuilder(fakeClient({ checklist, patchDraft: echo }));
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());

    const readiness = within(rail()).getByText("5 / 7").closest("p");
    expect(readiness).toHaveAttribute("aria-live", "polite");
    expect(readiness).toHaveAttribute("aria-atomic", "true");
    // The rows themselves are not a live region: nothing else in the rail
    // announces, which is the whole of the budget this feature gets.
    //
    // Fix round 2 (review, MIN-2): `role="status"` and `role="alert"` are
    // live regions too — the rail already carries one ("Checking…", while
    // `rows === null`) — so a budget counting the attribute alone could not
    // see a row given an implicit region later.
    expect(rail().querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(1);

    typeSeveralEdits();
    await settle();

    // The same element, with the new figure in it — an announcement, not a
    // region that unmounted and came back.
    await waitFor(() => expect(within(rail()).getByText("5 / 5")).toBeVisible());
    expect(within(rail()).getByText("5 / 5").closest("p")).toBe(readiness);
  });
});

// `D18` — ADR 0007 shipped its first half only: `review_requested` and the
// "In review" badge. The reviewers list, per-question comments and the
// Approved / Changes-requested marks are `docs/design.md`'s screen 10 and
// are NOT DESIGNED, so this card names the gap and invents nothing. A card
// that grew an Approve button here would be the builder promising a review
// workflow that has no server, no permission and no screen behind it.
describe("the reviewers card", () => {
  const IN_REVIEW: TestSummary = { ...TEST_ROW, reviewRequested: true };
  const inReview = (): ApiClient =>
    fakeClient({ tests: async () => [IN_REVIEW], test: async () => IN_REVIEW });

  it("shows the review flag and says the rest is not built", async () => {
    await openBuilder(inReview());
    expect(screen.getByText(/In review/)).toBeVisible();
    expect(screen.getByText(/Comments and approvals arrive with ADR 0007's second half/)).toBeVisible();
  });

  it("offers no comment or approval control", async () => {
    await openBuilder(inReview());

    // THE CONTROL ARM, and the reason this negative means anything. The
    // brief's sketch had no mount at all, so `queryByRole` ran against an
    // empty document and answered `null` before the card existed and after
    // it — a test that passes either way (`AG3`). The builder IS mounted
    // above, and the same query mechanism, on the same screen, finds a
    // control that is really there. Only then is the `null` below evidence.
    expect(screen.getByRole("button", { name: /^Publish$/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Approve|Comment/ })).toBeNull();
  });

  // Spec §13: "One family, consistent stroke, SVG, self-hosted or inline —
  // PRD S-11 has no iconography exception." The badge used to carry U+25C6
  // BLACK DIAMOND, a font-dependent character in a text node. It is now the
  // one `ICONS`/`Icon` family, and — this is the half `D18` cares about —
  // it still contributes NOTHING to the badge's accessible name, which is
  // the string the list screen's own guard reads.
  it("carries the badge's glyph as the icon family, not a text character", async () => {
    await openBuilder(inReview());
    const badge = screen.getByText(/In review/).closest(".test-badge") as HTMLElement;

    const glyph = badge.querySelector("svg.shell__icon");
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph?.querySelectorAll("path").length).toBeGreaterThan(0);
    // Byte-identical to what a reader got before the swap: the glyph is
    // hidden, so the badge is the words and only the words.
    //
    // NOT `toHaveAccessibleName`, which was the first thing written here and
    // was vacuous: `.test-badge` is a plain `<span>` with no role, so
    // dom-accessibility-api computes "" for it — before the swap and after,
    // diamond or no diamond. The text IS the measurable thing, and it moved:
    // this read "◆ In review" an hour ago and would redden if a character
    // crept back into the markup beside the icon.
    expect(badge.textContent?.replace(/\s+/g, " ").trim()).toBe("In review");
  });
});
