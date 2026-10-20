// The finish page (#75, `C-08`).
//
// DESIGN.md: "the landing and finish pages carry the full-bleed vermilion
// block with a cream display headline; the moment an attempt starts the
// system inverts to cream and ink". The clock is over, so the canvas comes
// back — and the shell is the landing page's own, reused rather than
// rebuilt, so the two bookends of a candidate's day look like one product.
//
// **The receipt is the whole answer on most tests.** `release.when` is
// `never` by default and a result is an organiser's deliberate choice, so
// the ordinary finish page carries a reference, a time, which attempt this
// was and how much of the paper was answered — and no score at all,
// because there is none to show and a blank "—" where a mark should be is
// a worse thing to hand someone who has just finished an exam.

import type { Receipt as ReceiptPayload, ReleasedResult } from "../../lib/run";
import { ResultView } from "./ResultView";

/** The candidate's own timezone, not the test's: this is the moment *they*
 *  pressed Submit, and they will quote it to their organiser from the
 *  clock on the wall beside them. */
function stamp(at: number): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(at);
  } catch {
    return new Date(at).toISOString();
  }
}

export function Receipt({
  receipt,
  released,
}: {
  receipt: ReceiptPayload;
  released: ReleasedResult | null;
}) {
  return (
    <div className="exam-landing exam-finish">
      <header className="exam-landing-hero">
        <h1>Submitted</h1>
      </header>

      <main className="exam-landing-body">
        <p className="exam-landing-lede">
          Your answers are saved. Keep the reference below — it is what your organiser needs if you
          ever have to ask about this attempt.
        </p>

        <dl className="exam-facts">
          <dt>Reference</dt>
          <dd>
            {/* Selectable, monospaced and on its own line: it will be
                copied into an email or read aloud down a phone. */}
            <code className="exam-receipt-ref">{receipt.attemptId}</code>
          </dd>
          <dt>Submitted</dt>
          <dd>{stamp(receipt.submittedAt)}</dd>
          <dt>Attempt</dt>
          <dd>
            Attempt {String(receipt.attemptNo)} of {String(receipt.attemptsAllowed)}
          </dd>
          <dt>Answered</dt>
          <dd>
            {String(receipt.answered)} of {String(receipt.total)}
            {receipt.unanswered > 0 && ` · ${String(receipt.unanswered)} left unanswered`}
          </dd>
        </dl>

        {released && <ResultView result={released} />}

        {released === null && (
          <p className="exam-finish-note">
            Results for this test are not shown here. Your organiser will tell you when and where to
            expect them.
          </p>
        )}
      </main>
    </div>
  );
}
