import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import type { Actor, ApiClient, Workspace } from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import { OrganiserApp } from "../../src/routes/organiser";
import { OrganiserShell } from "../../src/components/OrganiserShell";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    ...overrides,
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin");
});

afterEach(() => {
  window.history.replaceState(null, "", "/admin");
});

describe("Results navigation shell wiring", () => {
  it("renders a navigation item for Results in OrganiserShell", () => {
    const onNavigate = vi.fn();
    render(
      <OrganiserShell
        current="home"
        workspace={WORKSPACE}
        workspaces={[WORKSPACE]}
        actor={ACTOR}
        onNavigate={onNavigate}
        onSwitchWorkspace={vi.fn()}
        onSignOut={vi.fn()}
      >
        <div>Content</div>
      </OrganiserShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Organiser" });
    const resultsButton = within(nav).getByRole("button", { name: "Results" });
    expect(resultsButton).toBeVisible();

    fireEvent.click(resultsButton);
    expect(onNavigate).toHaveBeenCalledWith("results");
  });

  it("marks Results with aria-current='page' when current is results", () => {
    render(
      <OrganiserShell
        current="results"
        workspace={WORKSPACE}
        workspaces={[WORKSPACE]}
        actor={ACTOR}
        onNavigate={vi.fn()}
        onSwitchWorkspace={vi.fn()}
        onSignOut={vi.fn()}
      >
        <div>Content</div>
      </OrganiserShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Organiser" });
    const resultsButton = within(nav).getByRole("button", { name: "Results" });
    expect(resultsButton).toHaveAttribute("aria-current", "page");
  });

  it("navigates to the results view when clicking Results in OrganiserApp", async () => {
    render(<OrganiserApp client={fakeClient()} />);

    const nav = await screen.findByRole("navigation", { name: "Organiser" });
    const resultsButton = within(nav).getByRole("button", { name: "Results" });
    expect(resultsButton).toBeVisible();

    fireEvent.click(resultsButton);

    expect(await screen.findByTestId("results-view")).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("results");
  });
});
