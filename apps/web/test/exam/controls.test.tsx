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
import type { ResponseValue } from "@pariksha/core";

import { paintsIn, parseRuleBodies, readResolvedCss } from "../css-chain";
import { AnswerInput } from "../../src/components/exam/answer";
import { ViewControls } from "../../src/components/exam/ViewControls";
import type { CandidateQuestion } from "../../src/lib/paper";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(TEST_DIR, "../../src");
const STYLES_DIR = resolve(SRC_DIR, "styles");

/**
 * The three stylesheet entries this app ships, and the source each one
 * dresses.
 *
 * Written down rather than derived, because there is nothing to derive it
 * from short of walking the module graph — but it is not allowed to go stale:
 * the first test below asserts that EVERY source file rendering a checkbox or
 * a radio falls under exactly one `owns` prefix, so a new directory cannot
 * slip through unwatched. That assertion is the whole point of the map.
 */
const CHAINS: { name: string; entry: string; owns: string[] }[] = [
  {
    name: "candidate runtime (exam.html)",
    entry: "exam.css",
    owns: ["components/exam/", "routes/exam.tsx"],
  },
  {
    name: "organiser (admin.html)",
    entry: "admin.css",
    owns: [
      "components/testbuilder/",
      "components/authoring/",
      "components/organiser/",
      "routes/",
    ],
  },
  {
    name: "landing (index.html)",
    entry: "landing.css",
    owns: ["sections/", "island/", "routes/landing.tsx"],
  },
];

/** `exam.css` also carries `registration.css`, which both chains share. */
const RESOLVED: Record<string, string> = Object.fromEntries(
  CHAINS.map((chain) => [chain.entry, readResolvedCss(resolve(STYLES_DIR, chain.entry))]),
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

// `Choice.tsx` writes `type={multi ? "checkbox" : "radio"}`, so a literal-only
// pattern misses the one control #201 was really about. Both forms, and the
// expression form is matched on its content rather than on its shape.
const CONTROL_RE = /type=(?:"(?:checkbox|radio)"|\{[^}]*["'](?:checkbox|radio)["'][^}]*\})/;

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
  it("accounts for every source file that renders a checkbox or a radio", () => {
    // The map's own guard. Without it, a control added under a directory no
    // entry claims would simply not be checked by the test below — which is
    // exactly how the candidate runtime went unwatched.
    expect(CONTROL_FILES.length, "no control found anywhere: the scan is broken").toBeGreaterThan(
      5,
    );
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
      const chains = [...new Set(CONTROL_FILES.map((file) => chainOf(file)?.entry))];
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
    expect(CONTROL_FILES.filter((file) => chainOf(file)?.entry === "landing.css")).toEqual([]);
    expect(paintsIn(input("checkbox"), "appearance", RESOLVED["landing.css"]!)).toBeUndefined();
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
    expect(paintsIn(checked, "background", RESOLVED["exam.css"]!)).toBe("var(--control-accent)");
    expect(paintsIn(checked, "border", RESOLVED["exam.css"]!)).toContain("var(--control-edge)");

    for (const entry of ["admin.css", "exam.css"] as const) {
      for (const name of ["--control-accent:", "--control-accent-ink:", "--control-edge:"]) {
        expect(rootOf(RESOLVED[entry]!), `${entry} defines no ${name}`).toContain(name);
      }
    }
  });

  it("resolves each entry's import chain, so a missing rule is a red test", () => {
    // Without this, `paintsIn` would answer `undefined` for a stylesheet that
    // failed to resolve and a deleted rule would be indistinguishable from a
    // broken reader.
    expect(RESOLVED["exam.css"]).toContain(".exam-option-row");
    expect(RESOLVED["exam.css"]).toContain(".text-input");
    expect(RESOLVED["admin.css"]).toContain(".organiser__title");
    expect(parseRuleBodies(RESOLVED["exam.css"]!).length).toBeGreaterThan(20);
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
          paintsIn(control, "appearance", RESOLVED["exam.css"]!),
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
      expect(paintsIn(radio, "appearance", RESOLVED["exam.css"]!)).toBe("none");
    }
  });
});
