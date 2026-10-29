import type { ReactNode } from "react";

// `D18`: sign-in and the first-run wizard are a SPLIT screen — the Signal
// field quieted to one masked radial glow plus a grid, carrying the wordmark,
// a headline and three checkable facts, with the form on the right. Below
// 900px the brand half drops and the form stands alone (`admin.css`).
//
// These are the two screens with no shell around them. `organiser.tsx:188-191`
// keeps `loading`, `error`, `signin` and `setup` outside `OrganiserShell`
// because a sidebar offering Banks and Tests to a visitor who has not signed
// in is a nav with nothing behind it. The first two are a sentence on a page
// and stay on `.organiser`; these two are the arrival, and they are this.
//
// ONE COMPONENT RATHER THAN THE SAME MARKUP IN BOTH ROUTES. The wordmark and
// the three facts are facts about the instance, not about the moment, so they
// are identical on the two screens and there is nothing to keep in step. The
// headline is the moment and is the one prop.
//
// NOTHING HERE REACHES INTO `signal.css` (`D10`). 6.5e Task 7 judged all
// twenty-one of its constructs and moved none: every one is rendered by
// `sections/signal/` today, so importing one would drag the landing palette
// into the organiser bundle past `theme.css`, which that file's own header
// calls "the whole mechanism". The brand half is rebuilt in `admin.css` out
// of `theme.css`'s semantic names, `--glow` and `--wash` among them.
//
// `D20a` — THE GLOW IS ALLOWED TO DISAPPEAR, and that is why the content
// below is what it is. `theme.css:53-57` rules that the field is a
// dark-ground device: `--glow` resolves to 0.18 alpha on dark and 0.03 on
// light, because an accent bloom on a light ground is the same
// illegal-adjacent move `D1` refused. So the wordmark, the headline and the
// three facts carry this half on BOTH grounds, and the glow is ornament on
// one of them.
//
// (That paragraph is worded around one word on purpose: `hasIllegalColorLiteral`
// in `scripts/tokens.mjs` strips `/* */` and `<!-- -->` before it scans and
// does NOT strip `//`, so a colour keyword in prose in a line comment reads
// as a colour literal and reddens `test/no-hex-colors.test.ts`. That
// omission is deliberate — stripping `//` would also eat `https://` inside a
// quoted URL — and its own docstring now says so, which it did not when this
// was met.)

/** The three facts. Checkable, in `D18`'s sense: each names a mechanism a
 *  reader can go and verify — a licence, a database, a network panel — rather
 *  than making a claim about how good the software is. Every one of them is
 *  already stated on the public landing page (`sections/signal/`), so this is
 *  the same promise the organiser arrives having been made. */
const FACTS = [
  {
    term: "AGPL-3.0",
    rest: "the scoring code is public and copyleft ensures improvements remain open.",
  },
  {
    term: "Your database",
    rest: "questions, candidates and results stay in the store this instance points at. No Pariksha server sits in the path.",
  },
  {
    term: "No telemetry",
    rest: "no tracker and no third-party script — the fonts are served from this origin too.",
  },
] as const;

export function ScreenSplit({
  headline,
  children,
}: {
  /** What this moment is, in one line. Not a heading: the screen's one <h1>
   *  is the form's, and a second heading above it would start the document
   *  outline on the brand panel instead of on the thing being done. */
  headline: string;
  children: ReactNode;
}) {
  return (
    <main id="main-content" className="screen">
      <div className="screen__brand">
        <p className="screen__mark">Pariksha</p>
        <p className="screen__headline">{headline}</p>
        {/* An <ol>, so the list carries its own numbering and assistive
            technology is told there are three. The visible numerals are
            decoration OF that and are out of the accessibility tree, which is
            what keeps "01" from being announced on top of "1". */}
        <ol className="screen__facts">
          {FACTS.map((fact, index) => (
            <li key={fact.term}>
              <span className="screen__fact-n" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <b>{fact.term}</b> — {fact.rest}
            </li>
          ))}
        </ol>
      </div>
      <div className="screen__form">{children}</div>
    </main>
  );
}
