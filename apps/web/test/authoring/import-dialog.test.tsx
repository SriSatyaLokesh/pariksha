import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import type { ApiClient, ImportReport } from "../../src/lib/api";
import { ApiError } from "../../src/lib/api";
import { ImportDialog } from "../../src/components/authoring/ImportDialog";

// Repo convention (groups.test.tsx, choice-editor.test.tsx, ...) drives file
// inputs and buttons with `fireEvent` rather than `@testing-library/
// user-event`, which is not a dependency of this package — `fireEvent.change`
// with a `files` list on the `target` is the standard RTL technique for a
// file input and needs no extra package.
function uploadFile(input: HTMLElement, file: File): void {
  fireEvent.change(input, { target: { files: [file] } });
}

function jsonFile(name: string, body: unknown): File {
  return new File([JSON.stringify(body)], name, { type: "application/json" });
}

const GOOD_BANK = {
  format: "pariksha/bank@1",
  name: "Good bank",
  questions: [{ id: "TF-001", type: "true_false", prompt: "P", key: true }],
};

const BAD_BANK = {
  format: "pariksha/bank@1",
  name: "Bad bank",
  questions: [
    {
      id: "LOG-001",
      type: "single",
      prompt: "P",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      key: "not-an-option",
    },
  ],
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => null,
    workspaces: async () => [],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    createBank: async () => {
      throw new Error("not used");
    },
    getBank: async () => {
      throw new Error("not used");
    },
    updateBank: async () => {
      throw new Error("not used");
    },
    deleteBank: async () => undefined,
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    saveQuestion: async () => {
      throw new Error("not used");
    },
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: async () => {
      throw new Error("not used");
    },
    updateGroup: async () => {
      throw new Error("not used");
    },
    deleteGroup: async () => undefined,
    // A real `importBank` throws `ApiError(422, ...)` on a validation
    // failure and the web client (`apps/web/src/lib/api.ts`) normalises
    // that into an `ImportReport` with issues — the fake mirrors the
    // *client's* contract (an awaited report, not a throw) so this
    // component test exercises the same shape `ImportDialog` actually
    // receives, not the raw HTTP layer underneath it.
    importBank: async (_workspaceId, _bankId, doc) => {
      const bank = doc as { questions: { id: string; key: unknown }[] };
      const bad = bank.questions.find((q) => q.key === "not-an-option");
      if (bad) {
        return {
          imported: 0,
          issues: [
            {
              questionId: bad.id,
              index: 0,
              field: "key",
              message: `key "not-an-option" is not among the options`,
            },
          ],
        };
      }
      return { imported: bank.questions.length, issues: [] };
    },
    ...overrides,
  };
}

const noop = () => undefined;

describe("ImportDialog", () => {
  it("the dialog shows the dry-run report before anything is written, with one row per issue", async () => {
    render(
      <ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={fakeClient()} onImported={noop} />,
    );

    uploadFile(screen.getByLabelText(/file/i), jsonFile("bad.json", BAD_BANK));

    expect(await screen.findByText(/nothing was imported/i)).toBeVisible();
    expect(screen.getAllByRole("row", { name: /LOG-001/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  it("a clean dry run enables Import and shows how many questions would import", async () => {
    render(
      <ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={fakeClient()} onImported={noop} />,
    );

    uploadFile(screen.getByLabelText(/file/i), jsonFile("good.json", GOOD_BANK));

    expect(await screen.findByText(/1 question ready to import/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled();
  });

  it("clicking Import sends the real (non-dry-run) request and reports what was imported", async () => {
    const calls: { dryRun?: boolean }[] = [];
    const client = fakeClient({
      importBank: async (_w, _b, doc, opts) => {
        calls.push(opts ?? {});
        const bank = doc as { questions: unknown[] };
        return { imported: bank.questions.length, issues: [] };
      },
    });
    const onImported = vi.fn();
    render(<ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={client} onImported={onImported} />);

    uploadFile(screen.getByLabelText(/file/i), jsonFile("good.json", GOOD_BANK));
    await screen.findByRole("button", { name: /^import$/i, hidden: false });
    await waitFor(() => expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ dryRun: true }, { dryRun: false }]);
  });

  it("a file that is not valid JSON is reported without calling the API", async () => {
    const importBank = vi.fn(async () => ({ imported: 0, issues: [] }) as ImportReport);
    render(
      <ImportDialog
        workspaceId="wsp_1"
        bankId="bnk_1"
        client={fakeClient({ importBank })}
        onImported={noop}
      />,
    );

    uploadFile(screen.getByLabelText(/file/i), new File(["{not json"], "bad.json", { type: "application/json" }));

    expect(await screen.findByText(/not valid json/i)).toBeVisible();
    expect(importBank).not.toHaveBeenCalled();
  });

  it("a transport failure (not a validation report) surfaces the server's message", async () => {
    const client = fakeClient({
      importBank: async () => {
        throw new ApiError(413, "import_too_large", "An import is limited to 500 questions.");
      },
    });
    render(<ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={client} onImported={noop} />);

    uploadFile(screen.getByLabelText(/file/i), jsonFile("big.json", GOOD_BANK));

    expect(await screen.findByText(/limited to 500 questions/i)).toBeVisible();
  });

  it("the import dialog has no axe violations and the report is readable by a screen reader", async () => {
    const { container } = render(
      <ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={fakeClient()} onImported={noop} />,
    );

    uploadFile(screen.getByLabelText(/file/i), jsonFile("bad.json", BAD_BANK));
    await screen.findByText(/nothing was imported/i);

    expect(await axe(container)).toHaveNoViolations();
  });
});
