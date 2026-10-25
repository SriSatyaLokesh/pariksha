/*
 * The candidate's paper, as types only — no implementation, nothing
 * imported from the API, and nothing that fetches.
 *
 * **Why this file exists before the code that produces it.** Phase 6 runs
 * on two branches: this one owns `apps/api`, `packages` and
 * `apps/web/src/lib/run.ts`; the other owns the candidate screens. While
 * Task 5 was still unwritten, the screens needed a shape to build
 * against, so they declared their own `CandidateQuestion`, `AttemptPaper`
 * and a zero-argument `PaperClient.start()` locally in `Runner.tsx` and
 * `exam.tsx`. Two definitions of one shape do not conflict at merge —
 * structural typing hides an extra field and `Partial` hides a missing
 * method — so the drift would have surfaced as an `undefined` at runtime
 * inside a live attempt rather than as a failing typecheck.
 *
 * One file, declared once, cherry-picked by the screens branch and
 * imported by `run.ts`. A new file conflicts with nothing, and from the
 * moment both sides import it a drift is a compile error on whichever
 * side drifted.
 *
 * **Task 5 has now shipped the server half, and these shapes are the
 * ones it really answers with** — `apps/api/src/run/attempt.ts` and
 * `apps/api/src/run/scrub.ts`, asserted end to end in
 * `apps/api/test/run/start.test.ts`.
 *
 * **The two tracks are merged.** The local copies are gone and the
 * screens import these; `RunClient` declares `start(registrationToken)`
 * and `resume()` itself, so the `PaperClient` placeholder this file
 * carried for the screens branch is gone with them.
 */

import type { QuestionType, ResolvedProctoring, ResponseValue } from "@pariksha/core";

/**
 * One question as a candidate sees it: the prompt and the choices, and
 * never the key, the explanation or another candidate's anything
 * (`S-10`). `id` is the `qst_` row id — opaque, stable, and what
 * `response.question_id` stores.
 *
 * The server builds this field by field out of a `switch` over the
 * twelve types rather than deleting from the stored document, so a field
 * absent here is a field the server never put on the wire.
 */
export interface CandidateQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  media?: { kind: "image"; src: string; alt: string }[];
  /** Presentation order is pinned per attempt (`T-10`), so this array is
   *  already in the order this candidate must see. */
  options?: { id: string; text: string }[];
  left?: string[];
  right?: string[];
  items?: string[];
  /** The blanks to fill, by id. What each accepts is the key. */
  blanks?: { id: string }[];
  unit?: string;
  assertion?: string;
  reason?: string;
  maxLength?: number;
  k?: number;
  /** A passage or stimulus shared by several questions. */
  group?: { id: string; passage: string };
}

export interface PaperSection {
  id: string;
  title: string;
  instructions: string | null;
  timeLimitMinutes: number | null;
  questions: CandidateQuestion[];
}

/** What one candidate sits, as the server pinned it at `/start`. */
export interface AttemptPaper {
  attemptId: string;
  sections: PaperSection[];
  /** The set label this candidate drew, when the test has sets (`T-09`). */
  setNo?: string;
  /** Answers already saved, by question id, so a resume shows what was
   *  typed. Empty on a fresh attempt. */
  responses: Record<string, ResponseValue | null>;
  /**
   * The highest `client_seq` the server holds for this attempt, 0 on a
   * fresh one — the **seed** for the browser's own save counter (Task 8).
   *
   * Without it a second tab, or a candidate whose site data was cleared,
   * restarts that counter at 1; `upsertResponse` stores only a strictly
   * higher sequence, so every save comes back `superseded`, the queue
   * drops it as "the server holds newer", and the banner reads Saved over
   * answers that were never written.
   */
  clientSeq: number;
  navigation: "free" | "linear" | "per_section";
  /** The furthest flat question index reached. `linear` refuses a target
   *  below it and `per_section` derives the current section from it. */
  maxIndex: number;
  /** Milliseconds left on the whole attempt, from the server's own clock
   *  (`AC-13`: the countdown is a delta from this, never `Date.now()`). */
  remainingMs: number;
  /** The same for the current section, or null when it has no limit. */
  sectionRemainingMs: number | null;
  warnAtMinutes: number[];
  lateSyncGraceSeconds: number;
  allowCalculator: boolean;
  serverNow: number;
  submittedAt: number | null;
  /** Phase 7e Task 3 (`E-R1`): mirrors `apps/api/src/run/attempt.ts`'s own
   *  `AttemptPaper.lockedAt` field for field — `null` until the limit's
   *  `lock` action fires, read by `routes/exam.tsx` to seed
   *  `ProctoringLayer`'s `initialLocked` so a reload mid-lock raises the
   *  overlay again rather than resuming to a paper that looks live. */
  lockedAt: number | null;
  /**
   * Phase 7c Task 2, fixed in the Task 5 follow-up round, mirroring
   * `apps/api/src/run/attempt.ts`'s own `AttemptPaper` field for field:
   * `apps/api`'s doc comment there is the authority. **Both required,
   * from every caller** — `paperFrom` resolves `proctoring` from the
   * attempt's settings for free and sets `violations` to `0`, and
   * `GET /attempt` alone overrides `violations` with its counted value on
   * resume. `ProctoringLayer` (`components/exam/ProctoringLayer.tsx`)
   * mounts on first paint because of this, not only after a reload.
   */
  proctoring: ResolvedProctoring;
  violations: number;
  /** Phase 11 Task 2 (T-24): candidate interface language */
  language?: string;
}
