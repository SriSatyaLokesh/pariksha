// Lifecycle and numbered published versions (#62, P5.9) — T-04, UX-10,
// UX-11, UX-18.
//
// No @testing-library/user-event in this workspace — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note; keyboard
// coverage is real `fireEvent.keyDown`/`focus` rather than a claim.
//
// Every assertion here starts at `OrganiserApp` and clicks its way to the
// builder (the standing pre-submit rule: rendering `TestBuilder` directly
// proves nothing about whether the running app ever mounts these controls).

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import {
  ApiError,
  type ApiClient,
  type Actor,
  type TestSummary,
  type TestVersionRow,
  type LockedAttemptRow,
} from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE = { id: "wsp_1", name: "Placement cell" };

function actorOf(role: "owner" | "admin" | "author"): Actor {
  return { userId: "usr_1", email: "rao@example.edu", memberships: [{ workspaceId: "wsp_1", role, grants: [] }] };
}

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

const DRAFT: TestVersionRow = {
  id: "ver_1",
  testId: "tst_1",
  version: 1,
  body: { settings: {}, sections: [] },
  publishedAt: null,
  createdAt: 0,
  draw: {},
  setPoints: {},
  points: {},
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => actorOf("owner"),
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    listTags: async () => [],
    listGroups: async () => [],
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    tests: async () => [TEST_ROW],
    test: async () => TEST_ROW,
    updateTest: async () => TEST_ROW,
    draft: async () => DRAFT,
    patchDraft: async () => DRAFT,
    publishTest: async () => TEST_ROW,
    closeTest: async () => TEST_ROW,
    archiveTest: async () => TEST_ROW,
    versions: async () => [],
    checklist: async () => [],
    readiness: async () => ({}),
    cloneTest: async () => {
      throw new Error("not used by this test file");
    },
    exportTest: async () => {
      throw new Error("not used by this test file");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    workspaceBranding: async () => ({}),
    candidates: async () => [],
    lockedAttempts: async () => [],
    usage: async () => undefined,
    listApiKeys: async () => ({ keys: [] }),
    ...overrides,
  });
}

/** Dashboard -> Tests -> the builder, the only route an organiser has. */
async function openBuilder(client: ApiClient): Promise<ReturnType<typeof render>> {
  const view = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  return view;
}

describe("the builder's lifecycle header", () => {
  it("the state is text plus glyph in the list row and again in the builder header", async () => {
    const open: TestSummary = { ...TEST_ROW, state: "open", currentVersion: 1, draftVersion: 2 };
    render(<OrganiserApp client={fakeClient({ tests: async () => [open], test: async () => open })} />);

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    const row = (await screen.findByText("Midterm")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Open")).toBeVisible();
    expect(row.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);

    fireEvent.click(within(row).getByRole("button", { name: "Midterm" }));
    const header = await screen.findByRole("heading", { level: 1, name: "Midterm" });
    const main = header.closest("main") as HTMLElement;
    const badge = within(main).getByText("Open");
    expect(badge).toBeVisible();
    expect(badge.closest(".test-state")?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("UX-18: the banner is one line, states what attempts in progress stay on, and links to it", async () => {
    const published: TestSummary = { ...TEST_ROW, state: "open", currentVersion: 1, draftVersion: 2 };
    await openBuilder(
      fakeClient({
        tests: async () => [published],
        test: async () => published,
        draft: async () => ({ ...DRAFT, version: 2 }),
        versions: async () => [
          { version: 2, publishedAt: null, attemptCount: 0 },
          { version: 1, publishedAt: 1_700_000_000_000, attemptCount: 3 },
        ],
      }),
    );

    // Scoped by its own text: `ReorderableList` keeps its own `role="status"`
    // announcement on this screen, so a bare `getByRole("status")` is
    // ambiguous rather than wrong.
    const banner = (await screen.findByText(/attempts in progress stay on version 1/i)).closest(
      "[role='status']",
    ) as HTMLElement;
    expect(banner).toHaveTextContent("Version 2 (draft). Attempts in progress stay on version 1.");
    expect(within(banner).getByRole("button", { name: /view version 1/i })).toBeVisible();
  });

  it("no banner on a test that has never been published — there is nothing to stay on", async () => {
    await openBuilder(fakeClient());
    expect(screen.queryByText(/attempts in progress stay on/i)).toBeNull();
  });

  it("version history lists each version with when it was published and how many attempts are pinned", async () => {
    await openBuilder(
      fakeClient({
        test: async () => ({ ...TEST_ROW, state: "open", currentVersion: 1, draftVersion: 2 }),
        draft: async () => ({ ...DRAFT, version: 2 }),
        versions: async () => [
          { version: 2, publishedAt: null, attemptCount: 0 },
          { version: 1, publishedAt: 1_700_000_000_000, attemptCount: 3 },
        ],
      }),
    );

    const table = await screen.findByRole("table", { name: /version history/i });
    expect(within(table).getByRole("rowheader", { name: "Version 1" })).toBeVisible();
    expect(within(table).getByText("3")).toBeVisible();
    expect(within(table).getByText(/not published yet/i)).toBeVisible();
  });
});

describe("UX-11: who may publish", () => {
  it("an Author sees Publish in place, disabled, with the reason beside it and reachable by keyboard", async () => {
    const publishTest = vi.fn(async () => TEST_ROW);
    await openBuilder(fakeClient({ me: async () => actorOf("author"), publishTest }));

    const button = screen.getByRole("button", { name: /^publish$/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      "Needs an Admin — request review instead",
    );

    // Reachable, so a reader actually meets the explanation — and inert, so
    // pressing it does not 403 them.
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(publishTest).not.toHaveBeenCalled();
  });

  it("UX-10: requesting review sets the flag and the badge appears", async () => {
    const updateTest = vi.fn(async () => ({ ...TEST_ROW, reviewRequested: true }));
    await openBuilder(fakeClient({ me: async () => actorOf("author"), updateTest }));

    fireEvent.click(screen.getByRole("button", { name: /request review/i }));
    await waitFor(() => expect(updateTest).toHaveBeenCalledWith("wsp_1", "tst_1", { reviewRequested: true }));
    expect(await screen.findByText(/in review/i)).toBeVisible();
  });

  it("an Admin's Publish opens the checklist rather than publishing outright (UX-17)", async () => {
    const publishTest = vi.fn(async () => TEST_ROW);
    const checklist = vi.fn(async () => [
      {
        id: "section_empty",
        severity: "blocking" as const,
        message: 'section "Quantitative" has no questions',
        field: "section.source",
      },
    ]);
    await openBuilder(fakeClient({ me: async () => actorOf("admin"), publishTest, checklist }));

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    await waitFor(() => expect(checklist).toHaveBeenCalledWith("wsp_1", "tst_1"));

    // A `region` and not a `dialog` since `D7`: the checklist is a right rail
    // on the page from the first paint, and Publish re-reads it and docks it
    // rather than conjuring it. UX-17 is unchanged — what Publish opens is
    // still a checklist.
    const rail = await screen.findByRole("region", { name: /publish checklist/i });
    expect(rail).toHaveAttribute("data-state", "docked");
    expect(within(rail).getByText('section "Quantitative" has no questions')).toBeVisible();
    // Nothing published: the gate is a checklist, not a button.
    expect(publishTest).not.toHaveBeenCalled();
  });
});

describe("closing and archiving", () => {
  const openTest: TestSummary = { ...TEST_ROW, state: "open", currentVersion: 1, draftVersion: 2 };

  it("closing confirms first, and names what candidates will see afterwards", async () => {
    const closeTest = vi.fn(async () => ({ ...openTest, state: "closed" as const }));
    await openBuilder(fakeClient({ test: async () => openTest, closeTest }));

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    const dialog = screen.getByRole("dialog", { name: /close this test/i });
    expect(dialog).toHaveTextContent(/candidates opening the link will see that the test has closed/i);
    expect(closeTest).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /close the test/i }));
    await waitFor(() => expect(closeTest).toHaveBeenCalledWith("wsp_1", "tst_1"));
    expect(await screen.findByText("Closed")).toBeVisible();
  });

  it("the confirmation takes focus and Escape closes it without acting", async () => {
    const closeTest = vi.fn(async () => openTest);
    await openBuilder(fakeClient({ test: async () => openTest, closeTest }));

    const opener = screen.getByRole("button", { name: /^close$/i });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: /close this test/i });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(closeTest).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("Archive is offered only once the test is closed — Archived follows Closed", async () => {
    const open = await openBuilder(fakeClient({ test: async () => openTest }));
    expect(screen.queryByRole("button", { name: /^archive$/i })).toBeNull();

    // Two whole apps in one test: the first has to go, and so does the URL
    // it navigated to — `D5` put the open test in the query string, so a
    // second `render` left to inherit `?view=test&test=tst_1` would boot
    // straight back into the builder and never pass through Home.
    open.unmount();
    window.history.replaceState(null, "", "/");

    const closed: TestSummary = { ...openTest, state: "closed" };
    await openBuilder(fakeClient({ test: async () => closed }));
    expect(screen.getAllByRole("button", { name: /^archive$/i }).length).toBeGreaterThan(0);
  });

  it("the builder header, banner and confirmation have no axe violations", async () => {
    const { container } = await openBuilder(
      fakeClient({
        test: async () => openTest,
        draft: async () => ({ ...DRAFT, version: 2 }),
        versions: async () => [
          { version: 2, publishedAt: null, attemptCount: 0 },
          { version: 1, publishedAt: 1_700_000_000_000, attemptCount: 3 },
        ],
      }),
    );
    await screen.findByText(/attempts in progress stay on version 1/i);
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});

// Phase 7e fix wave (M4, M5): the route's own `onUnlock` handler — the half
// of the unlock surface `locked-attempts.test.tsx` cannot reach, since that
// file mounts `LockedAttempts` directly rather than through `routes/
// test.tsx`'s real wiring.
describe("the locked-attempts unlock surface (M4, M5)", () => {
  const LOCKED: LockedAttemptRow = {
    attemptId: "att_1",
    candidateLabel: "21CS0147",
    lockedAt: 1_760_000_000_000,
    violations: 5,
    remainingSeconds: 600,
  };

  it("M5: a single click does not unlock — a second, explicit confirm is required", async () => {
    const unlockAttempt = vi.fn(async () => undefined);
    await openBuilder(fakeClient({ lockedAttempts: async () => [LOCKED], unlockAttempt }));

    fireEvent.click(await screen.findByRole("button", { name: /Unlock 21CS0147/i }));
    expect(unlockAttempt).not.toHaveBeenCalled();
    expect(screen.getByText(/Unlock 21CS0147\?/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^Confirm unlock$/i }));
    await waitFor(() => expect(unlockAttempt).toHaveBeenCalledWith("wsp_1", "tst_1", "att_1"));
  });

  it("M5: Cancel backs out without unlocking", async () => {
    const unlockAttempt = vi.fn(async () => undefined);
    await openBuilder(fakeClient({ lockedAttempts: async () => [LOCKED], unlockAttempt }));

    fireEvent.click(await screen.findByRole("button", { name: /Unlock 21CS0147/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    expect(unlockAttempt).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Unlock 21CS0147/i })).toBeVisible();
  });

  it("M4: a failed unlock reports the error instead of silently leaving the row", async () => {
    await openBuilder(
      fakeClient({
        lockedAttempts: async () => [LOCKED],
        unlockAttempt: async () => {
          throw new ApiError(409, "not_locked", "That attempt is no longer locked.");
        },
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: /Unlock 21CS0147/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirm unlock$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That attempt is no longer locked.");
    // The row is still there — the organiser is not told it succeeded.
    expect(screen.getByRole("button", { name: /Unlock 21CS0147/i })).toBeVisible();
  });
});
