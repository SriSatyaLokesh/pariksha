// Phase 7b Task 5 (`D1`, `D20`, `Q3`): the `axe` pass this panel has not had
// yet — with the confirmation dialog open, a "changed from {Profile}" marker
// showing, and the disabled `face_check` control present.
//
// T5-R1 (progress.md, confirmed against the tree): Tasks 2-4 added no
// colour-setting selector at all. The marker and the cost line both reuse
// `.field-help`, already carrying `SURFACE` entries on both grounds in
// `contrast-usage.test.ts`; the panel's only new paint is a border on
// `.proctoring-panel__group`. So that gate stays green as-is — this file
// does not invent a selector to make it fail (`D20`/#201 want reuse; forcing
// a fail would be `AG5` inverted). The disabled `face_check` row was
// re-checked by hand against `registration.css`'s own measured-ratio
// comment (organiser fill 5.20:1+, exempt from WCAG 1.4.3 by opacity, never
// a colour swap) and `.field-label` carries no `:disabled`-conditional
// styling at all — its label reads at the SAME already-covered ratio
// whether the control is enabled or not. Nothing here needs a new entry;
// this file's job is the structural `axe` pass `contrast-usage.test.ts`
// cannot do (jsdom has no layout engine or canvas backend — see that
// file's own header note) and that no earlier task's file reached yet.
//
// T5-R2: the brief's own second Step-1 test — a colour-not-alone marker
// query via `getByRole("group", { name: /Require a camera/i })` — is the
// exact query `proctoring-profile.test.tsx`'s T3-R1 already ruled cannot
// match (Task 2 shipped no group named for a single control). That file's
// "marks an override that differs from its profile default" test already
// asserts the marker via `toHaveAccessibleDescription` plus visible text,
// which IS the colour-not-alone proof. Restating it here under a different
// query would just reintroduce the broken one; this file does not.
//
// Branch-review Finding 5, HONESTLY STATED: this file used to loop
// `["light", "dark"]` over the three `axe` passes below, toggling
// `document.documentElement.dataset.theme` between iterations and calling
// that "both grounds". It wasn't. `apps/web/test/setup.ts` injects no
// stylesheet and jsdom follows no `@import` chain (the branch's own `T2-R1`
// ruling), `axe`'s `color-contrast` rule cannot run without a layout engine
// or canvas backend at all (this file's own note above), and
// `ProctoringPanel` renders no theme-conditional markup — so the two
// iterations produced a byte-identical DOM and an identical rule set every
// time. A loop that asserts a property the harness cannot see reads as more
// coverage than it is, which is the decoration failure mode this phase
// keeps finding (`T5-R2`'s own probe exists to avoid exactly that).
//
// So: ONE ground, run once, three tests — what this file actually proves is
// structural: labelling, roles, focus and disabled-state association, none
// of which varies with `data-theme`. The two-ground COLOUR-contrast claim
// (`D1`) is enforced where it can actually be checked:
// `apps/web/test/css-chain/contrast-usage.test.ts`, which resolves the real
// stylesheet chain and computes real ratios per ground from it — see that
// file's `SURFACE` table, which already carries both grounds for every
// selector this panel paints.
//
// Local `openProctoringPanel`, same pattern Tasks 2-4 each wrote (R1,
// progress.md).

import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ProctoringOverrides, ProctoringProfile } from "@pariksha/core";

import { ProctoringPanel } from "../../src/components/testbuilder/ProctoringPanel";

const user = {
  selectOptions: (el: Element, value: string) => fireEvent.change(el, { target: { value } }),
};

type Proctoring = { profile: ProctoringProfile; overrides: ProctoringOverrides };

/** Controlled, like Tasks 2-4's own `Harness` — a static `value` prop would
 *  assert on a component that can never change. `durationMinutes` is fixed
 *  at 60 so the cost line renders too (another reused-selector surface),
 *  which none of this file's assertions need to vary. */
function Harness({
  profile = "off",
  overrides = {},
}: {
  profile?: ProctoringProfile;
  overrides?: ProctoringOverrides;
}) {
  const [proctoring, setProctoring] = useState<Proctoring>({ profile, overrides });
  return <ProctoringPanel value={proctoring} durationMinutes={60} onChange={setProctoring} />;
}

async function openProctoringPanel(
  init: { profile?: ProctoringProfile; overrides?: ProctoringOverrides } = {},
): Promise<HTMLElement> {
  const { container } = render(<Harness {...init} />);
  await screen.findByRole("group", { name: /Proctoring/i });
  return container;
}

describe("the proctoring panel's accessibility gate (D1, D20, Q3)", () => {
  it("has no axe violations with a marker showing and face_check disabled", async () => {
    const container = await openProctoringPanel({
      profile: "strict",
      overrides: { require_camera: false },
    });
    // Both the things this task's gate exists to check are really in the
    // DOM for this render, so a future change that drops either silently
    // also drops its own axe coverage rather than leaving a pass that
    // tests nothing (the same `queryBy*`-needs-a-positive-control
    // discipline carried through every task on this plan).
    expect(screen.getByText(/changed from Strict/i)).toBeVisible();
    expect(screen.getByLabelText(/Count faces in each image/i)).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with the confirmation dialog open", async () => {
    const container = await openProctoringPanel({
      profile: "strict",
      overrides: { require_camera: false },
    });
    user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
    await screen.findByRole("alertdialog");
    expect(await axe(container)).toHaveNoViolations();
  });

  // T5-R2: the one tight spot the plan predicted — a disabled control
  // still needs a legible, associated label. `axe`'s label-association
  // checks (`label`, `aria-input-field-name`) run fine under jsdom even
  // though colour contrast cannot; isolating this one row rather than
  // relying on the whole-panel passes above to localise a failure to it.
  it("the disabled face_check control keeps a legible, associated label", async () => {
    const container = await openProctoringPanel({ profile: "strict" });
    const control = screen.getByLabelText(/Count faces in each image/i);
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleName(/Count faces in each image/i);
    expect(control).toHaveAccessibleDescription(/Phase 8/i);
    expect(await axe(container)).toHaveNoViolations();
  });
});
