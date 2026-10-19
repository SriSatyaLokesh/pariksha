import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import type { ApiClient, TestSummary } from "../../src/lib/api";
import { TestList } from "../../src/routes/tests";

const PUBLISHED: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  state: "open",
  currentVersion: 1,
  draftVersion: null,
  reviewRequested: true,
  tags: ["exam"],
  updatedAt: 1_700_000_000_000,
};

const DRAFT: TestSummary = {
  id: "tst_2",
  name: "Aptitude",
  slug: "aptitude",
  description: null,
  shortCode: "zz99yy",
  state: "draft",
  currentVersion: null,
  draftVersion: 1,
  reviewRequested: false,
  tags: [],
  updatedAt: 1_700_000_000_000,
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => null,
    workspaces: async () => [],
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
    tests: async () => [PUBLISHED],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => {
      throw new Error("not used");
    },
    updateTest: async (_workspaceId, _testId, patch) => ({ ...PUBLISHED, ...patch }),
    ...overrides,
  };
}

const renderList = (client: ApiClient) =>
  render(
    <TestList workspaceId="wsp_1" client={client} actorEmail="rao@example.edu" onSignOut={() => undefined} onBack={() => undefined} />,
  );

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("TestList", () => {
  it("the list is a table with aria-sort on the sorted column", async () => {
    renderList(fakeClient());
    await screen.findByText("Midterm");
    expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute("aria-sort", "ascending");
  });

  it("state and In review are text plus glyph, never colour alone", async () => {
    renderList(fakeClient({ tests: async () => [DRAFT] }));
    const row = (await screen.findByText("Aptitude")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/draft/i)).toBeVisible();
    expect(row?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);

    renderList(fakeClient({ tests: async () => [PUBLISHED] }));
    const publishedRow = (await screen.findByText("Midterm")).closest("tr");
    expect(within(publishedRow as HTMLElement).getByText(/in review/i)).toBeVisible();
  });

  it("filters, tags and search live in the URL and survive the back button", async () => {
    const tests = vi.fn(async () => [PUBLISHED]);
    renderList(fakeClient({ tests }));
    await screen.findByText("Midterm");

    fireEvent.change(screen.getByLabelText(/^search$/i), { target: { value: "mid" } });
    await waitFor(() => expect(window.location.search).toContain("search=mid"));

    // The back button: the browser moves the location back and fires
    // `popstate` — dispatched here rather than relying on jsdom's own
    // `history.back()` timing, so this is a direct test of the listener.
    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => expect(screen.getByLabelText(/^search$/i)).toHaveValue(""));
  });

  it("the locked slug is read-only, not disabled, and says why", async () => {
    renderList(fakeClient());
    await screen.findByText("Midterm");

    expect(screen.getByLabelText(/slug/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/slug/i)).not.toBeDisabled();
    expect(screen.getByText(/locked because this test has been published/i)).toBeVisible();
  });

  it("the QR code has a text alternative and the short link is reachable without it", async () => {
    renderList(fakeClient());
    await screen.findByText("Midterm");

    expect(screen.getByRole("img", { name: /qr code for the short link/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /\/t\// })).toBeVisible();
  });

  it("copying the short link confirms in a live region without moving focus", async () => {
    renderList(fakeClient());
    await screen.findByText("Midterm");

    const button = screen.getByRole("button", { name: /copy short link/i });
    // `fireEvent.click` does not focus the element the way a real pointer
    // click does — focused explicitly here so the assertion below tests
    // "stays where it was", not an artefact of the test harness never
    // having focused anything at all.
    button.focus();
    fireEvent.click(button);

    expect(await screen.findByRole("status")).toHaveTextContent(/copied/i);
    expect(document.activeElement).toBe(button);
  });

  it("an empty workspace and a filter with no results are different states with different actions", async () => {
    renderList(fakeClient({ tests: async () => [] }));
    expect(await screen.findByText(/no tests yet/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /create your first test/i })).toBeVisible();

    window.history.pushState(null, "", "/?search=zzz");
    renderList(fakeClient({ tests: async () => [] }));
    expect(await screen.findByText(/no tests match your filters/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeVisible();
  });

  it("the test list has no axe violations", async () => {
    const { container } = renderList(fakeClient());
    await screen.findByText("Midterm");
    expect(await axe(container)).toHaveNoViolations();
  });
});
