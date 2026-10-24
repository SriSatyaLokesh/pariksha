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
// Three causes were found, and they are separate: the Registration row's
// content-derived React key, `UX-18`'s confirmation opening from a
// keystroke on a published test, and "Default country" upper-casing under
// a live caret. A sweep that typed a letter into the MIDDLE of every
// editable box in all six panels and in the question editor cleared the
// other thirty-one, so the first three cases below are kept as the
// standing proof that the shared machinery around them — the 250 ms
// debounce, the PATCH, the follow-up GET, `TimingPanel`'s sync-from-prop
// effect — does not move focus or the caret by itself.
//
// Known and deliberately not fixed, recorded so the next reader does not
// have to find them again:
//
//   * An edit that never blurs is dropped without a word — collapse the
//     Timing row, navigate away, or pick a date from the native
//     `datetime-local` widget and then save. `UX-18` holds (nothing
//     reaches the draft unasked), but correctness now rests on a blur
//     nothing in the component guarantees.
//   * `RegistrationForm.tsx:200` keys each PREVIEW row by `field.id`, so
//     renaming a column remounts that column's preview row. Not a sibling
//     of the first cause: nobody is typing into the preview of the very
//     column they are renaming beside it, and the preview's own `values`
//     are keyed by that same id.
//   * `authoring/answer/Written.tsx:159` keys a `<fieldset>` by
//     `blank.id`. Derived content, but not an id the author types.

import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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
        fields: [
          { id: "email", type: "email", label: "Email", required: true, unique: true },
          { id: "phone", type: "phone", label: "Phone", validation: { default_country: "IN" } },
        ],
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
 *
 * **Every answer is a deep copy**, because every real answer came off the
 * wire through `JSON.parse` and shares no object with what was sent. A
 * store that handed the panel back the very `timing` object it had just
 * patched made `test.tsx`'s `body: updated.body` a no-op by reference, and
 * so hid every fault that turns on a new-but-equal prop arriving mid-edit
 * (fix round, M2).
 */
function store() {
  let current: TestVersionRow = structuredClone(DRAFT);
  return {
    get: () => structuredClone(current),
    patch: (patch: Record<string, unknown>) => {
      const settings = (patch["settings"] ?? {}) as Record<string, unknown>;
      current = structuredClone({
        ...current,
        body: {
          ...current.body,
          ...(patch["sections"] === undefined ? {} : { sections: patch["sections"] as never }),
          settings: { ...current.body.settings, ...settings },
        },
      });
      return structuredClone(current);
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

/**
 * One keystroke, with the caret **observed** and never written.
 *
 * The caret is placed where the author's is *before* the event (`at`, or
 * the end of the value), the character is spliced in there, and nothing is
 * written back afterwards. An earlier version of this helper re-set
 * `selectionRange` after the event, which ran after React's synchronous
 * controlled-value restore and therefore erased the commonest caret fault
 * there is — a field that normalises under the caret (upper-casing,
 * trimming, re-formatting) makes React write the DOM value back and throws
 * the caret to the end, and the harness quietly put it where the test
 * expected.
 *
 * So the assertions are here, on every call, and both are read back from
 * the DOM rather than written to it:
 *
 *   * **the value after the keystroke is exactly what the author typed** —
 *     catches a handler that rewrites the string (upper-casing, trimming,
 *     re-formatting);
 *   * **the caret sits at the end of that value** — assigning `.value`
 *     (what `fireEvent.input` does, and what a browser does on a real
 *     keystroke) always collapses the selection to the end of the new
 *     value; that happens before any `onChange` runs, with zero component
 *     code involved, and confirmed in jsdom by probe. A component that then
 *     moves the caret anywhere else — the fault the removed
 *     `selectionStart` assertion was deleted without replacing, M3's
 *     coverage-gap finding — is the one thing that can make it land
 *     anywhere else, value unchanged or not.
 */
function typeChar(el: HTMLInputElement | HTMLTextAreaElement, ch: string, at?: number): void {
  el.focus();
  // A number input has no caret to read or set: `selectionStart` is null
  // and `setSelectionRange` throws on it.
  const selectable = el instanceof HTMLTextAreaElement || el.type !== "number";
  const caret = at ?? el.value.length;
  if (selectable) el.setSelectionRange(caret, caret);
  const typed = el.value.slice(0, caret) + ch + el.value.slice(caret);
  fireEvent.input(el, { target: { value: typed } });
  expect(el.value).toBe(typed);
  if (selectable) {
    expect(el.selectionStart).toBe(typed.length);
    expect(el.selectionEnd).toBe(typed.length);
  }
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
    // Caret in the middle: "Read |this." — a field that normalises under
    // the caret rewrites the value and throws the caret to the end, which
    // an append-only test could never see. `typeChar` asserts both that the
    // value is still exactly what was typed AND that the caret sits where
    // this synthetic keystroke naturally leaves it (the end) — catching a
    // handler that relocates the caret elsewhere without touching the
    // value at all, which a value-only check cannot see.
    typeChar(field, "X", 5);
    expect(field.value).toBe("Read Xthis.");
    expect(document.activeElement).toBe(field);

    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Read Xthis.");
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
    await screen.findAllByLabelText("Column name");
    const column = screen.getAllByLabelText("Column name")[0] as HTMLInputElement;
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
            registration_form: expect.objectContaining({
              fields: [expect.objectContaining({ id: "email_id" }), expect.objectContaining({ id: "phone" })],
            }),
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

  // Fix round, M1. The first fix deferred the id write to the blur, which
  // only changed how OFTEN the row was destroyed. Tab is focus-then-blur:
  // the next box takes focus, the blur commits, and a row keyed by
  // `field.id` is torn out from under the element that just took it. The
  // probe before the key fix read
  // `sibling.isConnected false | activeElement BODY`.
  it("Registration: a committed rename does not destroy the row being tabbed into", async () => {
    const draft = store();
    await openBuilder(
      fakeClient({
        draft: async () => draft.get(),
        patchDraft: (async (_w: string, _t: string, p: never) => draft.patch(p)) as never,
      }),
    );

    fireEvent.click(rowFor("Registration"));
    await screen.findAllByLabelText("Column name");
    const column = screen.getAllByLabelText("Column name")[0] as HTMLInputElement;
    const sibling = screen.getAllByLabelText("Visible label")[0] as HTMLInputElement;
    const row = column.closest("li");
    const del = within(row as HTMLElement).getByRole("button", { name: /delete|remove/i });

    typeChar(column, "2");
    expect(column.value).toBe("email2");

    // Tab: the sibling takes focus FIRST, and the blur that commits the
    // rename arrives second.
    act(() => sibling.focus());
    fireEvent.blur(column);

    expect(sibling.isConnected).toBe(true);
    expect(document.activeElement).toBe(sibling);
    // Same row, same controls — the Delete button a mouse is already on
    // is still the one that will be clicked.
    expect(del.isConnected).toBe(true);
    expect(column.isConnected).toBe(true);
    expect(column.value).toBe("email2");
  });

  // Fix round, M2 — a regression the first fix introduced. `settle()` read
  // "there is an unapplied edit" off `form !== timing`, and `test.tsx`
  // mints a fresh `timing` object out of every PATCH response, so an echo
  // landing mid-edit both reset the box under the author and left the
  // following blur with nothing to ask about. Probe before the fix:
  // `value after echo "60"` (the author had typed 90), `dialog on blur false`.
  it("Timing on a published test: a PATCH echo does not wipe an edit in progress", async () => {
    const draft = store();
    const patchDraft = vi.fn(async (_w: string, _t: string, patch: never) => draft.patch(patch));
    const read = vi.fn(async () => draft.get());
    await openBuilder(
      fakeClient({
        draft: read,
        patchDraft: patchDraft as never,
        test: async () => ({ ...TEST_ROW, currentVersion: 1 }),
      }),
    );

    fireEvent.click(rowFor("Timing"));
    const cooldown = (await screen.findByLabelText(/cooldown/i)) as HTMLInputElement;

    // One applied change, to start a round trip whose echo will land while
    // the next box is being typed in.
    const duration = screen.getByLabelText("Overall duration (minutes)") as HTMLInputElement;
    duration.focus();
    fireEvent.input(duration, { target: { value: "90" } });
    fireEvent.blur(duration);
    fireEvent.click(await screen.findByRole("button", { name: "Apply the change" }));

    // …and the author carries straight on into the next box.
    cooldown.focus();
    fireEvent.input(cooldown, { target: { value: "5" } });

    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    expect(cooldown.value).toBe("5");
    expect(document.activeElement).toBe(cooldown);

    // And the edit is still an edit: leaving the box asks about it.
    fireEvent.blur(cooldown);
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  // Fix round, M4 — an unfound O-17 of the plainest kind. "Default
  // country" upper-cased on every change, so the controlled value differed
  // from what was typed, React wrote the DOM value back, and the caret
  // went to the end: typing a lower-case letter anywhere but the end of
  // "IN" scattered the rest of the code. Probe before the fix:
  // `typed "uIN" → DOM value left as "UIN"`.
  it("Registration: Default country does not normalise under a live caret", async () => {
    const draft = store();
    await openBuilder(
      fakeClient({
        draft: async () => draft.get(),
        patchDraft: (async (_w: string, _t: string, p: never) => draft.patch(p)) as never,
      }),
    );

    fireEvent.click(rowFor("Registration"));
    const country = (await screen.findByLabelText("Default country")) as HTMLInputElement;
    expect(country.value).toBe("IN");

    // At the START of the value, which is the only place a caret thrown to
    // the end can be seen. `typeChar` asserts the DOM value is still what
    // was typed.
    typeChar(country, "u", 0);
    expect(country.value).toBe("uIN");
    expect(document.activeElement).toBe(country);

    // The document still stores the upper case `DIAL_CODE` is keyed by —
    // normalised on the way out of the box, never under the caret.
    fireEvent.blur(country);
    expect(await screen.findByText(/No dialling code is known for "UIN"/)).toBeVisible();
  });

  // Minor. The store above echoes a patch exactly, so none of the guards
  // could see `test.tsx`'s follow-up GET answering with a DIFFERENT body —
  // the case `{ ...fresh, body: prev.body }` exists for, and which another
  // tab saving the same draft produces for real.
  it("a follow-up GET carrying someone else's body does not type over the author", async () => {
    const draft = store();
    const patchDraft = vi.fn(async (_w: string, _t: string, patch: never) => draft.patch(patch));
    let reads = 0;
    const read = vi.fn(async () => {
      reads += 1;
      if (reads === 1) return draft.get();
      // Someone else saved this draft between the PATCH and this read.
      const fresh = draft.get();
      return {
        ...fresh,
        body: {
          ...fresh.body,
          settings: { ...fresh.body.settings, branding: { start_message: "SOMEONE ELSE" } },
        },
      };
    });
    await openBuilder(fakeClient({ draft: read, patchDraft: patchDraft as never }));

    fireEvent.click(rowFor("Branding"));
    const field = (await screen.findByLabelText(/start message/i)) as HTMLTextAreaElement;
    typeChar(field, "X", 5);

    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    expect(field.value).toBe("Read Xthis.");
    expect(document.activeElement).toBe(field);
  });
});
