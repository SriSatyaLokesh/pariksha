import { SectionHeading } from "../../components/SectionHeading";
import { ComparisonTable } from "../../components/ComparisonTable";
import { MonoCaption } from "../../components/MonoCaption";

// Design contract §3 S4 (2026-10-17-landing-page-v2-design.md): the
// comparison, pulled to the fourth band at the owner's instruction. Three
// compared categories, never named products; seven rows re-worded from
// README.md so each reads true standing alone (three defects fixed: Cost,
// Rich question types, and the corner cell). Every row is sourced in
// content-inventory.md §1/§2.
const COLUMNS: [string, string, string] = [
  "Free form tools",
  "Paid assessment platforms",
  "Pariksha",
];

const ROWS = [
  {
    label: "Cost to run",
    values: ["Free", "Per candidate or per month", "Free hosting tier, arithmetic published"],
  },
  {
    label: "Question pools and sets",
    values: ["No", "Yes", "Yes"],
  },
  {
    label: "Rich question types",
    values: [
      "—",
      "Varies by vendor",
      "12, including matching, ordering and numeric with tolerance",
    ],
  },
  {
    label: "Camera, fullscreen and tab-switch checks",
    values: ["No", "Yes", "Yes"],
  },
  {
    label: "Where candidate data lives",
    values: ["Their servers", "Their servers", "Your account"],
  },
  {
    label: "Answer keys hidden from the browser",
    values: ["No", "Yes", "Yes"],
  },
  {
    label: "You can read and change the code",
    values: ["No", "No", "Yes"],
  },
] as Array<{ label: string; values: [string, string, string] }>;

export function S4Comparison() {
  return (
    <section
      id="comparison"
      aria-labelledby="comparison-heading"
      className="section wrap"
    >
      <SectionHeading id="comparison-heading" scale="chapter">
        Why not a form tool, and why not a paid assessment platform?
      </SectionHeading>
      <p className="comparison-intro">
        Pariksha is compared here against two categories of tool, never named
        competitors, because the project can defend format and scoring claims
        about itself but not performance claims about someone else&apos;s
        product. The table below settles cost, question richness, proctoring
        and data control before the comparison sprawls into a sales pitch.
      </p>
      <ComparisonTable
        caption="Pariksha compared with free form tools and paid assessment platforms, by category, not by named product"
        cornerLabel="What you need"
        columns={COLUMNS}
        rows={ROWS}
      />
      <MonoCaption className="comparison-dated-footnote">
        Compared against product categories, not named products, as of 17
        October 2026.
      </MonoCaption>
      {/* Two different objects, not one block of small print (§3 S4): the
          dated footnote above states what the table is; these two sentences
          below are the argument's conclusion, set as body text so they read
          as a plan rather than a disclaimer. Both are asserted by T24b. */}
      <div className="comparison-conclusion">
        <p>
          Moodle is the nearest open-source comparison and is more capable
          today than Pariksha is. Pariksha is not trying to replace it — it is
          trying to be lighter to run and to keep the test itself in one
          portable JSON file.
        </p>
        <p>
          A paid platform you can buy today will do more than Pariksha does
          today, because the Pariksha application is not built yet. What is
          built is the format, the schemas and the scoring engine — and you
          can run those today.
        </p>
      </div>
    </section>
  );
}
