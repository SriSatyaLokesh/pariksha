// `D17` — one checkbox and one radio FOR THE WHOLE PRODUCT.
//
// WHY THIS FILE EXISTS, AND WHY IT IS HERE AND NOT BESIDE THE FIELD-ROW
// TESTS. 6.5d Task 5 put the rule in `primitives.css`, which `admin.css` and
// `landing.css` import and `exam.css` does not. So the organiser and the
// landing page got the custom control and **the candidate runtime kept the
// UA's blue** — on `exam/answer/Choice.tsx`, the primary answer control of
// every choice question, and on `exam/Registration.tsx`'s consent box (#201).
// The surface with the least recourse in this product was the one surface the
// rule missed, and the reason it missed is that nothing was watching the seam
// between the two chains. That is what this file is.
//
// The gap was invisible to every test that existed. The Task 5 guard asserted
// `appearance: none` against `admin.css`'s resolved chain and against
// `landing.css`'s, which is two of three, and nothing anywhere enumerated the
// chains. So the first `describe` below does not ask "is this control styled"
// — it asks, of EVERY source file in `apps/web/src` that renders a checkbox
// or a radio, whether the stylesheet entry that file ships in gives it
// `appearance: none`. A new control in a chain that does not carry the rule
// is then a red test naming the file and the entry.
//
// HOW THE CSS IS READ. `vitest.config.ts` sets `css: false`, so jsdom loads no
// stylesheet and `getComputedStyle` knows nothing. `test/css-chain.ts`'s
// reader resolves an entry's real `@import` chain and then asks the DOM,
// through `Element.matches()`, which of those rules actually select a rendered
// element, resolving the winner by specificity. A rule whose selector stops
// matching real markup is as red as one whose declaration is deleted.

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistrationFormSpec, ResponseValue, SingleQuestion } from "@pariksha/core";

import {
  entryStylesheets,
  htmlEntries,
  paintsIn,
  parseRuleBodies,
  readResolvedCss,
} from "../css-chain";
import { AnswerInput } from "../../src/components/exam/answer";
import { FormBuilder } from "../../src/components/testbuilder/FormBuilder";
import { QuestionEditor } from "../../src/components/authoring/QuestionEditor";
import { ViewControls } from "../../src/components/exam/ViewControls";
import type { CandidateQuestion } from "../../src/lib/paper";
import type { ApiClient } from "../../src/lib/api";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(TEST_DIR, "../../src");

/**
 * The pages this app ships, and the source each one dresses.
 *
 * `page` is the real file name, and `htmlEntries()` reads `apps/web/*.html`
 * off disk: the test below asserts the two sets are equal, so a FOURTH page
 * cannot be silently unclaimed. That assertion is not decoration. #201 existed
 * because nothing watched the seam between two CSS chains, and a seam guard
 * that hardcodes its own list of chains rebuilds that defect one level up —
 * a new entry whose sources sit under a prefix another chain already claims
 * (`routes/`, `components/exam/`) would map to the wrong chain and pass bare.
 *
 * `owns` is still written by hand, because there is nothing to derive it from
 * short of walking the module graph. It is watched from two sides instead:
 * every control-rendering source file must fall under at least one prefix
 * (overlaps are intended and resolved by longest prefix — `routes/exam.tsx`
 * is the candidate's, `routes/` the organiser's), and the page set itself is
 * read off disk.
 */
const CHAINS: { name: string; page: string; owns: string[] }[] = [
  {
    name: "candidate runtime",
    page: "exam.html",
    owns: ["components/exam/", "routes/exam.tsx"],
  },
  {
    name: "organiser",
    page: "admin.html",
    owns: [
      "components/testbuilder/",
      "components/authoring/",
      "components/organiser/",
      "routes/",
    ],
  },
  {
    name: "landing",
    page: "index.html",
    owns: ["sections/", "island/", "routes/landing.tsx"],
  },
];

/**
 * EVERY stylesheet each page loads, resolved and joined — not one entry
 * stylesheet.
 *
 * `admin.html` runs `admin-main.tsx`, which imports `base.css`, `admin.css`
 * AND `testbuilder.css` side by side; reading `admin.css` alone would leave a
 * descendant-scoped override in `testbuilder.css` invisible to every
 * assertion below. `index.html` links its two stylesheets directly rather
 * than running a module at all. `entryStylesheets()` covers both shapes.
 */
const RESOLVED: Record<string, string> = Object.fromEntries(
  CHAINS.map((chain) => [
    chain.page,
    // One shared `seen` set per page, so a stylesheet two of its entries
    // reach is read once rather than twice.
    ((seen) =>
      entryStylesheets(chain.page)
        .map((path) => readResolvedCss(path, seen))
        .join("\n"))(new Set<string>()),
  ]),
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * A source file that renders a checkbox or a radio.
 *
 * Both JSX forms: the literal `type="checkbox"` and the expression form
 * `type={multi ? "checkbox" : "radio"}`, which is what `Choice.tsx` writes —
 * the one control #201 was really about, and the one a literal-only pattern
 * missed on this guard's first run.
 *
 * WHAT A SOURCE SCAN CANNOT SEE, stated rather than implied. A `type` that
 * comes from a variable (`type={kind}`), from a prop, or through a `{...rest}`
 * spread never names "checkbox" or "radio" at the call site, so no regex over
 * the source can find it. Widening the pattern to "any `type={...}`" would
 * sweep in every text and number input instead and turn an unrelated file into
 * a false red, which is worse than a known limit.
 *
 * The limit is bounded rather than open: this scan is the BREADTH net — it
 * asks which chains have a control at all — and the two `describe` blocks at
 * the foot of this file are the DEPTH net, measuring real rendered controls
 * in the candidate runtime and in the organiser against their own chains, by
 * `getAllByRole` and not by a pattern. A control typed from a variable is
 * invisible here and visible there the moment it is rendered in a test. What
 * would close the gap properly is a render-every-screen sweep, which this
 * package has no harness for.
 */
const CONTROL_RE = /type=(?:"(?:checkbox|radio)"|\{[^}]*\b(?:checkbox|radio)\b[^}]*\})/;

/** Every source file that renders a checkbox or a radio, repo-relative. */
const CONTROL_FILES = sourceFiles(SRC_DIR)
  .filter((file) => CONTROL_RE.test(readFileSync(file, "utf8")))
  .map((file) => relative(SRC_DIR, file).replaceAll("\\", "/"))
  .sort();

/** The chain a source file ships in, or `undefined` if the map has a hole. */
function chainOf(file: string): (typeof CHAINS)[number] | undefined {
  // Longest prefix wins: `routes/exam.tsx` is the candidate's even though the
  // organiser owns `routes/`.
  return [...CHAINS]
    .flatMap((chain) => chain.owns.map((prefix) => ({ chain, prefix })))
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find(({ prefix }) => file.startsWith(prefix))?.chain;
}

/** A real `<input>` of `type`. Deliberately NOT attached to the document:
 *  `Element.matches()` answers for a detached element, every rule read here
 *  is a bare element selector with no ancestor in it, and an attached probe
 *  survives `cleanup()` — which unmounts React roots and knows nothing about
 *  a node appended by hand — to be counted by a later `getAllByRole`. */
function input(type: "checkbox" | "radio", checked = false): HTMLInputElement {
  const element = document.createElement("input");
  element.type = type;
  element.checked = checked;
  return element;
}

describe("no chain that renders a control is left on the browser default (D17, #201)", () => {
  it("claims every page this app ships, so a fourth entry cannot go unwatched", () => {
    // The #201 shape, one level up. A new `foo.html` whose sources sit under
    // a prefix another chain already claims would map to the WRONG chain and
    // pass bare; a new one under no prefix at all would be invisible to the
    // file scan. Both are caught here, by reading the pages off disk rather
    // than trusting the list above.
    expect(htmlEntries()).toEqual(CHAINS.map((chain) => chain.page).sort());
  });

  it("accounts for every source file that renders a checkbox or a radio", () => {
    // The map's own guard. Without it, a control added under a directory no
    // entry claims would simply not be checked by the test below — which is
    // exactly how the candidate runtime went unwatched.
    expect(CONTROL_FILES.length, "no control found anywhere: the scan is broken").toBeGreaterThan(
      5,
    );
    // AT LEAST one prefix, not exactly one: the prefixes overlap on purpose
    // (`routes/exam.tsx` is the candidate's and `routes/` the organiser's)
    // and `chainOf` resolves that by longest match. What this forbids is a
    // file under NO prefix, which is the hole that would make it unwatched.
    expect(CONTROL_FILES.filter((file) => chainOf(file) === undefined)).toEqual([]);
  });

  it("finds the candidate runtime's own controls, so the scan is not vacuous", () => {
    // The two sites #201 was about, named rather than counted: if either is
    // renamed or moved, this says so instead of quietly checking one chain
    // less.
    expect(CONTROL_FILES).toContain("components/exam/answer/Choice.tsx");
    expect(CONTROL_FILES).toContain("components/exam/Registration.tsx");
    expect(CONTROL_FILES).toContain("components/exam/answer/Structured.tsx");
    expect(CONTROL_FILES).toContain("components/exam/ViewControls.tsx");
  });

  for (const type of ["checkbox", "radio"] as const) {
    it(`gives every chain that renders a ${type} its own appearance: none`, () => {
      const control = input(type);
      const chains = [...new Set(CONTROL_FILES.map((file) => chainOf(file)?.page))];
      const bare: string[] = [];
      for (const entry of chains) {
        if (entry === undefined) continue;
        if (paintsIn(control, "appearance", RESOLVED[entry]!) !== "none") {
          bare.push(`${entry} renders a ${type} and leaves it on the UA's own painting`);
        }
      }
      expect(bare).toEqual([]);
      // ...and at least two chains really were walked, so an empty list is
      // not an empty loop.
      expect(chains.length).toBeGreaterThan(1);
    });
  }

  it("names the landing chain's absence rather than assuming it", () => {
    // `landing.css` imports neither `registration.css` nor any control, and
    // that is correct only while nothing in its own source renders one. The
    // day something does, the assertion above starts checking `landing.css`
    // and reddens; this one says the same thing from the other side, so the
    // reason the landing chain carries no control pair is written down as a
    // fact rather than as a comment.
    expect(CONTROL_FILES.filter((file) => chainOf(file)?.page === "index.html")).toEqual([]);
    expect(paintsIn(input("checkbox"), "appearance", RESOLVED["index.html"]!)).toBeUndefined();
  });

  it("paints through the chain's own names and never a palette literal", () => {
    const rootOf = (css: string): string =>
      parseRuleBodies(css)
        .filter((rule) => rule.selector === ":root")
        .map((rule) => rule.body)
        .join(";");

    // `D1`: an accent cannot cross grounds. The organiser's page is cream and
    // the runtime's is cream-and-canvas with a vermilion accent, so one
    // literal in the shared rule would be wrong on one of them.
    const checked = input("checkbox", true);
    expect(paintsIn(checked, "background", RESOLVED["exam.html"]!)).toBe("var(--control-accent)");
    expect(paintsIn(checked, "border", RESOLVED["exam.html"]!)).toContain("var(--control-edge)");

    for (const entry of ["admin.html", "exam.html"] as const) {
      for (const name of ["--control-accent:", "--control-accent-ink:", "--control-edge:"]) {
        expect(rootOf(RESOLVED[entry]!), `${entry} defines no ${name}`).toContain(name);
      }
    }
  });

  it("resolves each entry's import chain, so a missing rule is a red test", () => {
    // Without this, `paintsIn` would answer `undefined` for a stylesheet that
    // failed to resolve and a deleted rule would be indistinguishable from a
    // broken reader.
    expect(RESOLVED["exam.html"]).toContain(".exam-option-row");
    expect(RESOLVED["exam.html"]).toContain(".text-input");
    expect(RESOLVED["admin.html"]).toContain(".organiser__title");
    // testbuilder.css is loaded beside admin.css by `admin-main.tsx`, not
    // imported by it. Reading the entry rather than the stylesheet is what
    // puts it in reach of every assertion here.
    expect(RESOLVED["admin.html"]).toContain(".form-builder");
    expect(parseRuleBodies(RESOLVED["exam.html"]!).length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// The candidate's own controls, rendered.

const OPTIONS = [
  { id: "a", text: "Alpha" },
  { id: "b", text: "Beta" },
  { id: "c", text: "Gamma" },
];

const SINGLE: CandidateQuestion = {
  id: "q1",
  type: "single",
  prompt: "Pick one",
  options: OPTIONS,
  points: 1,
};

const MULTIPLE: CandidateQuestion = { ...SINGLE, type: "multiple", prompt: "Pick some" };

/** The authoring side's own fixture: a `single` question renders the editor's
 *  "is correct" radios. */
const SINGLE_QUESTION: SingleQuestion = {
  id: "Q1",
  type: "single",
  prompt: "Which HTTP method is idempotent?",
  options: [
    { id: "a", text: "GET" },
    { id: "b", text: "POST" },
  ],
  key: "a",
};

function Answer({ question }: { question: CandidateQuestion }) {
  const [value, setValue] = useState<ResponseValue | null>(null);
  return <AnswerInput question={question} value={value} disabled={false} onChange={setValue} />;
}

describe("the candidate's answer control is custom and still a real input", () => {
  for (const [label, question, role] of [
    ["a single-choice radio", SINGLE, "radio"],
    ["a multiple-choice checkbox", MULTIPLE, "checkbox"],
  ] as const) {
    it(`${label} is drawn by the product, not by the UA`, () => {
      render(<Answer question={question} />);
      const controls = screen.getAllByRole(role);
      expect(controls.length).toBe(OPTIONS.length);
      for (const control of controls) {
        expect(
          paintsIn(control, "appearance", RESOLVED["exam.html"]!),
          `a candidate ${role} resolves to the UA's own painting`,
        ).toBe("none");
      }
    });

    it(`${label} keeps its role, its checked state and its keyboard`, () => {
      render(<Answer question={question} />);
      const first = screen.getAllByRole(role)[0]!;

      // A real element, not a div wearing a role.
      expect(first.tagName).toBe("INPUT");
      expect(first).toHaveAttribute("type", role);
      expect(first).not.toHaveAttribute("tabindex", "-1");
      expect(first).not.toBeChecked();

      // A focused native control's Enter/Space activation IS a click — the
      // decision this workspace already made in writing (no user-event here;
      // see answer-choice.test.tsx's header).
      first.focus();
      expect(document.activeElement).toBe(first);
      fireEvent.click(first);
      expect(screen.getAllByRole(role)[0]!).toBeChecked();
    });
  }

  it("the view controls' text-size radios are custom too", () => {
    render(
      <ViewControls
        fontScale={1}
        onFontScale={() => undefined}
        highContrast={false}
        onHighContrast={() => undefined}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(1);
    for (const radio of radios) {
      expect(paintsIn(radio, "appearance", RESOLVED["exam.html"]!)).toBe("none");
    }
  });
});

// ---------------------------------------------------------------------------
// The organiser's own controls, rendered.
//
// RESTORED IN FIX ROUND 3, and the reason is the point. Before the move, the
// `D17` guard lived in `test/testbuilder/field-rows.test.tsx` and walked
// RENDERED builder controls against the organiser's chain. The move brought
// the candidate side's rendered coverage with it and left the organiser side
// on a detached synthetic `<input>` alone — so a descendant-scoped
// `.form-builder input[type="checkbox"] { appearance: auto }` would have
// evaded the organiser half entirely while every assertion above stayed
// green. One side quietly losing reach during a move is exactly the shape
// `AG2` exists to catch, and the move being right does not excuse it.

function Builder({ initial }: { initial: RegistrationFormSpec }) {
  const [form, setForm] = useState<RegistrationFormSpec | undefined>(initial);
  return (
    <FormBuilder
      form={form}
      onChange={setForm}
      checkUrl={() => Promise.reject(new Error("not used by this test file"))}
    />
  );
}

describe("the organiser's own controls are custom too, measured on rendered markup", () => {
  it("every checkbox the builder renders resolves to appearance: none", () => {
    render(<Builder initial={{ fields: [{ id: "consent", type: "consent", label: "Consent" }] }} />);

    const controls = screen.getAllByRole("checkbox");
    expect(controls.length, "the builder rendered no checkbox to measure").toBeGreaterThan(0);
    for (const control of controls) {
      expect(
        paintsIn(control, "appearance", RESOLVED["admin.html"]!),
        "an organiser checkbox resolves to the UA's own painting",
      ).toBe("none");
    }
  });

  it("a builder checkbox keeps its role, its checked state and its keyboard", () => {
    render(<Builder initial={{ fields: [{ id: "consent", type: "consent", label: "Consent" }] }} />);

    const required = screen.getByRole("checkbox", { name: /required/i });
    expect(required.tagName).toBe("INPUT");
    expect(required).toHaveAttribute("type", "checkbox");
    expect(required).not.toHaveAttribute("tabindex", "-1");
    expect(required).not.toBeChecked();

    required.focus();
    expect(document.activeElement).toBe(required);
    fireEvent.click(required);
    expect(screen.getByRole("checkbox", { name: /required/i })).toBeChecked();
  });

  it("every radio the question editor renders resolves to appearance: none", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SINGLE_QUESTION}
        client={{ listGroups: async () => [] } as unknown as ApiClient}
        onSaved={() => undefined}
      />,
    );

    const controls = screen.getAllByRole("radio");
    expect(controls.length, "the editor rendered no radio to measure").toBeGreaterThan(0);
    for (const control of controls) {
      expect(
        paintsIn(control, "appearance", RESOLVED["admin.html"]!),
        "an organiser radio resolves to the UA's own painting",
      ).toBe("none");
    }
  });
});
