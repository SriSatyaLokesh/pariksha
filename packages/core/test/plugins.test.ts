import { describe, expect, it, beforeEach } from "vitest";
import {
  plugins,
  type QuestionPlugin,
  type ProctoringSignalPlugin,
  type ExportTargetPlugin,
} from "../src/plugins/index.js";

describe("Core Plugin Extensibility Architecture (O-06)", () => {
  beforeEach(() => {
    plugins.clear();
  });

  describe("Question Type Plugins", () => {
    interface CodeConfig {
      prompt: string;
      language: string;
      expectedOutput: string;
      points: number;
    }

    interface CodeResponse {
      sourceCode: string;
      output: string;
    }

    const codingPlugin: QuestionPlugin<CodeConfig, CodeResponse> = {
      type: "code_runner",
      validateConfig: (config: unknown) => {
        if (!config || typeof config !== "object") return { valid: false, errors: ["Config must be an object"] };
        const c = config as Record<string, unknown>;
        if (typeof c.prompt !== "string") return { valid: false, errors: ["prompt must be string"] };
        if (typeof c.expectedOutput !== "string") return { valid: false, errors: ["expectedOutput must be string"] };
        if (typeof c.points !== "number" || c.points <= 0) return { valid: false, errors: ["points must be > 0"] };
        return { valid: true };
      },
      validateResponse: (res: unknown) => {
        if (!res || typeof res !== "object") return { valid: false, errors: ["Response must be an object"] };
        const r = res as Record<string, unknown>;
        if (typeof r.sourceCode !== "string") return { valid: false, errors: ["sourceCode required"] };
        return { valid: true };
      },
      score: (question, response) => {
        const { points, expectedOutput } = question.config;
        if (!response || !response.output) {
          return { points, earned: 0, state: "unanswered" };
        }
        if (response.output.trim() === expectedOutput.trim()) {
          return { points, earned: points, state: "correct" };
        }
        return { points, earned: 0, state: "wrong" };
      },
    };

    it("registers and retrieves custom question type plugin", () => {
      expect(plugins.hasQuestion("code_runner")).toBe(false);
      expect(plugins.listQuestions()).toEqual([]);
      expect(plugins.getQuestion("non_existent")).toBeUndefined();
      plugins.registerQuestion(codingPlugin);
      expect(plugins.hasQuestion("code_runner")).toBe(true);
      expect(plugins.getQuestion("code_runner")).toBe(codingPlugin);
      expect(plugins.listQuestions()).toEqual(["code_runner"]);
    });

    it("validates question config and response through plugin", () => {
      plugins.registerQuestion(codingPlugin);

      const invalidConfig = { prompt: "write hello", points: -5 };
      expect(plugins.getQuestion("code_runner")?.validateConfig(invalidConfig).valid).toBe(false);

      const validConfig: CodeConfig = {
        prompt: "write hello",
        language: "python",
        expectedOutput: "hello world",
        points: 10,
      };
      expect(plugins.getQuestion("code_runner")?.validateConfig(validConfig).valid).toBe(true);

      const invalidResponse = { sourceCode: 123 };
      expect(plugins.getQuestion("code_runner")?.validateResponse(invalidResponse, validConfig).valid).toBe(false);

      const validResponse: CodeResponse = {
        sourceCode: "print('hello world')",
        output: "hello world",
      };
      expect(plugins.getQuestion("code_runner")?.validateResponse(validResponse, validConfig).valid).toBe(true);
    });

    it("scores custom question plugin accurately", () => {
      plugins.registerQuestion(codingPlugin);

      const question = {
        config: {
          prompt: "echo 42",
          language: "sh",
          expectedOutput: "42",
          points: 5,
        },
      };

      // Correct
      const score1 = plugins.getQuestion("code_runner")?.score(question, { sourceCode: "echo 42", output: "42\n" });
      expect(score1).toEqual({ points: 5, earned: 5, state: "correct" });

      // Wrong
      const score2 = plugins.getQuestion("code_runner")?.score(question, { sourceCode: "echo 41", output: "41" });
      expect(score2).toEqual({ points: 5, earned: 0, state: "wrong" });

      // Unanswered
      const score3 = plugins.getQuestion("code_runner")?.score(question, null);
      expect(score3).toEqual({ points: 5, earned: 0, state: "unanswered" });
    });

    it("rejects duplicate registration of existing question type", () => {
      plugins.registerQuestion(codingPlugin);
      expect(() => plugins.registerQuestion(codingPlugin)).toThrow(/already registered/i);
    });
  });

  describe("Proctoring Signal Plugins", () => {
    const audioSpikePlugin: ProctoringSignalPlugin = {
      name: "audio_spike",
      evaluate: (event) => {
        const payload = (event.payload ?? {}) as { decibels?: number };
        if (typeof payload.decibels === "number" && payload.decibels > 85) {
          return { severity: "violation", penalty: 1 };
        }
        if (typeof payload.decibels === "number" && payload.decibels > 70) {
          return { severity: "warning", penalty: 0 };
        }
        return { severity: "info", penalty: 0 };
      },
    };

    it("registers and evaluates custom proctoring signals", () => {
      expect(plugins.listProctoringSignals()).toEqual([]);
      expect(plugins.getProctoringSignal("non_existent")).toBeUndefined();
      plugins.registerProctoringSignal(audioSpikePlugin);
      expect(plugins.getProctoringSignal("audio_spike")).toBe(audioSpikePlugin);
      expect(plugins.listProctoringSignals()).toEqual(["audio_spike"]);

      const eval1 = plugins.getProctoringSignal("audio_spike")?.evaluate({
        type: "audio_spike",
        payload: { decibels: 92 },
      });
      expect(eval1).toEqual({ severity: "violation", penalty: 1 });

      const eval2 = plugins.getProctoringSignal("audio_spike")?.evaluate({
        type: "audio_spike",
        payload: { decibels: 75 },
      });
      expect(eval2).toEqual({ severity: "warning", penalty: 0 });

      expect(() => plugins.registerProctoringSignal(audioSpikePlugin)).toThrow(/already registered/i);
    });
  });

  describe("Export Target Plugins", () => {
    const qtiPlugin: ExportTargetPlugin = {
      format: "qti_xml",
      mimeType: "application/xml",
      fileExtension: ".xml",
      transform: (doc) => `<qti-assessment id="${(doc as { id?: string })?.id ?? 'default'}" />`,
    };

    it("registers and executes export format transformers", async () => {
      expect(plugins.listExportTargets()).toEqual([]);
      expect(plugins.getExportTarget("non_existent")).toBeUndefined();
      plugins.registerExportTarget(qtiPlugin);
      expect(plugins.getExportTarget("qti_xml")).toBe(qtiPlugin);
      expect(plugins.listExportTargets()).toEqual(["qti_xml"]);

      const output = await plugins.getExportTarget("qti_xml")?.transform({ id: "tst_test1" });
      expect(output).toBe('<qti-assessment id="tst_test1" />');

      expect(() => plugins.registerExportTarget(qtiPlugin)).toThrow(/already registered/i);
    });
  });
});
