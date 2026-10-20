// `C-09`: the candidate who comes back a week later (#75, P6.11).
//
// The attempt cookie is long gone — it outlives the deadline by an hour,
// not by a week — so the candidate holds two things: the `att_` reference
// printed on their receipt and the address they registered with. Neither
// is a credential, which is why the third thing is a six-digit code sent
// to that address.
//
// **The server is the only gate.** This screen sends two requests and
// renders what the second one answers, through `ResultView` — the same
// component the finish page uses, because a second renderer for a
// released result is a second place for the `show` ladder to drift
// (`AC-16`).
//
// **And it never says which half was wrong.** `POST /result/code` answers
// `202` to an unknown reference, a reference belonging to somebody else
// and a right reference with the wrong address alike; this screen shows
// one sentence over all three. A browser that narrowed that down would
// undo the server's whole point: it would say whether an address sat a
// test.
//
// Nothing new in the stylesheet. The shell, the fields and the two live
// regions are the registration screen's own classes — this is the same
// kind of screen (two short steps and a code), a week later.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { TextField } from "../TextField";
import { ResultView } from "./ResultView";
import { NO_RESULT_NOTE } from "./Receipt";
import type { ReleasedResult, RunClient } from "../../lib/run";

/** The one answer to every outcome of step one. Deliberately in the
 *  conditional — "if that reference and address match" — because a
 *  sentence that said "a code is on its way" would confirm the pair. */
const SENT =
  "If that reference and address match a submitted attempt, a code is on its way to that address. It can be used once, within ten minutes.";

/** Both halves, in one sentence, whichever of them is missing: the same
 *  words the server answers a short request with. */
const INCOMPLETE =
  "Enter the reference from your receipt and the email address you registered with.";

const NO_CODE = "Enter the code we sent you.";

const sentenceOf = (error: unknown): string =>
  error instanceof Error ? error.message : "That result could not be opened.";

export function ResultCode({ client, onBack }: { client: RunClient; onBack: () => void }) {
  const [attemptRef, setAttemptRef] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"ask" | "code" | "shown">("ask");
  const [released, setReleased] = useState<ReleasedResult | null>(null);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Where the keyboard goes when the screen changes under it. A view swap
   *  moves no focus on its own, so without this a candidate who pressed
   *  Continue is left on a button that is no longer there and hears
   *  nothing about what replaced it. */
  const landing = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step !== "ask") landing.current?.focus();
  }, [step]);

  function askForCode(event: FormEvent): void {
    event.preventDefault();
    if (attemptRef.trim() === "" || email.trim() === "") {
      setNotice(INCOMPLETE);
      return;
    }
    setBusy(true);
    setNotice(null);
    client
      .requestResultCode(attemptRef.trim(), email.trim())
      .then(() => {
        setSent(true);
        setStep("code");
      })
      .catch((error: unknown) => {
        // A rate limit or a malformed request — the server's own sentence.
        // Never a verdict on the pair: there is no answer that carries one.
        setNotice(sentenceOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function openResult(event: FormEvent): void {
    event.preventDefault();
    if (code.trim() === "") {
      setNotice(NO_CODE);
      return;
    }
    setBusy(true);
    setNotice(null);
    client
      .verifyResultCode(attemptRef.trim(), email.trim(), code.trim())
      .then((answer) => {
        setReleased(answer);
        setStep("shown");
      })
      .catch((error: unknown) => {
        // 410 `code_expired` covers unknown, lapsed, already spent, and
        // minted against another reference or address — one sentence,
        // because the hash is salted with both and none of them can be
        // told apart from out here.
        setNotice(sentenceOf(error));
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return (
    <main className="exam-register">
      <h1>See your result</h1>

      {/* Both present from first render rather than inserted with their
          content: a live region a screen reader has never seen is one it
          does not announce. */}
      <p className="exam-register-notice" role="alert">
        {notice ?? ""}
      </p>
      <p className="exam-register-status" role="status">
        {sent ? SENT : ""}
      </p>

      <div className="exam-register-panel">
        {step === "ask" && (
          <form className="exam-register-form" onSubmit={askForCode} noValidate>
            <h2>The reference on your receipt, and the address you registered with.</h2>
            <TextField
              id="exam-result-ref"
              label="Attempt reference"
              help="The reference printed on your receipt when you submitted."
              value={attemptRef}
              onChange={setAttemptRef}
              autoComplete="off"
            />
            <TextField
              id="exam-result-email"
              label="Email address"
              help="The address you registered for this test with."
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            {/* WCAG 2.5.3: the accessible name is a superset of the visible
                label — "Email me a code" is what the eye wants, and a
                screen-reader user arriving from a button list hears what
                the code is for. */}
            <button
              type="submit"
              className="exam-register-submit"
              aria-label="Email me a code to see my result"
              disabled={busy}
            >
              Email me a code
            </button>
            <button type="button" className="exam-register-secondary" onClick={onBack}>
              Back to the test
            </button>
          </form>
        )}

        {step === "code" && (
          <form className="exam-register-form" onSubmit={openResult} noValidate>
            <h2 ref={landing} tabIndex={-1}>
              Enter the code we sent you.
            </h2>
            <TextField
              id="exam-result-code"
              label="Code from your email"
              help="Six digits. It can be used once, within ten minutes."
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
            />
            <button
              type="submit"
              className="exam-register-submit"
              aria-label="See my result for this attempt reference"
              disabled={busy}
            >
              See my result
            </button>
            {/* The way back out of a half-finished step: a candidate who
                typed the wrong address has nowhere else to go. */}
            <button
              type="button"
              className="exam-register-secondary"
              onClick={() => {
                setSent(false);
                setNotice(null);
                setCode("");
                setStep("ask");
              }}
            >
              Use a different reference
            </button>
          </form>
        )}

        {step === "shown" && (
          <>
            <h2 ref={landing} tabIndex={-1}>
              Result for {attemptRef.trim()}
            </h2>
            {released === null ? (
              <p className="exam-finish-note">{NO_RESULT_NOTE}</p>
            ) : (
              <ResultView result={released} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
