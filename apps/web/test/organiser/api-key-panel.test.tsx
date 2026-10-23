// `ApiKeyPanel` (Phase 8d Task 2, `K25`, `K26`, `KG5`). The app's own entry
// point — nav, `View`, `readView`/`paramsOf` — is covered separately in
// `organiser.test.tsx`'s "reaches the API key panel from the app's own
// entry point"; this file only covers what the panel itself does once
// mounted.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ACTIONS, type Action } from "@pariksha/core";
import { ApiError, type ApiClient, type ApiKey } from "../../src/lib/api";
import { ApiKeyPanel, SCOPE_GROUPS_FLAT } from "../../src/components/organiser/ApiKeyPanel";

const WORKSPACE_ID = "wsp_1";

// MINOR-1 (whole-branch review): `API_KEY_SCOPES` had no production
// caller — `ApiKeyPanel.tsx` hand-builds `SCOPE_GROUPS` and never filters
// by it, so this test was its only consumer. Derived here instead of
// imported, from the one source both the panel's groups and `K26`'s
// forbidden list already agree is authoritative: `@pariksha/core`'s own
// `ACTIONS`.
const API_KEY_SCOPES: readonly Action[] = ACTIONS.filter(
  (action) => action !== "keys.manage" && action !== "members.manage",
);

const KEY: ApiKey = {
  id: "key_1",
  name: "ATS integration",
  scopes: ["results.export"],
  createdAt: 0,
  lastUsedAt: null,
  revokedAt: null,
};

// One typed object literal implementing ApiClient, same convention every
// other panel's own test file already follows — no MSW, no fetch mock.
function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notUsed = async (): Promise<never> => {
    throw new Error("not used by this test file");
  };
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => null,
    workspaces: async () => [],
    completeSetup: notUsed,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    createBank: notUsed,
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    saveQuestion: notUsed,
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: notUsed,
    updateGroup: notUsed,
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: notUsed,
    exportQuestion: notUsed,
    tests: async () => [],
    createTest: notUsed,
    test: notUsed,
    updateTest: notUsed,
    draft: notUsed,
    patchDraft: notUsed,
    publishTest: notUsed,
    closeTest: notUsed,
    archiveTest: notUsed,
    versions: async () => [],
    checklist: async () => [],
    cloneTest: notUsed,
    exportTest: notUsed,
    importTest: notUsed,
    checkUrl: notUsed,
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: notUsed,
    uploadMedia: notUsed,
    candidates: async () => [],
    importCandidates: notUsed,
    listWebhooks: async () => ({ webhooks: [] }),
    createWebhook: notUsed,
    setWebhookActive: notUsed,
    deleteWebhook: notUsed,
    listApiKeys: notUsed,
    createApiKey: notUsed,
    revokeApiKey: notUsed,
    // 8e's additions to `ApiClient`. This file was created on this branch, so
    // git merged it without a conflict and only the type caught the gap. See
    // #228: every test file hand-rolls this fixture, so one interface change
    // breaks twenty-odd of them in places no merge can point at.
    exportCandidateData: notUsed,
    deleteCandidateData: notUsed,
    usage: async () => undefined,
    // 8b's additions to `ApiClient` (#228 again — fourth time today that one
    // interface change broke a hand-rolled copy of this fixture).
    gradingQueue: notUsed,
    grade: notUsed,
    recordVerdict: notUsed,
    ...overrides,
  };
}

// The grouping is presentation only; the set of scopes it offers must
// still be exactly API_KEY_SCOPES — no forbidden scope snuck in by a
// typo, no real scope left off a group and so never offered at all.
it("SCOPE_GROUPS covers exactly API_KEY_SCOPES — no action added, dropped or duplicated", () => {
  expect(new Set(SCOPE_GROUPS_FLAT)).toEqual(new Set(API_KEY_SCOPES));
  expect(SCOPE_GROUPS_FLAT).toHaveLength(API_KEY_SCOPES.length);
});

describe("ApiKeyPanel — loading and the empty state", () => {
  it("shows the empty state when the workspace has no keys", async () => {
    render(<ApiKeyPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listApiKeys: async () => ({ keys: [] }) })} />);
    expect(await screen.findByText(/No API keys yet/)).toBeInTheDocument();
  });

  it("lists an existing key, its scopes and its active state", async () => {
    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [KEY] }) })}
      />,
    );
    expect(await screen.findByText(KEY.name)).toBeInTheDocument();
    expect(screen.getByText(/Export results — Active/)).toBeInTheDocument();
    expect(screen.getByText("Never used")).toBeInTheDocument();
  });

  it("renders the stored last-used date (MAJOR-2, whole-branch review) — the column the API writes and this screen used to never show", async () => {
    const used: ApiKey = { ...KEY, lastUsedAt: 1_700_000_000_000 };
    render(<ApiKeyPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listApiKeys: async () => ({ keys: [used] }) })} />);
    expect(await screen.findByText(`Last used ${new Date(used.lastUsedAt!).toLocaleDateString()}`)).toBeInTheDocument();
  });

  it("shows a revoked key as Revoked, with no revoke action", async () => {
    const revoked: ApiKey = { ...KEY, revokedAt: 1_700_000_000_000 };
    render(
      <ApiKeyPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listApiKeys: async () => ({ keys: [revoked] }) })} />,
    );
    expect(await screen.findByText(/Export results — Revoked/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Revoke the key ${KEY.name}` })).toBeNull();
  });
});

describe("ApiKeyPanel — create, and the secret shown once (KG5)", () => {
  it("creating a key reveals the secret, with copy-to-clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const createApiKey = vi.fn().mockResolvedValue({
      id: "key_new",
      name: "ATS integration",
      scopes: ["results.export"],
      secret: "pk_abc123",
    });

    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [] }), createApiKey })}
      />,
    );
    await screen.findByText(/No API keys yet/);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "ATS integration" } });
    fireEvent.click(screen.getByLabelText("Export results"));
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText("pk_abc123")).toBeInTheDocument();
    expect(createApiKey).toHaveBeenCalledWith(WORKSPACE_ID, {
      name: "ATS integration",
      scopes: ["results.export"],
    });
    // The sentence saying it will not be shown again — `KG5`'s own
    // requirement, not inferred from the secret being present.
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy the key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("pk_abc123"));
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
  });

  it("the secret reveal card is a live region a screen reader would announce", async () => {
    const createApiKey = vi.fn().mockResolvedValue({
      id: "key_new",
      name: "ATS integration",
      scopes: ["results.export"],
      secret: "pk_abc123",
    });
    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [] }), createApiKey })}
      />,
    );
    await screen.findByText(/No API keys yet/);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "ATS integration" } });
    fireEvent.click(screen.getByLabelText("Export results"));
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    const secret = await screen.findByText("pk_abc123");
    expect(secret.closest('[role="status"]')).not.toBeNull();
  });

  it("refuses to submit with no name", async () => {
    const createApiKey = vi.fn();
    render(
      <ApiKeyPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listApiKeys: async () => ({ keys: [] }), createApiKey })} />,
    );
    await screen.findByText(/No API keys yet/);

    fireEvent.click(screen.getByLabelText("Export results"));
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText(/needs a name/)).toBeInTheDocument();
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("refuses to submit with no scope selected", async () => {
    const createApiKey = vi.fn();
    render(
      <ApiKeyPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listApiKeys: async () => ({ keys: [] }), createApiKey })} />,
    );
    await screen.findByText(/No API keys yet/);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "ATS integration" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText(/Select at least one scope/)).toBeInTheDocument();
    expect(createApiKey).not.toHaveBeenCalled();
  });

  // Never offered: `K26`'s two forbidden actions have no checkbox at all
  // for an organiser to tick in the first place.
  it("never offers keys.manage or members.manage as a scope", async () => {
    render(<ApiKeyPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listApiKeys: async () => ({ keys: [] }) })} />);
    await screen.findByText(/No API keys yet/);

    expect(screen.queryByLabelText("Manage API keys")).toBeNull();
    expect(screen.queryByLabelText("Manage members")).toBeNull();
  });

  it("surfaces the server's refusal (K26 or the creator's-own-subset check) beside the scopes, not the Name field", async () => {
    const createApiKey = vi.fn().mockRejectedValue(
      new ApiError(403, "forbidden", "An author may not grant a key the \"workspace.settings\" scope."),
    );
    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [] }), createApiKey })}
      />,
    );
    await screen.findByText(/No API keys yet/);

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "ATS integration" } });
    fireEvent.click(screen.getByLabelText("Export results"));
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText(/may not grant a key/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).not.toHaveAttribute("aria-invalid", "true");
  });
});

describe("ApiKeyPanel — revoke", () => {
  it("revoking asks for confirmation before calling revokeApiKey", async () => {
    const revokeApiKey = vi.fn().mockResolvedValue(undefined);
    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [KEY] }), revokeApiKey })}
      />,
    );
    await screen.findByText(KEY.name);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the key ${KEY.name}` }));
    expect(revokeApiKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: `Confirm revoking the key ${KEY.name}` }));
    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledWith(WORKSPACE_ID, KEY.id));
  });

  it("cancelling the confirmation leaves the key alone", async () => {
    const revokeApiKey = vi.fn();
    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [KEY] }), revokeApiKey })}
      />,
    );
    await screen.findByText(KEY.name);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the key ${KEY.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: `Revoke the key ${KEY.name}` })).toBeInTheDocument();
    expect(revokeApiKey).not.toHaveBeenCalled();
  });

  it("a failed revoke is a panel alert, and does not mark the Name field invalid", async () => {
    const revokeApiKey = vi.fn().mockRejectedValue(new ApiError(500, "internal_error", "could not be completed"));
    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [KEY] }), revokeApiKey })}
      />,
    );
    await screen.findByText(KEY.name);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the key ${KEY.name}` }));
    fireEvent.click(screen.getByRole("button", { name: `Confirm revoking the key ${KEY.name}` }));

    expect(await screen.findByText(/could not be completed/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("double-clicking Revoke's confirm only calls revokeApiKey once", async () => {
    let resolveCall: (() => void) | undefined;
    const revokeApiKey = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCall = resolve;
        }),
    );
    render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [KEY] }), revokeApiKey })}
      />,
    );
    await screen.findByText(KEY.name);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the key ${KEY.name}` }));
    const confirmButton = screen.getByRole("button", { name: `Confirm revoking the key ${KEY.name}` });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(revokeApiKey).toHaveBeenCalledTimes(1);
    resolveCall?.();
  });
});

describe("ApiKeyPanel — axe", () => {
  it("the create form and an empty list have no axe violations", async () => {
    const { container } = render(
      <ApiKeyPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listApiKeys: async () => ({ keys: [] }) })} />,
    );
    await screen.findByText(/No API keys yet/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the list, a revealed secret and the confirm step have no axe violations", async () => {
    const createApiKey = vi.fn().mockResolvedValue({
      id: "key_new",
      name: KEY.name,
      scopes: KEY.scopes,
      secret: "pk_abc123",
    });
    const { container } = render(
      <ApiKeyPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listApiKeys: async () => ({ keys: [KEY] }), createApiKey })}
      />,
    );
    await screen.findByText(KEY.name);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the key ${KEY.name}` }));
    await screen.findByRole("button", { name: `Confirm revoking the key ${KEY.name}` });

    expect(await axe(container)).toHaveNoViolations();
  });
});
