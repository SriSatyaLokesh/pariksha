// Phase 7b Task 5 (`D1`, `D20`, `Q3`): the `axe` pass this panel has not had
// yet — with the confirmation dialog open, a "changed from {Profile}" marker
// showing, and the disabled `face_check` control present, on BOTH grounds
// (`:root` and `:root[data-theme="light"]`).
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
// file's own header note) and that no earlier task's file reached with
// both grounds live.
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
// Local `openProctoringPanel`, same pattern Tasks 2-4 each wrote (R1,
// progress.md) — extended with a `ground` option that sets
// `document.documentElement.dataset.theme`, the same mechanism
// `ground.test.ts` asserts for the real app and `theme.css`'s
// `THEME_SELECTOR` keys off.

import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ProctoringOverrides, ProctoringProfile } from "@pariksha/core";

import { ProctoringPanel } from "../../src/components/testbuilder/ProctoringPanel";

const user = {
  selectOptions: (el: Element, value: string) => fireEvent.change(el, { target: { value } }),
};

type Proctoring = { profile: ProctoringProfile; overrides: ProctoringOverrides };
type Ground = "dark" | "light";

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

/** `ground.test.ts`'s own mechanism: `theme.css` keys its light palette off
 *  `:root[data-theme="light"]`, so the whole switch is one attribute on
 *  `<html>`. Dark is the attribute's absence, not a second value. */
function setGround(ground: Ground): void {
  if (ground === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

async function openProctoringPanel(
  init: { profile?: ProctoringProfile; overrides?: ProctoringOverrides } = {},
  opts: { ground?: Ground } = {},
): Promise<HTMLElement> {
  setGround(opts.ground ?? "dark");
  const { container } = render(<Harness {...init} />);
  await screen.findByRole("group", { name: /Proctoring/i });
  return container;
}

describe("the proctoring panel's accessibility gate, on both grounds (D1, D20, Q3)", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  for (const ground of ["light", "dark"] as const) {
    it(`[${ground}] has no axe violations with a marker showing and face_check disabled`, async () => {
      const container = await openProctoringPanel(
        { profile: "strict", overrides: { require_camera: false } },
        { ground },
      );
      // Both the things this task's gate exists to check are really in the
      // DOM for this render, so a future change that drops either silently
      // also drops its own axe coverage rather than leaving a pass that
      // tests nothing (the same `queryBy*`-needs-a-positive-control
      // discipline carried through every task on this plan).
      expect(screen.getByText(/changed from Strict/i)).toBeVisible();
      expect(screen.getByLabelText(/Count faces in each image/i)).toBeDisabled();
      expect(await axe(container)).toHaveNoViolations();
    });

    it(`[${ground}] has no axe violations with the confirmation dialog open`, async () => {
      const container = await openProctoringPanel(
        { profile: "strict", overrides: { require_camera: false } },
        { ground },
      );
      user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
      await screen.findByRole("alertdialog");
      expect(await axe(container)).toHaveNoViolations();
    });

    // T5-R2: the one tight spot the plan predicted — a disabled control
    // still needs a legible, associated label. `axe`'s label-association
    // checks (`label`, `aria-input-field-name`) run fine under jsdom even
    // though colour contrast cannot; isolating this one row rather than
    // relying on the whole-panel passes above to localise a failure to it.
    it(`[${ground}] the disabled face_check control keeps a legible, associated label`, async () => {
      const container = await openProctoringPanel({ profile: "strict" }, { ground });
      const control = screen.getByLabelText(/Count faces in each image/i);
      expect(control).toBeDisabled();
      expect(control).toHaveAccessibleName(/Count faces in each image/i);
      expect(control).toHaveAccessibleDescription(/Phase 8/i);
      expect(await axe(container)).toHaveNoViolations();
    });
  }
});
