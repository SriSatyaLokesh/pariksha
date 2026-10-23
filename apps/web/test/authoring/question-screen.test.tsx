import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { SingleQuestion } from "@pariksha/core";

import type { Actor, ApiClient, Bank, Workspace } from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "author@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const BANK: Bank = {
  id: "bnk_1",
  name: "SQL basics",
  description: null,
  license: null,
  tags: [],
  questionCount: 1,
  createdAt: 0,
  updatedAt: 0,
};

const SINGLE: SingleQuestion = {
  id: "Q1",
  type: "single",
  prompt: "Which HTTP method is idempotent?",
  options: [
    { id: "a", text: "GET" },
    { id: "b", text: "POST" },
  ],
  key: "a",
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
    listQuestions: async () => ({
      questions: [
        {
          id: "qst_1",
          bankId: "bnk_1",
          refId: SINGLE.id,
          document: SINGLE,
          points: 1,
          usedInTests: 0,
          updatedAt: 0,
        },
      ],
    }),
    deleteQuestion: async () => undefined,
    saveQuestion: async (_workspaceId, bankId, doc) => ({
      id: "qst_1",
      bankId,
      refId: doc.id,
      document: doc,
      points: 1,
      usedInTests: 0,
      updatedAt: 0,
    }),
    listTags: async () => [],
    listGroups: async () => [],
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    tests: async () => [],
    versions: async () => [],
    checklist: async () => [],
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    workspaceBranding: async () => ({}),
    candidates: async () => [],
    lockedAttempts: async () => [],
    usage: async () => undefined,
    listApiKeys: async () => ({ keys: [] }),
    ...overrides,
  });
}

// Fix round (whole-branch review, M4): `justSaved` used to be set `true` on
// save and never reset — "Saved." stayed on screen, asserting the opposite
// of the truth, through every later edit.

// D14: Home -> Banks -> the bank -> the editor, the only route an Author
// has. This file rendered `QuestionScreen` with eight props, three of which
// Phase 6.5c Task 1 deleted; rendering it alone could never have shown that
// the editor is reachable at all.
async function openEditor(client: ApiClient = fakeClient()) {
  const view = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
  fireEvent.click(await screen.findByRole("button", { name: /SQL basics/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^edit question:/i }));
  await screen.findByRole("heading", { level: 1, name: "Edit question" });
  return view;
}

describe("QuestionScreen's 'Saved.' status", () => {
  it("appears after a save and clears on the next edit", async () => {
    await openEditor(fakeClient());

    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    expect(await screen.findByText("Saved.")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Which HTTP method is safe?" },
    });
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("does not clear on its own just because the editor re-rendered after the save", async () => {
    await openEditor(fakeClient());

    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    const saved = await screen.findByText("Saved.");

    // A moment with no further edit — the status must still read "Saved.",
    // not flip back on a re-render the save itself causes.
    await waitFor(() => expect(saved).toBeVisible());
    expect(screen.getByText("Saved.")).toBeVisible();
  });
});

// Fix round (whole-branch review, M4): zero web tests touched the regrade
// offer at all (`grep -rn regrade apps/web/test/` returned nothing) — not
// `gradingSignature`'s prose/key distinction, not the
// `offered -> queuing -> queued/failed` state machine, not the
// `client.regradeQuestion?.(...)` optional-method branch (no fixture
// implemented it, so it was never exercised in either direction), and not
// axe on the new markup. These three click-through tests are the minimum
// the branch review named.
describe("QuestionScreen's regrade offer (K17/K18, AC-08)", () => {
  it("a prose-only save offers nothing", async () => {
    await openEditor(fakeClient());

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Which HTTP method is safe?" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await screen.findByText("Saved.");

    expect(screen.queryByRole("button", { name: /regrade affected attempts/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/changes how the question is graded/i)).not.toBeInTheDocument();
  });

  it("a key save offers a regrade, and queuing it calls regradeQuestion with the qst_ row id, not the ref_id", async () => {
    const regradeQuestion = vi.fn(async () => ({ queued: 42, versions: 2 }));
    await openEditor(fakeClient({ regradeQuestion }));

    // SINGLE's key is option "a" — flip correctness to "b" instead of
    // touching prose, so `gradingSignature` (never `initial`/`lastSaved`
    // identity) is what decides the offer appears.
    fireEvent.click(screen.getByRole("radio", { name: /option b is correct/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await screen.findByText("Saved.");

    const button = await screen.findByRole("button", { name: /regrade affected attempts/i });
    fireEvent.click(button);

    await waitFor(() => expect(regradeQuestion).toHaveBeenCalledTimes(1));
    // `SINGLE.id` ("Q1") is the ref_id an author typed; "qst_1" is the row
    // id `saveQuestion`'s fixture hands back (`QuestionEditor.onSaved`'s
    // second argument) — the one the regrade route actually needs.
    expect(regradeQuestion).toHaveBeenCalledWith("wsp_1", "bnk_1", "qst_1");

    expect(await screen.findByText(/42 attempts across 2 tests queued for regrade\./i)).toBeVisible();
  });

  it("has no axe violations with the regrade offer present", async () => {
    const view = await openEditor(fakeClient({ regradeQuestion: vi.fn(async () => ({ queued: 1, versions: 1 })) }));

    fireEvent.click(screen.getByRole("radio", { name: /option b is correct/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await screen.findByRole("button", { name: /regrade affected attempts/i });

    expect(await axe(view.container)).toHaveNoViolations();
  });

  // Branch review M3: the offer used to render for any role that could
  // save a question and never for the one role that could actually act on
  // it. An Author holds `banks.edit` (saves the key) and not
  // `attempts.grade`; gating on the action, not a guess, means this role
  // sees a plain line instead of a button with no retry.
  it("gates the button on attempts.grade — an Author sees an informational line instead (M3)", async () => {
    const AUTHOR: Actor = {
      userId: "usr_2",
      email: "author@example.edu",
      memberships: [{ workspaceId: "wsp_1", role: "author", grants: [] }],
    };
    await openEditor(fakeClient({ me: async () => AUTHOR, regradeQuestion: vi.fn() }));

    fireEvent.click(screen.getByRole("radio", { name: /option b is correct/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await screen.findByText("Saved.");

    await screen.findByText(/someone with grading permission can rerun affected attempts/i);
    expect(screen.queryByRole("button", { name: /regrade affected attempts/i })).not.toBeInTheDocument();
  });

  // Branch review MIN2: comparing against the mount-time `initial` prop
  // (which `organiser.tsx` never refreshes after a save) made a *reverted*
  // key edit look unchanged and silently offer nothing — the only entry
  // point to a regrade in the whole product. Tracking the last-saved
  // signature in state instead gets a -> b -> a right.
  it("still offers a regrade after a key edit is reverted (MIN2)", async () => {
    await openEditor(fakeClient({ regradeQuestion: vi.fn(async () => ({ queued: 1, versions: 1 })) }));

    fireEvent.click(screen.getByRole("radio", { name: /option b is correct/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await screen.findByRole("button", { name: /regrade affected attempts/i });

    // Back to the original key ("a") — `initial` already equals this, but
    // `lastSaved` (the last save, "b") does not.
    fireEvent.click(screen.getByRole("radio", { name: /option a is correct/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    await screen.findByText("Saved.");

    expect(await screen.findByRole("button", { name: /regrade affected attempts/i })).toBeVisible();
  });

  // Branch review MIN6: the `failed` branch used to replace the button
  // with the error message — the text said "Try again" and removed the
  // only way to.
  it("keeps the button available to retry after a failed enqueue (MIN6)", async () => {
    const regradeQuestion = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ queued: 1, versions: 1 });
    await openEditor(fakeClient({ regradeQuestion }));

    fireEvent.click(screen.getByRole("radio", { name: /option b is correct/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    const button = await screen.findByRole("button", { name: /regrade affected attempts/i });

    fireEvent.click(button);
    await screen.findByText(/could not queue the regrade/i);
    // Still here, not replaced by the error — the retry path MIN6 asked for.
    const retryButton = await screen.findByRole("button", { name: /regrade affected attempts/i });

    fireEvent.click(retryButton);
    expect(await screen.findByText(/1 attempt across 1 test queued for regrade\./i)).toBeVisible();
    expect(regradeQuestion).toHaveBeenCalledTimes(2);
  });
});
