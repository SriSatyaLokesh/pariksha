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

import type {
  ApiClient,
  Actor,
  ChecklistRow,
  DraftPatch,
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
    // ...but only the three that name a section are controls. A light for a
    // setting-level row has nowhere to go, so it is not something to press.
    expect(lights.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /re-run the checks/i })).toBeNull();

    fireEvent.click(pin());

    expect(rail()).toHaveAttribute("data-state", "docked");
    expect(screen.getByRole("button", { name: /re-run the checks/i })).toBeVisible();
  });

  it("gives every light a name that says what and where", async () => {
    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());
    fireEvent.click(collapse());

    expect(
      screen.getByRole("button", { name: /Blocking — a pool cannot fill\. Go to Section B\./ }),
    ).toBeVisible();

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
    fireEvent.focus(screen.getByRole("button", { name: /Blocking — a pool cannot fill\. Go to Section B\./ }));
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
    fireEvent.click(screen.getByRole("button", { name: /apply the change/i }));

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

    // The light still offers the journey, because the rail is still holding
    // the rows it was given. Pressing it must not take the builder to a
    // section that is not there — a `?section=` naming nothing opens nothing
    // AND suppresses every setting panel (`panelFromUrl`), so the reader is
    // left on a screen with no spine and no settings.
    fireEvent.click(screen.getByRole("button", { name: /Go to quant\./ }));

    expect(new URLSearchParams(window.location.search).get("section")).toBeNull();
    expect(screen.getByRole("heading", { name: /^sections$/i })).toBeVisible();
  });
});
