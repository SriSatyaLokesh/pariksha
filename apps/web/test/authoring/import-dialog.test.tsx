import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

function textFile(name: string, text: string): File {
  return new File([text], name, { type: "text/plain" });
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
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: async () => {
      throw new Error("not used");
    },
    tests: async () => [],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => {
      throw new Error("not used");
    },
    updateTest: async () => {
      throw new Error("not used");
    },
    draft: async () => {
      throw new Error("not used");
    },
    patchDraft: async () => {
      throw new Error("not used");
    },
    publishTest: async () => {
      throw new Error("not used by this test file");
    },
    closeTest: async () => {
      throw new Error("not used by this test file");
    },
    archiveTest: async () => {
      throw new Error("not used by this test file");
    },
    versions: async () => [],
    checklist: async () => [],
    cloneTest: async () => {
      throw new Error("not used by this test file");
    },
    exportTest: async () => {
      throw new Error("not used by this test file");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    // Task 6 (#58, P5.5): present only to satisfy `ApiClient`'s shape --
    // nothing in this file reaches T-19's link check.
    checkUrl: async () => {
      throw new Error("not used by this test file");
    },
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: async () => {
      throw new Error("not used by this test file");
    },
    uploadMedia: async () => {
      throw new Error("not used by this test file");
    },
    candidates: async () => [],
    importCandidates: async () => {
      throw new Error("not used by this test file");
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

  // Task 8 (#52, P4.8): a `.csv`/`.gift` file is sent as text, not parsed
  // JSON, and carries `format` through both the dry-run and the real
  // import — these would fail against an implementation that always sent
  // `{dryRun: true}` with no `format` (the file would arrive as a JSON
  // string literal server-side and fail to parse as a bank at all).
  it("a .csv file is read as text and sent with format: csv, both dry-run and for real", async () => {
    const calls: { doc: unknown; opts: { dryRun?: boolean; format?: string } | undefined }[] = [];
    const client = fakeClient({
      importBank: async (_w, _b, doc, opts) => {
        calls.push({ doc, opts });
        return { imported: 1, issues: [] };
      },
    });
    render(<ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={client} onImported={noop} />);

    uploadFile(screen.getByLabelText(/file/i), textFile("bank.csv", "id,type,prompt,options,key\n"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(calls).toHaveLength(2));

    expect(calls).toEqual([
      { doc: "id,type,prompt,options,key\n", opts: { dryRun: true, format: "csv" } },
      { doc: "id,type,prompt,options,key\n", opts: { dryRun: false, format: "csv" } },
    ]);
  });

  it("a CSV import issue renders its source line, not a bank.questions index", async () => {
    const client = fakeClient({
      importBank: async () => ({
        imported: 0,
        issues: [{ questionId: null, index: -1, field: "key", message: `key "z" is not among the options`, line: 4 }],
      }),
    });
    render(<ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={client} onImported={noop} />);

    uploadFile(screen.getByLabelText(/file/i), textFile("bank.csv", "id,type,prompt,options,key\n"));

    expect(await screen.findByText(/nothing was imported/i)).toBeVisible();
    // Fix round 1, finding 14: the Question column used to repeat "line 4"
    // here too — redundant with the Line column, which is the one cell this
    // asserts on directly, by its own exact text.
    expect(screen.getByRole("cell", { name: "4" })).toBeVisible();
  });

  it("the Question column does not repeat the Line column's value for the same issue", async () => {
    const client = fakeClient({
      importBank: async () => ({
        imported: 0,
        issues: [{ questionId: null, index: -1, field: "key", message: "could not parse", line: 4 }],
      }),
    });
    render(<ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={client} onImported={noop} />);

    uploadFile(screen.getByLabelText(/file/i), textFile("bank.csv", "id,type,prompt,options,key\n"));
    await screen.findByText(/nothing was imported/i);

    const row = screen.getByRole("row", { name: /could not parse/ });
    expect(within(row).getAllByText("4")).toHaveLength(1);
  });

  it("a file with an extension this dialog does not recognise is reported without calling the API", async () => {
    const importBank = vi.fn(async () => ({ imported: 0, issues: [] }) as ImportReport);
    render(
      <ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={fakeClient({ importBank })} onImported={noop} />,
    );

    uploadFile(screen.getByLabelText(/file/i), textFile("bank.txt", "whatever"));

    expect(await screen.findByText(/\.json, \.csv or \.gift/i)).toBeVisible();
    expect(importBank).not.toHaveBeenCalled();
  });

  it("the import dialog has no axe violations and the report is readable by a screen reader", async () => {
    const { container } = render(
      <ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={fakeClient()} onImported={noop} />,
    );

    uploadFile(screen.getByLabelText(/file/i), jsonFile("bad.json", BAD_BANK));
    await screen.findByText(/nothing was imported/i);

    expect(await axe(container)).toHaveNoViolations();
  });

  // Fix round 1, finding 14: the axe check above only ever exercised a JSON
  // report (no `line`, three columns effectively in use) — the four-column
  // table a CSV/GIFT report actually renders was never scanned.
  it("the four-column CSV/GIFT issue table has no axe violations", async () => {
    const client = fakeClient({
      importBank: async () => ({
        imported: 0,
        issues: [
          { questionId: null, index: -1, field: "type", message: "unsupported type", line: 2 },
          { questionId: null, index: -1, field: "key", message: "could not parse", line: 4 },
        ],
      }),
    });
    const { container } = render(
      <ImportDialog workspaceId="wsp_1" bankId="bnk_1" client={client} onImported={noop} />,
    );

    uploadFile(screen.getByLabelText(/file/i), textFile("bank.csv", "id,type,prompt,options,key\n"));
    await screen.findByText(/nothing was imported/i);

    expect(await axe(container)).toHaveNoViolations();
  });
});
