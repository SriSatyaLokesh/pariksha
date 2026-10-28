// `D21a` — a row action can never be clipped, in any table.
//
// The reported defect was an action button cut off at a bank row's edge, and
// the cause was two things at once: the action cell had no reserved width, and
// the table was wider than the page. Both are fixed as RULES in
// `primitives.css`, so every table in the product inherits them rather than
// each screen re-deciding. This file is the half of that ruling jsdom can
// answer; `e2e/measurement/row-actions.spec.ts` is the half it cannot.
//
// WHAT JSDOM CANNOT SAY, and why the brief's first test sketch is not written
// here. The sketch was
//
//     const before = columnWidths(); await hoverRow(0);
//     expect(columnWidths()).toEqual(before);
//
// and in jsdom that is two sets of zeros compared with each other:
// `getBoundingClientRect()` returns all zeros, so it passes before the rule
// exists AND after it is deleted. `:hover` is worse than vacuous here —
// jsdom's selector engine parses `tr:hover` and never matches it, so a reveal
// asserted through hover would read as "no rule applies" whatever the
// stylesheet says. The pixel claim is therefore made in Chromium, and what
// stays here is the INVARIANT that makes width-reservation true: the resting
// rule reserves the column, and nothing a revealed row changes is a
// layout property. A rule that reserves the width and only ever animates
// `opacity` cannot widen a row, and that is checkable without layout.
//
// `:focus-within`, unlike `:hover`, jsdom really does evaluate (nwsapi
// implements it against `document.activeElement`). So `D21a`'s own sentence —
// "the buttons stay tabbable and tabbing onto one reveals the set" — is
// exercised below as behaviour: a real button is focused and the cell's
// resolved `opacity` changes.
//
// HOW THE CSS IS READ. `vitest.config.ts` sets `css: false`, so jsdom loads no
// stylesheet and `getComputedStyle` knows nothing. `test/css-chain.ts`'s
// reader resolves an entry's real `@import` chain and then asks the DOM,
// through `Element.matches()`, which of those rules actually select a RENDERED
// element, resolving the winner by specificity. A rule whose selector stops
// matching the markup is then as red as one whose declaration is deleted —
// which is what keeps these assertions out of "the text is present, therefore
// the behaviour happens" (`AG3`).
//
// ONE LIMIT OF THAT READER, stated rather than discovered later:
// `parseRuleBodies` recurses INTO `@media` blocks and flattens them, so the
// resting `opacity: 0` below is read as if `@media (hover: hover)` were true.
// That is the branch the reveal exists for, and it is the only `@media` in
// the rule, so nothing here can be flipped by a condition. A second, opposing
// media block added later would be flattened on top of this one and would
// have to be read in a browser instead.

import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SEMANTIC_NAMES,
  type CssRule,
  declarations,
  declaredFor,
  entryStylesheets,
  paintsIn,
  parseRuleBodies,
  readResolvedCss,
} from "./css-chain";
import { OrganiserApp } from "../src/routes/organiser";
import type {
  Actor,
  ApiClient,
  Bank,
  QuestionSummary,
  TestSummary,
  Workspace,
} from "../src/lib/api";
import { fakeClient as sharedClient } from "./fixtures/api-client";
import type { Question } from "@pariksha/core";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(TEST_DIR, "../src");

/** Every stylesheet a page really loads, resolved and joined — the same
 *  shape `test/exam/controls.test.tsx` builds, and for the same reason: the
 *  organiser loads three entries side by side and reading one would leave a
 *  later override invisible. */
function resolvedFor(page: string): string {
  const seen = new Set<string>();
  return entryStylesheets(page)
    .map((path) => readResolvedCss(path, seen))
    .join("\n");
}

const ORGANISER = resolvedFor("admin.html");
const LANDING = resolvedFor("index.html");

/** Every rule in the organiser's chain that selects an action cell. */
const ACTS_RULES = parseRuleBodies(ORGANISER).filter((rule) => /\.acts\b/.test(rule.selector));

/** The properties a rule declares, in source order. */
function propertiesOf(body: string): string[] {
  return declarations(body).flatMap((decl) => {
    const colon = decl.indexOf(":");
    return colon === -1 ? [] : [decl.slice(0, colon).trim()];
  });
}

// ---------------------------------------------------------------------------
// The two screens, reached the way `D14` requires: from `OrganiserApp`, by
// clicking. Nothing here renders `TestList` or `BankBrowser` directly.

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
  reviewRequested: false,
  tags: ["exam"],
  updatedAt: 1_700_000_000_000,
};

const BANK: Bank = {
  id: "bnk_1",
  name: "SQL basics",
  description: null,
  license: null,
  tags: [],
  questionCount: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

/** A deliberately LONG prompt. The cell holding it is prose, and `D18` records
 *  the bug this file must not re-create: "the overflow bug was
 *  `white-space: nowrap` inherited from the table rules." */
const DOCUMENT: Question = {
  id: "Q1",
  type: "single",
  prompt:
    "Which HTTP method is idempotent, and why does that matter when a client retries a request it never saw a response to?",
  options: [
    { id: "a", text: "GET" },
    { id: "b", text: "POST" },
  ],
  key: "a",
  difficulty: "medium",
  tags: [],
};

const QUESTION: QuestionSummary = {
  id: "qst_1",
  bankId: "bnk_1",
  refId: "Q1",
  document: DOCUMENT,
  points: 2,
  usedInTests: 0,
  updatedAt: 1_700_000_000_000,
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
    createBank: async () => ({ ...BANK }),
    listQuestions: async () => ({ questions: [QUESTION] }),
    deleteQuestion: async () => undefined,
    listTags: async () => [],
    listGroups: async () => [],
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    tests: async () => [PUBLISHED],
    updateTest: async (_workspaceId, _testId, patch) => ({ ...PUBLISHED, ...patch }),
    versions: async () => [],
    checklist: async () => [],
    readiness: async () => ({}),
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    workspaceBranding: async () => ({}),
    candidates: async () => [],
    lockedAttempts: async () => [],
    ...overrides,
  });
}

/** Home -> Tests. */
async function openTestList(): Promise<void> {
  render(<OrganiserApp client={fakeClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  await screen.findByRole("heading", { level: 1, name: "Tests" });
  await screen.findByText(PUBLISHED.name);
}

/** Home -> Banks -> one bank. */
async function openBankBrowser(): Promise<void> {
  render(<OrganiserApp client={fakeClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
  await screen.findByRole("heading", { level: 1, name: "Banks" });
  fireEvent.click(await screen.findByRole("button", { name: /SQL basics/ }));
  await screen.findByText(DOCUMENT.prompt);
}

/** The two tables that carry row actions today, each with the control that
 *  proves the cell really is the one an organiser clicks. */
const SCREENS = [
  {
    name: "the test list",
    open: openTestList,
    table: "table.testbuilder-list",
    action: /^Duplicate$/,
    /** A cell holding prose, for the `nowrap` containment check. */
    prose: () => screen.getByRole("button", { name: PUBLISHED.name }),
  },
  {
    name: "the bank browser",
    open: openBankBrowser,
    table: "table.bank-browser__table",
    action: /^Edit question:/,
    prose: () => screen.getByText(DOCUMENT.prompt),
  },
] as const;

/** The `<td>` holding `action` on the screen that is already open. */
function actionCell(action: RegExp): HTMLTableCellElement {
  const button = screen.getByRole("button", { name: action });
  const cell = button.closest("td");
  expect(cell, `the ${String(action)} control is not inside a <td> at all`).not.toBeNull();
  return cell as HTMLTableCellElement;
}

describe("D21a — one action-gutter rule, inherited by every table", () => {
  for (const screenUnderTest of SCREENS) {
    const { name, open, table, action, prose } = screenUnderTest;

    it(`${name} puts its row actions in an action cell`, async () => {
      await open();
      expect(actionCell(action)).toHaveClass("acts");
    });

    it(`${name} ends its row with the action cell, which is what makes a right-pinned gutter sane`, async () => {
      await open();
      // `position: sticky; inset-inline-end: 0` pins the cell to the inline
      // end of the scrollport. A gutter with a column AFTER it slides over
      // that column's content the moment the table scrolls — the brief's own
      // "an opaque sticky cell over a column that is scrolling under it is
      // the same defect wearing a different hat", and no less of a defect for
      // being transparent. So the cell has to be last, and that is a fact
      // about the markup rather than about the rule.
      const rows = document.querySelectorAll(`${table} tbody tr`);
      expect(rows.length, "no rows rendered, so this checks nothing").toBeGreaterThan(0);
      for (const row of rows) {
        const acts = row.querySelector(".acts");
        expect(acts, "a row rendered no action cell").not.toBeNull();
        expect(acts).toBe(row.lastElementChild);
      }
    });

    it(`${name} reserves the action column's width in its RESTING rule`, async () => {
      await open();
      const cell = actionCell(action);
      // `width: 1%` on an auto-layout table is shrink-to-fit bounded below by
      // min-content, and `white-space: nowrap` makes min-content "the buttons,
      // side by side". Together that is "width always reserved" — the column
      // is as wide as its actions whether or not the actions are showing,
      // because neither declaration is in a hover or focus rule.
      expect(paintsIn(cell, "width", ORGANISER)).toBe("1%");
      expect(paintsIn(cell, "white-space", ORGANISER)).toBe("nowrap");
      expect(paintsIn(cell, "position", ORGANISER)).toBe("sticky");
      expect(paintsIn(cell, "inset-inline-end", ORGANISER)).toBe("0");
    });

    // `D21a`'s first clause, and the half Task 1 could not deliver: "`th.acts`,
    // `td.acts` are `position: sticky; right: 0` INSIDE THEIR OWN SCROLL
    // CONTAINER". Neither table had one. At 1440px nothing between the table
    // and the viewport scrolls, so `position: sticky` resolved against the
    // DOCUMENT and the transparent gutter floated over the columns to its
    // left on a table wider than its page — a regression Task 1 introduced,
    // because before it the actions sat in an ordinary cell and could not
    // overlap anything.
    //
    // shell.css's `.shell__page > * { overflow-x: auto }` is inside
    // `@media (max-width: 719px)` only, so it is not that container at any
    // width an organiser works at. The container has to be the table's own.
    //
    // The pixels are in `e2e/measurement/row-actions.spec.ts`; what jsdom can
    // say is that the table's parent really is a scroll container, read off
    // the chain the browser assembles rather than off the markup.
    it(`${name} puts its table inside the table's own scroll container`, async () => {
      await open();
      const element = document.querySelector(table);
      expect(element, `${table} did not render`).not.toBeNull();
      const container = (element as HTMLElement).parentElement as HTMLElement;

      // THE RULE ITSELF, and a probe said this half had to be here. With only
      // the `paintsIn` reading below, changing `.table-scroll` to
      // `overflow-x: visible` reddened the bank browser and NOT the test
      // list: the test list's wrapper is a direct child of `.shell__page`, so
      // shell.css's `@media (max-width: 719px) { .shell__page > * }` also
      // selects it — and this file's own header records that `parseRuleBodies`
      // flattens `@media`, so the reader scored a narrow-width rule as if it
      // applied at every width. One surface's guard was passing on a rule
      // that is not in force where the defect lives.
      const own = parseRuleBodies(ORGANISER).filter((rule) =>
        rule.selector.split(",").some((part) => part.trim() === ".table-scroll"),
      );
      expect(own, "no .table-scroll rule in the organiser's chain").toHaveLength(1);
      expect(declarations((own[0] as CssRule).body)).toContain("overflow-x: auto");

      // ...and that the rule really reaches THIS element, which the rule set
      // alone cannot say.
      expect(container).toHaveClass("table-scroll");
      expect(paintsIn(container, "overflow-x", ORGANISER)).toBe("auto");

      // ...and it is the table's OWN wrapper, not the page. A container that
      // is also holding the create form and the filter bar would scroll
      // those sideways with the table.
      expect(container).not.toHaveClass("shell__page");
      expect(container.querySelectorAll("table")).toHaveLength(1);
    });

    // The gutter's column header, same wording on both tables. With
    // `opacity: 0` at rest a VISIBLE "Actions" reads as a heading over an
    // empty column, so it is clipped to the accessibility tree — where a
    // screen reader still announces it for every cell in the column, which
    // an empty `<th>` would not.
    it(`${name} names its action column for a screen reader and not on the page`, async () => {
      await open();
      const header = document.querySelector(`${table} thead th.acts`) as HTMLElement | null;
      expect(header, "the action column has no header cell").not.toBeNull();

      // ONE assertion binding the two, not two that pass independently (fix
      // round 1). A visible "Actions" sitting beside an empty
      // `.visually-hidden` span satisfied "has the text" and "has a hidden
      // span" separately, while being exactly the shape this test exists to
      // refuse. So: the hidden span must BE the name, and the cell must hold
      // nothing besides it.
      const hidden = (header as HTMLElement).querySelector(".visually-hidden");
      expect(hidden, "the action column's name is not clipped to the a11y tree").not.toBeNull();
      expect((hidden as HTMLElement).textContent).toBe("Actions");
      expect((header as HTMLElement).textContent?.trim()).toBe("Actions");
    });

    // M3 ruling: `primitives.css`'s `@media (hover: hover) { td.acts {
    // opacity: 0 } }` — `G1-01`/`O-10`/`O-25`/`O-33`/`F9`'s shared root
    // cause, a reveal gated behind `:hover` that is unreachable as a row at
    // all until a pointer lands on it and permanently unreachable on touch
    // — is deleted outright rather than overridden per table. This replaces
    // the two tests that pinned the old opacity-0-at-rest/opacity-1-on-focus
    // pair as a requirement, the same call `organiser-home.test.tsx` already
    // made for `.home__row-action` ("this replaces the test that pinned the
    // old `opacity: 0` default as a requirement").
    it(`${name} shows its action buttons without needing hover or focus, and always did stay tabbable`, async () => {
      await open();
      const cell = actionCell(action);
      const button = within(cell).getAllByRole("button")[0]!;

      // No opacity gate of any kind left on the action cell.
      expect(paintsIn(cell, "opacity", ORGANISER)).toBeUndefined();

      // ...and in the tab order regardless, which `D21a` always required —
      // only the gate around it is gone.
      expect(button).not.toHaveAttribute("tabindex", "-1");
      expect(button).not.toBeDisabled();
      button.focus();
      expect(button).toHaveFocus();
      // Focusing it changes nothing about the cell: there is no reveal left
      // to trigger.
      expect(paintsIn(cell, "opacity", ORGANISER)).toBeUndefined();
    });

    it(`${name} never lets the gutter's nowrap reach a cell holding prose`, async () => {
      await open();
      const cell = prose().closest("td");
      expect(cell).not.toBeNull();
      // `D18`: "Prompts wrap and clamp to two lines; the overflow bug was
      // `white-space: nowrap` inherited from the table rules." The gutter
      // needs `nowrap` and prose must never inherit it, so the declaration is
      // scoped to `.acts` and this is the other side of that scoping.
      expect(paintsIn(cell as Element, "white-space", ORGANISER)).not.toBe("nowrap");

      // THE POSITIVE ARM, on the same mount (fix round 1, F7). A negative
      // alone cannot tell "the scoping works" from "the reader found nothing"
      // — a renamed property, a broken chain or a selector that stopped
      // matching would all satisfy the line above. The gutter in the SAME
      // rendered table must really carry the declaration the prose cell must
      // not, which is the whole claim in one place.
      expect(paintsIn(actionCell(action), "white-space", ORGANISER)).toBe("nowrap");
    });
  }

  // C1: a WRAPPING flex container's min-content width is its widest child,
  // not the sum of its children — fine for `.button-row` in the free-width
  // contexts it is otherwise used in, wrong inside `td.acts`'s `width: 1%`,
  // where it shrank the bank browser's action column to one 36px button and
  // stacked the rest, blowing `e2e/measurement/density.spec.ts`'s row-height
  // bar. jsdom has no layout engine, so the stack itself needs a browser
  // (that spec); what IS checkable here is the CASCADE FACT that makes it
  // impossible: the rule that forces `flex-wrap: nowrap` really wins, by
  // specificity, over `.button-row`'s own `wrap`.
  it("the bank browser's row-action button-row never wraps inside the action cell", async () => {
    await openBankBrowser();
    const cell = actionCell(/^Edit question:/);
    const buttonRow = cell.querySelector(".button-row");
    expect(buttonRow, "no .button-row inside the bank browser's action cell").not.toBeNull();
    expect(paintsIn(buttonRow as Element, "flex-wrap", ORGANISER)).toBe("nowrap");
  });

  // M3 ruling supersedes this test's original shape. It used to assert the
  // invariant behind a STATEFUL reveal ("no :hover/:focus-within rule may
  // touch a layout property, only opacity") — sound while the reveal
  // existed, and vacuously true now that it does not: there is no stateful
  // rule left to check, which is the fix, not a gap in this guard. What is
  // still worth pinning is the absence staying an absence, so a later patch
  // cannot quietly reintroduce the hover gate on `.acts` without this
  // reddening.
  it("never gates a row's actions behind :hover or :focus-within again", () => {
    const stateful = ACTS_RULES.filter((rule) => /:(hover|focus|focus-within|focus-visible)\b/.test(rule.selector));
    expect(stateful, "a stateful rule on .acts reintroduced the hover-only reveal M3 deleted").toEqual([]);
  });

  it("reveals with opacity alone, never visibility (D21a over D18)", () => {
    // `D18`'s bullet says "reveal with `visibility` plus `opacity`" and `D21a`
    // says "the reveal is `opacity` alone, never `visibility`". `D21a` is
    // later and is the one that can be built: `visibility: hidden` removes an
    // element from the tab order, which defeats the `tr:focus-within` reveal
    // `D21a` specifies in the same sentence.
    for (const rule of ACTS_RULES) {
      expect(propertiesOf(rule.body), `${rule.selector} hides the gutter from the keyboard`).not.toContain("visibility");
      expect(propertiesOf(rule.body), `${rule.selector} hides the gutter from the keyboard`).not.toContain("display");
    }
    expect(ACTS_RULES.length, "no gutter rule found at all").toBeGreaterThan(0);
  });

  it("needs no colour, which is what makes one rule safe in two stylesheet chains", () => {
    // THE CHAIN SEAM. `primitives.css` is imported by `admin.css` — which also
    // imports `theme.css`, where `--ground`/`--ink`/`--surface`/`--edge*`/
    // `--accent` are defined — AND by `landing.css`, which imports
    // `primitives.css` and `signal.css` and NOT `theme.css`. Any `theme.css`
    // name written into `primitives.css` is undefined on the landing page.
    //
    // This rule dodges the seam entirely by naming no colour: the gutter is
    // transparent, which `D21a` requires for its own reason ("an opaque
    // sticky cell over a column that is scrolling under it is the same defect
    // wearing a different hat"). The two requirements have the same answer,
    // and this is the assertion that keeps them having it.
    //
    // The control arm first (fix round 1, F5): every assertion below is a
    // `not.toContain` over a loop, so an empty `ACTS_RULES` would satisfy all
    // of them without reading a single declaration — the same vacuous shape
    // the browser spec's first draft had, caught there by its own proof.
    expect(ACTS_RULES.length, "no gutter rule was found, so nothing was checked").toBeGreaterThan(0);
    for (const rule of ACTS_RULES) {
      const body = rule.body;
      for (const semantic of SEMANTIC_NAMES) {
        expect(body, `${rule.selector} reads ${semantic}, which landing.css never defines`).not.toContain(semantic);
      }
      expect(propertiesOf(body), `${rule.selector} paints a background over a scrolling column`).not.toContain("background");
      expect(propertiesOf(body)).not.toContain("background-color");
    }
  });

  it("names the landing chain's two tables rather than assuming they are not there", () => {
    // THE CONTROLLER'S PREMISE WAS WRONG, and the correction is recorded here
    // rather than in prose: the landing page DOES render tables —
    // `src/sections/signal/Body.tsx` has two, the results CSV excerpt and the
    // comparison grid, each inside its own `.signal-scroll-x`. So "the
    // landing page renders no <table>" is not what makes the shared rule safe
    // there.
    //
    // What makes it safe is that the rule is scoped to `.acts`, nothing in
    // the landing chain renders one, and (above) the rule names no colour.
    // This asserts the middle clause, from both sides.
    const LANDING_OWNED = ["sections/", "island/", "routes/landing.tsx"];
    const sources = sourceFiles(SRC_DIR)
      .map((file) => [relativeToSrc(file), readFileSync(file, "utf8")] as const);

    // Not an empty scan: the landing chain really does render tables, so an
    // empty `.acts` list below is an absence and not a broken pattern.
    const landingTables = sources
      .filter(([file, body]) => LANDING_OWNED.some((p) => file.startsWith(p)) && body.includes("<table"))
      .map(([file]) => file);
    expect(landingTables).toContain("sections/signal/Body.tsx");

    const landingActs = sources
      .filter(([file, body]) => LANDING_OWNED.some((p) => file.startsWith(p)) && /className="[^"]*\bacts\b/.test(body))
      .map(([file]) => file);
    expect(landingActs, "a landing-chain source grew an action cell").toEqual([]);

    // ...and the organiser's two really do carry one, so the pattern works.
    const organiserActs = sources
      .filter(([, body]) => /className="[^"]*\bacts\b/.test(body))
      .map(([file]) => file)
      .sort();
    expect(organiserActs).toEqual([
      "components/organiser/CollaboratorsDrawer.tsx",
      "components/organiser/TeamsPanel.tsx",
      "routes/bank.tsx",
      "routes/tests.tsx",
    ]);

    // The rule DOES ship into the landing chain — `primitives.css` is in it —
    // and that is fine rather than a gap. A plain landing table cell is
    // untouched by it; only an `.acts` cell, which that chain never renders,
    // would be.
    const plain = document.createElement("td");
    expect(declaredFor(plain, "position", LANDING)).toEqual([]);
    const acts = document.createElement("td");
    acts.className = "acts";
    expect(paintsIn(acts, "position", LANDING)).toBe("sticky");
  });
});

// ---------------------------------------------------------------------------

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

function relativeToSrc(file: string): string {
  return relative(SRC_DIR, file).replaceAll("\\", "/");
}
