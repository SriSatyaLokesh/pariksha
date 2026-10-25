// Signal — the screens band (issue 253).
//
// The hero's frame used to carry a code comment saying a product
// screenshot was one "the project cannot honestly take". That stopped
// being true when Phase 8 merged, and this section is the replacement
// argument: five real screens, not a mockup and not a prototype.
//
// Every file under `public/screens/` is written by
// `e2e/measurement/marketing-shots.spec.ts` and
// `e2e/measurement/ui-audit-walkthrough.spec.ts` — Chromium against the
// built app, on a seeded instance, at 1280x800. Nothing here is drawn by
// hand, so a screen that regresses shows up in the next capture rather
// than being quietly preserved by an out-of-date PNG.
//
// `loading="lazy"` on all but the first: this band sits below the fold and
// the five files together are ~0.44 MB. `width`/`height` are the files' own
// pixel dimensions so the grid reserves its space before they arrive.

interface Shot {
  src: string;
  alt: string;
  title: string;
  note: string;
}

const SHOTS: Shot[] = [
  {
    src: "/screens/exam-runner.png",
    alt: "A candidate's paper: a multi-matching grid, a question palette showing which questions are answered, a server-authoritative countdown and a text-size control.",
    title: "The candidate's paper",
    note: "Server clock, offline save queue, a palette that survives a reload, and text size and high contrast the candidate chooses.",
  },
  {
    src: "/screens/test-builder.png",
    alt: "The test builder: version history, three sections with their question and point counts, and a publish checklist reading All clear.",
    title: "The test builder",
    note: "Sections from fixed lists, pools or sets; numbered frozen versions; one publish checklist the server and the screen compute the same way.",
  },
  {
    src: "/screens/bank-browser.png",
    alt: "A question bank: a passage group, and rows of questions with their type, difficulty, tags, points and how many tests use them.",
    title: "Question banks",
    note: "All twelve types with live preview, passage groups, tag and difficulty filters, and import from Pariksha JSON, CSV or Moodle GIFT.",
  },
  {
    src: "/screens/analytics.png",
    alt: "The analytics screen: counts for registered, in progress, submitted, auto-submitted and locked attempts, a score distribution and a summary with mean and median.",
    title: "Results and analytics",
    note: "Score distribution, item analysis, completion and pass rates, and the results and per-answer CSVs beside them.",
  },
  {
    src: "/screens/organiser-home.png",
    alt: "The organiser's home screen: a workspace switcher, a What needs you queue and a list of recently edited tests.",
    title: "Home",
    note: "What needs you, what you touched last, and the free-plan usage meter — per workspace, with roles enforced on the server.",
  },
];

export function SignalScreens() {
  return (
    <section
      className="signal-wrap signal-section"
      id="screens"
      aria-labelledby="screens-heading"
    >
      <p className="signal-eyebrow">The software</p>
      <h2 id="screens-heading">Five screens, captured from the running app.</h2>
      <p className="signal-lede signal-lede--after">
        Not a prototype and not a mockup. Every image below is a headless
        Chromium capture of the built application against a seeded instance,
        re-taken whenever the screens change.
      </p>
      <div className="signal-screens">
        {SHOTS.map((shot, i) => (
          <figure className="signal-shot" key={shot.src}>
            <img
              src={shot.src}
              alt={shot.alt}
              width={1280}
              height={800}
              {...(i === 0 ? {} : { loading: "lazy" as const })}
              decoding="async"
            />
            <figcaption className="signal-fine">
              <strong>{shot.title}</strong> {shot.note}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
