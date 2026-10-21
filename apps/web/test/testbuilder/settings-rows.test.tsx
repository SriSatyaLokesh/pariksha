// `D7`: the five settings collapse into one panel of rows that each state
// their own setting, opening in place, one at a time.
//
// The whole point of this file is the word *state*. A collapsed panel is one
// an organiser has to find, and the only thing that pays for the collapse is
// a row that answers "what is timing set to" without being opened. A summary
// that describes the field — "when the test opens and closes" — buys nothing
// and fails every assertion below.
//
// `D14`: every assertion starts at `OrganiserApp` and clicks its way to the
// builder. The panels themselves are asserted in their own files
// (timing.test.tsx, access.test.tsx, release-branding.test.tsx); what is
// asserted here is where they live and when they mount.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";

import {
  type Actor,
  type ApiClient,
  type TestSummary,
  type TestVersionRow,
  type Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const TEST_ROW: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  closesAt: null,
  state: "draft",
  currentVersion: null,
  draftVersion: 1,
  reviewRequested: false,
  tags: [],
  updatedAt: 0,
};

// A draft with something set in every one of the five, because a row that
// states a value only when the value is the default states nothing.
const DRAFT: TestVersionRow = {
  id: "ver_1",
  testId: "tst_1",
  version: 1,
  body: {
    settings: {
      timing: {
        timezone: "Asia/Kolkata",
        duration_minutes: 60,
        opens_at: "2026-10-24T09:00:00+05:30",
        closes_at: "2026-10-24T18:00:00+05:30",
      },
      access: { mode: "link_code", access_code: "APTI-2026" },
      release: { when: "on_submit", show: "score_and_sections" },
      // The branding case `D7` names by hand: one half set, one half not.
      branding: { start_message: "Read the instructions before you begin." },
      registration_form: {
        fields: [
          { id: "email", type: "email", label: "Email", required: true, unique: true },
          { id: "roll_number", type: "short_text", label: "Roll number" },
        ],
      },
    },
    sections: [],
  },
  publishedAt: null,
  createdAt: 0,
  draw: {},
  setPoints: {},
  points: {},
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notUsed = () => {
    throw new Error("not used by this test file");
  };
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    createBank: notUsed,
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    saveQuestion: notUsed,
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: notUsed,
    updateGroup: notUsed,
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: notUsed,
    tests: async () => [TEST_ROW],
    createTest: notUsed,
    test: async () => TEST_ROW,
    updateTest: notUsed,
    draft: async () => DRAFT,
    patchDraft: async () => DRAFT,
    publishTest: notUsed,
    closeTest: notUsed,
    archiveTest: notUsed,
    versions: async () => [],
    checklist: async () => [],
    cloneTest: notUsed,
    exportTest: notUsed,
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: notUsed,
    // The workspace half of branding: the logo lives here, not on the draft.
    workspaceBranding: async () => ({ logo: "media/wsp_1/abc.png", logo_alt: "Alpha College" }),
    saveWorkspaceBranding: notUsed,
    uploadMedia: notUsed,
    candidates: async () => [],
    importCandidates: notUsed,
    ...overrides,
  };
}

/** Clicks from the app's entry point to the builder (`D14`). */
async function openBuilder(client: ApiClient = fakeClient()) {
  const result = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  return result;
}

/** The row's own control. Its accessible name opens with the label, so a
 *  row whose summary moved into a tooltip or a title attribute fails here
 *  rather than passing quietly. */
function rowFor(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}\\b`) });
}

describe("the five settings are rows that state their own setting (D7)", () => {
  it("states each setting's current value while collapsed", async () => {
    await openBuilder();

    // Timing: the spec's own example, to the character.
    expect(
      screen.getByText("60 minutes · opens 24 Oct 09:00 IST · closes 24 Oct 18:00 IST · 1 attempt"),
    ).toBeVisible();
    expect(screen.getByText("Link and code · code APTI-2026 · no candidates on the list")).toBeVisible();
    expect(screen.getByText("2 fields · 1 required · identified by Email")).toBeVisible();
    expect(screen.getByText("On submit · score and sections")).toBeVisible();
    expect(screen.getByText("logo set · start message set · finish message empty")).toBeVisible();
  });

  it("states a value, never the name of the field it is for", async () => {
    await openBuilder();
    // The failure this whole task exists to prevent, named as an assertion:
    // "when the test opens and closes" is a description; "opens 24 Oct" is a
    // value. No row may read as the former.
    for (const label of ["Timing", "Access", "Registration", "Results", "Branding"]) {
      expect(rowFor(label)).not.toHaveTextContent(/\bchoose\b|\bset (?:up|the|a)\b|\bwhen the test\b/i);
    }
  });

  it("mounts no panel until its row is opened", async () => {
    await openBuilder();
    expect(screen.queryByRole("heading", { name: "Timing and attempts" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Who can take this test" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Registration form" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "When candidates see their result" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Branding" })).toBeNull();
  });

  it("opens the panel in place when its row is clicked", async () => {
    await openBuilder();
    fireEvent.click(rowFor("Timing"));

    expect(rowFor("Timing")).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("heading", { name: "Timing and attempts" })).toBeVisible();
  });

  it("opens one panel at a time", async () => {
    await openBuilder();

    fireEvent.click(rowFor("Timing"));
    expect(rowFor("Timing")).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(rowFor("Access"));
    expect(rowFor("Access")).toHaveAttribute("aria-expanded", "true");
    expect(rowFor("Timing")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Timing and attempts" })).toBeNull();
  });

  it("closes the open panel when its own row is clicked again", async () => {
    await openBuilder();
    fireEvent.click(rowFor("Timing"));
    fireEvent.click(rowFor("Timing"));
    expect(rowFor("Timing")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Timing and attempts" })).toBeNull();
  });

  // The one that matters: a summary computed once at mount is a summary
  // that lies. This changes the value, closes the row, and reads it back.
  it("updates the summary when the setting changes", async () => {
    const patchDraft = vi.fn(async () => DRAFT);
    await openBuilder(fakeClient({ patchDraft }));

    fireEvent.click(rowFor("Timing"));
    fireEvent.change(await screen.findByLabelText(/overall duration/i), { target: { value: "90" } });
    fireEvent.click(rowFor("Timing"));

    expect(rowFor("Timing")).toHaveTextContent("90 minutes");
    expect(screen.queryByText(/60 minutes/)).toBeNull();

    // And the change really went down the shell's one save path, so the row
    // is reporting the draft rather than a number it invented.
    await waitFor(() => expect(patchDraft).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("says when a setting is empty rather than omitting it", async () => {
    await openBuilder();
    // The draft sets `start_message` and never `finish_message`; the
    // workspace sets a logo. All three are stated, including the one that
    // is not there.
    expect(rowFor("Branding")).toHaveTextContent("logo set · start message set · finish message empty");
  });

  it("states the emptiness of a setting nothing has been written to", async () => {
    const empty: TestVersionRow = { ...DRAFT, body: { settings: {}, sections: [] } };
    await openBuilder(
      fakeClient({ draft: async () => empty, workspaceBranding: async () => ({}) }),
    );

    expect(rowFor("Timing")).toHaveTextContent(
      "60 minutes · no opening time · no closing time · 1 attempt",
    );
    expect(rowFor("Access")).toHaveTextContent("Link and code · no code set · no candidates on the list");
    expect(rowFor("Registration")).toHaveTextContent("no fields yet · nothing identifies a candidate");
    expect(rowFor("Results")).toHaveTextContent("On submit · score only");
    expect(rowFor("Branding")).toHaveTextContent(
      "logo empty · start message empty · finish message empty",
    );
  });

  it("has no axe violations collapsed or open", async () => {
    const { container } = await openBuilder();
    const rows = within(container).getByRole("region", { name: "Settings" });
    expect(await axe(rows)).toHaveNoViolations();

    fireEvent.click(rowFor("Access"));
    await screen.findByRole("heading", { name: "Who can take this test" });
    expect(await axe(rows)).toHaveNoViolations();
  });
});
