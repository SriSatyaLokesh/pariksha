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
import { entryStylesheets, paintsIn, parseRuleBodies, readResolvedCss } from "../css-chain";

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

// `D7c` — the two kinds of draft the wire already supports, and the third
// shape they have to be told apart from. `currentVersion` is the published
// head and `draftVersion` the editable one, so:
//
//   currentVersion === null                 never published
//   draftVersion > currentVersion           v1 live, v2 being edited
//   otherwise                               v1 live, nothing newer
//
// Named after the prototype's own rows so the wording in the assertions is
// the wording a reader of the spec recognises.
const NEVER_PUBLISHED: TestSummary = {
  ...DRAFT,
  id: "tst_3",
  name: "Data structures midterm",
  slug: "dsa-midterm",
  currentVersion: null,
  draftVersion: 1,
};

const CHANGED_SINCE_PUBLISH: TestSummary = {
  ...DRAFT,
  id: "tst_4",
  name: "Quant practice 1",
  slug: "quant-1",
  state: "open",
  currentVersion: 1,
  draftVersion: 2,
};

/** `D7c`'s own second sentence, literally: "Draft · changes since v1". The
 *  row above carries the same publish history under an OPEN lifecycle, which
 *  is the pairing that proves the two columns are independent — but the
 *  ruling's headline case is this one, and nothing exercised it until fix
 *  round 1 said so. */
const DRAFT_SINCE_PUBLISH: TestSummary = {
  ...DRAFT,
  id: "tst_5",
  name: "Reasoning mock 2",
  slug: "reasoning-2",
  state: "draft",
  currentVersion: 1,
  draftVersion: 2,
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
    exportCandidateData: async () => {
      throw new Error("not used by this test file");
    },
    deleteCandidateData: async () => {
      throw new Error("not used by this test file");
    },
    usage: async () => undefined,
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

    // 6.5e Task 2, issue 200: the glyph half, which this test was named for
    // and could not tell from a Unicode character — an `aria-hidden` <span>
    // holding U+25CF satisfied the line above exactly as well as an icon
    // does. It is the shared `ICONS`/`Icon` family now (spec §13, "one
    // family, consistent stroke, SVG"), the same assertion the "In review"
    // badge below already makes, and `aria-hidden` so the state's accessible
    // name is its label and nothing else.
    const badge = within(row as HTMLElement).getByText(/draft/i).closest(".test-state") as HTMLElement;
    const glyph = badge.querySelector("svg.shell__icon");
    expect(glyph, "the state glyph is not from the one icon family").not.toBeNull();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(badge.textContent).not.toMatch(/[■-◿]/);
  });

  it("the In review badge is text plus glyph, never colour alone", async () => {
    await renderList(fakeClient({ tests: async () => [PUBLISHED] }));
    const row = (await screen.findByText("Midterm")).closest("tr");
    expect(within(row as HTMLElement).getByText(/in review/i)).toBeVisible();

    // 6.5d Task 6: the glyph half, which this test was named for and did
    // not assert. It is the shared `ICONS`/`Icon` family — spec §13, "one
    // family, consistent stroke, SVG" — not the U+25C6 character it used to
    // be, and it is `aria-hidden`, so the badge's accessible name is the two
    // words and nothing else. Both the name and the family matter: the same
    // badge renders in the builder header (`routes/test.tsx`), and the two
    // have to say the same thing.
    const badge = within(row as HTMLElement).getByText(/in review/i).closest(".test-badge") as HTMLElement;
    const glyph = badge.querySelector("svg.shell__icon");
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    // The words and only the words — `.test-badge` has no role, so
    // `toHaveAccessibleName` computes "" for it and would pass with the old
    // U+25C6 still in place. The text content is what actually moved.
    expect(badge.textContent?.replace(/\s+/g, " ").trim()).toBe("In review");
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

    const message = await screen.findByText(/already exists in this workspace/i);
    expect(message).toBeVisible();

    // Issue 200, the other half of this file's glyph sweep: the error mark
    // was U+26A0, a text character. Same family, same stroke, `aria-hidden`
    // so the alert reads as the sentence alone.
    const alert = message.closest(".field-error") as HTMLElement;
    expect(alert.querySelector("svg.shell__icon"), "the error mark is not from the one icon family").not.toBeNull();
    expect(alert.textContent).not.toContain("⚠");
  });

  // ---- `D7c`: State is the lifecycle, Version is the publish history ----

  it("tells a never-published draft from one with changes since publish", async () => {
    await renderList(
      fakeClient({ tests: async () => [NEVER_PUBLISHED, CHANGED_SINCE_PUBLISH, PUBLISHED] }),
    );

    const row = async (name: string) =>
      ((await screen.findByText(name)).closest("tr") as HTMLElement);

    // Three publish histories, three sentences. The first two are the pair
    // `D7c` exists for; the third is the control that stops "never
    // published" from being the only string this column can produce.
    expect(await row("Data structures midterm")).toHaveTextContent("never published");
    expect(await row("Quant practice 1")).toHaveTextContent("v1 live · v2 draft");
    expect(await row("Midterm")).toHaveTextContent("v1 live");
    // ...and the one with changes pending is NOT reported as unpublished,
    // which is the confusion the single column used to produce.
    expect(await row("Quant practice 1")).not.toHaveTextContent("never published");
  });

  it("keeps the lifecycle and the publish history in separate columns", async () => {
    await renderList(
      fakeClient({
        tests: async () => [NEVER_PUBLISHED, DRAFT_SINCE_PUBLISH, CHANGED_SINCE_PUBLISH],
      }),
    );
    await screen.findByText("Quant practice 1");

    // `D7c`: "State is the lifecycle (Open / Scheduled / Draft / Closed),
    // Version is the publish history". One cell carrying both would read as
    // a single fact and would have to be re-sorted into two the moment
    // either half changed on its own.
    const state = screen.getByRole("columnheader", { name: /^state$/i });
    const version = screen.getByRole("columnheader", { name: /^version$/i });
    const headers = Array.from(document.querySelectorAll("table.testbuilder-list thead th"));
    const cellsFor = (name: string) =>
      Array.from((screen.getByText(name).closest("tr") as HTMLElement).querySelectorAll("td"));

    // THE PAIRING MATRIX, which is the whole of the ruling. Two rows share a
    // lifecycle and differ in publish history; two share a publish history
    // and differ in lifecycle. Either column alone would collapse one of
    // those pairs, and no single assertion can show that.
    for (const [name, lifecycle, history] of [
      // `D7c`'s first sentence: "Draft · never published".
      ["Data structures midterm", "Draft", "never published"],
      // ...and its second, literally: "Draft · changes since v1".
      ["Reasoning mock 2", "Draft", "v1 live · v2 draft"],
      // The same history under a different lifecycle — a published test with
      // an edited draft behind it is OPEN, not a draft, and the single column
      // this ruling replaced called it one.
      ["Quant practice 1", "Open", "v1 live · v2 draft"],
    ] as const) {
      const cells = cellsFor(name);
      expect(cells[headers.indexOf(state)], `${name}: state`).toHaveTextContent(lifecycle);
      expect(cells[headers.indexOf(state)], `${name}: state carries history`).not.toHaveTextContent(
        /live|never published/,
      );
      expect(cells[headers.indexOf(version)], `${name}: version`).toHaveTextContent(history);
    }
  });

  // `D7c`: "No readiness meter here — the list route loads version heads, not
  // draft bodies, so a real 5 / 7 is one checklist call per row." An
  // invariant, not a mechanism: it is green today and its job is to stay
  // green. The probe that makes it mean something is rendering a meter into
  // a row and watching this go red.
  //
  // The pattern carries its spaces deliberately. `PublishChecklist.tsx:230`
  // renders the real meter as `${done} / ${total}` and the Last edited cell
  // renders `toLocaleDateString()`, which is `11/14/2023` in en-US — a
  // space-free `\d\/\d` would match the date on every row and this guard
  // would be red for a reason that has nothing to do with `D7c`.
  it("shows no readiness meter in the list", async () => {
    await renderList(
      fakeClient({ tests: async () => [NEVER_PUBLISHED, CHANGED_SINCE_PUBLISH, PUBLISHED] }),
    );
    await screen.findByText("Midterm");
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
  });

  // The budget half of the same ruling, and the half that actually bites:
  // thirteen rows must not become thirteen round trips. Behaviour, not text
  // — the client is a spy and the assertion is on what the screen asked for.
  it("loads the list with one tests() call and no checklist call", async () => {
    const tests = vi.fn(async () => [NEVER_PUBLISHED, CHANGED_SINCE_PUBLISH, PUBLISHED]);
    const checklist = vi.fn(async () => []);
    render(<OrganiserApp client={fakeClient({ tests, checklist })} />);

    // Home fetches `tests` for its own agenda (`D6b`), so the count is taken
    // from the navigation onward rather than from the mount — otherwise this
    // would be asserting Home's budget as well as the list's, and would move
    // whenever Home did.
    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    tests.mockClear();
    await screen.findByRole("heading", { level: 1, name: "Tests" });
    await screen.findByText("Midterm");

    expect(tests).toHaveBeenCalledTimes(1);
    // Three rows. `D7c`'s whole argument is that a readiness meter here
    // would be one of these per row — "thirteen round trips to decorate a
    // list" — so this is the assertion the ruling is made of.
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(checklist).not.toHaveBeenCalled();
  });

  // `D1`: "Test state carries no hue — glyph and label on inherited ink; the
  // only colour is the review flag." Asserted against the organiser's real
  // resolved stylesheet chain and against the rendered element, so a rule
  // that stopped matching is as red as a declaration that was deleted.
  it("carries no hue on test state", async () => {
    await renderList(fakeClient({ tests: async () => [DRAFT] }));
    // FROM THE ROW, not from a text match. This line used to read
    // `(await screen.findByText(/draft/i)).closest(".test-state")`, which
    // resolved the Status filter's `<option>Draft</option>` — it sorts before
    // the table — and `.closest` then returned NULL. `declaredFor` guards
    // `element.matches()` in a try/catch, so a null element reads as "no rule
    // matches" and every `toBeUndefined()` below passed without looking at
    // anything. The positive arm added in fix round 1 is what caught it; the
    // rule-set arm at the foot is what was carrying this test.
    const row = (await screen.findByText(DRAFT.name)).closest("tr") as HTMLElement;
    const badge = row.querySelector(".test-state") as HTMLElement;
    expect(badge, "the row rendered no state badge").not.toBeNull();

    const seen = new Set<string>();
    const organiser = entryStylesheets("admin.html")
      .map((path) => readResolvedCss(path, seen))
      .join("\n");

    // THE POSITIVE ARM FIRST, AND IT SITS ON `badge` (fix round 3). Every
    // assertion below is `toBeUndefined()`, which a broken chain, a renamed
    // property or a reader that resolved nothing would satisfy just as well
    // as the rule's absence. So the SAME reader, on the SAME mount, must
    // return a real declaration — and it has to be asked about THIS element,
    // not a neighbour.
    //
    // Fix round 1 put this control on `.test-version` in the same row, which
    // covered a dead reader but not the vacuity class that actually bit this
    // test: a `badge` that is NON-NULL BUT WRONG passes a control taken from
    // a different element AND passes all three absences below, because the
    // wrong element genuinely has no rule painting it. `css-chain.ts`'s own
    // guard names that residue as the one thing it cannot catch. A control
    // on `badge` closes it.
    //
    // `display`, not a colour: `.test-state` is `display: inline-flex` in
    // testbuilder.css, which is the rule that puts the glyph and the label on
    // one line. It cannot be loosened by a legitimate re-tone, and asserting
    // it is not this test quietly taking ownership of a palette value that
    // `contrast-usage.test.ts` owns.
    expect(
      paintsIn(badge, "display", organiser),
      "the reader resolved nothing on the state badge, so the absences below mean nothing",
    ).toBe("inline-flex");

    // The rendered element: nothing in the chain paints it, so it inherits.
    for (const property of ["color", "background", "background-color"]) {
      expect(
        paintsIn(badge, property, organiser),
        `the state badge is painted ${property} by a rule in the organiser chain`,
      ).toBeUndefined();
    }

    // ...and the rule set: no selector may key a colour off a state VALUE
    // either, which the element above could not see — `draft` is the only
    // state this mount renders.
    const stateRules = parseRuleBodies(organiser).filter((rule) =>
      rule.selector.includes(".test-state"),
    );
    expect(stateRules.length, "no .test-state rule was found at all").toBeGreaterThan(0);
    for (const rule of stateRules) {
      expect(rule.body, `${rule.selector} paints the state`).not.toMatch(
        /(^|;)\s*(color|background|background-color|border-color)\s*:/,
      );
    }
  });

  it("the test list has no axe violations", async () => {
    const { container } = await renderList(fakeClient());
    await screen.findByText("Midterm");
    expect(await axe(container)).toHaveNoViolations();
  });
});
