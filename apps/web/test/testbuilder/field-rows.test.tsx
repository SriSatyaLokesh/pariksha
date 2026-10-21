// `D16` — the field-row rule — `D16a` — a field id is scoped to its instance —
// and `D17` — one checkbox and one radio for the whole product.
//
// WHAT IS HERE AND WHAT IS IN THE BROWSER. jsdom performs no layout:
// `getBoundingClientRect()` returns all zeros, so the obvious assertion —
// two controls in a mixed row have the same `top` — is two identical zero
// rects and passes before the feature exists. `D16`'s pixel claim therefore
// lives in `e2e/measurement/field-rows.spec.ts`, which measures a real
// Chromium at 1440x900. What is answerable here is the half that is an
// invariant rather than a mechanism (`AG3`): the grid declarations and the
// `subgrid` / `@supports not` branches, read out of the stylesheet the
// organiser entry really assembles, and `D16`'s CONTENT rule — a unit lives
// inside its control, never in the help track — read off rendered markup.
//
// HOW THE CSS ASSERTIONS ARE MADE. `vitest.config.ts` sets `css: false`, so
// jsdom loads no stylesheet and `getComputedStyle` knows nothing. Rather than
// scan the file for a string, every assertion below resolves admin.css's real
// `@import` chain and then asks the DOM, through `Element.matches()`, which of
// those rules actually select the element that was rendered. A rule whose
// selector stops matching the markup is as red as a rule whose declaration is
// deleted — which a text scan would not catch.
//
// `D16a`'S ID WORK WAS ALREADY DONE. The duplicate-id measurement in the spec
// was taken on the prototype, where three frames render one `screen()`; it was
// never taken against `apps/web`. In the shipped tree every repeated construct
// already derives its ids from `useId()` (spec pointer, 61b0e74). The two id
// tests below are therefore REGRESSION GUARDS on behaviour that already holds,
// not a fix — they passed on first run with no change to either component, and
// the rule still binds every control this task adds.

import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistrationFormSpec, SingleQuestion } from "@pariksha/core";

import { declarations, parseRuleBodies, readResolvedCss } from "../css-chain";
import { FormBuilder } from "../../src/components/testbuilder/FormBuilder";
import { QuestionEditor } from "../../src/components/authoring/QuestionEditor";
import type { ApiClient } from "../../src/lib/api";

const STYLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles");

/** The stylesheet the organiser entry really assembles, imports inlined. */
const ADMIN_CSS = readResolvedCss(resolve(STYLES_DIR, "admin.css"));

/** ...and the landing page's, which imports the same `primitives.css` on a
 *  different ground. `D17`'s "one checkbox for the whole product" is a claim
 *  about both chains, so both are read. */
const LANDING_CSS = readResolvedCss(resolve(STYLES_DIR, "landing.css"));

/**
 * A selector's specificity as one comparable number.
 *
 * Needed, not decorative: `primitives.css` declares `.field-row > .field {
 * display: grid }` and `registration.css`, which admin.css imports AFTER it,
 * declares `.field { display: flex }`. Source order says flex and the cascade
 * says grid (0,2,0 beats 0,1,0). A reader that took the last declaration
 * would have reported the opposite of what a browser paints — it did, on the
 * first green run, which is what this function exists because of.
 *
 * `:not(...)`'s own argument is not counted, and neither is a pseudo-element
 * against the class column; neither form appears in the rules read here.
 */
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (selector.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10_000 + classes * 100 + elements;
}

/**
 * Every value `property` is given by a rule in `css` that really selects
 * `element`, weakest-first — so the last one is the one that paints.
 *
 * `parseRuleBodies` skips `@supports` blocks whole (it recurses into `@media`
 * only), which is what keeps this function reading the DEFAULT branch and
 * `supportsBody()` below reading the fallback. They cannot be confused.
 */
function declaredFor(element: Element, property: string, css = ADMIN_CSS): string[] {
  const found: { weight: number; order: number; value: string }[] = [];
  let order = 0;
  for (const rule of parseRuleBodies(css)) {
    order += 1;
    const weights = rule.selector
      .split(",")
      .map((part) => part.trim())
      .filter((part) => {
        try {
          return element.matches(part);
        } catch {
          // A selector jsdom's engine cannot parse is not a match it can
          // confirm; it must not read as one either.
          return false;
        }
      })
      .map(specificity);
    if (weights.length === 0) continue;
    const weight = Math.max(...weights);
    for (const decl of declarations(rule.body)) {
      const colon = decl.indexOf(":");
      if (colon !== -1 && decl.slice(0, colon).trim() === property) {
        found.push({ weight, order, value: decl.slice(colon + 1).trim() });
      }
    }
  }
  return found
    .sort((a, b) => a.weight - b.weight || a.order - b.order)
    .map((hit) => hit.value);
}

/** The value `property` really paints on `element`, or `undefined`. */
function paints(element: Element, property: string, css = ADMIN_CSS): string | undefined {
  return declaredFor(element, property, css).at(-1);
}

/** The body of the `@supports` block whose prelude contains `condition`. */
function supportsBody(condition: string, css = ADMIN_CSS): string {
  const at = css.indexOf(`@supports ${condition}`);
  expect(at, `no "@supports ${condition}" block in the stylesheet`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(open + 1, i - 1);
}

/** What `selector` declares for `property` inside that `@supports` block. */
function fallbackDeclares(selector: string, property: string): string | undefined {
  const rule = parseRuleBodies(supportsBody("not (grid-template-rows: subgrid)")).find(
    (candidate) => candidate.selector === selector,
  );
  if (rule === undefined) return undefined;
  return declarations(rule.body)
    .map((decl) => [decl.slice(0, decl.indexOf(":")).trim(), decl.slice(decl.indexOf(":") + 1).trim()])
    .find(([name]) => name === property)?.[1];
}

// ---------------------------------------------------------------------------
// The two surfaces `D16`'s "cost if wrong" names: "the registration form
// builder and the question editor, which have the same shape and the same
// latent bug".

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

const noop = (): void => undefined;

/** Only the two calls `QuestionEditor` makes on mount. */
function editorClient(): ApiClient {
  return {
    listGroups: async () => [],
    saveQuestion: async () => {
      throw new Error("not used by this test file");
    },
  } as unknown as ApiClient;
}

function renderQuestionEditor(): void {
  render(
    <QuestionEditor
      bankId="bnk_1"
      workspaceId="wsp_1"
      initial={SINGLE}
      client={editorClient()}
      onSaved={noop}
    />,
  );
}

/** A short-text field, which is the one that carries both a length row (two
 *  fields, neither with help) and a mixed row (one field with help, one
 *  without). The builder is controlled, so the harness holds its state. */
const ROLL_NUMBER: RegistrationFormSpec = {
  fields: [
    { id: "roll_number", type: "short_text", label: "Roll number", validation: { min_length: 8 } },
  ],
};

function Harness({ initial }: { initial: RegistrationFormSpec }) {
  const [form, setForm] = useState<RegistrationFormSpec | undefined>(initial);
  return <FormBuilder form={form} onChange={setForm} checkUrl={neverChecked} />;
}

const neverChecked = (): Promise<never> => Promise.reject(new Error("not used by this test file"));

/** The `.field-row` holding the field whose visible label is `label`. */
function rowOf(label: string | RegExp): HTMLElement {
  const control = screen.getByLabelText(label);
  const row = control.closest(".field-row");
  expect(row, `"${String(label)}" is not inside a .field-row`).not.toBeNull();
  return row as HTMLElement;
}

/** The `.field` elements of a row, in document order. */
function fieldsOf(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(":scope > .field")];
}

// ---------------------------------------------------------------------------

describe("D16 — a row of fields is one grid with three tracks", () => {
  it("puts every label in a row on one line and every control on one line", () => {
    renderQuestionEditor();

    // The mixed row this rule exists for: "Question ID" states a constraint
    // in the help track and "Passage group" states nothing. Before the rule,
    // the second field's control stretched into the space the first spent on
    // that sentence and the two landed on different lines.
    const row = rowOf("Question ID");
    const fields = fieldsOf(row);
    expect(fields.length).toBeGreaterThan(1);
    expect(fields.filter((field) => field.querySelector(".field-help") !== null)).toHaveLength(1);

    // One grid, three row tracks, on the ROW.
    expect(paints(row, "display")).toBe("grid");
    expect(paints(row, "grid-template-rows")?.split(/\s+/)).toHaveLength(3);

    // Each field is a subgrid spanning all three of them, so its label, its
    // control and its help resolve against the row's lines and not its own.
    for (const field of fields) {
      expect(paints(field, "display")).toBe("grid");
      expect(paints(field, "grid-template-rows")).toBe("subgrid");
      expect(paints(field, "grid-row")).toBe("span 3");
      // ...and nothing in a field stretches to fill a track it did not earn.
      for (const child of [...field.children]) {
        expect(paints(child, "align-self")).toBe("start");
      }
    }
  });

  it("reserves the help track where subgrid is unavailable", () => {
    renderQuestionEditor();
    const fields = fieldsOf(rowOf("Question ID"));

    // The fallback gives each field its own three explicit tracks...
    expect(fallbackDeclares(".field-row > .field", "grid-template-rows")).toBe("auto auto auto");

    // ...and a row where ANY field carries help reserves one help line on
    // EVERY field in it. That is the ruling's "one empty line, never a
    // misalignment": without the reserve, the help-free field's third track
    // is zero and its control sits a line higher than its neighbour's.
    const reserved = fallbackDeclares(".field-row:has(.field-help) > .field", "grid-template-rows");
    expect(reserved).toMatch(/^auto auto minmax\(/);
    // Reserved against a real line height, not a magic number.
    expect(reserved).toContain("var(--type-body-sm-line-height)");

    // And the live markup is the shape that selector needs: a row that holds
    // a `.field-help` somewhere, with a field that has none.
    const row = rowOf("Question ID");
    expect(row.querySelector(".field-help")).not.toBeNull();
    expect(fields.some((field) => field.querySelector(".field-help") === null)).toBe(true);
  });

  it("collapses the help track on a row where no field has help", () => {
    render(<Harness initial={ROLL_NUMBER} />);

    // "Minimum length" and "Maximum length": two fields, a unit inside each
    // control, neither with help. The reserve is conditional on a `.field-help`
    // being present, so this row costs no empty line.
    const row = rowOf("Minimum length");
    expect(row.querySelector(".field-help")).toBeNull();
    expect(fallbackDeclares(".field-row > .field", "grid-template-rows")).toBe("auto auto auto");
  });
});

describe("D16 — secondary text has exactly three homes", () => {
  it("puts a unit inside its control, never in the help track", () => {
    render(<Harness initial={ROLL_NUMBER} />);

    const unit = screen.getAllByText("chars");
    expect(unit.length).toBeGreaterThan(0);
    for (const affix of unit) {
      // Inside the control's own box...
      const control = affix.closest(".field-affix");
      expect(control, "the unit is not inside a .field-affix").not.toBeNull();
      expect(control!.querySelector("input")).not.toBeNull();
      // ...and never in the help track.
      expect(affix.closest(".field-help")).toBeNull();
    }

    // The invariant, stated over every help line the builder renders rather
    // than over the one field this test set up: no help line is a bare unit.
    for (const help of document.querySelectorAll(".field-help")) {
      expect(["chars", "min", "pts", "IST"]).not.toContain(help.textContent?.trim());
    }
  });
});

describe("D16a — a field id is scoped to its instance (regression guard)", () => {
  /** Every id a form control in the document carries. */
  function allFieldIds(): string[] {
    return [...document.querySelectorAll<HTMLElement>("input[id], select[id], textarea[id]")].map(
      (control) => control.id,
    );
  }

  it("gives each panel instance its own field ids", () => {
    // Two field panels of the same shape, which is the construct the rule is
    // about: with a literal id, `d1`-`d5` would exist twice over.
    render(
      <Harness
        initial={{
          fields: [
            { id: "roll_number", type: "short_text", label: "Roll number" },
            { id: "section", type: "short_text", label: "Section" },
          ],
        }}
      />,
    );

    const ids = allFieldIds();
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every label at a control in its own panel", () => {
    render(
      <Harness
        initial={{
          fields: [
            { id: "roll_number", type: "short_text", label: "Roll number" },
            { id: "section", type: "short_text", label: "Section" },
          ],
        }}
      />,
    );
    renderQuestionEditor();

    const orphans: string[] = [];
    for (const label of document.querySelectorAll<HTMLLabelElement>("label[for]")) {
      const control = document.getElementById(label.htmlFor);
      if (control === null) {
        orphans.push(`${label.htmlFor}: no control`);
        continue;
      }
      // The panel the label is in must be the panel the control is in — the
      // failure the rule names is a label resolving to the FIRST instance.
      const panel = label.closest(".field, fieldset, .question-editor");
      if (panel !== null && !panel.contains(control)) {
        orphans.push(`${label.htmlFor}: resolves outside its own panel`);
      }
    }
    expect(orphans).toEqual([]);
  });
});

describe("D17 — one checkbox and one radio for the whole product", () => {
  /** Every checkbox and radio rendered, on either chain. */
  function allCheckboxesAndRadios(): HTMLInputElement[] {
    return [
      ...document.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"], input[type="radio"]',
      ),
    ];
  }

  it("uses no browser-default checkbox or radio", () => {
    render(<Harness initial={ROLL_NUMBER} />);
    renderQuestionEditor();

    const controls = allCheckboxesAndRadios();
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(paints(control, "appearance"), `${control.type} keeps the UA's own painting`).toBe(
        "none",
      );
      // The same rule, through the other chain. `primitives.css` is imported
      // by landing.css too, and "one checkbox for the whole product" is a
      // claim about both.
      expect(paints(control, "appearance", LANDING_CSS)).toBe("none");
    }
  });

  it("draws both controls through the chain's own accent pair, never a literal", () => {
    render(<Harness initial={{ fields: [{ id: "consent", type: "consent", label: "Consent" }] }} />);
    const box = screen.getAllByRole("checkbox")[0]!;

    expect(paints(box, "border")).toContain("var(--control-accent)");

    // Each chain gives that pair its own ground's value, and neither may
    // reach past it to a palette token: `--accent` is the DARK Signal green
    // on a builder whose page is still cream (1.60:1), which is `D1`'s
    // "an accent cannot cross grounds" exactly.
    const rootOf = (css: string): string =>
      parseRuleBodies(css)
        .filter((rule) => rule.selector === ":root")
        .map((rule) => rule.body)
        .join(";");
    for (const [name, css] of [
      ["admin", ADMIN_CSS],
      ["landing", LANDING_CSS],
    ] as const) {
      expect(rootOf(css), `${name} defines no --control-accent`).toContain("--control-accent:");
      expect(rootOf(css), `${name} defines no --control-accent-ink`).toContain(
        "--control-accent-ink:",
      );
    }
  });

  it("keeps real input semantics on the custom controls", () => {
    render(<Harness initial={{ fields: [{ id: "consent", type: "consent", label: "Consent" }] }} />);

    // Role, checked state and keyboard reachability all come from the native
    // element: only the painting changed.
    const required = screen.getByRole("checkbox", { name: /required/i });
    expect(required.tagName).toBe("INPUT");
    expect(required).not.toBeChecked();
    expect(required).not.toHaveAttribute("tabindex", "-1");

    required.click();
    expect(screen.getByRole("checkbox", { name: /required/i })).toBeChecked();
  });
});

describe("the guards above read the real stylesheet", () => {
  it("resolves admin.css's import chain, so a missing rule is a red test", () => {
    // Without this, every `paints()` call would answer `undefined` for a
    // stylesheet that failed to resolve, and a deleted rule would be
    // indistinguishable from a broken reader.
    expect(ADMIN_CSS).toContain(".button-primary");
    expect(LANDING_CSS).toContain(".button-primary");
    expect(parseRuleBodies(ADMIN_CSS).length).toBeGreaterThan(20);
  });

  it("resolves the cascade by specificity, not by source order", () => {
    // The live case: registration.css gives `.field` `display: flex` and is
    // imported AFTER primitives.css, which gives `.field-row > .field`
    // `display: grid`. Order says flex, the cascade says grid. A `.field`
    // outside a row really is flex, and both answers come from the same
    // reader — which is what makes the first one a fact and not a fixture.
    cleanup();
    render(
      <div>
        <div className="field-row">
          <div className="field" data-testid="in-row" />
        </div>
        <div className="field" data-testid="alone" />
      </div>,
    );
    expect(paints(screen.getByTestId("in-row"), "display")).toBe("grid");
    expect(paints(screen.getByTestId("alone"), "display")).toBe("flex");
  });

  it("answers from the DOM, not from the selector text", () => {
    cleanup();
    render(<div className="field-row" data-testid="probe" />);
    const probe = screen.getByTestId("probe");
    expect(paints(probe, "display")).toBe("grid");
    // A sibling that the rule does not select gets nothing, which is what
    // makes the assertions above claims about THIS element.
    expect(paints(document.body, "display")).toBeUndefined();
  });
});
