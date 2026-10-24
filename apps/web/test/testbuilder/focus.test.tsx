// `O-17`: "Focus leaves the field while typing." The owner reports it on
// the builder's panels and on the question editor, so the claim under test
// is the plainest one there is: after a keystroke has been through the
// 250 ms debounce, the PATCH and the follow-up GET, the field the author
// was typing in is still the focused element and the caret has not moved.
//
// Driven with real `input` events plus hand-managed selection rather than
// `fireEvent.change`: a remount shows up as `document.activeElement`
// falling back to `<body>`, and a controlled-value fight shows up as the
// caret jumping to the end — the second is invisible to `fireEvent.change`,
// which never positions a caret at all.
//
// Two causes were found, and they are separate. A sweep that typed into
// every editable box in all six panels cleared the other twenty-two, so
// the three cases at the top of this file are kept as the standing proof
// that the shared machinery around them — the 250 ms debounce, the PATCH,
// the follow-up GET, `TimingPanel`'s sync-from-prop effect — does not move
// focus or the caret by itself.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  type Actor,
  type ApiClient,
  type TestSummary,
  type TestVersionRow,
  type Workspace,
} from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const TEST_ROW: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  closesAt: null,
  state: "draft",
  currentVersion: null,
  draftVersion: 1,
  reviewRequested: false,
  tags: [],
  updatedAt: 0,
};

const DRAFT: TestVersionRow = {
  id: "ver_1",
  testId: "tst_1",
  version: 1,
  body: {
    settings: {
      timing: { timezone: "Asia/Kolkata", duration_minutes: 60 },
      access: { mode: "link_code", access_code: "APTI-2026" },
      branding: { start_message: "Read this." },
      registration_form: {
        fields: [{ id: "email", type: "email", label: "Email", required: true, unique: true }],
      },
    },
    sections: [],
  },
  publishedAt: null,
  createdAt: 0,
  draw: {},
  setPoints: {},
  points: {},
};

/**
 * A draft store that behaves like the server: PATCH merges the blocks it is
 * given and answers with the stored body, GET answers with the same thing.
 * A fixture whose `patchDraft` answers with a frozen constant would type
 * over the author by itself and prove nothing about the screen.
 */
function store() {
  let current: TestVersionRow = structuredClone(DRAFT);
  return {
    get: () => current,
    patch: (patch: Record<string, unknown>) => {
      const settings = (patch["settings"] ?? {}) as Record<string, unknown>;
      current = {
        ...current,
        body: {
          ...current.body,
          ...(patch["sections"] === undefined ? {} : { sections: patch["sections"] as never }),
          settings: { ...current.body.settings, ...settings },
        },
      };
      return current;
    },
  };
}

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    signOut: async () => undefined,
    listBanks: async () => [],
    listQuestions: async () => ({ questions: [] }),
    listTags: async () => [],
    listGroups: async () => [],
    tests: async () => [TEST_ROW],
    test: async () => TEST_ROW,
    versions: async () => [],
    checklist: async () => [],
    readiness: async () => ({}),
    workspaceBranding: async () => ({}),
    candidates: async () => [],
    lockedAttempts: async () => [],
    usage: async () => undefined,
    listApiKeys: async () => ({ keys: [] }),
    ...overrides,
  });
}

async function openBuilder(client: ApiClient) {
  render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
}

function rowFor(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}\\b`) });
}

/** One keystroke: the character goes in at the caret, an `input` event
 *  fires, and the caret sits after it — which is what a browser does and
 *  what `fireEvent.change` does not. */
function typeChar(el: HTMLInputElement | HTMLTextAreaElement, ch: string, at?: number): void {
  el.focus();
  const selectable = el instanceof HTMLTextAreaElement || el.type !== "number";
  const start = at ?? (selectable ? (el.selectionStart ?? el.value.length) : el.value.length);
  const end = selectable ? (el.selectionEnd ?? start) : el.value.length;
  fireEvent.input(el, { target: { value: el.value.slice(0, start) + ch + el.value.slice(end) } });
  if (selectable && document.activeElement === el) el.setSelectionRange(start + ch.length, start + ch.length);
}

describe("O-17: focus stays in the field being typed into", () => {
  it("keeps focus in Attempts allowed across the save", async () => {
    const draft = store();
    const patchDraft = vi.fn(async (_w: string, _t: string, patch: never) => draft.patch(patch));
    const read = vi.fn(async () => draft.get());
    await openBuilder(fakeClient({ draft: read, patchDraft: patchDraft as never }));

    fireEvent.click(rowFor("Timing"));
    const attempts = (await screen.findByLabelText("Attempts allowed")) as HTMLInputElement;
    typeChar(attempts, "2");
    expect(document.activeElement).toBe(attempts);

    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    expect(document.activeElement).toBe(screen.getByLabelText("Attempts allowed"));
    expect(document.activeElement).toBe(attempts);
  });

  it("keeps focus and the caret in the Branding start message", async () => {
    const draft = store();
    const patchDraft = vi.fn(async (_w: string, _t: string, patch: never) => draft.patch(patch));
    const read = vi.fn(async () => draft.get());
    await openBuilder(fakeClient({ draft: read, patchDraft: patchDraft as never }));

    fireEvent.click(rowFor("Branding"));
    const field = (await screen.findByLabelText(/start message/i)) as HTMLTextAreaElement;
    // Caret in the middle: "Read |this." — a controlled-value fight moves it
    // to the end, which an append-only test could never see.
    typeChar(field, "X", 5);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(6);

    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(6);
  });

  it("keeps focus in the Access code field", async () => {
    const draft = store();
    const patchDraft = vi.fn(async (_w: string, _t: string, patch: never) => draft.patch(patch));
    const read = vi.fn(async () => draft.get());
    await openBuilder(fakeClient({ draft: read, patchDraft: patchDraft as never }));

    fireEvent.click(rowFor("Access"));
    const code = (await screen.findByLabelText("Access code")) as HTMLInputElement;
    typeChar(code, "X");
    expect(document.activeElement).toBe(code);

    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    expect(document.activeElement).toBe(code);
  });

  // Cause 1. `ReorderableList` keys each field row by `field.id`
  // (`FormBuilder`'s `keyOf`), and the Column name box *is* `field.id`:
  // writing it per keystroke remounted the row being typed in. Before the
  // fix the first character unmounted the input outright — `connected`
  // false, `activeElement` back on <body> — so the box could never hold
  // more than one letter.
  it("Registration: Column name survives a whole word", async () => {
    const draft = store();
    const patchDraft = vi.fn(async (_w: string, _t: string, patch: never) => draft.patch(patch));
    await openBuilder(
      fakeClient({ draft: async () => draft.get(), patchDraft: patchDraft as never }),
    );

    fireEvent.click(rowFor("Registration"));
    const column = (await screen.findByLabelText("Column name")) as HTMLInputElement;
    expect(column.value).toBe("email");

    for (const ch of "_id") {
      typeChar(column, ch);
      expect(column.isConnected).toBe(true);
      expect(document.activeElement).toBe(column);
    }
    expect(column.value).toBe("email_id");

    // And the rename still lands, on the way out of the box.
    fireEvent.blur(column);
    await waitFor(() =>
      expect(patchDraft).toHaveBeenCalledWith(
        "wsp_1",
        "tst_1",
        expect.objectContaining({
          settings: expect.objectContaining({
            registration_form: { fields: [expect.objectContaining({ id: "email_id" })] },
          }),
        }),
      ),
    );
  });

  // Cause 2. On a PUBLISHED test `TimingPanel.commit` used to raise
  // `UX-18`'s confirmation from every keystroke, and `useDialogKeys` moves
  // focus into a dialog the moment it opens — so the caret left the box
  // after the first digit and the rest of the number was typed into the
  // dialog. Before the fix this asserted
  // `expected <div role="dialog"> to be <input>`.
  it("Timing on a published test: the confirmation waits for the box to be left", async () => {
    const draft = store();
    const patchDraft = vi.fn(async (_w: string, _t: string, patch: never) => draft.patch(patch));
    await openBuilder(
      fakeClient({
        draft: async () => draft.get(),
        patchDraft: patchDraft as never,
        test: async () => ({ ...TEST_ROW, currentVersion: 1 }),
      }),
    );

    fireEvent.click(rowFor("Timing"));
    const duration = (await screen.findByLabelText("Overall duration (minutes)")) as HTMLInputElement;

    // Select all, then type "90" — two keystrokes, as a browser delivers
    // them. The first used to be the one that opened the dialog.
    duration.focus();
    fireEvent.input(duration, { target: { value: "9" } });
    expect(document.activeElement).toBe(duration);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.input(duration, { target: { value: "90" } });
    expect(document.activeElement).toBe(duration);
    expect(duration.value).toBe("90");

    // UX-18 is not dropped, only deferred: leaving the box still asks
    // before anything reaches the draft.
    fireEvent.blur(duration);
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(patchDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply the change" }));
    await waitFor(() =>
      expect(patchDraft).toHaveBeenCalledWith(
        "wsp_1",
        "tst_1",
        expect.objectContaining({
          settings: expect.objectContaining({
            timing: expect.objectContaining({ duration_minutes: 90 }),
          }),
        }),
      ),
    );
  });
});
