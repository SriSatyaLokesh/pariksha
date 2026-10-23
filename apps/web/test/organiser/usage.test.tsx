// Phase 8e Task 3 (`K31`, `K36`, `KG8`, #102): `UsagePanel`'s own
// behaviour. `KG8` here is the web half of "nothing reaches a `node`
// deployment" — `undefined` is the shape the API route answers with on
// `node` (`apps/api/test/usage/project.test.ts` proves that half), and this
// file proves the component renders nothing for it, with its positive
// control in the same file.
//
// Branch review fix wave, `C2` (CRITICAL): the panel no longer receives a
// `usage` prop — it owns its own fetch, behind its own button, so every
// test here drives that gesture rather than passing a value straight in.
// `m2` (MINOR): the rendered percentage is asserted exactly (`52%`), not
// merely "a number rendered" — the fixture (52,000 of 100,000) makes the
// answer unambiguous.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import { UsagePanel } from "../../src/components/organiser/UsagePanel";
import type { ApiClient, UsageProjection } from "../../src/lib/api";

const projection: UsageProjection = {
  projected: 52_000,
  limit: 100_000,
  warn: false,
  estimated: true,
};

/** `UsagePanel` reads only `client.usage`, so this is the whole surface a
 *  fixture needs — the same minimal-fake shape `CandidateDataPanel.test.tsx`'s
 *  neighbours use for a component with one real dependency. */
function fakeClient(usage: (workspaceId: string) => Promise<UsageProjection | undefined>): ApiClient {
  return { usage } as unknown as ApiClient;
}

const checkButton = () => screen.getByRole("button", { name: /check free-plan usage/i });

it("renders no usage element when the payload carries none", async () => {
  render(<UsagePanel client={fakeClient(async () => undefined)} workspaceId="wsp_1" />);
  fireEvent.click(checkButton());

  // The button's own label changes and back — the round trip actually
  // happened — and still nothing reads as a projection.
  await screen.findByRole("button", { name: /check free-plan usage/i });
  expect(screen.queryByText(/of your daily limit/)).toBeNull();
});

it("renders one when it does — control", async () => {
  render(<UsagePanel client={fakeClient(async () => projection)} workspaceId="wsp_1" />);
  fireEvent.click(checkButton());

  expect(await screen.findByText(/of your daily limit/)).toBeInTheDocument();
});

describe("the word 'estimated' is on the surface (K31)", () => {
  it("says so in the sentence itself, not only a tooltip", async () => {
    render(<UsagePanel client={fakeClient(async () => projection)} workspaceId="wsp_1" />);
    fireEvent.click(checkButton());

    expect(await screen.findByText(/estimated/)).toBeInTheDocument();
  });
});

describe("the meter's one number (m2)", () => {
  it("renders the exact percentage the fixture implies — 52,000 of 100,000", async () => {
    render(<UsagePanel client={fakeClient(async () => projection)} workspaceId="wsp_1" />);
    fireEvent.click(checkButton());

    expect(await screen.findByText("52%")).toBeInTheDocument();
  });
});

describe("the warn state (WARN_AT)", () => {
  it("says the ceiling is near when the server says warn, in words as well as colour", async () => {
    render(
      <UsagePanel client={fakeClient(async () => ({ ...projection, warn: true }))} workspaceId="wsp_1" />,
    );
    fireEvent.click(checkButton());

    expect(await screen.findByText(/approaching the free-plan ceiling/)).toBeInTheDocument();
  });

  it("says nothing of the sort when the server does not", async () => {
    render(<UsagePanel client={fakeClient(async () => projection)} workspaceId="wsp_1" />);
    fireEvent.click(checkButton());

    await screen.findByText(/of your daily limit/);
    expect(screen.queryByText(/approaching the free-plan ceiling/)).toBeNull();
  });
});

describe("the gesture itself", () => {
  it("calls usage() only on click, never on mount", () => {
    let calls = 0;
    render(
      <UsagePanel
        client={fakeClient(async () => {
          calls += 1;
          return projection;
        })}
        workspaceId="wsp_1"
      />,
    );
    expect(calls).toBe(0);
  });

  it("disables the button while the check is in flight", async () => {
    let resolve!: (value: UsageProjection | undefined) => void;
    render(
      <UsagePanel
        client={fakeClient(() => new Promise((r) => (resolve = r)))}
        workspaceId="wsp_1"
      />,
    );
    fireEvent.click(checkButton());

    expect(await screen.findByRole("button", { name: /checking/i })).toBeDisabled();
    resolve(projection);
    await screen.findByText(/of your daily limit/);
  });

  it("reports a transport failure rather than hanging silently", async () => {
    render(
      <UsagePanel
        client={fakeClient(() => Promise.reject(new Error("offline")))}
        workspaceId="wsp_1"
      />,
    );
    fireEvent.click(checkButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not check usage/i);
  });
});

describe("accessible", () => {
  it("has no axe violations before a check", async () => {
    const { container } = render(
      <UsagePanel client={fakeClient(async () => projection)} workspaceId="wsp_1" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations after a check, warn state included", async () => {
    const { container } = render(
      <UsagePanel client={fakeClient(async () => ({ ...projection, warn: true }))} workspaceId="wsp_1" />,
    );
    fireEvent.click(checkButton());
    await screen.findByText(/approaching the free-plan ceiling/);

    expect(await axe(container)).toHaveNoViolations();
  });
});
