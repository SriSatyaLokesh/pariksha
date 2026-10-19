// Access modes and allowlists (#60, P5.7) — T-20, T-21.
//
// Security-relevant, so the assertions here are about what is *refused*
// and what is *dropped*, not only about what renders. The parsers are
// `@pariksha/core`'s (their own exhaustive table is in
// packages/core/test/validate.test.ts); what this file proves is that the
// panel runs them, says what a correct entry looks like, and never writes
// a value the save path would refuse.
//
// No @testing-library/user-event in this workspace — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note.

import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { TestAccess } from "@pariksha/core";

import { ACCESS_CONSEQUENCE, AccessPanel } from "../../src/components/testbuilder/AccessPanel";

function Harness({ initial, onChange }: { initial?: TestAccess; onChange?: (next: TestAccess) => void }) {
  const [access, setAccess] = useState<TestAccess>(initial ?? { mode: "link_code", access_code: "APTI-2026" });
  return (
    <AccessPanel
      access={access}
      onChange={(next) => {
        onChange?.(next);
        setAccess(next);
      }}
    />
  );
}

const ranges = (): HTMLElement => screen.getByLabelText(/ip ranges/i);
const domains = (): HTMLElement => screen.getByLabelText(/email domains/i);

describe("AccessPanel", () => {
  it("only the chosen mode's own fields appear", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/access code/i)).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: /single sign-on/i }));
    expect(screen.queryByLabelText(/access code/i)).toBeNull();
  });

  // Review Focus 3, on the browser side. `access_code` is a legal property
  // of `access` under every mode, so a merge would keep it — and the
  // server merges `settings` one level deep, which means whatever this
  // panel emits is what gets stored.
  it("switching mode emits an object with the old mode's fields gone, not merged over", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ mode: "link_code", access_code: "APTI-2026", captcha: false }} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /single sign-on/i }));

    const next = onChange.mock.calls[0]?.[0] as TestAccess;
    expect(next).toEqual({ mode: "sso", captcha: false });
    expect(Object.keys(next)).not.toContain("access_code");
  });

  it("the allowlists survive a mode switch, because they mean the same under all four", () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={{ mode: "invite_only", candidate_list: "list.csv", allow_email_domains: ["*.ac.in"] }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /email code/i }));

    const next = onChange.mock.calls[0]?.[0] as TestAccess;
    expect(next).toEqual({ mode: "email_code", allow_email_domains: ["*.ac.in"] });
    expect(Object.keys(next)).not.toContain("candidate_list");
  });

  it("each mode states what the candidate does and what the organiser sends", () => {
    render(<Harness />);
    for (const c of Object.values(ACCESS_CONSEQUENCE)) {
      // "The link only." is the organiser's half of two modes, so these
      // are counted rather than matched once.
      expect(screen.getAllByText(c.candidate).length).toBeGreaterThan(0);
      expect(screen.getAllByText(c.organiser).length).toBeGreaterThan(0);
    }
  });

  it("a malformed CIDR is caught on blur with an example of a correct one", async () => {
    render(<Harness />);
    fireEvent.change(ranges(), { target: { value: "10.0.0.0/64" } });
    fireEvent.blur(ranges());

    expect(await screen.findByRole("alert")).toHaveTextContent(/for example 10\.0\.0\.0\/24/i);
  });

  it("a malformed email domain is caught on blur, and a bare wildcard is one", async () => {
    render(<Harness />);
    fireEvent.change(domains(), { target: { value: "*" } });
    fireEvent.blur(domains());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /matches every domain, which is not an allowlist/i,
    );
  });

  it("every bad line is reported, not only the first", async () => {
    render(<Harness />);
    fireEvent.change(ranges(), { target: { value: "10.0.0.0/64\n10.0.0.0/24\n010.0.0.1/8" } });
    fireEvent.blur(ranges());

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  });

  it("a list with a typo in it is never written through — it stays in the box to be fixed", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // The slash typed before its number — `10.0.0.0/2` would not do, it
    // is a legal (if enormous) range and is written through as one.
    fireEvent.change(ranges(), { target: { value: "10.0.0.0/" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(ranges()).toHaveValue("10.0.0.0/");

    fireEvent.change(ranges(), { target: { value: "10.0.0.0/24" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ allow_ip_ranges: ["10.0.0.0/24"] }));
  });

  it("clearing an allowlist removes the key rather than storing an empty list", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ mode: "sso", allow_ip_ranges: ["10.0.0.0/24"] }} onChange={onChange} />);

    fireEvent.change(ranges(), { target: { value: "" } });
    const next = onChange.mock.calls[0]?.[0] as TestAccess;
    expect(Object.keys(next)).not.toContain("allow_ip_ranges");
  });

  it("the combined allowlist effect is summarised in plain words", () => {
    render(<Harness initial={{ mode: "sso", allow_email_domains: ["*.ac.in"], allow_ip_ranges: ["10.0.0.0/24"] }} />);
    expect(screen.getByText("Only addresses matching *.ac.in, and only from 10.0.0.0/24.")).toBeVisible();
  });

  it("with no allowlist the summary says who that lets in, never a blank", () => {
    render(<Harness initial={{ mode: "link_code", access_code: "APTI-2026" }} />);
    expect(screen.getByText("Anyone with the link and the code.")).toBeVisible();
  });

  describe("the access code", () => {
    beforeEach(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn(async () => undefined) },
        configurable: true,
      });
    });

    it("is visible as text, and has a copy control that confirms", async () => {
      render(<Harness />);
      const code = screen.getByLabelText(/access code/i);
      expect(code).toHaveAttribute("type", "text");
      expect(code).toHaveValue("APTI-2026");

      fireEvent.click(screen.getByRole("button", { name: /copy the access code/i }));

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("APTI-2026");
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/access code copied/i));
    });

    it("rotating states that the old one stops working, before it rotates", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);

      fireEvent.click(screen.getByRole("button", { name: /rotate the access code/i }));

      expect(screen.getByRole("dialog")).toHaveTextContent(/the existing code stops working/i);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("rotating on confirmation writes a different code", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);

      fireEvent.click(screen.getByRole("button", { name: /rotate the access code/i }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /rotate it/i }));

      const next = onChange.mock.calls[0]?.[0] as TestAccess;
      expect(next.access_code).not.toBe("APTI-2026");
      // Long enough to clear the publish-time floor validateTest carries,
      // so rotating can never produce a code that blocks publishing.
      expect((next.access_code ?? "").length).toBeGreaterThanOrEqual(4);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("the rotate dialog takes Escape, starts focused and gives focus back", () => {
      render(<Harness />);
      const trigger = screen.getByRole("button", { name: /rotate the access code/i });
      trigger.focus();
      fireEvent.click(trigger);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveFocus();

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(trigger).toHaveFocus();
    });

    // #60's own acceptance row, task 7/8/10 review M5. A nag on blur, not
    // a refusal: the write still goes through (the standing ruling), and
    // validateTest carries the block at publish.
    it("a code under four characters is nagged on blur, with an example of a correct one", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);

      fireEvent.change(screen.getByLabelText(/access code/i), { target: { value: "AP" } });
      expect(screen.queryByText(/at least four characters/i)).toBeNull();

      fireEvent.blur(screen.getByLabelText(/access code/i));
      const alert = screen.getByText(/at least four characters/i);
      expect(alert).toBeVisible();
      // The example is a code of the shape Rotate produces, not prose.
      expect(alert).toHaveTextContent(/MATH-2847/);
      // Nagged, not refused.
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ access_code: "AP" }));
    });

    it("the nag goes once the code is long enough, and never appears under another mode", () => {
      render(<Harness />);
      fireEvent.change(screen.getByLabelText(/access code/i), { target: { value: "AP" } });
      fireEvent.blur(screen.getByLabelText(/access code/i));
      expect(screen.getByText(/at least four characters/i)).toBeVisible();

      fireEvent.change(screen.getByLabelText(/access code/i), { target: { value: "APTI" } });
      expect(screen.queryByText(/at least four characters/i)).toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: /single sign-on/i }));
      expect(screen.queryByText(/at least four characters/i)).toBeNull();
    });

    it("clearing the code removes the key rather than storing an empty string", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);

      fireEvent.change(screen.getByLabelText(/access code/i), { target: { value: "" } });
      const next = onChange.mock.calls[0]?.[0] as TestAccess;
      expect(Object.keys(next)).not.toContain("access_code");
    });
  });

  it("the access panel has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the rotate dialog has no axe violations either", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /rotate the access code/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
