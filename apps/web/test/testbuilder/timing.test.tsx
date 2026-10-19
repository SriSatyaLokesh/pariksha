// Timing, navigation and attempt policy (#59, P5.6) — T-12 to T-15.
//
// Driven, never poked: every assertion follows a real change or click on a
// control an organiser can see. No @testing-library/user-event in this
// workspace (see apps/web/test/testbuilder/form-builder.test.tsx's own note
// on the same point); `fireEvent.change` is the `change` a native control
// actually fires.
//
// Reachability — that the running app mounts this panel at all — is proved
// in apps/web/test/organiser.test.tsx, which walks from `OrganiserApp`.

import { useState } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { NAVIGATION_CONSEQUENCE, type TestTiming } from "@pariksha/core";

import { TimingPanel } from "../../src/components/testbuilder/TimingPanel";
import type { StoredSection } from "../../src/lib/api";

const ZONE = "Asia/Kolkata";
const OPENS = "2026-11-14T09:00:00+05:30";
const CLOSES = "2026-11-14T13:00:00+05:30";

const BASE: TestTiming = { timezone: ZONE, opens_at: OPENS, closes_at: CLOSES, duration_minutes: 60 };

function section(id: string, minutes?: number): StoredSection {
  return {
    id,
    title: id,
    source: { kind: "fixed", questions: [] },
    ...(minutes === undefined ? {} : { time_limit_minutes: minutes }),
  };
}

const SECTIONS = [section("reasoning", 30), section("verbal", 15), section("untimed")];

/** The panel is controlled; a static `timing` prop would assert on a
 * component that can never change. This holds the state the real shell
 * (apps/web/src/routes/test.tsx) holds. */
function Harness({
  initial = BASE,
  sections = SECTIONS,
  published = false,
  onChange,
}: {
  initial?: TestTiming;
  sections?: StoredSection[];
  published?: boolean;
  onChange?: (next: TestTiming) => void;
}) {
  const [timing, setTiming] = useState(initial);
  return (
    <TimingPanel
      timing={timing}
      sections={sections}
      published={published}
      onChange={(next) => {
        onChange?.(next);
        setTiming(next);
      }}
    />
  );
}

const duration = (): HTMLElement => screen.getByLabelText(/overall duration/i);

function optionValues(label: RegExp): string[] {
  const select = screen.getByLabelText(label);
  return within(select).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
}

describe("TimingPanel", () => {
  it("no time is rendered bare — every one states its zone, with the organiser's own echoed", () => {
    render(<Harness />);
    expect(screen.getByText(`14 Nov 2026, 09:00 ${ZONE}`)).toBeVisible();

    // The second half of the same line is the organiser's clock, not the
    // test's. Computed here from the same instant so this holds on a
    // machine in any zone; the assertion below is what makes it mean
    // something — in a zone other than +05:30 the two differ, and the
    // panel showing the test's time twice would fail it.
    const mine = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(OPENS),
    );
    // One line, two spans, so the assertion is on the line rather than on
    // either half of it.
    const line = screen.getByText(`14 Nov 2026, 09:00 ${ZONE}`).closest("p");
    expect(line).toHaveTextContent(new RegExp(`${mine} your time`));
    // On a machine outside +05:30 the echo is a different clock, which is
    // what keeps the assertion above from being a tautology.
    if (new Date(OPENS).getTimezoneOffset() !== -330) expect(mine).not.toBe("09:00");
  });

  it("the per-section sum is shown against the overall duration", () => {
    render(<Harness />);
    expect(screen.getByText(/sections total 45 min of 60 min/i)).toBeVisible();
  });

  it("an untimed section contributes nothing to the sum", () => {
    render(<Harness sections={[section("a", 30), section("b")]} />);
    expect(screen.getByText(/sections total 30 min of 60 min/i)).toBeVisible();
  });

  it("a sum above the overall duration is caught on blur with cause and fix", async () => {
    render(<Harness />);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(duration(), { target: { value: "30" } });
    fireEvent.blur(duration());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /sections total 45 minutes against an overall 30 — raise the duration or shorten a section/i,
    );
  });

  it("a window that ends before it opens is caught on blur, on the close field", async () => {
    render(<Harness initial={{ ...BASE, closes_at: "2026-11-14T08:00:00+05:30" }} />);
    // Nothing yet: an organiser who has not touched the control has not
    // made a mistake, and a panel that opens red teaches people to ignore
    // it. The alert arrives only once they leave the field.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.blur(screen.getByLabelText(/closes at/i));

    expect(await screen.findByRole("alert")).toHaveTextContent(/is not after it opens/i);
  });

  it("latest start is echoed as the sentence it means", () => {
    render(<Harness initial={{ ...BASE, latest_start_at: "2026-11-14T12:00:00+05:30" }} />);
    expect(screen.getByText(new RegExp(`A candidate arriving after 14 Nov 2026, 12:00 ${ZONE} cannot begin`))).toBeVisible();
  });

  it("an unset latest start says it follows the close time, and names it", () => {
    render(<Harness />);
    expect(screen.getByText(/A candidate arriving after 14 Nov 2026, 13:00 Asia\/Kolkata cannot begin/)).toBeVisible();
    expect(screen.getByText(/it follows the close time/i)).toBeVisible();
  });

  it("each navigation mode carries its consequence as persistent helper text", () => {
    render(<Harness />);
    for (const copy of Object.values(NAVIGATION_CONSEQUENCE)) expect(screen.getByText(copy)).toBeVisible();
  });

  it("choosing a navigation mode writes it, and free is the documented default before any choice", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ duration_minutes: 60 }} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Linear" }));
    expect(onChange).toHaveBeenCalledWith({ duration_minutes: 60, navigation: "linear" });
  });

  it("T-14: attempts allowed, cooldown and which attempt counts are settable, with their documented defaults", () => {
    render(<Harness initial={{ duration_minutes: 60 }} />);
    expect(screen.getByLabelText(/attempts allowed/i)).toHaveValue(1);
    expect(screen.getByLabelText(/cooldown between attempts/i)).toHaveValue(0);
    expect(screen.getByLabelText(/which attempt counts/i)).toHaveValue("highest");
    expect(optionValues(/which attempt counts/i)).toEqual(["highest", "latest", "average"]);
  });

  it("T-15: the warning marks and the late-sync grace carry their defaults and state what they do", () => {
    render(<Harness initial={{ duration_minutes: 60 }} />);
    expect(screen.getByLabelText(/warn at/i)).toHaveValue("10, 2");
    expect(screen.getByLabelText(/late sync grace \(seconds\)/i)).toHaveValue(30);
    expect(screen.getByText(/answers arriving later than this after the deadline are rejected/i)).toBeVisible();
  });

  it("the warning marks parse into a list of minutes, and an unparseable one is reported rather than half-written", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ duration_minutes: 60 }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/warn at/i), { target: { value: "15, 5, 1" } });
    expect(onChange).toHaveBeenLastCalledWith({ duration_minutes: 60, warn_at_minutes: [15, 5, 1] });

    onChange.mockClear();
    fireEvent.change(screen.getByLabelText(/warn at/i), { target: { value: "15, soon" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/not a list of minutes/i);
  });

  it("a time zone that Intl does not know is reported, and times fall back to UTC rather than vanishing", () => {
    render(<Harness initial={{ ...BASE, timezone: "Mars/Olympus" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/is not a time zone — use an IANA name/i);
    // 09:00+05:30 is 03:30 UTC. The fallback is stated, not silent.
    expect(screen.getByText(/03:30 UTC/)).toBeVisible();
  });

  it("a wall clock typed into the window is stored as an instant in the test's own zone", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ timezone: ZONE, duration_minutes: 60 }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/opens at/i), { target: { value: "2026-11-14T09:00" } });
    expect(onChange).toHaveBeenCalledWith({
      timezone: ZONE,
      duration_minutes: 60,
      opens_at: "2026-11-14T09:00:00+05:30",
    });
  });

  it("clearing a window field removes the key rather than storing an empty string", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/opens at/i), { target: { value: "" } });

    const next = onChange.mock.calls[0]?.[0] as TestTiming;
    expect(next).toEqual({ timezone: ZONE, closes_at: CLOSES, duration_minutes: 60 });
    // `toEqual` treats `{ opens_at: undefined }` as equal to `{}`, and the
    // key being *present* and undefined is exactly the thing
    // `exactOptionalPropertyTypes` exists to stop reaching the wire.
    expect(Object.keys(next)).not.toContain("opens_at");
  });

  it("times and durations are marked as the figures that have to line up", () => {
    render(<Harness />);
    expect(screen.getByText(/sections total 45 min of 60 min/i)).toHaveClass("timing-panel__figure");
    expect(screen.getByText(`14 Nov 2026, 09:00 ${ZONE}`)).toHaveClass("timing-panel__figure");
  });

  // `css: false` in apps/web/vite.config.ts means jsdom loads no stylesheet,
  // so `getComputedStyle(...).fontVariantNumeric` is empty for every element
  // on the page and could never fail. The class is asserted above; that the
  // class means tabular figures is asserted here, against the real file.
  it("the figure class declares tabular figures", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(resolve(here, "../../src/styles/testbuilder.css"), "utf8");
    expect(css).toMatch(/\.timing-panel__figure\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  describe("UX-18: a published test", () => {
    it("says what happens to attempts in progress before the change is applied", () => {
      const onChange = vi.fn();
      render(<Harness published onChange={onChange} />);

      fireEvent.change(duration(), { target: { value: "90" } });

      expect(screen.getByRole("dialog")).toHaveTextContent(/attempts in progress stay on version 1/i);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("applies it once the organiser has read that, and not before", () => {
      const onChange = vi.fn();
      render(<Harness published onChange={onChange} />);

      fireEvent.change(duration(), { target: { value: "90" } });
      fireEvent.click(screen.getByRole("button", { name: /apply the change/i }));

      expect(onChange).toHaveBeenCalledWith({ ...BASE, duration_minutes: 90 });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("cancelling writes nothing and puts the control back", () => {
      const onChange = vi.fn();
      render(<Harness published onChange={onChange} />);

      fireEvent.change(duration(), { target: { value: "90" } });
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onChange).not.toHaveBeenCalled();
      expect(duration()).toHaveValue(60);
    });

    it("Escape closes the dialog, focus starts in it and returns to the control that opened it", () => {
      render(<Harness published />);
      const control = duration();
      control.focus();
      fireEvent.change(control, { target: { value: "90" } });

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveFocus();

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(control).toHaveFocus();
    });

    it("an unpublished test writes straight through, with no dialog", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.change(duration(), { target: { value: "90" } });

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onChange).toHaveBeenCalledWith({ ...BASE, duration_minutes: 90 });
    });
  });

  it("the timing panel has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the dialog has no axe violations either", async () => {
    const { container } = render(<Harness published />);
    fireEvent.change(duration(), { target: { value: "90" } });
    expect(await axe(container)).toHaveNoViolations();
  });
});
