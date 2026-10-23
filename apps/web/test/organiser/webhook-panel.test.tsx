// `WebhookPanel` (Phase 8d Task 1, `K35`, `K36`, `KG5`). The app's own
// entry point — nav, `View`, `readView`/`paramsOf` — is covered separately
// in `organiser.test.tsx`'s "reaches the webhook panel from the app's own
// entry point"; this file only covers what the panel itself does once
// mounted.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { ApiError, type ApiClient, type Webhook } from "../../src/lib/api";
import { WebhookPanel } from "../../src/components/organiser/WebhookPanel";

const WORKSPACE_ID = "wsp_1";

const HOOK: Webhook = {
  id: "whk_1",
  url: "https://example.test/hook",
  events: ["attempt.submitted"],
  active: true,
  createdAt: 0,
};

// One typed object literal implementing ApiClient, same convention as
// apps/web/test/organiser.test.tsx's `fakeClient` — no MSW, no fetch mock.
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
    readiness: async () => ({}),
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
    // 8e's additions to `ApiClient`, then this branch's. Neither set overlaps
    // a line the other touched, so only the type ever catches a missing one.
    // See #228: every test file hand-rolls this fixture, which is why one
    // interface change conflicts in twenty-odd places.
    exportCandidateData: notUsed,
    deleteCandidateData: notUsed,
    usage: async () => undefined,
    listApiKeys: notUsed,
    createApiKey: notUsed,
    revokeApiKey: notUsed,
    // 8b's additions to `ApiClient` (#228 again — fourth time today that one
    // interface change broke a hand-rolled copy of this fixture).
    gradingQueue: notUsed,
    grade: notUsed,
    recordVerdict: notUsed,
    // 7e's additions to `ApiClient` — fifth time today one interface change
    // has broken a hand-rolled copy of this fixture (#228).
    lockedAttempts: notUsed,
    unlockAttempt: notUsed,
    ...overrides,
  };
}

describe("WebhookPanel — loading and the empty state", () => {
  it("shows the empty state when the workspace has no webhooks", async () => {
    render(<WebhookPanel workspaceId={WORKSPACE_ID} client={fakeClient()} />);
    expect(await screen.findByText(/No webhooks yet/)).toBeInTheDocument();
  });

  it("lists an existing webhook, its events and its active state", async () => {
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [HOOK] }) })}
      />,
    );
    expect(await screen.findByText(HOOK.url)).toBeInTheDocument();
    expect(screen.getByText(/Attempt submitted — Active/)).toBeInTheDocument();
  });
});

describe("WebhookPanel — K35/K36's cost line", () => {
  it("renders the per-candidate figure when the route sends one", async () => {
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [], costPerCandidate: 1 }) })}
      />,
    );
    expect(await screen.findByText(/≈1 request per candidate/)).toBeInTheDocument();
  });

  // Control for the test above — `K36`'s "the field is absent on node"
  // assertion is the exact vacuous shape (`queryBy…toBeNull`) that needs
  // one: this proves the cost sentence renders at all when the field is
  // present, so its absence just below means the prop, not a typo in the
  // text match.
  it("renders no cost line at all when the route omits the field", async () => {
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [] }) })}
      />,
    );
    await screen.findByText(/No webhooks yet/);
    expect(screen.queryByText(/per candidate/)).toBeNull();
  });
});

describe("WebhookPanel — create, and the secret shown once (KG5)", () => {
  it("creating a webhook reveals the signing secret, with copy-to-clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const createWebhook = vi.fn().mockResolvedValue({
      id: "whk_new",
      url: "https://example.test/new",
      events: ["attempt.submitted"],
      signingSecret: "whsec_abc123",
    });

    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [] }), createWebhook })}
      />,
    );
    await screen.findByText(/No webhooks yet/);

    fireEvent.change(screen.getByLabelText(/Endpoint URL/), {
      target: { value: "https://example.test/new" },
    });
    fireEvent.click(screen.getByLabelText("Attempt submitted"));
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));

    expect(await screen.findByText("whsec_abc123")).toBeInTheDocument();
    expect(createWebhook).toHaveBeenCalledWith(WORKSPACE_ID, {
      url: "https://example.test/new",
      events: ["attempt.submitted"],
    });
    // The sentence saying it will not be shown again — the brief's own
    // requirement, not inferred from the secret being present.
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy the signing secret" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("whsec_abc123"));
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
  });

  // MINOR-7 (whole-branch review): the reveal card had no live region and
  // no focus move, so a screen reader never heard the one credential this
  // screen ever shows appear — reachable by Tab, but easy to miss, for the
  // single most important thing on the page.
  it("MINOR-7: the secret reveal card is a live region a screen reader would announce", async () => {
    const createWebhook = vi.fn().mockResolvedValue({
      id: "whk_new",
      url: "https://example.test/new",
      events: ["attempt.submitted"],
      signingSecret: "whsec_abc123",
    });
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [] }), createWebhook })}
      />,
    );
    await screen.findByText(/No webhooks yet/);

    fireEvent.change(screen.getByLabelText(/Endpoint URL/), { target: { value: "https://example.test/new" } });
    fireEvent.click(screen.getByLabelText("Attempt submitted"));
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));

    const secret = await screen.findByText("whsec_abc123");
    expect(secret.closest('[role="status"]')).not.toBeNull();
  });

  it("refuses to submit with no event selected", async () => {
    const createWebhook = vi.fn();
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [] }), createWebhook })}
      />,
    );
    await screen.findByText(/No webhooks yet/);

    fireEvent.change(screen.getByLabelText(/Endpoint URL/), { target: { value: "https://example.test/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));

    expect(await screen.findByText(/Select at least one event/)).toBeInTheDocument();
    expect(createWebhook).not.toHaveBeenCalled();
  });

  it("surfaces the server's SSRF refusal as the field error", async () => {
    const { ApiError } = await import("../../src/lib/api");
    const createWebhook = vi.fn().mockRejectedValue(
      new ApiError(422, "url_refused", "a link to a network address cannot be checked."),
    );
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [] }), createWebhook })}
      />,
    );
    await screen.findByText(/No webhooks yet/);

    fireEvent.change(screen.getByLabelText(/Endpoint URL/), {
      target: { value: "http://169.254.169.254/latest" },
    });
    fireEvent.click(screen.getByLabelText("Attempt submitted"));
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));

    expect(await screen.findByText(/network address cannot be checked/)).toBeInTheDocument();
  });
});

describe("WebhookPanel — pause/resume and revoke", () => {
  it("pausing an active webhook calls setWebhookActive(false) and reloads the list", async () => {
    let active = true;
    const setWebhookActive = vi.fn(async (_ws: string, _id: string, next: boolean) => {
      active = next;
    });
    const listWebhooks = vi.fn(async () => ({ webhooks: [{ ...HOOK, active }] }));

    render(<WebhookPanel workspaceId={WORKSPACE_ID} client={fakeClient({ listWebhooks, setWebhookActive })} />);
    await screen.findByText(HOOK.url);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(setWebhookActive).toHaveBeenCalledWith(WORKSPACE_ID, HOOK.id, false));
    expect(await screen.findByText(/Paused/)).toBeInTheDocument();
  });

  it("revoking asks for confirmation before calling deleteWebhook", async () => {
    const deleteWebhook = vi.fn().mockResolvedValue(undefined);
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [HOOK] }), deleteWebhook })}
      />,
    );
    await screen.findByText(HOOK.url);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the webhook to ${HOOK.url}` }));
    expect(deleteWebhook).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: `Confirm revoking the webhook to ${HOOK.url}` }));
    await waitFor(() => expect(deleteWebhook).toHaveBeenCalledWith(WORKSPACE_ID, HOOK.id));
  });

  it("cancelling the confirmation leaves the webhook alone", async () => {
    const deleteWebhook = vi.fn();
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [HOOK] }), deleteWebhook })}
      />,
    );
    await screen.findByText(HOOK.url);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the webhook to ${HOOK.url}` }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: `Revoke the webhook to ${HOOK.url}` })).toBeInTheDocument();
    expect(deleteWebhook).not.toHaveBeenCalled();
  });

  // MINOR-6 (whole-branch review): a revoke failure used to set the one
  // shared `error` state, which `TextField` rendered as the Endpoint URL
  // field's own error and `aria-invalid="true"` followed it there — a
  // field the organiser never touched, reported invalid over a row action
  // that has nothing to do with it.
  it("MINOR-6: a failed revoke is a panel alert, and does not mark the URL field invalid", async () => {
    const deleteWebhook = vi.fn().mockRejectedValue(new ApiError(500, "internal_error", "could not be completed"));
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [HOOK] }), deleteWebhook })}
      />,
    );
    await screen.findByText(HOOK.url);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the webhook to ${HOOK.url}` }));
    fireEvent.click(screen.getByRole("button", { name: `Confirm revoking the webhook to ${HOOK.url}` }));

    expect(await screen.findByText(/could not be completed/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Endpoint URL/)).not.toHaveAttribute("aria-invalid", "true");
  });

  // MINOR-8 (whole-branch review): no in-flight guard meant a double-click
  // on Pause fired two `PATCH`es (and would, for Revoke, fire a second
  // `DELETE` whose 404 surfaces as a failure after the first already
  // succeeded).
  it("MINOR-8: double-clicking Pause only calls setWebhookActive once", async () => {
    let resolveCall: (() => void) | undefined;
    const setWebhookActive = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCall = resolve;
        }),
    );
    render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [HOOK] }), setWebhookActive })}
      />,
    );
    await screen.findByText(HOOK.url);

    const pauseButton = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(pauseButton);
    fireEvent.click(pauseButton);
    fireEvent.click(pauseButton);

    expect(setWebhookActive).toHaveBeenCalledTimes(1);
    resolveCall?.();
  });
});

describe("WebhookPanel — axe", () => {
  it("the create form and an empty list have no axe violations", async () => {
    const { container } = render(<WebhookPanel workspaceId={WORKSPACE_ID} client={fakeClient()} />);
    await screen.findByText(/No webhooks yet/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the list, a revealed secret and the confirm step have no axe violations", async () => {
    const createWebhook = vi.fn().mockResolvedValue({
      id: "whk_new",
      url: HOOK.url,
      events: HOOK.events,
      signingSecret: "whsec_abc123",
    });
    const { container } = render(
      <WebhookPanel
        workspaceId={WORKSPACE_ID}
        client={fakeClient({ listWebhooks: async () => ({ webhooks: [HOOK] }), createWebhook })}
      />,
    );
    await screen.findByText(HOOK.url);

    fireEvent.click(screen.getByRole("button", { name: `Revoke the webhook to ${HOOK.url}` }));
    await screen.findByRole("button", { name: `Confirm revoking the webhook to ${HOOK.url}` });

    expect(await axe(container)).toHaveNoViolations();
  });
});
