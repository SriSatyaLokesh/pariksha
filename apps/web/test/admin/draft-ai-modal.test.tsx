// Tests for DraftAiModal component (Phase 12, Task 4c, S-15).
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { Question } from "@pariksha/core";
import type { ApiClient } from "../../src/lib/api";
import { fakeClient } from "../fixtures/api-client";
import { DraftAiModal } from "../../src/components/admin/DraftAiModal";

const WORKSPACE_ID = "wsp_draft_test";
const BANK_ID = "bnk_draft_test";

const SAMPLE_QUESTIONS: Question[] = [
  {
    id: "q_draft_1",
    type: "single",
    prompt: "Which consensus algorithm uses randomized election timers?",
    difficulty: "medium",
    options: [
      { id: "a", text: "Paxos" },
      { id: "b", text: "Raft" },
      { id: "c", text: "2PC" },
    ],
    key: "b",
  },
  {
    id: "q_draft_2",
    type: "true_false",
    prompt: "Raft guarantees safety under network partitions.",
    difficulty: "hard",
    key: true,
  },
  {
    id: "q_draft_3",
    type: "numeric",
    prompt: "What is the minimum number of nodes required for 2 node failures?",
    difficulty: "easy",
    key: { value: 5 },
  },
];

describe("DraftAiModal — visibility and rendering", () => {
  it("renders nothing when isOpen={false}", () => {
    const client = fakeClient();
    const { container } = render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={false}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders modal dialog with form when isOpen={true}", () => {
    const client = fakeClient();
    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Draft Questions with AI" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    expect(screen.getByLabelText(/Topic, Syllabus, or Text Material/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/AI Provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Question Count/i)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Generate Drafts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });
});

describe("DraftAiModal — question type toggling", () => {
  it("toggles question type buttons updating aria-pressed", () => {
    const client = fakeClient();
    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    // Initial state: single, multiple, true_false are pressed
    const singleBtn = screen.getByRole("button", { name: /Single Choice/i });
    const numericBtn = screen.getByRole("button", { name: /Numerical/i });

    expect(singleBtn).toHaveAttribute("aria-pressed", "true");
    expect(numericBtn).toHaveAttribute("aria-pressed", "false");

    // Toggle single choice off
    fireEvent.click(singleBtn);
    expect(singleBtn).toHaveAttribute("aria-pressed", "false");

    // Toggle numeric on
    fireEvent.click(numericBtn);
    expect(numericBtn).toHaveAttribute("aria-pressed", "true");
  });
});

describe("DraftAiModal — client-side validation", () => {
  it("validates required prompt input before calling draftAiQuestions", async () => {
    const draftFn = vi.fn();
    const client = fakeClient({ draftAiQuestions: draftFn });

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const submitBtn = screen.getByRole("button", { name: "Generate Drafts" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Please provide a prompt or topic for question generation.");
    expect(draftFn).not.toHaveBeenCalled();
  });

  it("validates that at least one question type must be selected", async () => {
    const draftFn = vi.fn();
    const client = fakeClient({ draftAiQuestions: draftFn });

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    // Fill prompt
    const promptInput = screen.getByLabelText(/Topic, Syllabus, or Text Material/i);
    fireEvent.change(promptInput, { target: { value: "Operating Systems Memory Management" } });

    // Deselect all active types (single, multiple, true_false)
    fireEvent.click(screen.getByRole("button", { name: /Single Choice/i }));
    fireEvent.click(screen.getByRole("button", { name: /Multiple Choice/i }));
    fireEvent.click(screen.getByRole("button", { name: /True \/ False/i }));

    const submitBtn = screen.getByRole("button", { name: "Generate Drafts" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Please select at least one question type.");
    expect(draftFn).not.toHaveBeenCalled();
  });
});

describe("DraftAiModal — generation and preview", () => {
  it("generates questions on submit, displaying preview list of created questions and calling onSuccess on View in Bank", async () => {
    const onSuccess = vi.fn();
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      usage: { promptTokens: 420, completionTokens: 180, estimatedCostCents: 12 },
    });
    const client = fakeClient({ draftAiQuestions: draftFn });

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />,
    );

    const promptInput = screen.getByLabelText(/Topic, Syllabus, or Text Material/i);
    fireEvent.change(promptInput, {
      target: { value: "Raft consensus protocol leader election" },
    });

    const countInput = screen.getByLabelText(/Question Count/i);
    fireEvent.change(countInput, { target: { value: "3" } });

    const providerSelect = screen.getByLabelText(/AI Provider/i);
    fireEvent.change(providerSelect, { target: { value: "openai" } });

    const submitBtn = screen.getByRole("button", { name: "Generate Drafts" });
    fireEvent.click(submitBtn);

    // Verify client called with correct arguments
    await waitFor(() => {
      expect(draftFn).toHaveBeenCalledWith(WORKSPACE_ID, BANK_ID, {
        prompt: "Raft consensus protocol leader election",
        count: 3,
        types: ["single", "multiple", "true_false"],
        provider: "openai",
      });
    });

    // Success status and count
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Successfully drafted 3 questions into this bank.",
    );

    // Renders drafted question summaries: prompt, type, difficulty
    for (const q of SAMPLE_QUESTIONS) {
      expect(screen.getByText(q.prompt)).toBeInTheDocument();
      expect(screen.getByText(q.type)).toBeInTheDocument();
      expect(screen.getByText(q.difficulty ?? "medium")).toBeInTheDocument();
    }

    // Click "View in Bank" calls onSuccess
    const viewBtn = screen.getByRole("button", { name: "View in Bank" });
    fireEvent.click(viewBtn);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors in role=alert", async () => {
    const draftFn = vi.fn().mockRejectedValue(new Error("No active Anthropic API key configured for this workspace."));
    const client = fakeClient({ draftAiQuestions: draftFn });

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const promptInput = screen.getByLabelText(/Topic, Syllabus, or Text Material/i);
    fireEvent.change(promptInput, { target: { value: "Quantum Computing Basics" } });

    const submitBtn = screen.getByRole("button", { name: "Generate Drafts" });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No active Anthropic API key configured for this workspace.");
  });
});

describe("DraftAiModal — modal dismissal", () => {
  it("calls onClose when Cancel button is clicked", () => {
    const onClose = vi.fn();
    const client = fakeClient();

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Close dialog (✕) button is clicked", () => {
    const onClose = vi.fn();
    const client = fakeClient();

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    const client = fakeClient();

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DraftAiModal — accessibility audits", () => {
  it("has no axe violations in initial form state", async () => {
    const client = fakeClient();
    const { container } = render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in preview state with questions displayed", async () => {
    const client = fakeClient({
      draftAiQuestions: async () => ({
        questions: SAMPLE_QUESTIONS,
        usage: { promptTokens: 300, completionTokens: 150, estimatedCostCents: 5 },
      }),
    });

    const { container } = render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const promptInput = screen.getByLabelText(/Topic, Syllabus, or Text Material/i);
    fireEvent.change(promptInput, { target: { value: "Distributed Databases" } });

    fireEvent.click(screen.getByRole("button", { name: "Generate Drafts" }));

    await screen.findByRole("button", { name: "View in Bank" });

    expect(await axe(container)).toHaveNoViolations();
  });
});
