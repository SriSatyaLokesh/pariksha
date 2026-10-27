import { describe, expect, it } from "vitest";
import { createDemoClient } from "../../src/lib/demo-client.js";
import { DEMO_PAPER_FIXTURE } from "../../src/lib/demo-test.js";

describe("Demo Exam Client (Zero Cloudflare Subrequests)", () => {
  it("enforces access code DEMO case-insensitively and rejects invalid codes", async () => {
    const client = createDemoClient();

    // Rejects missing/empty/invalid codes
    await expect(client.access()).rejects.toThrow("Invalid access code. Please enter DEMO.");
    await expect(client.access({ code: "" })).rejects.toThrow("Invalid access code. Please enter DEMO.");
    await expect(client.access({ code: "   " })).rejects.toThrow("Invalid access code. Please enter DEMO.");
    await expect(client.access({ code: "WRONG" })).rejects.toThrow("Invalid access code. Please enter DEMO.");

    // Accepts DEMO and demo (case-insensitive with whitespace trimmed)
    const upperResult = await client.access({ code: "DEMO" });
    expect(upperResult.entryToken).toBe("demo_entry_token");

    const lowerResult = await client.access({ code: "demo" });
    expect(lowerResult.entryToken).toBe("demo_entry_token");

    const paddedResult = await client.access({ code: "  demo  " });
    expect(paddedResult.entryToken).toBe("demo_entry_token");
  });

  it("configures 15-minute total exam duration and 5-minute section time limits", async () => {
    const client = createDemoClient();

    // Verify Landing fixture configuration
    const landing = await client.landing();
    expect(landing.durationMinutes).toBe(15);
    expect(landing.sections.length).toBe(3);
    for (const section of landing.sections) {
      expect(section.timeLimitMinutes).toBe(5);
    }

    // Verify Start paper fixture configuration
    const paper = await client.start("demo-token");
    expect(paper.remainingMs).toBe(15 * 60_000);
    expect(paper.sectionRemainingMs).toBe(5 * 60_000);
    expect(paper.sections.length).toBe(3);
    for (const section of paper.sections) {
      expect(section.timeLimitMinutes).toBe(5);
    }
  });

  it("initializes attempt paper from local fixture with proctoring off", async () => {
    const client = createDemoClient();
    const paper = await client.start("demo-token");
    expect(paper.sections.length).toBe(3);
    expect(paper.proctoring.profile).toBe("off");
    expect(paper.proctoring.requireCamera).toBe(false);
    expect(paper.proctoring.requireFullscreen).toBe(false);
  });

  it("saves answers locally in memory without making network fetch", async () => {
    const client = createDemoClient();
    await client.start("demo-token");
    const saveResult = await client.putAnswer({
      questionId: "demo_q1",
      value: { kind: "option", option: "opt_b" },
      clientSeq: 1,
      queuedAt: 1000,
    });
    expect(saveResult.outcome).toBe("accepted");

    // Resume reads saved answers
    const resumed = await client.resume();
    expect(resumed?.responses["demo_q1"]).toEqual({ kind: "option", option: "opt_b" });
  });

  it("scores attempt locally using @pariksha/core and returns receipt with section scores", async () => {
    const client = createDemoClient();
    await client.start("demo-token");
    // Answer demo_q1 correctly (opt_b)
    await client.putAnswer({
      questionId: "demo_q1",
      value: { kind: "option", option: "opt_b" },
      clientSeq: 1,
      queuedAt: 1000,
    });
    // Answer demo_q3 correctly (true)
    await client.putAnswer({
      questionId: "demo_q3",
      value: { kind: "boolean", value: true },
      clientSeq: 2,
      queuedAt: 2000,
    });

    const result = await client.submit();
    expect(result.receipt.attemptId).toBe(DEMO_PAPER_FIXTURE.attemptId);
    expect(result.receipt.answered).toBe(2);
    expect(result.receipt.total).toBe(12);

    expect(result.released).toBeDefined();
    expect(result.released?.show).toBe("score_and_sections");
    expect(result.released?.sections?.length).toBe(3);
    // Section 1 should have positive points for correct answers
    const sec1 = result.released?.sections?.find((s) => s.sectionId === "sec_core");
    expect(sec1?.points).toBeGreaterThan(0);
  });
});
