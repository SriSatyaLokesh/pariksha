import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import {
  ApiError,
  type Actor,
  type ApiClient,
  type TestSummary,
  type Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";
import { QrCode } from "../../src/components/QrCode";

// Task 2 fix round, Critical 2: the same comparison `qr-code.test.tsx` uses,
// applied to what the list actually renders — proves the row passes the
// short link itself into `QrCode`, not the test's slug or its id.
function darkCells(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('rect[fill="currentColor"]'))
    .map((rect) => `${rect.getAttribute("x")},${rect.getAttribute("y")}`)
    .join("|");
}

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const PUBLISHED: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  closesAt: null,
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
  closesAt: null,
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
    tests: async () => [PUBLISHED],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => {
      throw new Error("not used");
    },
    updateTest: async (_workspaceId, _testId, patch) => ({ ...PUBLISHED, ...patch }),
    draft: async () => {
      throw new Error("not used");
    },
    patchDraft: async () => {
      throw new Error("not used");
    },
    publishTest: async () => {
      throw new Error("not used by this test file");
    },
    closeTest: async () => {
      throw new Error("not used by this test file");
    },
    archiveTest: async () => {
      throw new Error("not used by this test file");
    },
    versions: async () => [],
    checklist: async () => [],
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
      throw new Error("not used by this test file");
    },
    uploadMedia: async () => {
      throw new Error("not used by this test file");
    },
    candidates: async () => [],
    importCandidates: async () => {
      throw new Error("not used by this test file");
    },
    ...overrides,
  };
}

// D14: Home -> Tests, from the app's own entry point. The list used to be
// rendered directly with six props, three of which Phase 6.5c Task 1 took
// away with `OrganiserHeader`.
const renderList = async (client: ApiClient) => {
  const view = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  await screen.findByRole("heading", { level: 1, name: "Tests" });
  return view;
};

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
    await renderList(fakeClient());
    await screen.findByText("Midterm");
    expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute("aria-sort", "ascending");
  });

  it("the tst_ id is selectable mono text with tabular figures (Important 9)", async () => {
    await renderList(fakeClient());
    const row = (await screen.findByText("Midterm")).closest("tr") as HTMLElement;
    const idCell = within(row).getByText(PUBLISHED.id);
    expect(idCell.tagName).toBe("CODE");
    expect(idCell).toHaveClass("test-id");
  });

  it("a status filter is reachable, not only promised by the no-results copy (Important 9)", async () => {
    const tests = vi.fn(async () => [PUBLISHED]);
    await renderList(fakeClient({ tests }));
    await screen.findByText("Midterm");
    tests.mockClear();

    fireEvent.change(screen.getByLabelText(/^status$/i), { target: { value: "published" } });

    await waitFor(() => expect(window.location.search).toContain("status=published"));
    await waitFor(() =>
      expect(tests).toHaveBeenCalledWith("wsp_1", expect.objectContaining({ status: "published" })),
    );
  });

  // Task 2 fix round (Minor 17): split from one test with two unreleased
  // `render()` calls, where a later query risked matching whichever tree
  // happened to contain a match first rather than the one it claimed to.
  it("state is text plus glyph, never colour alone", async () => {
    await renderList(fakeClient({ tests: async () => [DRAFT] }));
    const row = (await screen.findByText("Aptitude")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(/draft/i)).toBeVisible();
    expect(row?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it("the In review badge is text plus glyph, never colour alone", async () => {
    await renderList(fakeClient({ tests: async () => [PUBLISHED] }));
    const row = (await screen.findByText("Midterm")).closest("tr");
    expect(within(row as HTMLElement).getByText(/in review/i)).toBeVisible();
  });

  // Task 11 (#62) replaced the interim "published" state with the derived
  // five — the server now answers Scheduled or Open against the published
  // version's own window — so the case this used to cover is these two.
  it.each([
    ["scheduled", "Scheduled"],
    ["open", "Open"],
    ["archived", "Archived"],
  ] as const)("the derived %s state renders its own label and glyph, not a blank cell", async (state, label) => {
    await renderList(fakeClient({ tests: async () => [{ ...PUBLISHED, state }] }));
    const row = (await screen.findByText("Midterm")).closest("tr");
    expect(within(row as HTMLElement).getByText(label)).toBeVisible();
    expect(row?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it("filters, tags and search live in the URL and survive the back button", async () => {
    const tests = vi.fn(async () => [PUBLISHED]);
    await renderList(fakeClient({ tests }));
    await screen.findByText("Midterm");
    tests.mockClear();

    // Several characters, one at a time like real typing — not one jump to
    // the finished string — so this exercises the debounce (Important 7)
    // rather than a path a single `fireEvent.change` can't see.
    const pushSpy = vi.spyOn(window.history, "pushState");
    const search = screen.getByLabelText(/^search$/i);
    fireEvent.change(search, { target: { value: "m" } });
    fireEvent.change(search, { target: { value: "mi" } });
    fireEvent.change(search, { target: { value: "mid" } });

    await waitFor(() => expect(window.location.search).toContain("search=mid"));
    // `replaceState`, not `pushState`: three keystrokes must not become
    // three Back-button stops.
    expect(pushSpy).not.toHaveBeenCalled();
    // And the three keystrokes must not become three requests either — the
    // debounce collapses them into the one that reflects where typing
    // settled.
    await waitFor(() => expect(tests).toHaveBeenCalledTimes(1));
    expect(tests).toHaveBeenCalledWith("wsp_1", expect.objectContaining({ search: "mid" }));

    // The back button: the browser moves the location back and fires
    // `popstate` — dispatched here rather than relying on jsdom's own
    // `history.back()` timing, so this is a direct test of the listener.
    //
    // `?view=tests` and not `/`: the entry behind the filter is the list
    // itself, which `D5` now names in the query string. Going back to a
    // bare `/` is going back to Home, and Home has no Search field to
    // assert the clearing of.
    window.history.pushState(null, "", "/?view=tests");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => expect(screen.getByLabelText(/^search$/i)).toHaveValue(""));
  });

  it("the locked slug is read-only, not disabled, and says why", async () => {
    await renderList(fakeClient());
    const row = (await screen.findByText("Midterm")).closest("tr") as HTMLElement;

    // Scoped with `within(row)`: the create form above has its own field
    // also labelled "Slug" (PRD T-01, issue #54, docs/design.md:194 all
    // call it that — product copy does not get renamed to disambiguate a
    // test selector), so an unscoped query would throw on two matches.
    expect(within(row).getByLabelText(/slug/i)).toHaveAttribute("readonly");
    expect(within(row).getByLabelText(/slug/i)).not.toBeDisabled();
    expect(within(row).getByText(/locked because this test has been published/i)).toBeVisible();
  });

  it("the QR code has a text alternative and the short link is reachable without it", async () => {
    await renderList(fakeClient());
    await screen.findByText("Midterm");

    expect(screen.getByRole("img", { name: /qr code for the short link/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /\/t\// })).toBeVisible();
  });

  it("the QR code encodes the short link, not the slug or the id", async () => {
    const { container } = await renderList(fakeClient());
    await screen.findByText("Midterm");

    const reference = render(
      <QrCode
        value={`${window.location.origin}/t/${PUBLISHED.shortCode}`}
        label="QR code for the short link"
        size={64}
      />,
    );
    expect(darkCells(container)).toEqual(darkCells(reference.container));

    const wrongSlug = render(
      <QrCode value={`${window.location.origin}/t/${PUBLISHED.slug}`} label="QR code for the short link" size={64} />,
    );
    expect(darkCells(container)).not.toEqual(darkCells(wrongSlug.container));
  });

  // Task 12 added a second `role="status"` to this screen (the clone and
  // export activity line), so these three scope to the short link's own
  // cell rather than taking whichever live region the query finds first.
  function shortLinkCell(): HTMLElement {
    return screen.getByRole("button", { name: /copy short link/i }).closest("td") as HTMLElement;
  }

  it("copying the short link confirms in a live region without moving focus", async () => {
    await renderList(fakeClient());
    await screen.findByText("Midterm");

    const button = screen.getByRole("button", { name: /copy short link/i });
    // `fireEvent.click` does not focus the element the way a real pointer
    // click does — focused explicitly here so the assertion below tests
    // "stays where it was", not an artefact of the test harness never
    // having focused anything at all.
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(within(shortLinkCell()).getByRole("status")).toHaveTextContent(/copied/i));
    expect(document.activeElement).toBe(button);
  });

  it("the live region exists before any copy, so its text updates rather than being inserted (Important 8)", async () => {
    await renderList(fakeClient());
    await screen.findByText("Midterm");

    // Present and empty up front — an inserted-with-content live region is
    // what screen readers commonly fail to announce.
    expect(within(shortLinkCell()).getByRole("status")).toHaveTextContent("");
  });

  it("clears copiedId so a second copy announces again, instead of staying silent (Minor 15)", async () => {
    await renderList(fakeClient());
    await screen.findByText("Midterm");

    const button = screen.getByRole("button", { name: /copy short link/i });
    const status = (): HTMLElement => within(shortLinkCell()).getByRole("status");
    fireEvent.click(button);
    await waitFor(() => expect(status()).toHaveTextContent(/copied/i));

    await waitFor(() => expect(status()).toHaveTextContent(""), { timeout: 3000 });

    fireEvent.click(button);
    await waitFor(() => expect(status()).toHaveTextContent(/copied/i));
  }, 10_000);

  // Task 2 fix round (Minor 17): split, same reason as the state-glyph test
  // above.
  it("an empty workspace shows a create action", async () => {
    await renderList(fakeClient({ tests: async () => [] }));
    expect(await screen.findByText(/no tests yet/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /create your first test/i })).toBeVisible();
  });

  it("a filter with no results shows a clear-filters action instead", async () => {
    window.history.pushState(null, "", "/?search=zzz");
    await renderList(fakeClient({ tests: async () => [] }));
    expect(await screen.findByText(/no tests match your filters/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeVisible();
  });

  // Task 2 fix round (Minor 18): `createTest` was a throwing stub in every
  // other test, so the create form — name/slug validation, the 409 path,
  // the post-create reload — had no coverage at all. The create form's own
  // "Slug" field shares its accessible name with a published row's, so it
  // is found by id rather than `getByLabelText`, which would throw on two
  // matches once a row is on screen.
  it("the create form's happy path creates a test and reloads the list", async () => {
    // Three reads, not two: `renderList` walks through Home (`D14`), and
    // Home's own agenda calls `tests()` before the list ever mounts
    // (`D6` — it is one of the two reads Home is allowed).
    const tests = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([PUBLISHED]);
    const createTest = vi.fn(async () => PUBLISHED);
    const { container } = await renderList(fakeClient({ tests, createTest }));
    await screen.findByText(/no tests yet/i);

    fireEvent.change(screen.getByLabelText(/test name/i), { target: { value: "Midterm" } });
    fireEvent.change(container.querySelector("#test-slug") as HTMLInputElement, {
      target: { value: "midterm" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create test$/i }));

    await waitFor(() =>
      expect(createTest).toHaveBeenCalledWith("wsp_1", { name: "Midterm", slug: "midterm" }),
    );
    expect(await screen.findByText("Midterm")).toBeVisible();
  });

  it("the create form shows the 409 envelope's message on a taken slug", async () => {
    const createTest = vi.fn(async () => {
      throw new ApiError(409, "slug_taken", "A test with that address already exists in this workspace.");
    });
    const { container } = await renderList(fakeClient({ createTest }));
    await screen.findByText("Midterm");

    fireEvent.change(screen.getByLabelText(/test name/i), { target: { value: "Another" } });
    fireEvent.change(container.querySelector("#test-slug") as HTMLInputElement, {
      target: { value: "midterm" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create test$/i }));

    expect(await screen.findByText(/already exists in this workspace/i)).toBeVisible();
  });

  it("the test list has no axe violations", async () => {
    const { container } = await renderList(fakeClient());
    await screen.findByText("Midterm");
    expect(await axe(container)).toHaveNoViolations();
  });
});
