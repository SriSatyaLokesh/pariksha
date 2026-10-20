// T-19's builder affordance (#58, P5.5): the three states an organiser can
// see, and what each of them is allowed to imply.
//
// The whole point of this file is the wording. `unverified` is "the server
// could not confirm it", `timeout` is "we did not get an answer in time",
// and neither is "your link is wrong" — a builder that says "invalid" over
// a slow CDN teaches organisers to ignore the flag, which is worse than not
// having one.

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { RegistrationFormSpec } from "@pariksha/core";

import { FormBuilder } from "../../src/components/testbuilder/FormBuilder";
import type { ReachResult } from "../../src/lib/api";

const CHECKED_AT = 1_760_000_000_000;

const RESUME: RegistrationFormSpec = {
  fields: [
    {
      id: "resume_url",
      type: "url",
      label: "Link to your resume",
      required: true,
      validation: { check_reachable: true },
    },
  ],
};

function renderBuilder(checkUrl: (url: string) => Promise<ReachResult>) {
  const changes: RegistrationFormSpec[] = [];
  function Harness() {
    const [form, setForm] = useState<RegistrationFormSpec | undefined>(RESUME);
    return (
      <FormBuilder
        form={form}
        onChange={(next) => {
          changes.push(next);
          setForm(next);
        }}
        checkUrl={checkUrl}
      />
    );
  }
  const result = render(<Harness />);
  return { ...result, changes };
}

function answering(result: ReachResult): (url: string) => Promise<ReachResult> {
  return vi.fn(async () => result);
}

/** The affordance's own live region. `ReorderableList` has an unnamed
 * `role="status"` on this screen too, which is exactly why this one is
 * named. */
function status(): HTMLElement {
  return screen.getByRole("status", { name: /link check/i });
}

function tryLink(url = "https://example.com/cv.pdf"): void {
  fireEvent.change(screen.getByLabelText(/try a link/i), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
}

describe("the url field's reachability affordance (T-19)", () => {
  it("the flag says the check is not built yet, and cannot be ticked", () => {
    // T-19 is deferred: fetching an organiser-chosen URL on the
    // registration path is an SSRF surface inside a 10 ms CPU budget, and
    // Phase 6 has nowhere to show the flag it would raise. The switch is
    // disabled with copy naming the phase rather than removed, because a
    // switch that silently does nothing is worse than an absent one — an
    // organiser would tick it and believe links were being checked.
    renderBuilder(answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT }));
    const flag = screen.getByRole("checkbox", { name: /check the link is reachable/i });
    expect(flag).toBeChecked();
    expect(flag).toBeDisabled();
    expect(screen.getByText(/not built yet/i)).toBeVisible();
    expect(screen.getByText(/never refused, and nothing blocked/i)).toBeVisible();
  });

  it("the three states are text plus glyph, and unverified never reads as invalid", async () => {
    renderBuilder(answering({ state: "unverified", status: 403, checkedAt: CHECKED_AT }));

    expect(status()).toHaveTextContent(/^Not checked$/);
    tryLink();

    await waitFor(() => expect(status()).toHaveTextContent(/unverified — the link did not return 200 \(403\)/i));
    expect(within(status()).getByText("⚠")).toBeInTheDocument();
    expect(status()).not.toHaveTextContent(/invalid/i);
    expect(status()).not.toHaveTextContent(/unreachable/i);
  });

  it("a reachable link says so, with its own glyph", async () => {
    renderBuilder(answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT }));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/reachable — the link returned 200/i));
    expect(within(status()).getByText("✓")).toBeInTheDocument();
  });

  it("a refused link says why, and says it is not a verdict on the link", async () => {
    renderBuilder(
      answering({
        state: "refused",
        status: null,
        reason: "a link to a network address cannot be checked",
        checkedAt: CHECKED_AT,
      }),
    );
    tryLink("http://169.254.169.254/");
    await waitFor(() =>
      expect(status()).toHaveTextContent(/not checked — a link to a network address cannot be checked/i),
    );
  });

  it("the check shows it is running", async () => {
    let settle: (result: ReachResult) => void = () => undefined;
    const pending = new Promise<ReachResult>((resolve) => {
      settle = resolve;
    });
    renderBuilder(() => pending);

    tryLink();
    expect(status()).toHaveTextContent(/checking/i);
    // And it cannot be fired twice while it is in flight.
    expect(screen.getByRole("button", { name: /^check$/i })).toBeDisabled();

    settle({ state: "reachable", status: 200, checkedAt: CHECKED_AT });
    await waitFor(() => expect(status()).toHaveTextContent(/reachable/i));
  });

  it("a timeout reports a timeout with a retry, not unreachable", async () => {
    renderBuilder(answering({ state: "timeout", status: null, checkedAt: CHECKED_AT }));
    tryLink();

    await waitFor(() => expect(status()).toHaveTextContent(/timed out/i));
    expect(status()).not.toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("button", { name: /check again/i })).toBeEnabled();
  });

  it("the result says when it was checked", async () => {
    renderBuilder(answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT }));
    tryLink();
    // Fixed and locale-independent: the organiser needs to know whether a
    // result is a minute old or a week old, not what their browser calls
    // Tuesday.
    await waitFor(() => expect(status()).toHaveTextContent("Checked at 2025-10-09 08:53 UTC."));
  });

  it("a request that fails outright is reported as a failed check, not as a failed link", async () => {
    renderBuilder(() => Promise.reject(new Error("network down")));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/the check could not be run/i));
    // Not reported as a statement about the link: the request failed, which
    // is a different fact.
    expect(status()).not.toHaveTextContent(/unverified/i);
  });

  it("an unverified result blocks nothing — the field is still editable and still saves", async () => {
    const { changes } = renderBuilder(answering({ state: "unverified", status: 404, checkedAt: CHECKED_AT }));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/unverified/i));

    const before = changes.length;
    fireEvent.change(screen.getByLabelText(/visible label/i), { target: { value: "Resume link" } });

    // The draft save path is `onChange` (the shell debounces it into one
    // `PATCH .../draft`): it still fires, with the edit in it.
    expect(changes.length).toBe(before + 1);
    expect(changes.at(-1)?.fields[0]?.label).toBe("Resume link");
    expect(screen.getByLabelText(/visible label/i)).toBeEnabled();
    // And nothing from the check was written onto the field.
    expect(JSON.stringify(changes.at(-1))).not.toContain("unverified");
  });

  it("the check is only offered once the flag is on", () => {
    const off: RegistrationFormSpec = { fields: [{ id: "resume_url", type: "url", label: "Resume" }] };
    render(<FormBuilder form={off} onChange={() => undefined} checkUrl={answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT })} />);
    expect(screen.queryByLabelText(/try a link/i)).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /check the link is reachable/i }));
    // Uncontrolled here on purpose: `onChange` is a no-op, so the flag does
    // not flip — which is what proves the affordance is driven by the
    // stored `check_reachable`, not by local checkbox state.
    expect(screen.queryByLabelText(/try a link/i)).toBeNull();
  });

  it("the url field row has no axe violations", async () => {
    const { container } = renderBuilder(answering({ state: "unverified", status: 404, checkedAt: CHECKED_AT }));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/unverified/i));
    expect(await axe(container)).toHaveNoViolations();
    expect(
      await axe(within(container).getByRole("group", { name: /Link to your resume/i })),
    ).toHaveNoViolations();
  });
});
