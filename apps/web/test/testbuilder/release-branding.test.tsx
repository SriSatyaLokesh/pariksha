// Result release and branding (#61, P5.8) — T-22 and T-23.
//
// No @testing-library/user-event in this workspace — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note.

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { RELEASE_CONSEQUENCE, SHOW_CONSEQUENCE, type TestBranding, type TestRelease } from "@pariksha/core";

import { ReleasePanel } from "../../src/components/testbuilder/ReleasePanel";
import { BrandingPanel } from "../../src/components/testbuilder/BrandingPanel";

// --- T-22: release -----------------------------------------------------

function ReleaseHarness({
  initial = { when: "on_submit" } as TestRelease,
  onChange,
}: {
  initial?: TestRelease;
  onChange?: (next: TestRelease) => void;
}) {
  const [release, setRelease] = useState(initial);
  return (
    <ReleasePanel
      release={release}
      onChange={(next) => {
        onChange?.(next);
        setRelease(next);
      }}
    />
  );
}

describe("ReleasePanel", () => {
  it("each release option states what the candidate will see, where it is chosen", () => {
    render(<ReleaseHarness />);
    for (const copy of [...Object.values(RELEASE_CONSEQUENCE), ...Object.values(SHOW_CONSEQUENCE)]) {
      expect(screen.getByText(copy)).toBeVisible();
    }
  });

  it("never release states what the candidate gets instead", () => {
    render(<ReleaseHarness initial={{ when: "never" }} />);
    expect(
      screen.getByText(/candidates see a receipt with their attempt reference and no score/i),
    ).toBeVisible();
  });

  it("full_review carries its warning where the choice is made, not in a help page", () => {
    render(<ReleaseHarness />);
    expect(screen.getByText(SHOW_CONSEQUENCE.full_review)).toHaveTextContent(
      /only once the test has closed for everyone/i,
    );
  });

  it("on_date requires a date before it can be chosen", () => {
    const onChange = vi.fn();
    render(<ReleaseHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /on a date/i }));

    // Nothing written: `release.at` unset under `on_date` is a legal save
    // (the schema's conditional `required` is publish-time), so if it were
    // written the organiser would never learn the choice means nothing.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/choose a release date/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/release\.at/);
  });

  it("choosing the date is what writes on_date, in one go", () => {
    const onChange = vi.fn();
    render(<ReleaseHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /on a date/i }));
    fireEvent.change(screen.getByLabelText(/release date/i), { target: { value: "2026-11-16" } });

    expect(onChange).toHaveBeenCalledWith({ when: "on_date", at: "2026-11-16T00:00:00Z" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("moving off on_date drops the date — a stale one is the access_code bug in another block", () => {
    const onChange = vi.fn();
    render(<ReleaseHarness initial={{ when: "on_date", at: "2026-11-16T00:00:00Z" }} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /on submit/i }));

    const next = onChange.mock.calls[0]?.[0] as TestRelease;
    expect(next).toEqual({ when: "on_submit" });
    expect(Object.keys(next)).not.toContain("at");
  });

  it("what they see is not offered under never, because there is nothing to see", () => {
    render(<ReleaseHarness initial={{ when: "never" }} />);
    expect(screen.getByLabelText(/what they see/i)).toBeDisabled();
  });

  it("the release panel has no axe violations", async () => {
    const { container } = render(<ReleaseHarness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// --- T-23: branding ----------------------------------------------------

const UPLOADED = { key: "abc123.png" };

function BrandingHarness({
  branding = {},
  workspaceBranding = {},
  canEditWorkspace = true,
  onChange,
  onSaveWorkspace = async () => undefined,
  onUploadLogo = async () => UPLOADED,
}: {
  branding?: TestBranding;
  workspaceBranding?: TestBranding;
  canEditWorkspace?: boolean;
  onChange?: (next: TestBranding) => void;
  onSaveWorkspace?: (next: TestBranding) => Promise<void>;
  onUploadLogo?: (file: File, alt: string) => Promise<{ key: string }>;
}) {
  const [testBranding, setTestBranding] = useState(branding);
  return (
    <BrandingPanel
      branding={testBranding}
      workspaceBranding={workspaceBranding}
      canEditWorkspace={canEditWorkspace}
      onChange={(next) => {
        onChange?.(next);
        setTestBranding(next);
      }}
      onSaveWorkspace={onSaveWorkspace}
      onUploadLogo={onUploadLogo}
    />
  );
}

const colourInput = (): HTMLElement => screen.getByLabelText(/primary colour/i);
const saveButton = (): HTMLElement => screen.getByRole("button", { name: /save workspace branding/i });
const previews = (): HTMLElement | null =>
  screen.getByRole("region", { name: /start page preview/i }).parentElement;

const pngFile = (): File => new File([new Uint8Array([137, 80, 78, 71])], "crest.png", { type: "image/png" });

describe("BrandingPanel", () => {
  it("the colour picker reports its contrast and refuses below 4.5:1 with the measured ratio", async () => {
    render(<BrandingHarness />);

    fireEvent.change(colourInput(), { target: { value: "#f59a6e" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/2\.09:1 against cream/i);
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 4\.5:1/i);
    expect(saveButton()).toBeDisabled();
  });

  it("a passing colour reports its ratio too, and can be saved", () => {
    render(<BrandingHarness />);
    fireEvent.change(colourInput(), { target: { value: "#b63a10" } });

    expect(screen.getByText("5.66:1")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveButton()).toBeEnabled();
  });

  it("something that is not a colour is refused before any ratio is claimed for it", () => {
    render(<BrandingHarness />);
    fireEvent.change(colourInput(), { target: { value: "crimson" } });

    expect(screen.getByRole("alert")).toHaveTextContent(/is not a colour/i);
    expect(screen.queryByText(/:1 against cream/)).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it("the brand colour reaches CSS as a custom property, never a style attribute", () => {
    render(<BrandingHarness workspaceBranding={{ primary_colour: "#b63a10" }} />);
    expect(previews()?.style.getPropertyValue("--brand-primary")).toBe("#b63a10");
  });

  it("a refused colour is never painted — the previews keep their fallback", () => {
    render(<BrandingHarness workspaceBranding={{ primary_colour: "#b63a10" }} />);
    fireEvent.change(colourInput(), { target: { value: "#f59a6e" } });

    expect(previews()?.style.getPropertyValue("--brand-primary")).toBe("");
  });

  it("start, finish and the released result view are previewed with the branding applied", () => {
    render(
      <BrandingHarness
        branding={{ start_message: "Read the instructions.", finish_message: "Thank you." }}
        workspaceBranding={{ primary_colour: "#b63a10", footer_text: "Alpha College" }}
      />,
    );

    for (const name of [/start page preview/i, /finish page preview/i, /released result preview/i]) {
      const preview = screen.getByRole("region", { name });
      expect(preview).toBeVisible();
      expect(within(preview).getByText("Alpha College")).toBeVisible();
    }
    expect(within(screen.getByRole("region", { name: /start page/i })).getByText("Read the instructions.")).toBeVisible();
    expect(within(screen.getByRole("region", { name: /finish page/i })).getByText("Thank you.")).toBeVisible();
    // One wrapper carries the colour, so all three inherit it rather than
    // each setting it and one of them silently forgetting to.
    expect(previews()?.style.getPropertyValue("--brand-primary")).toBe("#b63a10");
  });

  it("a logo upload requires alt text and states the render size", async () => {
    const onUploadLogo = vi.fn(async () => UPLOADED);
    render(<BrandingHarness onUploadLogo={onUploadLogo} />);

    fireEvent.change(screen.getByLabelText(/logo file/i), { target: { files: [pngFile()] } });

    expect(screen.getByRole("button", { name: /^upload$/i })).toBeDisabled();
    expect(screen.getByText(/renders at 32 px tall/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText(/alt text/i), { target: { value: "Acme College crest" } });
    expect(screen.getByRole("button", { name: /^upload$/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));
    expect(onUploadLogo).toHaveBeenCalledWith(expect.any(File), "Acme College crest");
    await waitFor(() => expect(screen.getByText(/abc123\.png/)).toBeVisible());
  });

  it("alt text that is only spaces does not count as alt text", () => {
    render(<BrandingHarness />);
    fireEvent.change(screen.getByLabelText(/logo file/i), { target: { files: [pngFile()] } });
    fireEvent.change(screen.getByLabelText(/alt text/i), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: /^upload$/i })).toBeDisabled();
  });

  it("saving the workspace half hands over exactly what is on screen, and confirms", async () => {
    const onSaveWorkspace = vi.fn(async () => undefined);
    render(<BrandingHarness onSaveWorkspace={onSaveWorkspace} />);

    fireEvent.change(colourInput(), { target: { value: "#b63a10" } });
    fireEvent.change(screen.getByLabelText(/footer text/i), { target: { value: "Alpha College" } });
    fireEvent.click(saveButton());

    expect(onSaveWorkspace).toHaveBeenCalledWith({ primary_colour: "#b63a10", footer_text: "Alpha College" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/workspace branding saved/i));
  });

  it("a server refusal is shown rather than swallowed", async () => {
    render(
      <BrandingHarness
        onSaveWorkspace={async () => {
          throw new Error("Only an owner can change workspace branding.");
        }}
      />,
    );
    fireEvent.click(saveButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/only an owner can change workspace branding/i);
  });

  // The PRD's split: an Author sees what their candidates will see and
  // cannot change it for everybody. The server refuses either way; this is
  // so they are told before filling the form in rather than 403'd after.
  it("without workspace.settings the workspace half is read-only, and says so", () => {
    render(<BrandingHarness canEditWorkspace={false} workspaceBranding={{ footer_text: "Alpha College" }} />);

    expect(screen.getByText(/only an owner can change them/i)).toBeVisible();
    for (const control of [colourInput(), screen.getByLabelText(/footer text/i), screen.getByLabelText(/logo file/i)]) {
      expect(control).toBeDisabled();
    }
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("region", { name: /start page preview/i })).toBeVisible();
  });

  it("the per-test messages are writable whatever the workspace role is", () => {
    const onChange = vi.fn();
    render(<BrandingHarness canEditWorkspace={false} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/start message/i), { target: { value: "Good luck." } });
    expect(onChange).toHaveBeenCalledWith({ start_message: "Good luck." });
  });

  it("clearing a per-test message removes the key rather than storing an empty string", () => {
    const onChange = vi.fn();
    render(<BrandingHarness branding={{ start_message: "Good luck." }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/start message/i), { target: { value: "" } });
    const next = onChange.mock.calls[0]?.[0] as TestBranding;
    expect(Object.keys(next)).not.toContain("start_message");
  });

  it("the branding panel has no axe violations", async () => {
    const { container } = render(
      <BrandingHarness
        branding={{ start_message: "Read the instructions." }}
        workspaceBranding={{ primary_colour: "#b63a10", footer_text: "Alpha College" }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
