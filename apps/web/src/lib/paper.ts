// The candidate's paper, as types only — no implementation, nothing
// imported from the API, and nothing that fetches.
//
// **Why this file exists before the code that produces it.** Phase 6 runs
// on two branches: this one owns `apps/api`, `packages` and
// `apps/web/src/lib/run.ts`; the other owns the candidate screens. While
// Task 5 was still unwritten, the screens needed a shape to build against,
// so they declared their own `CandidateQuestion`, `AttemptPaper` and a
// zero-argument `PaperClient.start()` locally in `Runner.tsx` and
// `exam.tsx`. Two definitions of one shape do not conflict at merge —
// structural typing hides an extra field and `Partial` hides a missing
// method — so the drift would have surfaced as an `undefined` at runtime
// inside a live attempt rather than as a failing typecheck.
//
// One file, declared once, cherry-picked by the screens branch and
// imported by `run.ts` when Task 5 lands. A new file conflicts with
// nothing, and from the moment both sides import it a drift is a
// compile error on whichever side drifted.
//
// `start` takes the `registrationToken` `POST .../register` answers with
// (Task 3), which is the one piece of arity the screens could not have
// guessed: a zero-argument `start()` kept compiling against
// `RunClient & Partial<PaperClient>` and would have called the real
// `start(undefined)` on the first live run.

/** One question as a candidate sees it: the prompt and the choices, and
 *  never the key, the explanation or another candidate's anything
 *  (`S-10`). `id` is the `qst_` row id — opaque, stable, and what
 *  `response.question_id` stores. */
export interface CandidateQuestion {
  id: string;
  type: string;
  prompt: string;
  /** Presentation order is pinned per attempt (`T-10`), so this array is
   *  already in the order this candidate must see. */
  options?: { id: string; text: string }[];
  /** A passage or stimulus shared by several questions. */
  group?: { id: string; body: string };
  media?: string[];
  points?: number;
}

/** What one candidate sits, as the server pinned it at `/start`. */
export interface AttemptPaper {
  attemptId: string;
  sections: {
    id: string;
    title: string;
    timeLimitMinutes: number | null;
    questions: CandidateQuestion[];
  }[];
  /** The set label this candidate drew, when the test has sets (`T-09`). */
  setNo?: string;
  /** Answers already saved, so a resume shows what was typed. */
  responses: { questionId: string; value: unknown; clientSeq: number }[];
  navigation: "free" | "linear" | "per_section";
  /** Milliseconds left on the whole attempt, from the server's own clock
   *  (`AC-13`: the countdown is a delta from this, never `Date.now()`). */
  remainingMs: number;
  sectionRemainingMs?: number | null;
  serverNow: number;
  submittedAt?: number | null;
}

/** The half of the client that exists once a candidate has registered.
 *  Task 5 implements it on `RunClient`; until then the screens hold it
 *  as its own interface. */
export interface PaperClient {
  /** Spends the single-use `registrationToken` from `POST .../register`
   *  and mints the attempt. */
  start(registrationToken: string): Promise<AttemptPaper>;
  /** Resumes with the attempt cookie alone, or `null` when there is no
   *  attempt to resume. */
  resume(): Promise<AttemptPaper | null>;
}
