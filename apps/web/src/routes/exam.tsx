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

import { useCallback, useEffect, useState } from "react";
import type { LandingPayload, RunClient } from "../lib/run";
import {
  Runner,
  readMarked,
  writeMarked,
  type AttemptPaper,
  type CandidateQuestion,
} from "../components/exam/Runner";

// --- "Check my device" (C-01) -------------------------------------------

/**
 * The PRD's supported-device rule, as a pure function — no camera, no
 * permission prompt, and no gate. `docs/ROADMAP.md` gives Phase 7 "device
 * and browser gating" and "the camera requirement"; `C-01` puts the
 * *button* on the landing page, which is this phase. So this reports and
 * never blocks: a candidate on an unsupported browser can still press
 * Start today, and will be refused by Phase 7 rather than by a dead button
 * with no explanation.
 */
export interface DeviceFinding {
  label: string;
  ok: boolean;
  detail: string;
}

/** The architecture diagram's "candidate browser: laptop or desktop". */
const MIN_WIDTH = 1024;

/** `P-02`: latest two versions of Chrome, Edge and Firefox on desktop;
 * Safari on macOS. Version numbers are deliberately not checked — a
 * browser lies about them, the check would go stale on its own, and the
 * honest thing to report is the family. */
function browserName(userAgent: string): string | null {
  if (/\bEdg\//.test(userAgent)) return "Edge";
  if (/\bFirefox\//.test(userAgent)) return "Firefox";
  if (/\bChrome\//.test(userAgent)) return "Chrome";
  if (/\bVersion\/[\d.]+ Safari\//.test(userAgent) && /Mac OS X/.test(userAgent)) return "Safari";
  return null;
}

export function deviceReport(): { ok: boolean; findings: DeviceFinding[] } {
  const width = window.innerWidth;
  // `?.` because a jsdom or an embedded webview may not implement it, and a
  // device check that throws is worse than one that reports a failure.
  const finePointer = window.matchMedia?.("(pointer: fine)").matches ?? false;
  const browser = browserName(navigator.userAgent);

  const findings: DeviceFinding[] = [
    {
      label: "Screen",
      ok: width >= MIN_WIDTH,
      detail:
        width >= MIN_WIDTH
          ? `${String(width)} pixels wide.`
          : `${String(width)} pixels wide. This test expects a laptop or desktop, at least ${String(MIN_WIDTH)} pixels.`,
    },
    {
      label: "Pointer",
      ok: finePointer,
      detail: finePointer
        ? "A mouse or trackpad was detected."
        : "No mouse or trackpad was detected. Touch-only devices are not supported.",
    },
    {
      label: "Browser",
      ok: browser !== null,
      detail:
        browser === null
          ? "Not recognised. Use the latest Chrome, Edge or Firefox on a laptop or desktop, or Safari on a Mac."
          : `${browser}, which is supported.`,
    },
  ];

  return { ok: findings.every((finding) => finding.ok), findings };
}

// --- the landing page ----------------------------------------------------

const PROCTORING_LABEL: Readonly<Record<LandingPayload["proctoring"], string>> = {
  off: "Off",
  standard: "Standard",
  strict: "Strict",
};

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

export function ExamLanding({ test, onStart }: { test: LandingPayload; onStart?: () => void }) {
  const [report, setReport] = useState<ReturnType<typeof deviceReport> | null>(null);
  const notice = STATE_NOTICE[test.state];

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
          <dt>Proctoring</dt>
          <dd>{PROCTORING_LABEL[test.proctoring]}</dd>
          <dt>Devices</dt>
          <dd>A laptop or desktop, with a mouse or trackpad.</dd>
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

        <div className="exam-landing-actions">
          <button type="button" onClick={() => setReport(deviceReport())}>
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
            disabled={test.state !== "open"}
            onClick={onStart}
          >
            Start
          </button>
        </div>

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
  | { kind: "attempt"; paper: AttemptPaper };

/**
 * Task 5 widens `RunClient` in `lib/run.ts` with exactly these, answering
 * with the `AttemptPaper` Task 5 defines there. Declared here, structurally
 * and optional, so Task 6's shell is reachable from the app root — the
 * pre-submit checklist's first item — before the API half of the phase
 * lands. The merge deletes this interface and widens the prop to the real
 * `RunClient`.
 */
export interface PaperClient {
  start(): Promise<AttemptPaper>;
}

/** Task 7 renders the real answer blocks into this slot; until then the
 * runner shows the stem it was given and nothing it cannot honour. */
function questionSlot(question: CandidateQuestion) {
  return <p className="exam-question-stem">{question.prompt}</p>;
}

function AttemptView({ paper }: { paper: AttemptPaper }) {
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState(paper.responses);
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => readMarked(paper.attemptId));

  const toggleMark = (questionId: string) => {
    setMarked((previous) => {
      const next = new Set(previous);
      if (!next.delete(questionId)) next.add(questionId);
      writeMarked(paper.attemptId, next);
      return next;
    });
  };

  return (
    <Runner
      paper={{ ...paper, responses }}
      index={index}
      onIndex={setIndex}
      marked={marked}
      onToggleMark={toggleMark}
      // Task 8 owns the save queue; until it lands, clearing an answer is
      // a local fact only, and saying so here is better than a button
      // that visibly does nothing.
      onClear={(questionId) => {
        setResponses((previous) => ({ ...previous, [questionId]: null }));
      }}
      questionSlot={questionSlot}
      // Task 9's clock and Task 8's banner. Empty rather than faked: a
      // placeholder countdown is the one lie this screen must not tell.
      clockSlot={<></>}
      bannerSlot={<></>}
    />
  );
}

export function ExamApp({ client }: { client: RunClient & Partial<PaperClient> }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  const boot = useCallback(async () => {
    try {
      setView({ kind: "landing", test: await client.landing() });
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
  if (view.kind === "attempt") {
    return <AttemptView paper={view.paper} />;
  }
  return (
    <ExamLanding
      test={view.test}
      onStart={() => {
        void (async () => {
          try {
            const paper = await client.start?.();
            if (paper) setView({ kind: "attempt", paper });
          } catch (error) {
            setView({
              kind: "error",
              message: error instanceof Error ? error.message : "This test could not be started.",
            });
          }
        })();
      }}
    />
  );
}
