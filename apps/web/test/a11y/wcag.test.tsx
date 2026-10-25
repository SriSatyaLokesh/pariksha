import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { DemoBanner } from "../../src/components/demo/DemoBanner";
import { SubmitDialog } from "../../src/components/exam/SubmitDialog";
import { SaveBanner } from "../../src/components/exam/SaveBanner";
import { ProctorBanner } from "../../src/components/exam/ProctorBanner";
import { Receipt } from "../../src/components/exam/Receipt";
import { ResultCode } from "../../src/components/exam/ResultCode";
import type { Receipt as ReceiptPayload } from "../../src/lib/run";

describe("WCAG 2.1 AA Accessibility Audit Suite (O-04)", () => {
  it("DemoBanner has no axe violations in exam and organiser modes", async () => {
    const { container: examContainer } = render(
      <DemoBanner mode="exam" onExit={() => {}} />,
    );
    expect(await axe(examContainer)).toHaveNoViolations();

    const { container: orgContainer } = render(
      <DemoBanner mode="organiser" expiresInMs={30 * 60_000} />,
    );
    expect(await axe(orgContainer)).toHaveNoViolations();
  });

  it("SubmitDialog has no axe violations when open or pending", async () => {
    const { container: openContainer } = render(
      <SubmitDialog
        total={30}
        unanswered={2}
        marked={1}
        pending={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(await axe(openContainer)).toHaveNoViolations();

    const { container: pendingContainer } = render(
      <SubmitDialog
        total={30}
        unanswered={0}
        marked={0}
        pending={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(await axe(pendingContainer)).toHaveNoViolations();
  });

  it("SaveBanner has no axe violations across saving, saved, and offline states", async () => {
    const { container: idle } = render(<SaveBanner state={{ kind: "idle" }} />);
    expect(await axe(idle)).toHaveNoViolations();

    const { container: saving } = render(<SaveBanner state={{ kind: "saving", pending: 1 }} />);
    expect(await axe(saving)).toHaveNoViolations();

    const { container: saved } = render(
      <SaveBanner state={{ kind: "saved", at: Date.now() }} />,
    );
    expect(await axe(saved)).toHaveNoViolations();

    const { container: offline } = render(
      <SaveBanner state={{ kind: "offline", pending: 3 }} />,
    );
    expect(await axe(offline)).toHaveNoViolations();
  });

  it("ProctorBanner has no axe violations with alert message", async () => {
    const { container } = render(
      <ProctorBanner
        message="Please keep your camera centered and facing forward."
        messageAt={Date.now()}
        onDismiss={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Receipt screen has no axe violations", async () => {
    const mockReceipt: ReceiptPayload = {
      attemptId: "att_01j7h8k9a1b2c3d4e5f6g7h8",
      attemptNo: 1,
      attemptsAllowed: 1,
      submittedAt: Date.now(),
      answered: 25,
      unanswered: 0,
      total: 25,
      finishMessage: null,
    };

    const { container } = render(<Receipt receipt={mockReceipt} released={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ResultCode screen has no axe violations", async () => {
    const mockClient = {
      result: vi.fn().mockResolvedValue(null),
    } as unknown as Parameters<typeof ResultCode>[0]["client"];

    const { container } = render(
      <ResultCode client={mockClient} onBack={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
