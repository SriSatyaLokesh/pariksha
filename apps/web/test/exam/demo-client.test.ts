import { describe, expect, it } from "vitest";
import { createDemoClient } from "../../src/lib/demo-client.js";
import { DEMO_PAPER_FIXTURE } from "../../src/lib/demo-test.js";

describe("Demo Exam Client (Zero Cloudflare Subrequests)", () => {
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
