import { SectionHeading } from "../../components/SectionHeading";
import { FeatureCell } from "../../components/FeatureCell";
import { CodeBlock } from "../../components/CodeBlock";

// Design contract §3 S5 (2026-10-17-landing-page-v2-design.md): six
// FeatureCells grouped by the organiser's job (content-inventory.md §1,
// Jobs A-F), not by the codebase. Status discipline is carried once by the
// binding lead line below — no cell carries a shipped/specified badge.
export function S5Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="section wrap"
    >
      <SectionHeading
        id="features-heading"
        scale="band"
        eyebrow="WHAT IT DOES"
      >
        What does Pariksha do?
      </SectionHeading>
      <p>
        Pariksha groups what it does by the organiser&apos;s job, not by the
        shape of the codebase. Six cells below answer six different problems:
        worthwhile questions, a different paper for everyone, clean
        registration, controlled access, proctoring that never records, and
        results that land in a spreadsheet already.
      </p>
      <p className="feature-lead">
        The scoring and selection engines are built and tested; everything
        else on this page is specified. v0.1 ships six core question types,
        registration forms, proctoring and CSV results; all twelve types
        arrive at v0.3.
      </p>
      <div className="feature-grid feature-grid--s5">
        <FeatureCell
          label="TWELVE TYPES"
          title="Every type a paper needs"
          body={
            <>
              Single choice, multiple choice, select exactly K, true/false,
              assertion–reason, matching, multi-matching, ordering, fill in
              the blank, numeric with tolerance, short answer and long answer
              — every one taking Markdown, fenced code and LaTeX, each with up
              to five scoring modes and only the modes its type supports.
              Twelve types are defined in the format and graded today in{" "}
              <code>packages/core</code>; six ship in v0.1, all twelve by
              v0.3.
            </>
          }
        />
        <FeatureCell
          label="PER CANDIDATE"
          title="A different paper for everyone"
          body="Pools filtered by tag and difficulty, fixed sets handed out round-robin, or a hand-picked list — then a seeded shuffle that gives back the same order on a refresh. Options marked pinned, such as &ldquo;All of the above&rdquo;, never move."
        />
        <FeatureCell
          label="REGISTRATION"
          title="A form you design per test"
          body="Eleven field types, from short text to a consent tick box. Mark any field unique and a second registration with the same value is refused — on the server, where every rule is re-checked."
        />
        <FeatureCell
          label="PROCTORING"
          title="Off, Standard or Strict"
          body="Standard logs tab switches and blocks copy-paste; Strict adds camera snapshots and on-device face counting. No video and no audio are ever recorded, and no biometric template is stored."
        />
        <FeatureCell
          label="FLAGS, NOT VERDICTS"
          title="The app flags, a person decides"
          body={
            <>
              Every attempt comes out <code>clean</code>, <code>review</code>{" "}
              or <code>high_risk</code>, with the events behind it — the app
              never decides that someone cheated.
            </>
          }
        />
        <FeatureCell
          label="RESULTS"
          title="Results that fit your spreadsheet"
          body="A live monitor, a grading queue, item analysis and a CSV with a column per form field and section — plus a REST API and signed webhooks for everything else."
        />
      </div>
      <CodeBlock
        caption="examples/reasoning-aptitude/test.json — scoring"
        footer="A wrong answer costs a quarter of the question's points; a blank costs nothing."
      >
        {
          '"scoring": { "default_mode": "negative", "negative_fraction": 0.25, "pass_mark_percent": 50 }'
        }
      </CodeBlock>
    </section>
  );
}
