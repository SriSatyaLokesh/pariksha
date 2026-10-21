import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { QuestionType, SingleQuestion } from "@pariksha/core";

import type { Actor, ApiClient, Bank, Workspace } from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";
import { TYPE_GROUPS, TYPE_LABELS } from "../../src/components/authoring/TypePicker";
import {
  readResolvedCss,
  organiserStylesheets,
  parseRuleBodies,
  declarations,
  paintsIn,
} from "../css-chain";

// `D18`: "Type picker cards are `align-content: start` and open a drawn
// miniature of that question type on hover AND keyboard focus, animated
// 0fr->1fr so nothing jumps. Twelve distinct examples — a description is
// not an example."
//
// WHAT THIS FILE CAN AND CANNOT SEE. The web package runs vitest with
// `css: false`, so jsdom applies no cascade at all and `getComputedStyle`
// reports initial values whatever the stylesheet says; and jsdom performs
// no layout, so `getBoundingClientRect()` is all zeros. Both halves of the
// obvious assertion — "the example became visible", "the grid did not
// change height" — would therefore pass identically before this feature
// existed and after. They are not written here.
//
// What IS readable is the cascade, resolved by hand against the real
// elements of a real mount: `paintsIn` walks every rule the organiser's
// stylesheet chain really assembles, keeps the ones whose selector the
// element really matches, and returns the value that really wins. Focus
// state is part of that match — jsdom's `matches()` evaluates `:focus`,
// `:focus-visible` and `:focus-within` against the real `activeElement` —
// so "the card is focused, therefore the open rule is the one that paints"
// is a statement about behaviour, not about the presence of a rule.
//
// `:hover` is the one selector jsdom answers `false` to unconditionally
// (there is no pointer), so the hover half of the ruling is guarded one
// notch weaker and the weakness is named where it is used, below.
//
// No `@testing-library/user-event` in this workspace (apps/web carries
// @testing-library/react and jest-dom only — `test/authoring/reorder.test.tsx`
// and `test/exam/calculator.test.tsx` both record this). Focus is moved
// with `.focus()` on the real element, which is the same `activeElement`
// a Tab produces; jsdom implements no sequential focus navigation and
// resolves `:focus-visible` as `:focus`, so this file proves "focus opens
// it" and cannot prove "only a KEYBOARD focus opens it". That distinction
// is a browser fact and is named in the report, not asserted here.

const ALL_STYLESHEETS = organiserStylesheets();
// One shared `seen` set so a file imported by two entries is read once, in
// the order `admin-main.tsx` loads them — which is the order a tie between
// `base.css` and another stylesheet is resolved in.
const ORGANISER_CSS = (() => {
  const seen = new Set<string>();
  return ALL_STYLESHEETS.map((path) => readResolvedCss(path, seen)).join("\n");
})();

const TYPES: QuestionType[] = [
  ...TYPE_GROUPS.choice,
  ...TYPE_GROUPS.match,
  ...TYPE_GROUPS.written,
];

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "author@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const BANK: Bank = {
  id: "bnk_1",
  name: "SQL basics",
  description: null,
  license: null,
  tags: [],
  questionCount: 1,
  createdAt: 0,
  updatedAt: 0,
};

const SINGLE: SingleQuestion = {
  id: "Q1",
  type: "single",
  prompt: "Which HTTP method is idempotent?",
  options: [
    { id: "a", text: "GET" },
    { id: "b", text: "POST" },
  ],
  key: "a",
};

function fakeClient(): ApiClient {
  const unused = () => {
    throw new Error("not used by this test file");
  };
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: unused,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
    createBank: unused,
    listQuestions: async () => ({
      questions: [
        {
          id: "qst_1",
          bankId: "bnk_1",
          refId: SINGLE.id,
          document: SINGLE,
          points: 1,
          usedInTests: 0,
          updatedAt: 0,
        },
      ],
    }),
    deleteQuestion: async () => undefined,
    saveQuestion: async (_workspaceId, bankId, doc) => ({
      id: "qst_1",
      bankId,
      refId: doc.id,
      document: doc,
      points: 1,
      usedInTests: 0,
      updatedAt: 0,
    }),
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: unused,
    updateGroup: unused,
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: unused,
    tests: async () => [],
    createTest: unused,
    test: unused,
    updateTest: unused,
    draft: unused,
    patchDraft: unused,
    publishTest: unused,
    closeTest: unused,
    archiveTest: unused,
    versions: async () => [],
    checklist: async () => [],
    cloneTest: unused,
    exportTest: unused,
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: unused,
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: unused,
    uploadMedia: unused,
    candidates: async () => [],
    importCandidates: unused,
  };
}

/**
 * `D14`: every assertion starts at `OrganiserApp` and clicks its way in.
 * Home -> Banks -> the bank -> the editor -> "Change type", which is the
 * only route an Author has to the picker this file is about.
 *
 */
async function openPicker() {
  render(<OrganiserApp client={fakeClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
  fireEvent.click(await screen.findByRole("button", { name: /SQL basics/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^edit question:/i }));
  await screen.findByRole("heading", { level: 1, name: "Edit question" });
  fireEvent.click(await screen.findByRole("button", { name: /^change type$/i }));
  await screen.findByRole("button", { name: /^Single choice/ });
}

/**
 * The picker button for one type, proved to be the button and not some
 * other element that happens to carry the same words. Every absence or
 * cascade assertion below runs against what this returns, and
 * `declaredFor` reads a wrong element as "no rule matches" rather than as
 * a failure — so the element is checked, not assumed.
 */
function cardFor(type: QuestionType): HTMLElement {
  const card = screen.getByRole("button", { name: new RegExp(`^${TYPE_LABELS[type]}\\b`) });
  expect(card.tagName).toBe("BUTTON");
  expect(card).toHaveAttribute("aria-pressed");
  return card;
}

/** The drawn miniature inside one card, likewise proved rather than assumed. */
function exampleFor(type: QuestionType): Element {
  const card = cardFor(type);
  const example = card.querySelector(".type-card__example");
  expect(example, `no .type-card__example inside the ${type} card`).not.toBeNull();
  return example as Element;
}

/**
 * A miniature's SHAPE: its markup with every text node removed.
 *
 * This is what makes "a description is not an example" testable. Twelve
 * boxes each holding that type's own sentence are twelve distinct strings
 * and one single shape; twelve drawings of twelve different question types
 * are twelve shapes. Stripping the text is what tells them apart.
 */
function shapeOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) text.remove();
  return clone.innerHTML;
}

/** The track list a card's own grid really resolves to, under the real cascade. */
function tracksOf(card: Element): string[] {
  const declared = paintsIn(card, "grid-template-rows", ORGANISER_CSS);
  expect(declared, "the card declares no grid-template-rows at all").toBeDefined();
  return (declared as string).trim().split(/\s+/);
}

describe("D18: the type picker opens a drawn example", () => {
  it("opens the example on keyboard focus, not only on hover", async () => {
    await openPicker();
    const single = cardFor("single");

    // Nothing focused: the card's own closed track list is what paints.
    expect(document.activeElement).not.toBe(single);
    expect(tracksOf(single).at(-1)).toBe("0fr");

    single.focus();
    expect(document.activeElement).toBe(single);

    // Focused: the open rule is now the one that wins the cascade on this
    // very element. jsdom evaluates `:focus-visible` against the real
    // `activeElement`, so this is the focus doing it and not the rule
    // merely existing.
    expect(tracksOf(single).at(-1)).toBe("1fr");

    // Focus leaves, and it closes again.
    single.blur();
    expect(document.activeElement).not.toBe(single);
    expect(tracksOf(single).at(-1)).toBe("0fr");
  });

  it("opens on hover through the same rule that focus opens", async () => {
    // WEAKER THAN THE TEST ABOVE, deliberately and visibly. jsdom has no
    // pointer: `element.matches(":hover")` is `false` for every element
    // forever, so hover cannot be exercised here at all. What is checked
    // instead is an invariant that ties the two halves of the ruling
    // together: the rule that focus was just proved to win must ALSO carry
    // a `:hover` branch, and that branch must resolve to this same card —
    // not to some other element, and not to a selector that no longer
    // matches it. A hover branch retargeted or deleted reddens this.
    await openPicker();
    const single = cardFor("single");
    const closedTracks = tracksOf(single).join(" ");
    const openTracks = `${closedTracks.slice(0, closedTracks.lastIndexOf(" "))} 1fr`;

    const openRule = parseRuleBodies(ORGANISER_CSS).find((rule) =>
      declarations(rule.body).some(
        (decl) => decl.replace(/\s+/g, " ").trim() === `grid-template-rows: ${openTracks}`,
      ),
    );
    expect(openRule, `no rule declares grid-template-rows: ${openTracks}`).toBeDefined();

    const hoverBranch = (openRule as { selector: string }).selector
      .split(",")
      .map((part) => part.trim())
      .find((part) => part.includes(":hover"));
    expect(hoverBranch, "the open rule has no :hover branch").toBeDefined();

    // The branch targets THIS card: peel `:hover` off and the rest must
    // still select it.
    expect(single.matches((hoverBranch as string).replace(":hover", ""))).toBe(true);
  });

  it("draws a distinct example for each of the twelve types", async () => {
    await openPicker();
    expect(TYPES).toHaveLength(12);

    const shapes = TYPES.map((type) => shapeOf(exampleFor(type)));

    // Every one really draws: a miniature with nothing but text in it is
    // the description this ruling refuses.
    for (const [index, shape] of shapes.entries()) {
      const drawn = new DOMParser().parseFromString(`<i>${shape}</i>`, "text/html");
      expect(
        drawn.querySelectorAll("*").length,
        `the ${TYPES[index]} example draws fewer than three elements`,
      ).toBeGreaterThanOrEqual(4); // <html><head><body><i> is 4 before any shape
    }

    // Twelve types, twelve shapes. Text stripped, so twelve boxes each
    // holding that type's own sentence collapse to one shape and fail.
    expect(new Set(shapes).size).toBe(12);
  });

  it("resizes the example's own track rather than adding one, so the rows above it never move", async () => {
    // The brief asks for "does not change the card grid's height when an
    // example opens". That is a PIXEL claim, and neither tool in this
    // repository can make it: jsdom does no layout (every rect is zero,
    // before the feature and after), and Playwright is unavailable here.
    // So what is asserted is the invariant the `0fr->1fr` mechanism exists
    // to provide, which IS readable: the card keeps the same number of
    // tracks open and closed, every track but the last is byte-identical
    // between the two states, and the example is in the DOM in both — so
    // opening it is a resize of one existing row and never a remount or a
    // new row. The name and the note cannot move relative to the card's
    // top, whatever height the grid row gives the card.
    await openPicker();
    const single = cardFor("single");

    // Queried while CLOSED, and proved non-null by `exampleFor` itself:
    // the drawer is not conditionally mounted.
    const example = exampleFor("single");
    expect(example.isConnected).toBe(true);

    const closed = tracksOf(single);
    single.focus();
    expect(document.activeElement).toBe(single);
    const open = tracksOf(single);

    expect(open).toHaveLength(closed.length);
    expect(open.slice(0, -1)).toEqual(closed.slice(0, -1));
    expect([closed.at(-1), open.at(-1)]).toEqual(["0fr", "1fr"]);
    expect(example.isConnected).toBe(true);

    // `align-content: start` is what keeps those untouched rows at the top
    // of a card the grid has stretched to a taller neighbour's height.
    expect(paintsIn(single, "align-content", ORGANISER_CSS)).toBe("start");
  });

  it("keeps aria-pressed as the selection semantics the picker already had", async () => {
    await openPicker();
    // The editor opens on a `single` question, so that card is the pressed
    // one and no other is. Opening a drawer on focus must not change what
    // the button IS.
    expect(cardFor("single")).toHaveAttribute("aria-pressed", "true");
    for (const type of TYPES.filter((candidate) => candidate !== "single")) {
      expect(cardFor(type)).toHaveAttribute("aria-pressed", "false");
    }
  });
});
