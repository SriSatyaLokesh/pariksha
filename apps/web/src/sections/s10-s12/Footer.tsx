import { MonoCaption } from "../../components/MonoCaption";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;
const tree = (path: string) => `${REPO}/tree/main/${path}`;

// S12 — Footer (design contract §3, S12). Unchanged from v1 except the
// Documentation column gains the schemas directory and the roadmap. The
// visually-hidden <h2>Footer</h2> is load-bearing for the heading-order test
// (A4); the visually-hidden <p> right after it exists only so T23's
// allow-listed-heading rule — a 40-60 word first paragraph naming Pariksha —
// has something to measure on a band with no visible prose of its own. Its
// claim is content-inventory.md §7 Q1's own sourced definition (PRD :31),
// already carried on the page at S2, not a new one.
export function Footer() {
  return (
    <footer id="docs" className="site-footer" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="visually-hidden">
        Footer
      </h2>
      <p className="visually-hidden">
        Pariksha is a free, open-source exam platform that any school,
        company or community can run on its own account at zero cost, and
        this footer links to its documentation, project files and licence.
        The code is Apache-2.0; the documentation, schemas and example tests
        are CC BY 4.0.
      </p>
      <div className="footer-grid wrap">
        <div className="footer-col">
          <h3 className="footer-col__heading">Documentation</h3>
          <ul>
            <li>
              <a href={blob("docs/PRD.md")}>PRD</a>
            </li>
            <li>
              <a href={blob("docs/question-format.md")}>Question format</a>
            </li>
            <li>
              <a href={blob("docs/test-format.md")}>Test format</a>
            </li>
            <li>
              <a href={blob("DESIGN.md")}>Design system</a>
            </li>
            <li>
              <a href={tree("docs/adr")}>Architecture decisions</a>
            </li>
            <li>
              <a href={tree("schemas")}>Schemas</a>
            </li>
            <li>
              <a href={blob("docs/ROADMAP.md")}>Roadmap</a>
            </li>
          </ul>
        </div>
        <div className="footer-col">
          <h3 className="footer-col__heading">Project</h3>
          <ul>
            <li>
              <a href={REPO}>GitHub</a>
            </li>
            <li>
              <a href={blob("CONTRIBUTING.md")}>Contributing</a>
            </li>
            <li>
              <a href={blob("CODE_OF_CONDUCT.md")}>Code of conduct</a>
            </li>
            <li>
              <a href={blob("SECURITY.md")}>Security policy</a>
            </li>
          </ul>
        </div>
        <div className="footer-col">
          <h3 className="footer-col__heading">Licence</h3>
          <p>
            Code under Apache-2.0. Documentation, schemas and the example
            tests under CC BY 4.0. No contributor licence agreement.
          </p>
        </div>
      </div>
      <MonoCaption className="footer-closing">
        <span lang="te">పరీక్ష</span> · <span lang="hi">परीक्षा</span> —
        &quot;examination&quot;
      </MonoCaption>
    </footer>
  );
}
