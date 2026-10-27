// Tests for DraftAiModal component (Phase 12, Task 4c, S-15).
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByLabelText(/AI Model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Question Count/i)).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Generate Draft Questions/i })).toBeInTheDocument();
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

    const submitBtn = screen.getByRole("button", { name: /Generate Draft/i });
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

    const submitBtn = screen.getByRole("button", { name: /Generate Draft/i });
    fireEvent.click(submitBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Please select at least one question type.");
    expect(draftFn).not.toHaveBeenCalled();
  });
});

describe("DraftAiModal — review step, validation badges, flagging, and inline editing", () => {
  it("transitions from config to review step and displays header stats & validation badges", async () => {
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      validationIssues: [],
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
        onSuccess={vi.fn()}
      />,
    );

    const promptInput = screen.getByLabelText(/Topic, Syllabus, or Text Material/i);
    fireEvent.change(promptInput, {
      target: { value: "Raft consensus protocol leader election" },
    });

    const submitBtn = screen.getByRole("button", { name: /Generate Draft/i });
    fireEvent.click(submitBtn);

    // Verify questions rendered with prompt, type, difficulty
    for (const q of SAMPLE_QUESTIONS) {
      expect(await screen.findByText(q.prompt)).toBeInTheDocument();
      expect(screen.getByText(q.type)).toBeInTheDocument();
    }

    // Header stats: 3 Approved, 0 Flagged, Token usage and cost
    const statsBar = screen.getByRole("status");
    expect(within(statsBar).getByText(/3 Approved/i)).toBeInTheDocument();
    expect(within(statsBar).getByText(/0 Flagged/i)).toBeInTheDocument();
    expect(within(statsBar).getByText(/600 Tokens/i)).toBeInTheDocument();
    expect(within(statsBar).getByText(/\$0\.12/i)).toBeInTheDocument();

    // Validation status badges: all 3 should show Schema Valid
    const validBadges = screen.getAllByText("✓ Schema Valid");
    expect(validBadges).toHaveLength(3);

    // Action buttons: "Flag as Incorrect" on all 3 cards
    const flagButtons = screen.getAllByRole("button", { name: "Flag as Incorrect" });
    expect(flagButtons).toHaveLength(3);

    // Primary CTA
    expect(screen.getByRole("button", { name: /Import 3 Approved Questions to Bank/i })).toBeInTheDocument();
  });

  it("displays validation warning badge when validation issues are returned", async () => {
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      validationIssues: [
        { field: "questions[1].key", message: "Answer key not found in options" },
      ],
      usage: { promptTokens: 300, completionTokens: 150, estimatedCostCents: 5 },
    });
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

    fireEvent.change(screen.getByLabelText(/Topic, Syllabus, or Text Material/i), {
      target: { value: "Consensus Algorithms" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Draft/i }));

    // Question 2 has validation warning
    expect(await screen.findByText("⚠️ Validation Warning")).toBeInTheDocument();
    expect(screen.getByText("Answer key not found in options")).toBeInTheDocument();

    // Other questions are still valid
    expect(screen.getAllByText("✓ Schema Valid")).toHaveLength(2);
  });

  it("clicking 'Flag as Incorrect' dims/strikethroughs card, updates summary, and 'Unflag & Keep' restores it", async () => {
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      validationIssues: [],
      usage: { promptTokens: 400, completionTokens: 100, estimatedCostCents: 8 },
    });
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

    fireEvent.change(screen.getByLabelText(/Topic, Syllabus, or Text Material/i), {
      target: { value: "Consensus Protocols" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Draft/i }));

    const flagButtons = await screen.findAllByRole("button", { name: "Flag as Incorrect" });
    // Flag the 2nd question (index 1)
    fireEvent.click(flagButtons[1]!);

    // Summary updates
    const statsBar = screen.getByRole("status");
    expect(screen.getByText(/1 flagged item will be excluded/i)).toBeInTheDocument();
    expect(within(statsBar).getByText(/2 Approved/i)).toBeInTheDocument();
    expect(within(statsBar).getByText(/1 Flagged/i)).toBeInTheDocument();

    // The button on question 2 is now "Unflag & Keep"
    expect(screen.getByRole("button", { name: "Unflag & Keep" })).toBeInTheDocument();

    // Primary CTA now says Import 2 Approved Questions
    expect(screen.getByRole("button", { name: /Import 2 Approved Questions to Bank/i })).toBeInTheDocument();

    // Unflag question 2
    fireEvent.click(screen.getByRole("button", { name: "Unflag & Keep" }));

    // Restored to approved
    expect(screen.getByText(/0 flagged items will be excluded/i)).toBeInTheDocument();
    expect(within(statsBar).getByText(/3 Approved/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Flag as Incorrect" })).toHaveLength(3);
  });

  it("clicking 'Import Approved Questions' invokes commitDraftQuestions with only unflagged questions", async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const commitFn = vi.fn().mockResolvedValue({ importedCount: 2, bankId: BANK_ID });
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      validationIssues: [],
      usage: { promptTokens: 400, completionTokens: 100, estimatedCostCents: 8 },
    });
    const client = fakeClient({ draftAiQuestions: draftFn, commitDraftQuestions: commitFn });

    render(
      <DraftAiModal
        client={client}
        workspaceId={WORKSPACE_ID}
        bankId={BANK_ID}
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Topic, Syllabus, or Text Material/i), {
      target: { value: "Consensus Protocols" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Draft/i }));

    // Flag Question 2 (index 1)
    const flagButtons = await screen.findAllByRole("button", { name: "Flag as Incorrect" });
    fireEvent.click(flagButtons[1]!);

    // Click Import
    const importBtn = screen.getByRole("button", { name: /Import 2 Approved Questions to Bank/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(commitFn).toHaveBeenCalledTimes(1);
    });

    // Verified commitFn was called with questions 0 and 2, but NOT question 1
    expect(commitFn).toHaveBeenCalledWith(WORKSPACE_ID, BANK_ID, [
      SAMPLE_QUESTIONS[0],
      SAMPLE_QUESTIONS[2],
    ]);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("inline editing a question allows updating prompt and choices before committing", async () => {
    const onSuccess = vi.fn();
    const commitFn = vi.fn().mockResolvedValue({ importedCount: 3, bankId: BANK_ID });
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      validationIssues: [],
      usage: { promptTokens: 400, completionTokens: 100, estimatedCostCents: 8 },
    });
    const client = fakeClient({ draftAiQuestions: draftFn, commitDraftQuestions: commitFn });

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

    fireEvent.change(screen.getByLabelText(/Topic, Syllabus, or Text Material/i), {
      target: { value: "Consensus Protocols" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Draft/i }));

    const editButtons = await screen.findAllByRole("button", { name: "Edit" });
    // Click Edit on Question 1 (index 0)
    fireEvent.click(editButtons[0]!);

    // Edit form appears
    const editPromptInput = screen.getByLabelText(/Edit Prompt/i);
    expect(editPromptInput).toHaveValue(SAMPLE_QUESTIONS[0]!.prompt);

    // Change prompt
    fireEvent.change(editPromptInput, {
      target: { value: "Which consensus protocol is widely used in etcd?" },
    });

    // Save Edit
    fireEvent.click(screen.getByRole("button", { name: "Save Edit" }));

    // Check edited prompt is displayed
    expect(
      screen.getByText("Which consensus protocol is widely used in etcd?"),
    ).toBeInTheDocument();

    // Now commit
    const importBtn = screen.getByRole("button", { name: /Import 3 Approved Questions to Bank/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(commitFn).toHaveBeenCalledTimes(1);
    });

    // Commit payload contains the modified question
    const committed = commitFn.mock.calls[0]![2] as Question[];
    expect(committed[0]!.prompt).toBe("Which consensus protocol is widely used in etcd?");
  });

  it("model selector allows choosing registry models and custom model input", async () => {
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      usage: { promptTokens: 100, completionTokens: 50, estimatedCostCents: 2 },
    });
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

    // Switch to OpenRouter
    const providerSelect = screen.getByLabelText(/AI Provider/i);
    fireEvent.change(providerSelect, { target: { value: "openrouter" } });

    // Model select should show OpenRouter models
    const modelSelect = screen.getByLabelText(/AI Model/i);
    expect(modelSelect).toBeInTheDocument();

    // Select custom model
    fireEvent.change(modelSelect, { target: { value: "custom" } });

    // Custom model input should appear
    const customModelInput = screen.getByLabelText(/Custom Model ID/i);
    fireEvent.change(customModelInput, { target: { value: "anthropic/claude-3.7-sonnet" } });

    // Fill prompt and submit
    fireEvent.change(screen.getByLabelText(/Topic, Syllabus, or Text Material/i), {
      target: { value: "Distributed systems" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Draft/i }));

    await waitFor(() => {
      expect(draftFn).toHaveBeenCalledWith(
        WORKSPACE_ID,
        BANK_ID,
        expect.objectContaining({
          provider: "openrouter",
          model: "anthropic/claude-3.7-sonnet",
        }),
      );
    });
  });

  it("can navigate back to config step from review step", async () => {
    const draftFn = vi.fn().mockResolvedValue({
      questions: SAMPLE_QUESTIONS,
      usage: { promptTokens: 100, completionTokens: 50, estimatedCostCents: 2 },
    });
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

    fireEvent.change(screen.getByLabelText(/Topic, Syllabus, or Text Material/i), {
      target: { value: "Distributed systems" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Draft/i }));

    const backBtn = await screen.findByRole("button", { name: /Back to Config/i });
    fireEvent.click(backBtn);

    // Back to config form
    expect(screen.getByLabelText(/Topic, Syllabus, or Text Material/i)).toBeInTheDocument();
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

    const submitBtn = screen.getByRole("button", { name: /Generate Draft/i });
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

    fireEvent.click(screen.getByRole("button", { name: /Generate Draft/i }));

    await screen.findByRole("button", { name: /Import.*Approved Questions to Bank/i });

    expect(await axe(container)).toHaveNoViolations();
  });
});
