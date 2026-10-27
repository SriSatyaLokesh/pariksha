// Tests for ByokSettings component (Phase 12, Task 4b, S-15).
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ByokCredential, ByokUsage } from "../../src/lib/api";
import { fakeClient } from "../fixtures/api-client";
import { ByokSettings } from "../../src/components/admin/ByokSettings";

const WORKSPACE_ID = "wsp_byok_test";

const SAMPLE_ANTHROPIC_CRED: ByokCredential = {
  id: "byok_ant_1",
  provider: "anthropic",
  keyHint: "sk-ant-...4a9b",
  spendLimitCents: 5000,
  status: "active",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  lastUsedAt: 1700005000000,
};

const SAMPLE_OPENAI_CRED: ByokCredential = {
  id: "byok_oai_1",
  provider: "openai",
  keyHint: "sk-proj-...9z1x",
  spendLimitCents: null,
  status: "active",
  createdAt: 1700001000000,
  updatedAt: 1700001000000,
  lastUsedAt: null,
};

const SAMPLE_USAGE: ByokUsage = {
  totalPromptTokens: 12000,
  totalCompletionTokens: 3450,
  totalCostCents: 154,
};

describe("ByokSettings — unconfigured state", () => {
  it("renders empty/unconfigured state with 0 usage", async () => {
    const client = fakeClient({
      getByok: async () => ({
        credentials: [],
        usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
      }),
    });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByRole("heading", { name: "Bring Your Own Key" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Anthropic" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OpenAI" })).toBeInTheDocument();

    const notConfiguredBadges = screen.getAllByText("Not configured");
    expect(notConfiguredBadges).toHaveLength(2);

    const configureButtons = screen.getAllByRole("button", { name: "Configure Key" });
    expect(configureButtons).toHaveLength(2);

    expect(screen.getByText("Total Tokens")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});

describe("ByokSettings — active credentials and telemetry", () => {
  it("renders active credentials, masked key hints, spend limits, and usage stats", async () => {
    const client = fakeClient({
      getByok: async () => ({
        credentials: [SAMPLE_ANTHROPIC_CRED, SAMPLE_OPENAI_CRED],
        usage: SAMPLE_USAGE,
      }),
    });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    expect(await screen.findByText("sk-ant-...4a9b")).toBeInTheDocument();
    expect(screen.getByText("sk-proj-...9z1x")).toBeInTheDocument();

    const activeBadges = screen.getAllByText("Active");
    expect(activeBadges).toHaveLength(2);

    // Spend limits: $50.00 / month for Anthropic, No cap for OpenAI
    expect(screen.getByText(/\$50\.00 \/ month/)).toBeInTheDocument();
    expect(screen.getByText(/No cap/)).toBeInTheDocument();

    // Telemetry: 12,000 + 3,450 = 15,450 total tokens, $1.54 estimated cost
    expect(screen.getByText("15,450")).toBeInTheDocument();
    expect(screen.getByText("$1.54")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("3,450")).toBeInTheDocument();

    // Update & Delete buttons present for both
    const updateButtons = screen.getAllByRole("button", { name: "Update Key" });
    expect(updateButtons).toHaveLength(2);

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    expect(deleteButtons).toHaveLength(2);
  });
});

describe("ByokSettings — configure and save key", () => {
  it("opens configuration form, submits new Anthropic key and spend cap", async () => {
    const saveByokKey = vi.fn().mockResolvedValue({
      credential: { ...SAMPLE_ANTHROPIC_CRED, spendLimitCents: 2550 },
    });
    const getByok = vi
      .fn()
      .mockResolvedValueOnce({
        credentials: [],
        usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
      })
      .mockResolvedValueOnce({
        credentials: [{ ...SAMPLE_ANTHROPIC_CRED, spendLimitCents: 2550 }],
        usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
      });

    const client = fakeClient({ getByok, saveByokKey });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    // Click Configure Key for Anthropic (first one)
    const configureButtons = await screen.findAllByRole("button", { name: "Configure Key" });
    const firstButton = configureButtons[0];
    expect(firstButton).toBeDefined();
    fireEvent.click(firstButton!);

    expect(
      screen.getByRole("heading", { name: "Configure Anthropic Key" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Anthropic API Key/), {
      target: { value: "sk-ant-test-key-12345" },
    });
    fireEvent.change(screen.getByLabelText(/Monthly Spend Cap/), {
      target: { value: "25.50" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    await waitFor(() => {
      expect(saveByokKey).toHaveBeenCalledWith(
        WORKSPACE_ID,
        "anthropic",
        "sk-ant-test-key-12345",
        2550,
      );
    });

    expect(
      await screen.findByText(/Successfully configured Anthropic API key\./),
    ).toBeInTheDocument();
  });

  it("submits OpenAI key without spend cap (sending null)", async () => {
    const saveByokKey = vi.fn().mockResolvedValue({
      credential: SAMPLE_OPENAI_CRED,
    });
    const getByok = vi.fn().mockResolvedValue({
      credentials: [],
      usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
    });

    const client = fakeClient({ getByok, saveByokKey });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    const configureButtons = await screen.findAllByRole("button", { name: "Configure Key" });
    // Second button is for OpenAI
    const openAiButton = configureButtons[1];
    expect(openAiButton).toBeDefined();
    fireEvent.click(openAiButton!);

    expect(
      screen.getByRole("heading", { name: "Configure OpenAI Key" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/OpenAI API Key/), {
      target: { value: "sk-proj-testkey98765" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    await waitFor(() => {
      expect(saveByokKey).toHaveBeenCalledWith(
        WORKSPACE_ID,
        "openai",
        "sk-proj-testkey98765",
        null,
      );
    });
  });

  it("validates required API key in form", async () => {
    const saveByokKey = vi.fn();
    const client = fakeClient({
      getByok: async () => ({
        credentials: [],
        usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
      }),
      saveByokKey,
    });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    const configureButtons = await screen.findAllByRole("button", { name: "Configure Key" });
    const button = configureButtons[0];
    expect(button).toBeDefined();
    fireEvent.click(button!);

    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("API key is required.");
    expect(saveByokKey).not.toHaveBeenCalled();
  });

  it("validates negative or non-numeric spend cap input", async () => {
    const saveByokKey = vi.fn();
    const client = fakeClient({
      getByok: async () => ({
        credentials: [],
        usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
      }),
      saveByokKey,
    });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    const configureButtons = await screen.findAllByRole("button", { name: "Configure Key" });
    const button = configureButtons[0];
    expect(button).toBeDefined();
    fireEvent.click(button!);

    fireEvent.change(screen.getByLabelText(/Anthropic API Key/), {
      target: { value: "sk-ant-test" },
    });
    fireEvent.change(screen.getByLabelText(/Monthly Spend Cap/), {
      target: { value: "-15" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Key" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Monthly spend cap must be a valid non-negative number.",
    );
    expect(saveByokKey).not.toHaveBeenCalled();
  });

  it("can cancel the editing form", async () => {
    const client = fakeClient({
      getByok: async () => ({
        credentials: [],
        usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
      }),
    });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    const configureButtons = await screen.findAllByRole("button", { name: "Configure Key" });
    const button = configureButtons[0];
    expect(button).toBeDefined();
    fireEvent.click(button!);

    expect(
      screen.getByRole("heading", { name: "Configure Anthropic Key" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("heading", { name: "Configure Anthropic Key" }),
    ).toBeNull();
  });
});

describe("ByokSettings — deletion with inline confirmation", () => {
  it("cancelling deletion confirmation leaves the credential untouched", async () => {
    const deleteByokKey = vi.fn();
    const client = fakeClient({
      getByok: async () => ({
        credentials: [SAMPLE_ANTHROPIC_CRED],
        usage: SAMPLE_USAGE,
      }),
      deleteByokKey,
    });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(deleteByokKey).not.toHaveBeenCalled();

    // Cancel deletion
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(deleteByokKey).not.toHaveBeenCalled();
  });

  it("confirming deletion calls deleteByokKey and reloads credentials", async () => {
    const deleteByokKey = vi.fn().mockResolvedValue(undefined);
    const getByok = vi
      .fn()
      .mockResolvedValueOnce({
        credentials: [SAMPLE_ANTHROPIC_CRED],
        usage: SAMPLE_USAGE,
      })
      .mockResolvedValueOnce({
        credentials: [],
        usage: SAMPLE_USAGE,
      });

    const client = fakeClient({ getByok, deleteByokKey });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() => {
      expect(deleteByokKey).toHaveBeenCalledWith(WORKSPACE_ID, "anthropic");
    });

    expect(await screen.findByRole("status")).toHaveTextContent("Removed Anthropic key.");
  });

  it("handles deletion errors with role=alert", async () => {
    const deleteByokKey = vi.fn().mockRejectedValue(new Error("Network error"));
    const client = fakeClient({
      getByok: async () => ({
        credentials: [SAMPLE_ANTHROPIC_CRED],
        usage: SAMPLE_USAGE,
      }),
      deleteByokKey,
    });

    render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
  });
});

describe("ByokSettings — accessibility (axe)", () => {
  it("has no axe violations in unconfigured state", async () => {
    const client = fakeClient({
      getByok: async () => ({
        credentials: [],
        usage: { totalPromptTokens: 0, totalCompletionTokens: 0, totalCostCents: 0 },
      }),
    });

    const { container } = render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);
    await screen.findByRole("heading", { name: "Bring Your Own Key" });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with active credentials", async () => {
    const client = fakeClient({
      getByok: async () => ({
        credentials: [SAMPLE_ANTHROPIC_CRED, SAMPLE_OPENAI_CRED],
        usage: SAMPLE_USAGE,
      }),
    });

    const { container } = render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);
    await screen.findByText("sk-ant-...4a9b");

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with editing form open", async () => {
    const client = fakeClient({
      getByok: async () => ({
        credentials: [SAMPLE_ANTHROPIC_CRED],
        usage: SAMPLE_USAGE,
      }),
    });

    const { container } = render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);
    const updateButton = await screen.findByRole("button", { name: "Update Key" });
    fireEvent.click(updateButton);

    await screen.findByRole("heading", { name: "Configure Anthropic Key" });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with delete confirmation open", async () => {
    const client = fakeClient({
      getByok: async () => ({
        credentials: [SAMPLE_ANTHROPIC_CRED],
        usage: SAMPLE_USAGE,
      }),
    });

    const { container } = render(<ByokSettings client={client} workspaceId={WORKSPACE_ID} />);
    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    await screen.findByRole("button", { name: "Confirm delete" });

    expect(await axe(container)).toHaveNoViolations();
  });
});
