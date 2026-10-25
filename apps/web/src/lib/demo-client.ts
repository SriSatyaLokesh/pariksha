import {
  scoreAttempt,
  type ScoringDefaults,
  type ResponseValue,
} from "@pariksha/core";
import {
  DEMO_LANDING_FIXTURE,
  DEMO_PAPER_FIXTURE,
  DEMO_QUESTIONS_CATALOG,
  DEMO_PAPER_SECTIONS,
} from "./demo-test.js";
import type {
  LandingPayload,
  Receipt,
  RegistrationPayload,
  ReleasedResult,
  RunClient,
} from "./run.js";
import type { AttemptPaper } from "./paper.js";
import type { QueuedSave } from "./queue.js";

const DEMO_STORAGE_KEY = "pariksha_demo_attempt";

const DEFAULT_SCORING: ScoringDefaults = {
  mode: "all_or_nothing",
  negativeMarking: false,
};

export function createDemoClient(): RunClient {
  const responses: Record<string, ResponseValue | null> = {};
  let currentMaxIndex = 0;
  let submittedAt: number | null = null;
  let calculatedReceipt: Receipt | null = null;
  let calculatedReleased: ReleasedResult | null = null;

  // Restore any previous demo attempt state from sessionStorage if available
  if (typeof window !== "undefined" && window.sessionStorage) {
    try {
      const saved = window.sessionStorage.getItem(DEMO_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          responses?: Record<string, ResponseValue | null>;
          maxIndex?: number;
          submittedAt?: number | null;
        };
        if (parsed.responses) Object.assign(responses, parsed.responses);
        if (typeof parsed.maxIndex === "number") currentMaxIndex = parsed.maxIndex;
        if (typeof parsed.submittedAt === "number") {
          submittedAt = parsed.submittedAt;
        }
      }
    } catch {
      // sessionStorage unavailable or parse error — ignore
    }
  }

  const persist = () => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        window.sessionStorage.setItem(
          DEMO_STORAGE_KEY,
          JSON.stringify({ responses, maxIndex: currentMaxIndex, submittedAt }),
        );
      } catch {
        // storage quota exceeded or unavailable
      }
    }
  };

  return {
    landing: (): Promise<LandingPayload> => Promise.resolve(DEMO_LANDING_FIXTURE),

    access: (): Promise<{ entryToken: string }> => Promise.resolve({ entryToken: "demo_entry_token" }),

    requestEmailCode: (): Promise<void> => Promise.resolve(),

    form: (): Promise<RegistrationPayload> =>
      Promise.resolve({
        consent: null,
        form: { fields: [] },
        registered: true,
        registrationToken: "demo_reg_token",
      }),

    register: (): Promise<{ registrationToken: string }> =>
      Promise.resolve({ registrationToken: "demo_reg_token" }),

    start: (): Promise<AttemptPaper> =>
      Promise.resolve({
        ...DEMO_PAPER_FIXTURE,
        responses: { ...responses },
        maxIndex: currentMaxIndex,
        submittedAt,
      }),

    resume: (): Promise<AttemptPaper | null> =>
      Promise.resolve({
        ...DEMO_PAPER_FIXTURE,
        responses: { ...responses },
        maxIndex: currentMaxIndex,
        submittedAt,
      }),

    putAnswer: (save: QueuedSave) => {
      responses[save.questionId] = save.value;
      if (typeof save.clientSeq === "number" && save.clientSeq > currentMaxIndex) {
        currentMaxIndex = save.clientSeq;
      }
      persist();

      return Promise.resolve({
        outcome: "accepted" as const,
        remainingMs: 3_600_000,
        maxIndex: currentMaxIndex,
        sectionRemainingMs: null,
      });
    },

    submit: (): Promise<{ receipt: Receipt; released: ReleasedResult | null }> => {
      if (calculatedReceipt && calculatedReleased) {
        return Promise.resolve({ receipt: calculatedReceipt, released: calculatedReleased });
      }

      submittedAt = Date.now();
      persist();

      // Organize questions by section for isomorphic @pariksha/core grading
      const questionsBySection = DEMO_PAPER_SECTIONS.map((sec) => ({
        sectionId: sec.id,
        questions: DEMO_QUESTIONS_CATALOG.filter((q) =>
          sec.questions.some((sq) => sq.id === q.id),
        ),
      }));

      // Grade the attempt entirely client-side using @pariksha/core
      const score = scoreAttempt({
        questionsBySection,
        responses,
        awards: {},
        defaults: DEFAULT_SCORING,
        passMarkPercent: 50,
      });

      const totalQuestions = DEMO_QUESTIONS_CATALOG.length;
      const answeredCount = Object.values(responses).filter((v) => v !== null).length;
      const unansweredCount = totalQuestions - answeredCount;

      calculatedReceipt = {
        attemptId: DEMO_PAPER_FIXTURE.attemptId,
        submittedAt,
        answered: answeredCount,
        unanswered: unansweredCount,
        total: totalQuestions,
        attemptNo: 1,
        attemptsAllowed: 1,
        finishMessage: "Thank you for evaluating the Pariksha Public Demo!",
      };

      calculatedReleased = {
        show: "score_and_sections",
        total: score.total,
        max: score.max,
        percent: score.percent,
        passed: score.passed,
        pending: score.pending,
        sections: score.sections.map((s) => ({
          sectionId: s.sectionId,
          title: DEMO_PAPER_SECTIONS.find((sec) => sec.id === s.sectionId)?.title ?? s.sectionId,
          points: s.points,
          max: s.max,
        })),
      };

      return Promise.resolve({ receipt: calculatedReceipt, released: calculatedReleased });
    },

    requestResultCode: (): Promise<void> => Promise.resolve(),

    verifyResultCode: (): Promise<ReleasedResult | null> => Promise.resolve(calculatedReleased),
  };
}
