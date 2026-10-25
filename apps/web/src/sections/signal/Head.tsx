// Signal — navigation, hero and the question-type rail.
// Implements `.planning/landing/signal-reference.html`. Every claim here
// traces to `.planning/landing/content-inventory.md`.
//
// The hero's frame was written when a product screenshot was one "the
// project cannot honestly take" — the application did not exist. It does
// now (issue 253: real screens live in the band below, from
// `public/screens/`), and the frame STAYS anyway: it is the one thing a
// screenshot cannot show, a pool drawing a different paper for every
// candidate, redrawn in front of the reader. The markup below is the
// complete, readable state with JavaScript off; the island at
// src/island/exam-demo.ts upgrades it in place by its data- attributes
// and must never rewrite it from scratch.

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const WORKED_EXAMPLE = `${REPO}/tree/main/examples/reasoning-aptitude`;

const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Screens", href: "#screens" },
  { label: "Integrity", href: "#integrity" },
  { label: "Compare", href: "#compare" },
  { label: "Status", href: "#status" },
  { label: "Docs", href: `${REPO}/tree/main/docs` },
] as const;

export function SignalNav() {
  return (
    <header className="signal-nav">
      <div className="signal-nav__inner">
        <p className="signal-wordmark">
          <span className="signal-wordmark__name">Pariksha</span>
          <span className="signal-wordmark__sub">
            <span lang="te">పరీక్ష</span> · <span lang="hi">परीक्षा</span>
          </span>
        </p>
        <nav className="signal-nav__links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <a className="signal-btn" href="#start">
          Run your first exam
        </a>
      </div>
    </header>
  );
}

/** The three candidates and the first draw the page renders without JS. */
const FIRST_DRAW = [
  { name: "Ananya Rao", ids: ["LOG-001", "LOG-004", "SER-002", "LOG-007"] },
  { name: "Rahul Nair", ids: ["LOG-003", "SER-001", "LOG-009", "LOG-002"] },
  { name: "Fatima Sheikh", ids: ["SER-002", "LOG-006", "LOG-002", "LOG-004"] },
] as const;

const TAGS = ["reasoning", "quantitative", "verbal", "all tags"] as const;

export function SignalHero() {
  return (
    <section className="signal-field">
      <div className="signal-wrap signal-hero">
        <div className="signal-hero__grid">
          <div>
            <p className="signal-eyebrow">
              Alpha · the whole exam path runs
            </p>
            <h1>
              Run real exams on infrastructure{" "}
              <span className="signal-accent-word">you own</span>.
            </h1>
            <p className="signal-lede">
              Twelve question types, a different paper for every candidate,
              proctoring that records no video, and a results CSV — running free
              in your own Cloudflare account or server. Open source, Apache-2.0,
              no per-candidate fee.
            </p>
            <div className="signal-actions signal-actions--hero">
              <a className="signal-btn" href="#start">
                Run your first exam
              </a>
              <a
                className="signal-btn signal-btn--ghost"
                href={WORKED_EXAMPLE}
              >
                See a real exam
              </a>
            </div>
            <ul className="signal-trust">
              <li>
                <b>Apache-2.0</b>
              </li>
              <li>
                <b>12</b> types
              </li>
              <li>
                <b>97%</b> coverage
              </li>
              <li>no telemetry</li>
              <li>
                <b>$0</b> per candidate
              </li>
            </ul>
          </div>

          <div className="signal-frame">
            <div className="signal-frame__bar">
              <span className="signal-frame__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="signal-frame__url">
                your-college.example / campus-screening / build
              </span>
            </div>
            <div className="signal-frame__body">
              <h2 className="visually-hidden" id="draw-heading">
                A different paper for every candidate
              </h2>
              <div
                className="signal-chips"
                role="group"
                aria-label="Filter the pool by tag"
              >
                {TAGS.map((tag, i) => (
                  <button
                    key={tag}
                    className="signal-chip"
                    type="button"
                    aria-pressed={i === 0 ? "true" : "false"}
                    data-signal-chip
                    data-tag={tag === "all tags" ? "all" : tag}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div data-signal-rows aria-labelledby="draw-heading">
                {FIRST_DRAW.map((row) => (
                  <div className="signal-row" key={row.name}>
                    <b>{row.name}</b>
                    <span>{row.ids.join(" · ")}</span>
                  </div>
                ))}
              </div>
              <div className="signal-frame__foot">
                <button
                  className="signal-ghost-btn"
                  type="button"
                  data-signal-redraw
                >
                  Draw again
                </button>
                <span className="signal-fine signal-fine--flush">
                  4 of 11 drawn per candidate · seeded per attempt
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Six of the twelve types, as the reference's category row. */
const TYPES = [
  {
    name: "Single choice",
    note: "One option is the key.",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
      </>
    ),
  },
  {
    name: "Select all / exactly K",
    note: "Partial credit, locked at K.",
    path: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
        <path d="M7.5 12.3l3.1 3.1 6-6.4" />
      </>
    ),
  },
  {
    name: "Matching",
    note: "One-to-one and one-to-many.",
    path: (
      <>
        <path d="M4 7h6M4 12h6M4 17h6" />
        <path d="M14 7h6M14 12h6M14 17h6" />
        <path d="M10 7c2 0 2 5 4 5" />
      </>
    ),
  },
  {
    name: "Ordering",
    note: "Scored by position.",
    path: (
      <>
        <path d="M7 4v16M7 20l-3-3M7 20l3-3" />
        <path d="M13 6h7M13 12h7M13 18h7" />
      </>
    ),
  },
  {
    name: "Fill in the blank",
    note: "Exact, case-free or regex.",
    path: (
      <>
        <path d="M4 12h5M11 12h3M16 12h4" />
        <rect x="9.6" y="8.4" width="5" height="7.2" rx="1.4" />
      </>
    ),
  },
  {
    name: "Numeric with tolerance",
    note: "Plus or minus, absolute or percent.",
    path: (
      <>
        <path d="M4 16.5h16" />
        <path d="M8 16.5V9M12 16.5V5.5M16 16.5v-4" />
        <path d="M4 20h16" />
      </>
    ),
  },
] as const;

export function SignalTypeRail() {
  return (
    <section
      className="signal-wrap signal-rail"
      id="how-it-works"
      aria-labelledby="types-heading"
    >
      <div className="signal-rail__head">
        <h2 id="types-heading">
          Twelve question types. Five ways to score them.
        </h2>
        <p className="signal-fine signal-fine--flush">
          Markdown, LaTeX, code blocks and images in every one. All twelve are
          authorable, previewable, sittable and scored today.
        </p>
      </div>
      <div className="signal-cards">
        {TYPES.map((type) => (
          <div className="signal-card" key={type.name}>
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
              className="signal-accent-word"
            >
              {type.path}
            </svg>
            <h3>{type.name}</h3>
            <p>{type.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
