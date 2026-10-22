// Phase 7b Task 1 (`Q8`, phase-7-proctoring-design.md §11): proctoring
// becomes the sixth setting row. The whole point, same as
// settings-rows.test.tsx's own: the row STATES the resolved setting —
// "Strict · camera required · images every 60 s · warns at 5 violations" —
// never a description of the field, and an unset block reads "Off" plainly
// rather than being dropped.
//
// `D14`: every assertion starts at `OrganiserApp` and clicks (or deep-links)
// its way to the builder. No component is mounted in isolation.
//
// No `@testing-library/user-event` in this workspace (apps/web's
// package.json carries @testing-library/react and jest-dom only — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note). `user.click`
// below is a one-method local shim over `fireEvent.click`, kept so the
// brief's test bodies read exactly as written.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  Actor,
  ApiClient,
  TestSummary,
  TestVersionRow,
  Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

const user = { click: (element: Element) => fireEvent.click(element) };

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

function draftWith(
  settings: Partial<TestVersionRow["body"]["settings"]>,
): TestVersionRow {
  return {
    id: "ver_1",
    testId: "tst_1",
    version: 1,
    body: { settings, sections: [] },
    publishedAt: null,
    createdAt: 0,
    draw: {},
    setPoints: {},
    points: {},
  };
}

function fakeClient(draft: TestVersionRow): ApiClient {
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
    draft: async () => draft,
    patchDraft: async () => draft,
    publishTest: notUsed,
    closeTest: notUsed,
    archiveTest: notUsed,
    versions: async () => [],
    checklist: async () => [],
    cloneTest: notUsed,
    exportTest: notUsed,
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: notUsed,
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: notUsed,
    uploadMedia: notUsed,
    candidates: async () => [],
    importCandidates: notUsed,
  };
}

/**
 * Modelled on settings-rows.test.tsx:135 — render `OrganiserApp`, click
 * "Tests", click the test, await the `h1` — with one addition this file
 * needs that one did not: an open panel, named up front.
 *
 * A pre-named panel cannot be reached by clicking through, the way the
 * other three cases here do: `organiser.tsx`'s own navigation
 * (`writeView`/`paramsOf`) clears `?panel=` on every view transition that
 * does not itself name one, so `?panel=proctoring` set before the render
 * and then walked to by clicking "Tests" then "Midterm" would be wiped by
 * the second click, before `TestBuilder` ever mounts to read it. The
 * existing deep-link case in url-check.test.tsx is the same screen reached
 * the same way: the URL already names the view, the test and the panel —
 * exactly what a reload does (`D14`) — and `fromUrl()` builds the view from
 * it directly, never going through `writeView` at all.
 */
async function openBuilder(
  settings: Partial<TestVersionRow["body"]["settings"]>,
  view: { panel?: string } = {},
): Promise<void> {
  const client = fakeClient(draftWith(settings));
  if (view.panel) {
    window.history.replaceState(null, "", `/admin?view=test&test=${TEST_ROW.id}&panel=${view.panel}`);
    render(<OrganiserApp client={client} />);
  } else {
    render(<OrganiserApp client={client} />);
    await user.click(await screen.findByRole("button", { name: "Tests" }));
    await user.click(await screen.findByRole("button", { name: TEST_ROW.name }));
  }
  await screen.findByRole("heading", { level: 1, name: TEST_ROW.name });
}

describe("proctoring is the sixth setting row (Q8)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/admin");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/admin");
  });

  it("states the resolved proctoring setting while collapsed", async () => {
    await openBuilder({ proctoring: { profile: "strict", overrides: {} } });
    expect(await screen.findByText(/Strict · camera required · images every 60 s/)).toBeVisible();
  });

  it("states Off plainly when there is no proctoring block at all", async () => {
    await openBuilder({});
    // Two decisions this assertion had to make that the brief's literal
    // `findByText(/Proctoring — Off/)` does not survive, against
    // `SettingRow`'s existing, unchanged markup (shared by all six rows —
    // out of this task's scope to edit):
    //
    // 1. The label and the summary are two sibling <span>s, so
    //    "Proctoring — Off" is never one element's OWN text node — RTL's
    //    `getNodeText` deliberately reads only a node's direct text
    //    children, and `findByText` fails here with "the text is broken up
    //    by multiple elements" even though that is exactly what is
    //    visible. `getByRole("button", { name })` reads the accessible
    //    name instead, which does span both.
    // 2. The visible gap between "—" and "Off" is `.setting-row__button`'s
    //    CSS `gap`, not a space character — there is no whitespace text
    //    node between the two spans in the JSX — so the computed
    //    accessible name joins them as "Proctoring —" + "Off" with no
    //    space at all, and a literal `/Proctoring — Off/` (one space)
    //    still fails. `\s*` tolerates that gap while keeping the exact
    //    three words and their order.
    expect(await screen.findByRole("button", { name: /Proctoring\s*—\s*Off/ })).toBeVisible();
  });

  // Review Focus 5 — one at a time, and a hand-typed key resolves deterministically.
  it("retracts an open settings panel when proctoring opens", async () => {
    await openBuilder({});
    await user.click(screen.getByRole("button", { name: /Timing/ }));
    await user.click(screen.getByRole("button", { name: /Proctoring/ }));
    expect(screen.queryByRole("group", { name: /Timing/ })).toBeNull();
  });

  it("opens from ?panel=proctoring", async () => {
    await openBuilder({}, { panel: "proctoring" });
    expect(await screen.findByRole("group", { name: /Proctoring/ })).toBeVisible();
  });
});
