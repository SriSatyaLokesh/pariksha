import { MonoCaption } from "../../components/MonoCaption";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;
const tree = (path: string) => `${REPO}/tree/main/${path}`;

// S12 — Footer (design contract §3, S12). Unchanged from v1 except the
// Documentation column gains the schemas directory and the roadmap. The
// visually-hidden <h2>Footer</h2> is load-bearing for the heading-order test
// (A4). There is no paragraph under it: T23 exempts the three allow-listed
// headings entirely, so a band with no prose of its own gets no manufactured
// answer-shaped paragraph.
export function Footer() {
  return (
    <footer id="docs" className="site-footer" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="visually-hidden">
        Footer
      </h2>
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
