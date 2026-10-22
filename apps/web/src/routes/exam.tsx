// The candidate's screens. Task 1 builds the first of them: the landing
// page (C-01).
//
// Routing, without a router — the same arrangement `routes/organiser.tsx`
// documents for the organiser app, and for the same reasons: no router
// library is installed, and which screen a candidate sees is a property of
// API answers, not of the URL. The URL carries exactly one thing, the slug
// pair `T-02` fixes, and `exam-main.tsx` reads it once.
//
// Nothing here imports from `src/lib/api.ts` or any organiser screen:
// `bundle.test.ts` fails the build if it does, because the candidate's
// bundle budget is 300 KB gzipped (PRD non-functional table) and an
// exam-taker under a clock downloads only what they are about to use.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROCTORING_DEFAULTS, type ResolvedProctoring } from "@pariksha/core";
import type {
  AttemptPaper,
  CandidateQuestion,
  LandingPayload,
  Receipt as ReceiptPayload,
  ReleasedResult,
  RunClient,
} from "../lib/run";
import {
  Runner,
  firstOfNextSection,
  flatQuestions,
  lockedIndices,
  readMarked,
  writeMarked,
} from "../components/exam/Runner";
import { AnswerInput } from "../components/exam/answer";
import { SaveBanner } from "../components/exam/SaveBanner";
import { ProctoringErrorBoundary, ProctoringLayer } from "../components/exam/ProctoringLayer";
import { createSaveQueue, type SaveState } from "../lib/queue";
import { Clock, anchorFrom, reanchor, type ClockAnchor } from "../components/exam/Clock";
import { ExamRegistration, tokenFromUrl } from "../components/exam/Registration";
import { SubmitDialog } from "../components/exam/SubmitDialog";
import { Receipt } from "../components/exam/Receipt";
import { ResultCode } from "../components/exam/ResultCode";

// --- "Check my device" (C-01) -------------------------------------------

/**
 * The PRD's supported-device rule, as a pure function — no camera, no
 * permission prompt. `docs/ROADMAP.md` gives Phase 7 "device and browser
 * gating"; this is that gate (`Q9b`, extending the function 7a's `C-01`
 * shipped rather than joining it with a second one). `refused` is the one
 * thing that blocks Start — `desktop_only` is on *and* this device fails
 * it (`Q1a`: a supported configuration a phone may take when it is off, so
 * nothing here refuses on its account). Every finding is still reported
 * honestly regardless of `desktopOnly` — R3/`Q9c` — a 390px screen under
 * `desktop_only: false` shows `ok: false` and is still admitted.
 */
export interface DeviceFinding {
  label: string;
  ok: boolean;
  detail: string;
}

/** The architecture diagram's "candidate browser: laptop or desktop". */
const MIN_WIDTH = 1024;

/** `P-02`: latest two versions of Chrome, Edge and Firefox on desktop;
 * Safari on macOS and iOS. Version numbers are deliberately not checked —
 * a browser lies about them, the check would go stale on its own, and the
 * honest thing to report is the family. Safari's own two markers
 * (`Version/`, `Mac OS X`) are checked for presence rather than adjacency:
 * a real phone's UA reads "...Version/17.0 Mobile/15E148 Safari/604.1...",
 * which an adjacent-only pattern missed. */
function browserName(userAgent: string): string | null {
  if (/\bEdg\//.test(userAgent)) return "Edge";
  if (/\bFirefox\//.test(userAgent)) return "Firefox";
  if (/\bChrome\//.test(userAgent)) return "Chrome";
  if (/\bSafari\//.test(userAgent) && /Version\/[\d.]+/.test(userAgent) && /Mac OS X/.test(userAgent)) {
    return "Safari";
  }
  return null;
}

export function deviceReport(resolved: ResolvedProctoring): {
  ok: boolean;
  /** `desktop_only` is on AND this device fails it — the only thing that
   *  blocks a start (R3). Never derived from `ok`: a finding may be
   *  `ok: false` (an honest report) without refusing anything. */
  refused: boolean;
  findings: DeviceFinding[];
} {
  const width = window.innerWidth;
  // `?.` because a jsdom or an embedded webview may not implement it, and a
  // device check that throws is worse than one that reports a failure.
  const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? false;
  const browser = browserName(navigator.userAgent);

  const screenOk = width >= MIN_WIDTH;
  const pointerOk = finePointer;
  const browserOk = browser !== null;

  const findings: DeviceFinding[] = [
    {
      label: "Screen",
      ok: screenOk,
      detail: screenOk
        ? `${String(width)} pixels wide.`
        : resolved.desktopOnly
          ? `${String(width)} pixels wide. This test expects a laptop or desktop, at least ${String(MIN_WIDTH)} pixels.`
          : `${String(width)} pixels wide.`,
    },
    {
      label: "Pointer",
      ok: pointerOk,
      detail: pointerOk
        ? "A mouse or trackpad was detected."
        : resolved.desktopOnly
          ? "No mouse or trackpad was detected. Touch-only devices are not supported."
          : "No mouse or trackpad was detected.",
    },
    {
      // `Q9c`: no device class here, matching `proctoringRequirements`'s
      // own browser line — Chrome, Edge and Firefox are not desktop-only
      // products and Safari runs on iOS too, so naming one is false
      // whenever `desktop_only` is off.
      label: "Browser",
      ok: browserOk,
      detail: browserOk
        ? `${String(browser)}, which is supported.`
        : "Not recognised. Use a fully updated Chrome, Edge, Firefox or Safari.",
    },
  ];

  return {
    ok: findings.every((finding) => finding.ok),
    refused: resolved.desktopOnly && (!screenOk || !pointerOk),
    findings,
  };
}

// --- the landing page ----------------------------------------------------

/** What the candidate is told about a window they are outside of. Every
 * state carries its own sentence: "the button is greyed out" is not a
 * reason, and a candidate cannot come back tomorrow to ask. */
const STATE_NOTICE: Readonly<Record<LandingPayload["state"], string | null>> = {
  draft: "This test is not open.",
  scheduled: "This test has not opened yet. Come back when the window below begins.",
  open: null,
  closed: "This test has closed. You can no longer start it.",
  archived: "This test is not open.",
};

function formatInstant(at: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(at);
  } catch {
    // An unknown IANA zone is an organiser's typo, not a reason to show a
    // candidate a blank window.
    return new Date(at).toISOString();
  }
}

export function ExamLanding({
  test,
  onStart,
  onResult,
}: {
  test: LandingPayload;
  onStart?: () => void;
  /** `C-09`'s way in. The landing page is the only address a candidate
   *  keeps — the one on their invitation — so the return visit a week
   *  later starts here, on a test that has usually closed by then. */
  onResult?: () => void;
}) {
  const [report, setReport] = useState<ReturnType<typeof deviceReport> | null>(null);
  const notice = STATE_NOTICE[test.state];

  // `Q1b`: the landing payload ships the resolved REQUIREMENT SENTENCES,
  // never the raw resolved flags — `profile` is carried for display only
  // and no reader may branch on it (`Q1`). Whether this test is
  // desktop-only is read off the one line `proctoringRequirements` already
  // emits for it (rendered in the Requirements section below), not
  // re-derived from `profile`.
  const desktopOnly = test.proctoring.requirements.some((line) => /\b(desktop|laptop)\b/i.test(line));
  // `deviceReport` only reads `resolved.desktopOnly` from here on — the
  // landing payload carries no more of `ResolvedProctoring` than that one
  // boolean (`Q1b` again), so the rest of this object is `off`'s inert
  // defaults, never consulted.
  const resolved: ResolvedProctoring = { ...PROCTORING_DEFAULTS.off, desktopOnly };
  const blocked = report?.refused ?? false;

  return (
    <div className="exam-landing">
      <header className="exam-landing-hero card-voltage">
        {/* `branding.logo` is a media key, and the only route that can
            serve one to a candidate is Task 7's attempt-scoped media route
            — `GET /workspaces/:id/media/:key` keeps `banks.edit` (standing
            decision 4). The key rides in the payload from today so that
            task is a render, not a round trip; an <img> pointed at a route
            that does not exist yet would be a broken image on the first
            screen a candidate ever sees. */}
        <h1>{test.name}</h1>
      </header>

      <main className="exam-landing-body">
        {/* On cream, not on the voltage field above it. Cream on voltage is
            3.86:1 — legal for the 56px headline and illegal for anything at
            reading size, which is precisely DESIGN.md's "one saturated
            field and one sentence". */}
        {test.description && <p className="exam-landing-lede">{test.description}</p>}

        {notice && (
          <p className="exam-notice" data-state={test.state}>
            {notice}
          </p>
        )}

        {test.branding.startMessage && (
          <p className="exam-landing-message">{test.branding.startMessage}</p>
        )}

        <dl className="exam-facts">
          <dt>Duration</dt>
          <dd>{test.durationMinutes} minutes</dd>
          <dt>Questions</dt>
          <dd>{test.questionCount} questions</dd>
          {test.opensAt !== null && (
            <>
              <dt>Opens</dt>
              <dd>{formatInstant(test.opensAt, test.timezone)}</dd>
            </>
          )}
          {test.closesAt !== null && (
            <>
              <dt>Closes</dt>
              <dd>{formatInstant(test.closesAt, test.timezone)}</dd>
            </>
          )}
        </dl>

        <section className="exam-landing-sections">
          <h2 id="exam-sections-heading">Sections</h2>
          <ul aria-labelledby="exam-sections-heading">
            {test.sections.map((section) => (
              <li key={section.id}>
                <span className="exam-section-title">{section.title}</span>
                <span className="exam-section-count">{section.questionCount} questions</span>
                {section.timeLimitMinutes !== null && (
                  <span className="exam-section-limit">{section.timeLimitMinutes} minutes</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {test.rules && (
          <section className="exam-landing-rules">
            <h2>Rules</h2>
            <p>{test.rules}</p>
          </section>
        )}

        {/* `Q1b`: the same sentences the runtime will enforce, so a
            candidate who will be denied for having no camera learns it
            before the timer starts rather than after. Empty for Off —
            and for any test with every control turned off — so no
            heading appears over nothing to list. */}
        {test.proctoring.requirements.length > 0 && (
          <section className="exam-landing-requirements">
            <h2 id="exam-requirements-heading">Requirements</h2>
            {/* `list-style: none` (DESIGN.md) drops list semantics in
                WebKit and takes the accessible name with it — this list
                only; the Sections list and the device-report list share
                the same CSS and are out of scope here. */}
            <ul role="list" aria-labelledby="exam-requirements-heading">
              {test.proctoring.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="exam-landing-actions">
          <button type="button" onClick={() => setReport(deviceReport(resolved))}>
            Check my device
          </button>
          {/* WCAG 2.5.3: the accessible name is a SUPERSET of the visible
              label, never a replacement for it. "Start" alone is what the
              eye wants on the one button that matters; a screen-reader
              user who arrives at it out of context — from a button list,
              say — needs to hear what is starting. */}
          <button
            type="button"
            className="exam-start"
            aria-label={`Start ${test.name}`}
            aria-describedby="exam-device-blocked"
            disabled={test.state !== "open" || blocked}
            onClick={onStart}
          >
            Start
          </button>
          {/* WCAG 2.5.3 again: the name is a superset of the label, and
              the label is what a candidate who has already sat this test
              is looking for. */}
          {onResult && (
            <button
              type="button"
              className="exam-register-secondary"
              aria-label={`See my result for ${test.name}`}
              onClick={onResult}
            >
              See my result
            </button>
          )}
        </div>

        {/* A disabled control is not a reason — a candidate who cannot tell
            `aria-disabled` from a slow network cannot do anything about
            either. `aria-describedby` on Start ties this to the button's
            accessible description, always, not only once refused — the
            element itself is present from first render exactly like its
            sibling below, and only its *contents* vary with `blocked`, for
            the same reason that one's comment gives: a live region a
            screen reader has never seen is a live region it does not
            announce. */}
        <p id="exam-device-blocked" className="exam-device-blocked" role="status">
          {blocked && "This test needs a laptop or desktop computer."}
        </p>

        {/* Present from first render rather than inserted with its content:
            a live region a screen reader has never seen is a live region it
            does not announce. */}
        <div role="status" className="exam-device-report">
          {report && (
            <ul>
              {report.findings.map((finding) => (
                <li key={finding.label} data-ok={finding.ok}>
                  <span className="exam-finding-label">{finding.label}</span>
                  {/* The non-colour carrier: DESIGN.md's "colour is never
                      the only carrier here". */}
                  <span className="exam-finding-mark" aria-hidden="true">
                    {finding.ok ? "OK" : "!"}
                  </span>
                  <span className="exam-finding-detail">{finding.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {test.branding.footerText && (
        <footer className="exam-landing-footer">{test.branding.footerText}</footer>
      )}
    </div>
  );
}

// --- the app root --------------------------------------------------------

type View =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "landing"; test: LandingPayload }
  | { kind: "register"; test: LandingPayload }
  | { kind: "attempt"; paper: AttemptPaper }
  /** `C-09`: no cookie, no attempt, just a reference and an address. */
  | { kind: "result-code"; test: LandingPayload }
  | { kind: "finished"; receipt: ReceiptPayload; released: ReleasedResult | null };

/**
 * Where the registration step hands `/start` its single-use token.
 *
 * `POST .../register` answers `{ registrationToken }`; `POST .../start`
 * spends it and mints the attempt. `ExamRegistration` writes it and Start
 * reads it, so a Start pressed without one is not an error any more: it is
 * a candidate who has not registered yet, and the registration screen is
 * where they go.
 *
 * `sessionStorage`, not memory alone: a reload between registering and
 * pressing Start must not cost the candidate their place, and the token
 * has no value after this tab closes.
 */
export const REGISTRATION_TOKEN_KEY = "pariksha.registrationToken";

export function readRegistrationToken(): string | null {
  try {
    return sessionStorage.getItem(REGISTRATION_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** The write half. A browser with storage disabled still starts its attempt
 *  — the token is handed straight to `/start` in the same tick — it just
 *  does not survive a reload, which is the one thing this key buys. */
export function writeRegistrationToken(token: string): void {
  try {
    sessionStorage.setItem(REGISTRATION_TOKEN_KEY, token);
  } catch {
    /* Private mode, or storage refused. Not worth a sentence to a
       candidate: nothing they can do about it, and nothing breaks now. */
  }
}

function AttemptView({
  paper,
  client,
  onFinished,
}: {
  paper: AttemptPaper;
  client: RunClient;
  /** Where the finish page comes from. The submission is owned here, not
   *  in `Runner`, because it is the thing that ends the attempt and
   *  `Runner` is a layout. */
  onFinished: (answer: { receipt: ReceiptPayload; released: ReleasedResult | null }) => void;
}) {
  /**
   * The first question this candidate may still write to.
   *
   * Zero on a fresh attempt and on any `free` paper, which is every
   * candidate's first second in the runner. On a **resumed** `linear` or
   * `per_section` paper it is not: question one is behind the lock, and
   * opening there would show a dead screen — an input whose every save
   * the server refuses — on the one page a candidate cannot leave.
   */
  const [index, setIndex] = useState(() => {
    const locked = lockedIndices(paper);
    let at = 0;
    while (locked.has(at)) at += 1;
    return at;
  });
  /**
   * How far the server says this candidate has got — **stored, never
   * derived** (standing decision 6).
   *
   * `paper.maxIndex` is the reading the resume was handed and it is frozen
   * there for the life of the attempt: without this the rail's lock, the
   * opening index and the Previous rule only ever reflect the resume, so
   * on a fresh `linear` attempt nothing ever locked — the candidate walked
   * to question 5, the rail still showed 1-4 open, Previous was still
   * there, and the save behind it took a 403.
   *
   * Every save answers the committed value, so this is assignment and not
   * arithmetic. A browser that raised it itself would be a second
   * implementation of a server rule and a wrong one: the progress bump
   * rides the same statement under `max_index < ?`, so the server advances
   * on a `superseded` save too.
   */
  const [maxIndex, setMaxIndex] = useState(paper.maxIndex);
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => readMarked(paper.attemptId));
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  /**
   * `AC-13`'s anchor, and **Review Focus 4**.
   *
   * The server's own reading of how much time is left, stamped with the
   * `performance.now()` at which it arrived. Nothing here ever stores an
   * absolute deadline, so there is no expression anywhere that a change
   * to the system clock could move — see `components/exam/Clock.tsx`.
   */
  const [anchor, setAnchor] = useState<ClockAnchor>(() =>
    anchorFrom(paper.remainingMs, paper.sectionRemainingMs),
  );

  /**
   * One queue for this attempt (Task 8).
   *
   * **Seeded from `paper.clientSeq`**, the highest sequence the server
   * holds. A second tab, or a candidate whose site data was cleared,
   * would otherwise restart the counter at 1 — every save then comes
   * back `superseded`, the queue drops it as "the server holds newer",
   * and the banner reads Saved over answers nobody stored.
   *
   * Never closed from here. `close()` exists for the tests, which make
   * dozens of queues; this one lives exactly as long as the attempt
   * view, and calling it in an effect's cleanup would kill the queue on
   * mount under `StrictMode`, which is how this page really runs.
   */
  const queue = useMemo(
    () =>
      createSaveQueue(
        paper.attemptId,
        async (save) => {
          const answer = await client.putAnswer(save);
          // Every save re-anchors the countdown, which is why the route
          // carries `remainingMs` at all: a tab that slept for an hour is
          // corrected by the next keystroke rather than by a reload. It
          // is **absent on a refusal** (Task 8's deviation 4) — the
          // server answered no reading, and re-anchoring to an invented
          // zero would be worse than not re-anchoring.
          if (answer.remainingMs !== undefined) {
            const reading = answer.remainingMs;
            const section = answer.sectionRemainingMs;
            setAnchor((previous) => reanchor(previous, reading, section));
          }
          // The server's own `max_index` after this write, which is what
          // locks the rail behind a candidate who has moved on.
          if (answer.maxIndex !== undefined) setMaxIndex(answer.maxIndex);
          return answer;
        },
        undefined,
        paper.clientSeq,
      ),
    [paper.attemptId, paper.clientSeq, client],
  );

  /**
   * **What the candidate sees is the server's rows with the queue's own
   * unsent ones laid over them** — `AC-14`'s "closing and reopening the
   * browser resumes with the same answers".
   *
   * A save that never reached the server is still the newest thing the
   * candidate typed, and it survived the reload in `localStorage`.
   * Seeding from `paper.responses` alone showed a resumed candidate an
   * empty input and an "unanswered" palette square over an answer they
   * had written, which reads as lost work even in the moment before the
   * queue drains it.
   */
  const [responses, setResponses] = useState<AttemptPaper["responses"]>(() => {
    const seeded = { ...paper.responses };
    for (const save of queue.pending()) seeded[save.questionId] = save.value;
    return seeded;
  });

  /**
   * Subscribe, then **drain**.
   *
   * Restoring the queue from `localStorage` queues nothing: `enqueue`,
   * the `online` listener and the `visibilitychange` listener are the
   * only things that start a pass, and on a fresh load with the network
   * already up none of them fires — `online` needs a transition and
   * `visibilitychange` needs visibility to change. Without this line a
   * candidate who went offline, typed, and then lost the tab reopens to
   * answers that sit in storage and are never sent, which is exactly the
   * "zero lost answers" promise this phase is gated on.
   */
  useEffect(() => {
    const off = queue.subscribe(setSaveState);
    void queue.drain();
    return off;
  }, [queue]);

  /** The answer blocks for all twelve types (Task 7), each change both
   * shown at once and queued for the server. The local state is not the
   * record: the queue is, and what it holds survives a reload. */
  const save = (questionId: string, next: AttemptPaper["responses"][string]): void => {
    setResponses((previous) => ({ ...previous, [questionId]: next }));
    queue.enqueue(questionId, next);
  };

  const questionSlot = (question: CandidateQuestion) => (
    <AnswerInput
      question={question}
      value={responses[question.id] ?? null}
      // Never disabled while a save is in flight. Taking the keyboard
      // away from a candidate because a request is open loses the
      // keystrokes they make in the meantime, which is the exact failure
      // this task exists to prevent.
      disabled={false}
      onChange={(next) => {
        save(question.id, next);
      }}
    />
  );

  const toggleMark = (questionId: string) => {
    setMarked((previous) => {
      const next = new Set(previous);
      if (!next.delete(questionId)) next.add(questionId);
      writeMarked(paper.attemptId, next);
      return next;
    });
  };

  /** Open, in flight, or neither. One piece of state rather than two
   *  booleans: "confirming and submitting at the same time" is not a
   *  state this screen has, and two booleans would let it exist. */
  const [submitting, setSubmitting] = useState<"idle" | "confirming" | "sending">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * **Drain, then submit.** The queue may be holding answers the candidate
   * made in time; submitting first would close the attempt and every one
   * of them would come back a 409. Being a moment late costs nothing and
   * being early costs answers (`AC-14`).
   *
   * A refusal leaves the dialog open with a sentence in it, because a
   * candidate whose submission failed must be able to press again — the
   * server's own idempotence is what makes pressing again safe.
   *
   * **Unless they never opened it.** `auto` is the clock's own submission
   * at zero: a refusal there must leave the sentence and nothing else,
   * because re-opening "Submit this test?" asks a candidate whose time has
   * run out to confirm something they did not do.
   *
   * **One at a time.** Both buttons go `disabled` the moment `submitting`
   * becomes `"sending"`, but the clock is not a button: a candidate who
   * presses Submit and Finish in the last second of the attempt is inside
   * `queue.drain()` — an unsent answer, a retry, an offline window — when
   * `onZero` fires, and a second submission starts underneath the first.
   * The server is idempotent, so no answer is lost; the browser is not —
   * `onFinished` swaps the view twice, and whichever call loses the race
   * paints "could not be submitted" over a receipt that arrived. A ref,
   * not `submitting`: this callback closes over the render that made it,
   * so the state it can read is always the stale one.
   */
  const finishing = useRef(false);
  const finish = useCallback(async (auto = false) => {
    if (finishing.current) return;
    finishing.current = true;
    setSubmitting("sending");
    setSubmitError(null);
    try {
      await queue.drain();
      onFinished(await client.submit());
    } catch (error) {
      // Only on the way out: a candidate whose submission was refused must
      // be able to press again, which is safe because `finishAttempt`
      // writes only `WHERE submitted_at IS NULL`. The success path never
      // clears it — the view is gone.
      finishing.current = false;
      setSubmitting(auto ? "idle" : "confirming");
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Your test could not be submitted. Check your connection and try again.",
      );
    }
  }, [client, onFinished, queue]);

  return (
    <>
      {/* `Q2c`/`AG4`: a sibling of `Runner`, never its parent — the
          boundary below catches whatever the layer's own work throws
          without taking the paper's own subtree down with it.
          `paper.proctoring` is now carried by **every** response that
          builds a paper, `/start`'s mint included: it is a pure function
          of the attempt's settings, so resolving it costs no read, and
          omitting it from the mint left a candidate unproctored until
          their first reload. The guard below stays because an older
          cached payload can still arrive without it. */}
      {paper.proctoring && (
        <ProctoringErrorBoundary>
          <ProctoringLayer
            attemptId={paper.attemptId}
            proctoring={paper.proctoring}
            initialViolations={paper.violations ?? 0}
          />
        </ProctoringErrorBoundary>
      )}
      <Runner
        paper={{ ...paper, responses, maxIndex }}
        index={index}
        onIndex={setIndex}
        marked={marked}
        onToggleMark={toggleMark}
        // A cleared answer is a **save of null**, not a local forget: the
        // server holds the old value until something replaces it, and an
        // absent row and a null row mean different things to Phase 8.
        onClear={(questionId) => {
          save(questionId, null);
        }}
        questionSlot={questionSlot}
        clockSlot={
          <Clock
            anchor={anchor}
            warnAtMinutes={paper.warnAtMinutes}
            onZero={() => {
              // **Drain before submitting.** The queue may be holding
              // answers the candidate made in time; submitting first would
              // close the attempt and every one of them would come back a
              // 409. `C-07`'s auto-submit is whichever of this and the
              // server's next request happens first, so being a moment late
              // here costs nothing and being early costs answers.
              //
              // Task 11: the drain, then the submission the drain was for.
              // Whichever of this and the server's own materialisation gets
              // there first wins; the other is a no-op, because
              // `finishAttempt` writes only `WHERE submitted_at IS NULL`.
              void finish(true);
            }}
            onSectionZero={() => {
              // `C-07` on the client: when the section's clock runs out the
              // candidate is moved to the first question of the next one.
              // The server's half is the refusal that names it.
              const next = firstOfNextSection(paper, index);
              if (next !== null) setIndex(next);
            }}
          />
        }
        bannerSlot={<SaveBanner state={saveState} />}
        submitSlot={
          <>
            <button
              type="button"
              className="exam-submit"
              // WCAG 2.5.3: the accessible name is a superset of the
              // visible label. "Submit" is what the eye wants; a
              // screen-reader user arriving from a button list needs to
              // hear what it ends.
              aria-label="Submit test and finish"
              disabled={submitting === "sending"}
              onClick={() => {
                setSubmitting("confirming");
              }}
            >
              Submit test
            </button>
            {submitting !== "idle" && (
              <SubmitDialog
                unanswered={
                  flatQuestions(paper).filter((question) => (responses[question.id] ?? null) === null)
                    .length
                }
                marked={marked.size}
                total={flatQuestions(paper).length}
                pending={submitting === "sending"}
                onConfirm={() => {
                  void finish();
                }}
                onCancel={() => {
                  setSubmitting("idle");
                }}
              />
            )}
            {submitError !== null && (
              <p className="exam-submit-error" role="alert">
                {submitError}
              </p>
            )}
          </>
        }
      />
    </>
  );
}

export function ExamApp({ client }: { client: RunClient }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  /**
   * Spend the registration token. Both callers pass one they have just
   * read or just been handed, so there is no branch here for not having
   * one — `/start` is the only thing that mints an attempt.
   */
  const startWith = useCallback(
    async (registrationToken: string) => {
      setView({ kind: "loading" });
      try {
        setView({ kind: "attempt", paper: await client.start(registrationToken) });
      } catch (error) {
        setView({
          kind: "error",
          message: error instanceof Error ? error.message : "This test could not be started.",
        });
      }
    },
    [client],
  );

  const boot = useCallback(async () => {
    try {
      // `C-06`: closing the browser and reopening it resumes the same
      // attempt — and `AC-14` needs it, because the queue that survived
      // the reload in `localStorage` only drains once something mounts
      // it. `resume()` answers `null` on an ordinary first visit and
      // costs the server nothing at all when the browser carries no
      // attempt cookie (measured: 0 subrequests).
      const resumed = await client.resume();
      if (resumed) {
        /**
         * **A submitted attempt resumes to the finish page, never to the
         * paper.** `GET /run/attempt` serves a submitted attempt's paper
         * in full — the cookie outlives the deadline by an hour so the
         * receipt can be re-read — so without this a reload of the finish
         * page put the candidate back on a live-looking paper: a
         * counting-down chip, Next and Clear, and every save a 409 as the
         * restored queue replayed into refusals.
         *
         * `submit()` rather than `result()`: the finish page is a receipt
         * *and* a result, and `attemptNo`, `attemptsAllowed` and the
         * answered counts are on the receipt alone. The server's
         * submission is idempotent — `finishAttempt` writes only `WHERE
         * submitted_at IS NULL` — so this re-reads the first submission's
         * receipt rather than scoring again, and writes no second audit
         * row.
         */
        if (resumed.submittedAt !== null) {
          const { receipt, released } = await client.submit();
          setView({ kind: "finished", receipt, released });
          return;
        }
        setView({ kind: "attempt", paper: resumed });
        return;
      }
      const test = await client.landing();
      // The SSO callback redirects back here carrying its entry token, so
      // a candidate who has just signed in is already past the gate and
      // should not have to press Start to be told so.
      setView({ kind: tokenFromUrl("entry") === null ? "landing" : "register", test });
    } catch (error) {
      setView({
        kind: "error",
        message: error instanceof Error ? error.message : "This test is not available.",
      });
    }
  }, [client]);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (view.kind === "loading") {
    return (
      <p className="exam-loading" role="status">
        Loading…
      </p>
    );
  }
  if (view.kind === "error") {
    return (
      <main className="exam-error">
        <h1>This test is not available</h1>
        <p role="alert">{view.message}</p>
      </main>
    );
  }
  if (view.kind === "finished") {
    return <Receipt receipt={view.receipt} released={view.released} />;
  }
  if (view.kind === "attempt") {
    return (
      <AttemptView
        paper={view.paper}
        client={client}
        onFinished={({ receipt, released }) => {
          setView({ kind: "finished", receipt, released });
        }}
      />
    );
  }
  if (view.kind === "result-code") {
    return (
      <ResultCode
        client={client}
        onBack={() => {
          setView({ kind: "landing", test: view.test });
        }}
      />
    );
  }
  if (view.kind === "register") {
    return (
      <ExamRegistration
        test={view.test}
        client={client}
        entry={tokenFromUrl("entry")}
        onRegistered={(registrationToken) => {
          // Stored first, started second: a reload between the two must
          // not cost the candidate the token they just paid a proof of
          // work for.
          writeRegistrationToken(registrationToken);
          void startWith(registrationToken);
        }}
      />
    );
  }
  return (
    <ExamLanding
      test={view.test}
      onResult={() => {
        setView({ kind: "result-code", test: view.test });
      }}
      onStart={() => {
        // The registration screen is where a candidate without a token
        // goes — C-03's whole flow hangs off this branch.
        const registrationToken = readRegistrationToken();
        if (registrationToken === null) {
          setView({ kind: "register", test: view.test });
          return;
        }
        void startWith(registrationToken);
      }}
    />
  );
}
