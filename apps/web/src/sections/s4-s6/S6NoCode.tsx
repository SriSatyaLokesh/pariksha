import { SectionHeading } from "../../components/SectionHeading";
import { ProductMock } from "../../components/ProductMock";
import { CodeBlock } from "../../components/CodeBlock";
import { CardHairline } from "../../components/CardHairline";
import { MonoCaption } from "../../components/MonoCaption";

// Design contract §3 S6 (2026-10-17-landing-page-v2-design.md): resolves the
// tension the previous three sections create. The answer-first paragraph and
// the pull quote are verbatim from the contract and content-inventory.md §5;
// the left column's three UX decisions quote docs/design.md UX-07 and UX-21.
const NOT_BUILT_STATEMENT =
  "the authoring interface is designed and not yet built; this is the design";

export function S6NoCode() {
  return (
    <section id="no-code" aria-labelledby="no-code-heading" className="section wrap">
      <SectionHeading id="no-code-heading" scale="band" eyebrow="THE FORMAT">
        Does an organiser ever have to write JSON?
      </SectionHeading>
      <p>
        No. Organisers build questions and tests in a Pariksha UI: one editing
        screen for all twelve types, a type picker, a drag-to-reorder section
        list, live pool counts and a publish checklist. The JSON exists so
        that you can hand-author, script, diff or export a test if you want to
        — and so that nothing you build is locked into Pariksha.
      </p>
      <p className="no-code-pull-quote">
        You will never have to write this. It is here so that you can — and
        so that nothing you build is trapped.
      </p>
      <div className="no-code-columns">
        <div className="no-code-col">
          <MonoCaption>
            {NOT_BUILT_STATEMENT.charAt(0).toUpperCase() +
              NOT_BUILT_STATEMENT.slice(1)}
            .
          </MonoCaption>
          <ProductMock
            className="editor-mock"
            description={`A mock of the question editor: type-picker pills, a prompt field, option rows with correct and pin toggles, and a points field — ${NOT_BUILT_STATEMENT}.`}
          >
            <div className="editor-mock__tabs">
              <span className="editor-mock__tab editor-mock__tab--active">
                Single choice
              </span>
              <span className="editor-mock__tab">Matching</span>
              <span className="editor-mock__tab">Numeric</span>
            </div>
            <div className="editor-mock__field">
              <span className="editor-mock__field-label">Prompt</span>
              <div className="editor-mock__input">
                What comes next in the series?
              </div>
            </div>
            <div className="editor-mock__option">
              <span className="editor-mock__toggle editor-mock__toggle--correct" />
              <span>127</span>
              <span className="editor-mock__toggle editor-mock__toggle--pin" />
            </div>
            <div className="editor-mock__option">
              <span className="editor-mock__toggle" />
              <span>95</span>
              <span className="editor-mock__toggle editor-mock__toggle--pin" />
            </div>
            <div className="editor-mock__field editor-mock__field--points">
              <span className="editor-mock__field-label">Points</span>
              <div className="editor-mock__input">2</div>
            </div>
          </ProductMock>
          <ul className="no-code-ux-list">
            <li>
              One editing screen for all twelve types — prompt, answer, key
              and scoring, meta, preview — with only the answer block
              changing by type.
            </li>
            <li>
              Only the scoring modes a type supports are offered, so an
              invalid combination cannot be entered in the first place.
            </li>
            <li>
              Type <code>{"{{1}}"}</code> in the prompt and a blank row grows
              underneath it, with its own accepted answers; delete the
              placeholder and the row goes with it.
            </li>
          </ul>
        </div>
        <div className="no-code-col">
          <p>
            The format is published anyway, so an organiser who wants it can
            hand-author questions in a text editor against a documented
            schema, generate a bank from a script and import it
            all-or-nothing with a line-by-line error report, export a whole
            test as one file and import it into a different installation, or
            diff a test and review a question set in a pull request.
          </p>
          <CardHairline>
            <ul className="no-code-format-list">
              <li>A breaking format change requires a new version and a converter.</li>
              <li>Fields may be added without breaking anything already written.</li>
              <li>Banks and tests license as CC BY 4.0, readable by any tool.</li>
            </ul>
          </CardHairline>
          <CodeBlock
            caption="Validate questions against the schema — no install"
            footer="Write your own questions, validate them, and they will import into Pariksha on day one."
          >
            {`git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \\
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"`}
          </CodeBlock>
        </div>
      </div>
    </section>
  );
}
