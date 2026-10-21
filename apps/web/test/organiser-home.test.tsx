// Home becomes an agenda (spec §5, `D6`/`D6a`/`D6b`; §11, `D21`/`D21b`).
//
// `D14`: every assertion starts at `OrganiserApp` and clicks its way there.
// Home is the view the app boots into, so "there" is one render — but the
// client is the real `ApiClient` shape and the screen is reached through
// `OrganiserApp`'s own state machine, never by rendering `Home` with props
// nothing in the running app would hand it.
//
// Several of these tests read `home.css` as well as the DOM, and
// deliberately: jsdom has no layout engine and loads no stylesheet, so "the
// page never scrolls and the panes do" is not observable from a rendered
// tree. What IS observable is the pair of facts that produce it — the
// element Home renders is the element the stylesheet bounds, and the panes
// inside it are the elements the stylesheet lets scroll. Both halves are
// asserted, so neither a renamed class nor a dropped rule passes.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Actor, ApiClient, Bank, TestSummary, Workspace } from "../src/lib/api";
import { OrganiserApp } from "../src/routes/organiser";
import {
  declarations,
  organiserStylesheets,
  paintsIn,
  parseRuleBodies,
  readResolvedCss,
} from "./css-chain";

const HOME_CSS = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/home.css");

/** Every stylesheet `admin-main.tsx` loads, resolved — the cascade the
 *  organiser really renders under, which is wider than home.css alone. One
 *  shared `seen` set, so a file two entries reach is read once. */
function organiserCss(): string {
  const seen = new Set<string>();
  return organiserStylesheets()
    .map((path) => readResolvedCss(path, seen))
    .join("\n");
}

/** Every declaration `home.css` makes for `selector`, merged across the
 *  rules that name it (a base rule plus a `@media` reopening). */
function declarationsOf(selector: string): string[] {
  return parseRuleBodies(readResolvedCss(HOME_CSS))
    .filter((rule) => rule.selector === selector)
    .flatMap((rule) => declarations(rule.body));
}

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

// A local wall-clock instant with room on either side inside its own day, so
// "+2 hours" never crosses midnight and the horizons are the same in every
// timezone a machine running this suite might be in.
const NOW = new Date(2026, 9, 21, 9, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function aTest(over: Partial<TestSummary> & { id: string }): TestSummary {
  return {
    name: over.id,
    slug: over.id,
    description: null,
    shortCode: "ab12cd",
    state: "draft",
    currentVersion: 1,
    draftVersion: 1,
    reviewRequested: false,
    tags: [],
    updatedAt: NOW,
    closesAt: null,
    ...over,
  };
}

const bank = (questionCount: number): Bank => ({
  id: "bnk_" + String(questionCount),
  name: "SQL basics",
  description: null,
  license: null,
  tags: [],
  questionCount,
  createdAt: NOW,
  updatedAt: NOW,
});

/** The calls Home actually made, in order — `D6`'s endpoint constraint is
 *  an invariant over this list, not over any one call site. */
let calls: string[] = [];

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notUsed = () => {
    throw new Error("not used by this test file");
  };
  const base = {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: notUsed,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [bank(12)],
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
    tests: async () => [],
    createTest: notUsed,
    test: notUsed,
    updateTest: notUsed,
    draft: notUsed,
    patchDraft: notUsed,
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
    ...overrides,
  } as unknown as ApiClient;

  // One recording proxy rather than a hand-written wrapper per method: a
  // method added to `ApiClient` later is recorded without this file changing.
  return new Proxy(base, {
    get(target, prop: string) {
      const value = target[prop as keyof ApiClient];
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(prop);
        return (value as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
}

/** Home, reached the way the app reaches it: boot, then the default view. */
async function openHome(overrides: Partial<ApiClient> = {}) {
  const result = render(<OrganiserApp client={fakeClient(overrides)} />);
  await screen.findByRole("heading", { level: 1, name: "Placement cell" });
  // The heading paints on mount; the agenda does not. Waiting for the
  // heading alone asserts against a half-built screen, which is a flake
  // that reads as a grouping bug.
  await waitFor(() =>
    expect(result.container.querySelector('.home[data-state="ready"]')).not.toBeNull(),
  );
  return result;
}

const agenda = () => screen.getByRole("region", { name: "What needs you" });
const recent = () => screen.getByRole("region", { name: "Recently edited" });

/** A row's subject, for asserting on sets of rows at once. */
const subjectsIn = (root: HTMLElement): string[] =>
  [...root.querySelectorAll(".home__row-subject")].map((el) => el.textContent ?? "");

beforeEach(() => {
  calls = [];
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  window.history.replaceState(null, "", "/admin");
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/admin");
});

describe("the agenda groups by time horizon (D6a)", () => {
  const spread = [
    aTest({ id: "closes-today", name: "Midterm", state: "open", closesAt: NOW + 2 * HOUR }),
    aTest({ id: "closes-this-week", name: "Mock 2", state: "open", closesAt: NOW + 3 * DAY }),
    aTest({ id: "closes-later", name: "Finals", state: "open", closesAt: NOW + 30 * DAY }),
    aTest({ id: "never-published", name: "Sketch", currentVersion: null, draftVersion: 1 }),
  ];

  it("groups what needs you by time horizon", async () => {
    await openHome({ tests: async () => spread });

    const headings = [...agenda().querySelectorAll(".home__group-name")].map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["Today", "This week", "Whenever you like"]);
  });

  it("puts each row under the horizon its own time names", async () => {
    await openHome({ tests: async () => spread });

    const groups = [...agenda().querySelectorAll(".home__group")];
    expect(groups.map((group) => subjectsIn(group as HTMLElement))).toEqual([
      ["Midterm"],
      ["Mock 2"],
      ["Finals", "Sketch"],
    ]);
  });

  it("does not render a horizon with nothing in it", async () => {
    await openHome({
      tests: async () => [aTest({ id: "d", name: "Sketch", currentVersion: null })],
    });

    const headings = [...agenda().querySelectorAll(".home__group-name")].map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["Whenever you like"]);
    expect(screen.queryByText("Today")).toBeNull();
  });

  it("carries a count on every group header", async () => {
    await openHome({ tests: async () => spread });

    const counts = [...agenda().querySelectorAll(".home__group-count")].map(
      (el) => el.textContent,
    );
    expect(counts).toEqual(["1", "1", "2"]);
  });

  it("reveals a row's action on focus, not only on hover", async () => {
    await openHome({ tests: async () => spread });

    // The reveal is `opacity`, never `visibility` (`D21a`), so the button is
    // tabbable before it is visible and focusing it is what shows it.
    expect(within(agenda()).getAllByRole("button", { name: /^Open / })).toHaveLength(4);
    expect(declarationsOf(".home__row-action")).toContain("opacity: 0");
    expect(
      declarationsOf(".home__row:hover .home__row-action, .home__row-action:focus-visible"),
    ).toContain("opacity: 1");
  });

  // The builder itself is `test/testbuilder/`'s subject and needs four more
  // reads this file deliberately does not stub; what Home owes is that the
  // row navigates to the test it names, which `D5` makes observable in the
  // query string.
  it("opens the test a row names", async () => {
    await openHome({ tests: async () => spread });

    fireEvent.click(within(agenda()).getByRole("button", { name: "Open Midterm" }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("view")).toBe("test");
    expect(params.get("test")).toBe("closes-today");
  });
});

describe("the agenda is bounded (D6a)", () => {
  const forty = Array.from({ length: 40 }, (_, i) =>
    aTest({ id: "t" + String(i), name: "Draft " + String(i), currentVersion: null }),
  );
  const four = forty.slice(0, 4);

  it("reads the same at four items and at forty", async () => {
    const { unmount } = await openHome({ tests: async () => four });
    expect(agenda().querySelectorAll(".home__row")).toHaveLength(4);
    unmount();

    await openHome({ tests: async () => forty });
    expect(agenda().querySelectorAll(".home__row")).toHaveLength(5);
  });

  it("collapses the overflow into one line rather than growing", async () => {
    await openHome({ tests: async () => forty });

    expect(within(agenda()).getByText("35 more whenever you like")).toBeInTheDocument();
  });
});

describe("Home never scrolls, and its panes do (D21)", () => {
  // Rewritten in 6.5c Task 4's fix round, because the assertion it replaces
  // is the one that let the defect through. It asserted the TEXT
  // `height: …100dvh`, which stayed present and became wrong: the bound
  // read `calc(100dvh - var(--shell-bar))`, correct while the shell was bar
  // + page at every width, and 53px short the moment Task 4 put the rail
  // back on the screen below 719px as a strip in a third grid row. The page
  // outgrew its track, the grid grew past 100dvh and the document scrolled
  // vertically at phone width — D21's one prohibition — with this file
  // green.
  //
  // jsdom computes no layout, so the scroll itself cannot be exercised
  // (AG3): it was measured in Chrome instead, document overflow 45 -> 0 at
  // 360/400/719, recorded in the task's report. What CAN be asserted here
  // is the invariant that would have caught it — nothing sizing this page
  // names a piece of shell chrome or does arithmetic over it. A bound that
  // has to be re-derived every time the shell gains a row is a bound that
  // will not be.
  it("sizes the page from its grid track, never from a copy of the chrome", async () => {
    const { container } = await openHome();

    // The element the stylesheet bounds is the element Home renders.
    expect(container.querySelector(".home")).not.toBeNull();

    const page = declarationsOf(".shell__page:has(> .home)");
    const sizing = page.filter((decl) => /^(height|min-height|max-height)\s*:/.test(decl));
    expect(sizing).not.toHaveLength(0);
    expect(sizing.filter((decl) => /--shell-|calc\(/.test(decl))).toEqual([]);

    expect(page).toContain("overflow: hidden");
    // And nothing reintroduces a second, duplicated bound on the child.
    expect(declarationsOf(".shell__page > .home").join(";")).not.toMatch(/max-height/);
  });

  it("lets the page's height reach the panes", async () => {
    await openHome();

    // The first link in the min-height chain: without `flex: 1` the child
    // is content-sized inside a clipped page, and without `min-height: 0`
    // the scroll areas below can never shrink, which pushes the strip off
    // screen rather than scrolling a pane.
    const rules = declarationsOf(".shell__page > .home");
    expect(rules).toContain("flex: 1");
    expect(rules).toContain("min-height: 0");
    // Kept on the child too: shell.css gives every direct child of the page
    // `overflow-x: auto` below 719px, which would otherwise make `.home`
    // its own scroll container.
    expect(rules).toContain("overflow: hidden");
  });

  // Fix round 2's ruling: reachability beats never-scrolls. Below about
  // 680px of viewport height the fixed parts plus the pane floor no longer
  // fit, and `overflow: hidden` would CLIP the panes rather than crowd
  // them — clipped content is unreachable content, which WCAG 2.1 SC 1.4.10
  // Reflow counts as a failure at 320x256. Guarded so a later plan
  // tightening the bound cannot silently reintroduce the clip.
  it("floors the panes so they cannot be squeezed to a sliver", async () => {
    await openHome();

    const panes = declarationsOf(".home__panes");
    expect(panes).toContain("--home-pane-floor: 9rem");
    // One name the release rule reads, set per layout, so the stacked case
    // needs no branch of its own.
    expect(panes).toContain("min-height: var(--home-panes-floor)");
    expect(panes).toContain(
      "--home-panes-floor: calc((2 * var(--home-pane-floor)) + var(--space-md))",
    );
  });

  it("lets the page scroll past the floor rather than clipping it", async () => {
    await openHome();

    // The bound relaxes to a minimum, and the clip is lifted with it.
    const page = declarationsOf(".shell__page:has(> .home)");
    expect(page).toContain("min-height: 100%");
    expect(page).toContain("overflow: visible");
    // The floor becomes an explicit flex basis there: a zero basis in an
    // intrinsically-sized container makes the panes' contribution their
    // whole content, which turns the page into one long list.
    expect(declarationsOf(".home__panes")).toContain("flex: 1 1 var(--home-panes-floor)");
  });

  // The three fixes a browser probe found. jsdom cannot see any of them, so
  // without these a later edit restores the regression with the suite green.
  it("keeps the row action out of the flow, so it costs a row no width", async () => {
    await openHome();

    expect(declarationsOf(".home__row-action")).toContain("position: absolute");
  });

  it("makes the reason give way before the subject does", async () => {
    await openHome();

    expect(declarationsOf(".home__row-reason")).toContain("flex: 0 4 auto");
  });

  it("paints the shell frame Home sits in, not only the page", async () => {
    const { container } = await openHome();

    // The rail is `align-self: start`, so the grid cell below it shows
    // `.shell`'s own background — a cream wedge under the nav without this.
    //
    // 6.5e Task 1b moved the fill from home.css's `.shell:has(> .shell__page
    // > .home)` onto `.shell` itself, because every screen is on the ground
    // now and not only Home. So this reads the ORGANISER'S WHOLE CHAIN and
    // asks the rendered element what paints it, rather than scanning
    // home.css for a selector that has moved: the invariant is "the frame
    // Home sits in is filled", and the rule's address is not part of it.
    const shell = container.querySelector(".shell");
    expect(shell).not.toBeNull();
    expect(paintsIn(shell!, "background", organiserCss())).toBe("var(--ground-2)");

    // ...and the page over it is still the ground, so the two are not one
    // flat surface. Together these are the pairing the browser probe found.
    const page = container.querySelector(".shell__page");
    expect(page).not.toBeNull();
    expect(paintsIn(page!, "background", organiserCss())).toBe("var(--ground)");
  });

  it("scrolls the two panes inside themselves instead", async () => {
    const { container } = await openHome();

    expect(container.querySelectorAll(".home__pane .home__scroll")).toHaveLength(2);
    const rules = declarationsOf(".home__scroll");
    expect(rules).toContain("overflow-y: auto");
    expect(rules).toContain("min-height: 0");
  });

  it("keeps the status strip out of the scrolling area", async () => {
    const { container } = await openHome();

    const strip = container.querySelector(".home__strip");
    expect(strip).not.toBeNull();
    expect(strip?.closest(".home__scroll")).toBeNull();
  });
});

describe("the strip selects rather than reads out (D21, D21b)", () => {
  const mixed = [
    aTest({ id: "a", name: "Midterm", state: "open", closesAt: NOW + 2 * HOUR }),
    aTest({ id: "b", name: "Mock 2", reviewRequested: true }),
    aTest({ id: "c", name: "Sketch", currentVersion: null }),
  ];

  it("leads with the two scale figures rather than making them pills", async () => {
    await openHome({ tests: async () => mixed, listBanks: async () => [bank(400), bank(12)] });

    const lead = screen.getByTestId("home-lead");
    expect(lead).toHaveTextContent("3 tests");
    expect(lead).toHaveTextContent("412 questions");
    // Neither figure is a control: a pill that counts a set with no rows on
    // this page would be dead on click.
    expect(within(lead).queryByRole("button")).toBeNull();
  });

  it("counts each set on its own pill", async () => {
    await openHome({ tests: async () => mixed });

    expect(screen.getByRole("button", { name: "Closing, 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Awaiting review, 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Never published, 1" })).toBeInTheDocument();
  });

  it("marks the rows a pill counts, in both panes, and clears on Escape", async () => {
    const { container } = await openHome({ tests: async () => mixed });

    fireEvent.click(screen.getByRole("button", { name: "Closing, 1" }));

    const marked = [...container.querySelectorAll('.home__row[data-marked="on"]')];
    expect(marked.map((row) => row.querySelector(".home__row-subject")?.textContent)).toEqual([
      "Midterm",
      "Midterm",
    ]);
    // One in each pane, not two in one.
    expect(agenda().querySelectorAll('[data-marked="on"]')).toHaveLength(1);
    expect(recent().querySelectorAll('[data-marked="on"]')).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelectorAll("[data-marked]")).toHaveLength(0);
  });

  it("clears when the same pill is pressed again", async () => {
    const { container } = await openHome({ tests: async () => mixed });
    const pill = screen.getByRole("button", { name: "Closing, 1" });

    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelectorAll("[data-marked]")).toHaveLength(0);
  });

  it("selects one at a time", async () => {
    await openHome({ tests: async () => mixed });

    fireEvent.click(screen.getByRole("button", { name: "Closing, 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Awaiting review, 1" }));

    expect(screen.getByRole("button", { name: "Closing, 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Awaiting review, 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("leaves unmatched rows readable rather than hiding them", async () => {
    const { container } = await openHome({ tests: async () => mixed });

    fireEvent.click(screen.getByRole("button", { name: "Closing, 1" }));

    const unmatched = [...container.querySelectorAll('.home__row[data-marked="off"]')];
    expect(unmatched.length).toBeGreaterThan(0);
    for (const row of unmatched) expect(row).toBeVisible();
    // Marking, not filtering: nothing moved and nothing was removed.
    expect(subjectsIn(recent())).toEqual(["Midterm", "Mock 2", "Sketch"]);
    // 0.8 and no further — past that the row's secondary text drops under
    // the 3:1 DESIGN.md requires.
    expect(declarationsOf('.home__row[data-marked="off"]')).toContain("opacity: 0.8");
  });

  it("reports the marked count in a live region", async () => {
    await openHome({ tests: async () => mixed });

    fireEvent.click(screen.getByRole("button", { name: "Closing, 1" }));
    // Tests, not rows: the pill counts agenda rows and the marking also
    // reaches the second pane, so "rows" was a number that matched nothing
    // on screen.
    expect(screen.getByRole("status")).toHaveTextContent("Closing: 1 test marked.");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("status")).toHaveTextContent("Selection cleared.");
  });

  it("gives a pill a round dot, never a rail (D21b)", async () => {
    const { container } = await openHome({ tests: async () => mixed });

    expect(container.querySelectorAll(".home__pill .home__dot")).toHaveLength(4);
    // The same construct the agenda uses for urgency, so the strip and the
    // list speak one language.
    expect(container.querySelectorAll(".home__row .home__dot").length).toBeGreaterThan(0);
    const dot = declarationsOf(".home__dot");
    expect(dot).toContain("width: 7px");
    expect(dot).toContain("height: 7px");
    expect(dot).toContain("border-radius: var(--rounded-full)");
  });

  it("does not offer a pill that would be dead on click", async () => {
    await openHome({ tests: async () => [] });

    expect(screen.getByRole("button", { name: "Closing, 0" })).toBeDisabled();
  });
});

describe("the agenda survives the times it is given (D6b)", () => {
  it("handles a test whose closesAt is null, past, or unparseable", async () => {
    const odd = [
      aTest({ id: "null", name: "No window", state: "open", closesAt: null }),
      aTest({ id: "past", name: "Already shut", state: "closed", closesAt: NOW - 5 * DAY }),
      // `closesAt` is typed `number | null`, so NaN can only arrive from a
      // body this client did not mint — an older server, a proxy, a replayed
      // fixture. It must sort and group like "no closing time", never throw.
      aTest({ id: "nan", name: "Unparseable", state: "open", closesAt: Number.NaN }),
    ];

    await openHome({ tests: async () => odd });

    // No horizon claims any of them, and the screen still rendered.
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.queryByText("This week")).toBeNull();
    expect(subjectsIn(recent())).toEqual(["No window", "Already shut", "Unparseable"]);
    expect(screen.getByRole("button", { name: "Closing, 0" })).toBeDisabled();
  });
});

describe("a test that is over is not on the agenda (D6b)", () => {
  // `listTests` applies no status filter unless it is passed one, and `D6`
  // forbids Home passing one — so both of these arrive on the wire like any
  // other test, and both were on the agenda before fix round 1.
  const over = [
    // Archiving an abandoned draft is how an organiser clears it. This one
    // sat under "Never published / Whenever you like" for ever.
    aTest({ id: "binned", name: "Abandoned sketch", state: "archived", currentVersion: null }),
    // `closeTest` goes through `setTestStatus`, which writes `status` and
    // nothing else — so the published `closes_at` outlives an early close
    // and this arrives as closed with a future `closesAt`. Home put it
    // under Closing, with a risk dot, saying a shut test was about to shut.
    aTest({
      id: "shut-early",
      name: "Pulled mock",
      state: "closed",
      closesAt: NOW + 2 * HOUR,
    }),
  ];

  it("leaves an archived draft and an early-closed test off it", async () => {
    const { container } = await openHome({ tests: async () => over });

    expect(container.querySelectorAll(".home__row-subject")).toHaveLength(2);
    expect(agenda().querySelectorAll(".home__row")).toHaveLength(0);
    expect(within(agenda()).getByText("Nothing needs you right now.")).toBeVisible();
    // Both are still in Recently edited — nothing is hidden, they are only
    // not things that need you.
    expect(subjectsIn(recent())).toEqual(["Abandoned sketch", "Pulled mock"]);
  });

  // Whole-branch review, Minor 4. Recently edited rendered `test.state`
  // straight off the wire, so Home said `draft`/`closed` while the test
  // list one rail click away says `Draft`/`Closed` — two vocabularies for
  // one fact. `tests.tsx` exports `STATE_LABEL` now and both screens read
  // it; a second label map is how one of them starts saying something else.
  it("names a test's state the way the test list names it", async () => {
    await openHome({ tests: async () => over });

    const reasons = [...recent().querySelectorAll(".home__row-reason")].map(
      (el) => el.textContent ?? "",
    );
    expect(reasons).toEqual(["Archived", "Closed"]);
  });

  it("counts nothing on any pill, so none of them is live", async () => {
    await openHome({ tests: async () => over });

    for (const label of [
      "Closing",
      "Awaiting review",
      "Changes since publish",
      "Never published",
    ]) {
      expect(screen.getByRole("button", { name: `${label}, 0` })).toBeDisabled();
    }
  });
});

describe("a load that fails says so once (and stops saying Loading)", () => {
  it("replaces the loading state with the alert rather than showing both", async () => {
    render(
      <OrganiserApp
        client={fakeClient({
          tests: async () => {
            throw new Error("offline");
          },
        })}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
  });
});

describe("Home reads only what already exists (D6)", () => {
  it("calls only tests() and listBanks()", async () => {
    await openHome();

    expect(calls).toEqual(["setupStatus", "me", "workspaces", "tests", "listBanks"]);
  });
});

describe("Home is reachable and accessible", () => {
  it("states the role the signed-in actor holds in this workspace", async () => {
    await openHome({
      me: async () => ({
        ...ACTOR,
        memberships: [{ workspaceId: "wsp_1", role: "author" as const, grants: [] }],
      }),
    });

    expect(screen.getByText("Workspace · author")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = await openHome({
      tests: async () => [
        aTest({ id: "a", name: "Midterm", state: "open", closesAt: NOW + 2 * HOUR }),
        aTest({ id: "b", name: "Mock 2", reviewRequested: true }),
      ],
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});
