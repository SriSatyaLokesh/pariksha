// landing-page-v2-design.md §3.0 renumbered every section id (the
// comparison moved to S4, "hosting" became part of "cost", etc.) — these
// four targets are re-pointed at the new ids so the bar still jumps
// somewhere real.
const NAV_LINKS = [
  { label: "What it is", href: "#what-it-is" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Cost", href: "#cost" },
  { label: "Docs", href: "#docs" },
  { label: "GitHub", href: "https://github.com/SriSatyaLokesh/pariksha" },
] as const;

export function TopNav() {
  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <p className="wordmark">
          <span className="wordmark__name">Pariksha</span>
          <span className="wordmark__sub">
            <span lang="te">పరీక్ష</span> · <span lang="hi">परीक्षा</span>
          </span>
        </p>
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} className="nav-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
