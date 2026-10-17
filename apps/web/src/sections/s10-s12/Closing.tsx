import { HeroSection } from "../../components/HeroSection";
import { ButtonPrimary } from "../../components/ButtonPrimary";

const REPO = "https://github.com/SriSatyaLokesh/pariksha";

// S11 — Closing (design contract §3, S11). Not a second hero: the page opens
// on the candidate's screen (S1's mock) and closes on the organiser's folder
// — M-4, a real file listing, not a ProductMock and not aria-hidden. Line
// counts verified against examples/reasoning-aptitude/ as of 2026-10-17
// (design contract §3, S11); re-check if the example changes.
const FILES: { name: string; lines: string; detail: string }[] = [
  { name: "questions.json", lines: "260 lines", detail: "17 questions, all 12 types" },
  {
    name: "test.json",
    lines: "213 lines",
    detail: "3 sections: pool, fixed sets A/B, fixed list",
  },
  { name: "candidates.csv", lines: "7 lines", detail: "6 candidates" },
  { name: "results.csv", lines: "7 lines", detail: "29 columns per row" },
  {
    name: "README.md",
    lines: "451 lines",
    detail: "what the organiser writes, what the candidate sees",
  },
];

export function Closing() {
  return (
    <HeroSection
      variant="display-lg"
      headingId="closing-heading"
      heading="Read one real test, end to end."
      lead="Pariksha's worked example, examples/reasoning-aptitude, is one complete test from end to end: the question bank, the test definition that draws from it, six sample candidates, and the results CSV their attempts produced — the exact files committed in the repository, nothing simplified for the page."
      primaryCta={
        <ButtonPrimary href={`${REPO}/tree/main/examples/reasoning-aptitude`}>
          Start with the worked example
        </ButtonPrimary>
      }
      mock={
        <ul className="closing-files">
          {FILES.map((file) => (
            <li key={file.name}>
              <code className="closing-files__name">{file.name}</code>
              <span className="closing-files__lines">{file.lines}</span>
              <span className="closing-files__detail">{file.detail}</span>
            </li>
          ))}
        </ul>
      }
    />
  );
}
