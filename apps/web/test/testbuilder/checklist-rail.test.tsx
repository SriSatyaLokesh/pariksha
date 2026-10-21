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
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import type {
  ApiClient,
  Actor,
  ChecklistRow,
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
 *  own: the light's accessible name is built from them, never written here. */
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

  it("collapses to a strip of lights and back", async () => {
    await openBuilder();
    await waitFor(() => expect(within(rail()).getByText("5 / 7")).toBeVisible());

    // Docked: the panel's own controls are there and there are no lights.
    expect(screen.getByRole("button", { name: /re-run the checks/i })).toBeVisible();
    expect(screen.queryByRole("list", { name: /checklist lights/i })).toBeNull();

    fireEvent.click(collapse());

    expect(rail()).toHaveAttribute("data-state", "lights");
    expect(within(screen.getByRole("list", { name: /checklist lights/i })).getAllByRole("button")).toHaveLength(7);
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
    expect(
      screen.getByRole("button", { name: /Advisory — no access code is set\. Go to access\.access_code\./ }),
    ).toBeVisible();

    // And a light is the way there, not only a label.
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

    fireEvent.click(screen.getByRole("button", { name: /quantitative aptitude/i }));

    // The checklist side retracts. The nav side is `OrganiserShell`'s own
    // state and 6.5c owns `D18`'s rule for it, so this file asserts that its
    // toggle still answers rather than who collapsed it.
    expect(rail()).toHaveAttribute("data-state", "lights");

    const shell = document.querySelector(".shell") as HTMLElement;
    const before = shell.dataset.rail;
    fireEvent.click(screen.getByRole("button", { name: /navigation/i }));
    expect(shell.dataset.rail).not.toBe(before);

    // Auto-collapse is a convenience, never a lock: the pin still docks.
    fireEvent.click(pin());
    expect(rail()).toHaveAttribute("data-state", "docked");
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
