import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BANK_CONVERSION_PROMPT, SAMPLE_BANK_FILENAME, sampleBank } from "@pariksha/core";
import { BankBrowser } from "../../src/routes/bank";
import { ImportScreen } from "../../src/routes/import";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import type { ApiClient, Bank, QuestionSummary, Workspace } from "../../src/lib/api";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

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

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    listBanks: async () => [BANK],
    listQuestions: async () => ({ questions: [] }),
    listTags: async () => [],
    listGroups: async () => [],
    ...overrides,
  });
}

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

describe("Bank prompt and sample download (#178)", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("BankBrowser action bar", () => {
    it("copies AI conversion prompt to clipboard and displays feedback", async () => {
      render(
        <BankBrowser
          bankId="bnk_1"
          workspaceId="wsp_1"
          client={fakeClient()}
          onNewQuestion={() => {}}
          onEditQuestion={() => {}}
          onImport={() => {}}
        />,
      );

      const copyBtn = screen.getByRole("button", { name: /copy ai prompt/i });
      expect(copyBtn).toBeInTheDocument();

      fireEvent.click(copyBtn);

      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock).toHaveBeenCalledWith(BANK_CONVERSION_PROMPT);

      const feedback = await screen.findByText(/copied prompt!/i);
      expect(feedback).toBeInTheDocument();
    });

    it("downloads sample bank JSON when Download sample is clicked", async () => {
      const saved = captureDownloads();
      render(
        <BankBrowser
          bankId="bnk_1"
          workspaceId="wsp_1"
          client={fakeClient()}
          onNewQuestion={() => {}}
          onEditQuestion={() => {}}
          onImport={() => {}}
        />,
      );

      const downloadBtn = screen.getByRole("button", { name: /download sample/i });
      expect(downloadBtn).toBeInTheDocument();

      fireEvent.click(downloadBtn);

      await waitFor(() => expect(saved).toHaveLength(1));
      const entry = saved[0];
      if (!entry) throw new Error("no download was captured");
      expect(entry.name).toBe(SAMPLE_BANK_FILENAME);

      const content = JSON.parse(await entry.blob.text()) as ReturnType<typeof sampleBank>;
      expect(content.format).toBe("pariksha/bank@1");
      expect(content.questions.length).toBe(12);
    });
  });

  describe("ImportScreen", () => {
    it("renders Copy AI Prompt for bank import and copies prompt with feedback", async () => {
      render(
        <ImportScreen
          workspaceId="wsp_1"
          bankId="bnk_1"
          client={fakeClient()}
          onImported={() => {}}
          kind="bank"
        />,
      );

      const copyBtn = screen.getByRole("button", { name: /copy ai prompt/i });
      expect(copyBtn).toBeInTheDocument();

      fireEvent.click(copyBtn);

      expect(writeTextMock).toHaveBeenCalledTimes(1);
      expect(writeTextMock).toHaveBeenCalledWith(BANK_CONVERSION_PROMPT);

      const feedback = await screen.findByText(/copied prompt!/i);
      expect(feedback).toBeInTheDocument();
    });

    it("downloads sample bank JSON when Download a sample is clicked", async () => {
      const saved = captureDownloads();
      render(
        <ImportScreen
          workspaceId="wsp_1"
          bankId="bnk_1"
          client={fakeClient()}
          onImported={() => {}}
          kind="bank"
        />,
      );

      const downloadBtn = screen.getByRole("button", { name: /download a sample/i });
      expect(downloadBtn).toBeInTheDocument();

      fireEvent.click(downloadBtn);

      await waitFor(() => expect(saved).toHaveLength(1));
      const entry = saved[0];
      if (!entry) throw new Error("no download was captured");
      expect(entry.name).toBe(SAMPLE_BANK_FILENAME);
    });

    it("does not render sample download or copy prompt for test import", () => {
      render(
        <ImportScreen
          workspaceId="wsp_1"
          client={fakeClient()}
          onImported={() => {}}
          kind="test"
        />,
      );

      expect(screen.queryByRole("button", { name: /copy ai prompt/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /download a sample/i })).not.toBeInTheDocument();
    });
  });
});
