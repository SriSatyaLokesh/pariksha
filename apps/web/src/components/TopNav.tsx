const NAV_LINKS = [
  { label: "What it does", href: "#what-it-does" },
  { label: "Question types", href: "#question-types" },
  { label: "Hosting", href: "#hosting" },
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
