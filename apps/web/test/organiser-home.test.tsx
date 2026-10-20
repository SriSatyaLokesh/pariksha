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
import { declarations, parseRuleBodies, readResolvedCss } from "./css-chain";

const HOME_CSS = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles/home.css");

/** Every declaration `home.css` makes for `selector`, merged across the
 *  rules that name it (a base rule plus a `@media` reopening). */
function declaredFor(selector: string): string[] {
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
    expect(declaredFor(".home__row-action")).toContain("opacity: 0");
    expect(
      declaredFor(".home__row:hover .home__row-action, .home__row-action:focus-visible"),
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
  it("never scrolls the page itself", async () => {
    const { container } = await openHome();

    // The element the stylesheet bounds is the element Home renders.
    expect(container.querySelector(".home")).not.toBeNull();

    const rules = declaredFor(".shell__page > .home");
    expect(rules).toContain("overflow: hidden");
    expect(rules.some((decl) => /^max-height:.*100dvh/.test(decl))).toBe(true);
  });

  it("scrolls the two panes inside themselves instead", async () => {
    const { container } = await openHome();

    expect(container.querySelectorAll(".home__pane .home__scroll")).toHaveLength(2);
    const rules = declaredFor(".home__scroll");
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
    expect(declaredFor('.home__row[data-marked="off"]')).toContain("opacity: 0.8");
  });

  it("reports the marked count in a live region", async () => {
    await openHome({ tests: async () => mixed });

    fireEvent.click(screen.getByRole("button", { name: "Closing, 1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Closing: 1 row marked.");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("status")).toHaveTextContent("Selection cleared.");
  });

  it("gives a pill a round dot, never a rail (D21b)", async () => {
    const { container } = await openHome({ tests: async () => mixed });

    expect(container.querySelectorAll(".home__pill .home__dot")).toHaveLength(4);
    // The same construct the agenda uses for urgency, so the strip and the
    // list speak one language.
    expect(container.querySelectorAll(".home__row .home__dot").length).toBeGreaterThan(0);
    const dot = declaredFor(".home__dot");
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
