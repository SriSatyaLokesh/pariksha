// Import is a PAGE (`D18`), and these are its tests.
//
// It replaces `import-dialog.test.tsx`, whose five direct `ImportDialog`
// mounts had zero `OrganiserApp` mounts. That file is not merely edited —
// the component those mounts rendered is gone, so under `D14` every
// assertion here starts where a person starts: at `OrganiserApp`, at an
// address, or at the button in the bank browser that navigates to one.
// The test-import half of the same page lives in
// `test/testbuilder/clone-import.test.tsx`, beside the list it is reached
// from.
//
// The fake client's `importBank` runs `@pariksha/core`'s own `validateBank`
// — the importer's real cross-field pass, not a hand-written stand-in. The
// structural (JSON Schema) half of a dry run cannot run here at all:
// `@cfworker/json-schema` is `apps/api`'s dependency and bundling a
// validator into the organiser to test one would be the second source of
// truth `D18` exists to refuse. It is checked where it lives —
// `packages/core/test/types.test.ts` against the schema files, and
// `apps/api/test/import/json.test.ts` through the real import route.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { QUESTION_TYPES, validateBank } from "@pariksha/core";

import {
  ApiError,
  type Actor,
  type ApiClient,
  type Bank,
  type ImportReport,
  type Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const BANK: Bank = {
  id: "bnk_1",
  name: "SQL basics",
  description: null,
  license: null,
  tags: [],
  questionCount: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

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
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
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
    // The importer's own cross-field pass, run here rather than imitated.
    // A real `importBank` throws `ApiError(422, …)` and `lib/api.ts`
    // normalises that into an `ImportReport`, so the fake mirrors the
    // *client's* contract (an awaited report) and not the HTTP layer.
    importBank: async (_workspaceId, _bankId, doc) => {
      const result = validateBank(doc);
      return result.ok
        ? { imported: result.bank.questions.length, issues: [] }
        : { imported: 0, issues: result.issues };
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
      throw new Error("not used");
    },
    closeTest: async () => {
      throw new Error("not used");
    },
    archiveTest: async () => {
      throw new Error("not used");
    },
    versions: async () => [],
    checklist: async () => [],
    cloneTest: async () => {
      throw new Error("not used");
    },
    exportTest: async () => {
      throw new Error("not used");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: async () => {
      throw new Error("not used");
    },
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: async () => {
      throw new Error("not used");
    },
    uploadMedia: async () => {
      throw new Error("not used");
    },
    candidates: async () => [],
    importCandidates: async () => {
      throw new Error("not used");
    },
    gradingQueue: async () => {
      throw new Error("not used by this test file");
    },
    grade: async () => {
      throw new Error("not used by this test file");
    },
    recordVerdict: async () => {
      throw new Error("not used by this test file");
    },
    exportCandidateData: async () => {
      throw new Error("not used");
    },
    deleteCandidateData: async () => {
      throw new Error("not used");
    },
    usage: async () => undefined,
    listWebhooks: async () => {
      throw new Error("not used by this test file");
    },
    createWebhook: async () => {
      throw new Error("not used by this test file");
    },
    setWebhookActive: async () => {
      throw new Error("not used by this test file");
    },
    deleteWebhook: async () => {
      throw new Error("not used by this test file");
    },
    listApiKeys: async () => ({ keys: [] }),
    createApiKey: async () => {
      throw new Error("not used by this test file");
    },
    revokeApiKey: async () => {
      throw new Error("not used by this test file");
    },
    ...overrides,
  };
}

/** A reload at `search` — the only difference between a deep link and a
 *  click (`organiser-url.test.tsx` uses the same two lines). */
function reloadAt(search: string, client: ApiClient = fakeClient()) {
  window.history.replaceState(null, "", `/admin${search}`);
  return render(<OrganiserApp client={client} />);
}

/** The bank import page, opened at its own address. */
async function openImport(client: ApiClient = fakeClient()) {
  const view = reloadAt("?view=import&bank=bnk_1", client);
  await screen.findByRole("heading", { level: 1, name: "Import questions" });
  return view;
}

// Repo convention (groups.test.tsx, choice-editor.test.tsx, …): a file input
// is driven with `fireEvent.change` and a `files` list on the target —
// `@testing-library/user-event` is not a dependency of this package.
// jsdom's own `File` does not reliably implement `.text()` under this
// environment, so the one method the page calls is provided outright, the
// same way `testbuilder/clone-import.test.tsx` already does.
function fileOf(name: string, body: string, type: string): File {
  const file = new File([body], name, { type });
  Object.defineProperty(file, "text", { value: async () => body });
  return file;
}

function jsonFile(name: string, doc: unknown): File {
  return fileOf(name, JSON.stringify(doc), "application/json");
}

function upload(file: File): void {
  fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
}

/** What the browser was handed to save. jsdom performs no download — the
 *  click on the generated link is a no-op — so the Blob handed to
 *  `createObjectURL` and the anchor's own `download` are the whole
 *  observable effect. */
function captureDownloads(): { name: string; blob: Blob }[] {
  const saved: { name: string; blob: Blob }[] = [];
  let pending: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
    pending = blob as Blob;
    return "blob:sample";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (pending !== undefined) saved.push({ name: this.download, blob: pending });
  });
  return saved;
}

/** Press "Download a sample" and read back what it saved. */
async function downloadSample(): Promise<{ name: string; doc: { questions: { type: string }[] } }> {
  const saved = captureDownloads();
  fireEvent.click(screen.getByRole("button", { name: /download a sample/i }));
  await waitFor(() => expect(saved).toHaveLength(1));
  const entry = saved[0];
  if (entry === undefined) throw new Error("no download was captured");
  return {
    name: entry.name,
    doc: JSON.parse(await entry.blob.text()) as { questions: { type: string }[] },
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin");
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/admin");
});

describe("import is a page, not a modal (D18)", () => {
  it("is reachable at its own address", async () => {
    await openImport();

    expect(screen.getByLabelText(/bank file/i)).toBeVisible();
  });

  it("traps no focus: no dialog role, no focus grab on arrival, and Escape is the browser's", async () => {
    // The dialog this replaces declared `role="dialog"`, took focus through
    // `useDialogKeys` and closed on Escape. A page does none of the three,
    // and all three would come back together if someone re-wrapped this
    // screen in that hook.
    await openImport();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(screen.getByLabelText(/bank file/i), { key: "Escape" });

    expect(screen.getByRole("heading", { level: 1, name: "Import questions" })).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("import");
  });

  it("is opened from the bank browser, and Back returns to the bank", async () => {
    reloadAt("?view=bank&bank=bnk_1");
    fireEvent.click(await screen.findByRole("button", { name: /^import$/i }));

    await screen.findByRole("heading", { level: 1, name: "Import questions" });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("view")).toBe("import");
    expect(params.get("bank")).toBe("bnk_1");

    window.history.back();

    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("view")).toBe("bank"),
    );
    expect(screen.queryByRole("heading", { level: 1, name: "Import questions" })).toBeNull();
  });
});

describe("the sample (D18)", () => {
  it("offers a sample generated from the schema, with one question of every type", async () => {
    await openImport();

    const { name, doc } = await downloadSample();

    expect(name).toMatch(/\.json$/);
    // The set, against the type list the schema pins (`QUESTION_TYPES` is
    // compared to `schemas/question-1.json`'s own `type` enum in
    // `packages/core/test/types.test.ts`) — not against a frozen 12, which
    // `AG2` refuses. A `.size === 12` on its own would also pass for twelve
    // near-identical stubs; the test below is what rules those out.
    expect(new Set(doc.questions.map((q) => q.type))).toEqual(new Set(QUESTION_TYPES));
  });

  it("validates the generated sample against the importer", async () => {
    // Through the page's own upload path — the same `client.importBank(…,
    // { dryRun: true })` a real file takes — into the importer's own
    // `validateBank`. Not a second copy of the rules, and not a
    // hand-written expectation of what the sample should contain.
    await openImport();
    const { name, doc } = await downloadSample();

    upload(jsonFile(name, doc));

    expect(
      await screen.findByText(`${doc.questions.length} questions ready to import.`),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled();
  });

  it("offers no bank sample on the test import, which takes a different document", async () => {
    reloadAt("?view=import");
    await screen.findByRole("heading", { level: 1, name: "Import a test" });

    expect(screen.queryByRole("button", { name: /download a sample/i })).toBeNull();
  });
});

describe("the import rules are unchanged by the move", () => {
  it("shows the dry-run report before anything is written, with one row per issue", async () => {
    await openImport();

    upload(jsonFile("bad.json", BAD_BANK));

    expect(await screen.findByText(/nothing was imported/i)).toBeVisible();
    expect(screen.getAllByRole("row", { name: /LOG-001/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  it("a clean dry run enables Import and says how many questions would import", async () => {
    await openImport();

    upload(jsonFile("good.json", GOOD_BANK));

    expect(await screen.findByText(/1 question ready to import/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled();
  });

  it("Import sends the real (non-dry-run) request and returns to the bank", async () => {
    const calls: ({ dryRun?: boolean } | undefined)[] = [];
    await openImport(
      fakeClient({
        importBank: async (_w, _b, doc, opts) => {
          calls.push(opts);
          return { imported: (doc as { questions: unknown[] }).questions.length, issues: [] };
        },
      }),
    );

    upload(jsonFile("good.json", GOOD_BANK));
    await waitFor(() => expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(calls).toEqual([{ dryRun: true }, { dryRun: false }]));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("view")).toBe("bank"),
    );
  });

  it("a file that is not valid JSON is reported without calling the API", async () => {
    const importBank = vi.fn(async () => ({ imported: 0, issues: [] }) as ImportReport);
    await openImport(fakeClient({ importBank }));

    upload(fileOf("bad.json", "{not json", "application/json"));

    expect(await screen.findByText(/not valid json/i)).toBeVisible();
    expect(importBank).not.toHaveBeenCalled();
  });

  it("a file with an extension the page does not recognise is reported without calling the API", async () => {
    const importBank = vi.fn(async () => ({ imported: 0, issues: [] }) as ImportReport);
    await openImport(fakeClient({ importBank }));

    upload(fileOf("bank.txt", "whatever", "text/plain"));

    expect(await screen.findByText(/\.json, \.csv or \.gift/i)).toBeVisible();
    expect(importBank).not.toHaveBeenCalled();
  });

  it("a transport failure (not a validation report) surfaces the server's message", async () => {
    await openImport(
      fakeClient({
        importBank: async () => {
          throw new ApiError(413, "import_too_large", "An import is limited to 500 questions.");
        },
      }),
    );

    upload(jsonFile("big.json", GOOD_BANK));

    expect(await screen.findByText(/limited to 500 questions/i)).toBeVisible();
  });

  it("a .csv file is read as text and sent with format: csv, both dry-run and for real", async () => {
    const calls: { doc: unknown; opts: { dryRun?: boolean; format?: string } | undefined }[] = [];
    await openImport(
      fakeClient({
        importBank: async (_w, _b, doc, opts) => {
          calls.push({ doc, opts });
          return { imported: 1, issues: [] };
        },
      }),
    );

    upload(fileOf("bank.csv", "id,type,prompt,options,key\n", "text/csv"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      { doc: "id,type,prompt,options,key\n", opts: { dryRun: true, format: "csv" } },
      { doc: "id,type,prompt,options,key\n", opts: { dryRun: false, format: "csv" } },
    ]);
  });

  it("a CSV import issue renders its source line, and the Question column does not repeat it", async () => {
    await openImport(
      fakeClient({
        importBank: async () => ({
          imported: 0,
          issues: [{ questionId: null, index: -1, field: "key", message: "could not parse", line: 4 }],
        }),
      }),
    );

    upload(fileOf("bank.csv", "id,type,prompt,options,key\n", "text/csv"));
    await screen.findByText(/nothing was imported/i);

    // Fix round 1, Minor 2: this was `getAllByText("4")`, inherited verbatim
    // from the deleted `import-dialog.test.tsx` — and an exact string match
    // cannot see the regression it exists for. The defect is the Question
    // column rendering "line 4" beside the Line column's own "4"; `"4"`
    // matches neither "line 4" nor any cell containing it, so the count
    // stayed 1 with the defect present and the guard could never redden.
    // The word boundary is what makes it count occurrences of the NUMBER
    // wherever it appears in the row.
    const row = screen.getByRole("row", { name: /could not parse/ });
    expect(within(row).getAllByText(/\b4\b/)).toHaveLength(1);
  });
});

describe("accessibility", () => {
  it("the import page and its issue table have no axe violations", async () => {
    const { container } = await openImport();

    upload(jsonFile("bad.json", BAD_BANK));
    await screen.findByText(/nothing was imported/i);

    expect(await axe(container)).toHaveNoViolations();
  });

  it("the four-column CSV/GIFT issue table has no axe violations", async () => {
    const { container } = await openImport(
      fakeClient({
        importBank: async () => ({
          imported: 0,
          issues: [
            { questionId: null, index: -1, field: "type", message: "unsupported type", line: 2 },
            { questionId: null, index: -1, field: "key", message: "could not parse", line: 4 },
          ],
        }),
      }),
    );

    upload(fileOf("bank.csv", "id,type,prompt,options,key\n", "text/csv"));
    await screen.findByText(/nothing was imported/i);

    expect(await axe(container)).toHaveNoViolations();
  });
});
