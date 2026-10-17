import { SectionHeading } from "../../components/SectionHeading";
import { CardHairline } from "../../components/CardHairline";
import { MonoCaption } from "../../components/MonoCaption";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const blob = (path: string) => `${REPO}/blob/main/${path}`;

type RoadmapState = "done" | "part" | "pending";

interface RoadmapPhase {
  ordinal: string;
  title: string;
  state: RoadmapState;
  milestone?: string;
}

// docs/ROADMAP.md "Progress": Phase 1 is Done, Phase 3 is Part done, the
// other ten are Not started. Milestone buckets resolve the one overlap in
// "Mapping to PRD milestones" (Phase 8 listed under both v0.2 and v0.3) by
// taking each phase's first listed milestone — a non-overlapping partition
// of the same twelve phases the roadmap already names.
const ROADMAP: RoadmapPhase[] = [
  {
    ordinal: "01",
    title: "Foundation and scoring core",
    state: "done",
    milestone: "v0.1",
  },
  { ordinal: "02", title: "Data and API platform", state: "pending" },
  {
    ordinal: "03",
    title: "Organiser auth, roles, first run and landing page",
    state: "part",
  },
  { ordinal: "04", title: "Question banks and authoring", state: "pending" },
  { ordinal: "05", title: "Test builder and lifecycle", state: "pending" },
  { ordinal: "06", title: "Candidate runtime", state: "pending" },
  {
    ordinal: "07",
    title: "Proctoring",
    state: "pending",
    milestone: "v0.2",
  },
  {
    ordinal: "08",
    title: "Results, monitoring, grading and data lifecycle",
    state: "pending",
  },
  {
    ordinal: "09",
    title: "BYOK AI question drafting",
    state: "pending",
    milestone: "v0.3",
  },
  { ordinal: "10", title: "Public demo instance", state: "pending" },
  {
    ordinal: "11",
    title: "Docker self-host",
    state: "pending",
    milestone: "v1.0",
  },
  { ordinal: "12", title: "v1.0 release readiness", state: "pending" },
];

// Design contract §3 S9 (2026-10-17-landing-page-v2-design.md): converts the
// status from a disclaimer into a plan, and places BYOK where it cannot be
// mistaken for a feature. §6 declines a Timeline component in favour of
// exactly this: one ordered list with a mono-sm ordinal per row.
export function StatusSection() {
  return (
    <section
      id="status"
      aria-labelledby="status-heading"
      className="section wrap"
    >
      <SectionHeading id="status-heading" scale="band" eyebrow="STATUS">
        What is built today, and what is not?
      </SectionHeading>
      <p>
        Pariksha has not been released yet; it is pre-alpha as of October
        2026. The formats, their JSON Schemas, a worked example and the
        scoring engine are published and tested, and the application itself
        lands with v0.1, one of twelve build phases complete, a second part
        done, and this page is itself that second phase&apos;s output.
      </p>

      <h3 className="status-group__heading">Built and tested</h3>
      <ul className="status-list">
        <li>The question and test formats, and their JSON Schemas.</li>
        <li>A worked example of 17 questions, covering all 12 types.</li>
        <li>
          <code>packages/core</code>: all 12 types graded, all 5 scoring
          modes, cross-field import validation, seeded selection and
          shuffling.
        </li>
        <li>
          Phase 1 landed with 173 tests and 97/93/100/98% coverage of{" "}
          <code>packages/core/src</code>, gated in CI.
        </li>
      </ul>

      <h3 className="status-group__heading">Specified, not built</h3>
      <ul className="status-list">
        <li>The authoring UI</li>
        <li>The test builder</li>
        <li>The candidate runtime</li>
        <li>Proctoring</li>
        <li>Results</li>
        <li>The API</li>
      </ul>
      <p className="status-group__links">
        Read the <a href={blob("docs/PRD.md")}>PRD</a> and the{" "}
        <a href={blob("docs/ROADMAP.md")}>roadmap</a>.
      </p>

      <h3 className="status-group__heading">Roadmap</h3>
      <p className="status-group__lead">
        Twelve build phases under four product milestones. One complete, a
        second part done — this website is its output.
      </p>
      <ol className="roadmap-ledger" aria-label="The twelve build phases">
        {ROADMAP.map((phase) => (
          <li
            key={phase.ordinal}
            className={`roadmap-ledger__row roadmap-ledger__row--${phase.state}`}
          >
            <span className="roadmap-ledger__milestone">
              {phase.milestone ?? ""}
            </span>
            <MonoCaption className="roadmap-ledger__ordinal">
              {phase.ordinal}
            </MonoCaption>
            <span className="roadmap-ledger__title">{phase.title}</span>
            {phase.state === "part" ? (
              <MonoCaption className="roadmap-ledger__tag">
                PART DONE
              </MonoCaption>
            ) : null}
          </li>
        ))}
      </ol>

      <CardHairline className="status-byok">
        <p>
          <strong>BYOK question drafting · Phase 9, not built.</strong> Your
          own Anthropic or OpenAI key, encrypted per workspace, never sent to
          the browser. Drafts questions into a bank, never whole tests.
          Validated like an import, rejected whole if it fails, reviewed by a
          human before use. You set a spend cap.
        </p>
      </CardHairline>
      <p className="status-byok-note">
        Pariksha ships no model keys and makes no outbound AI request on its
        own behalf, and a deployment with no key configured behaves exactly
        as it does now; the decision record comes before any of it is
        written.
      </p>
    </section>
  );
}
