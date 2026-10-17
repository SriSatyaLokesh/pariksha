import { SectionHeading } from "../../components/SectionHeading";

// S10 — Questions and answers (design contract §3, S10). Thirteen literal
// questions, each a plain <h3>, each followed by one 40-60 word <p> sourced
// from content-inventory.md §7 (Q2-Q11, Q13-Q15; Q1 and Q12 are dropped
// because S2 and S6 already are those questions).
//
// content-inventory.md's own answers often open on a bare negation with no
// subject ("Not as an application.", "No. No video..."). Lifted alone by an
// extractor those have no subject — so every first sentence below is
// rewritten to open on the word "Pariksha" (T23b), keeping the sourcing,
// the word count and every verb exactly as definitive as the source.
const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Can I use Pariksha today?",
    answer:
      "You cannot run Pariksha as an application today. The repository holds the product requirements, the open question and test formats, their JSON Schemas, a complete worked example and the scoring engine, which is built and tested. The application lands with v0.1; the formats are stable enough to write questions against right now.",
  },
  {
    question: 'What does "Pariksha" mean?',
    answer:
      'Pariksha — పరీక్ష in Telugu, परीक्षा in Hindi — means "examination". The project\'s typeface, Anek, ships Latin, Telugu and Devanagari on one skeleton, so a translated test keeps the same typographic voice. The name is still being checked for trademark and domain conflicts before public launch.',
  },
  {
    question: "How much does it cost to run?",
    answer:
      "Pariksha costs nothing to run on the reference deployment. Five hundred candidates in one hour fits inside Cloudflare's free tier: about 55,000 Worker requests against 100,000 a day, 55,000 D1 row writes against 100,000, and 0.75 GB of snapshots against 10 GB. The arithmetic is published, not asserted.",
  },
  {
    question: "Where is candidate data stored?",
    answer:
      "Pariksha stores candidate data in the organiser's own account — your Cloudflare D1 database and R2 bucket, or your own Postgres and disk under Docker. There is no Pariksha server in the path. You pick the database region and storage jurisdiction where the host allows it, and there is no telemetry or third-party script anywhere.",
  },
  {
    question: "How many question types does it support?",
    answer:
      "Pariksha supports twelve question types: single choice, multiple choice, select exactly K, true/false, assertion–reason, matching, multi-matching, ordering, fill in the blank, numeric with tolerance, short answer and long answer. Each takes Markdown, code blocks, LaTeX and images, and all twelve are implemented and unit-tested in packages/core today.",
  },
  {
    question: "How does it stop candidates copying from each other?",
    answer:
      "Pariksha gives each candidate a different paper to stop them copying from each other. A section draws N questions at random from a pool filtered by tag and difficulty, or hands out fixed sets A, B and C round-robin by registration order so neighbours never match, and question and option order shuffle per candidate while pinned options stay put.",
  },
  {
    question: "Does Pariksha record video of candidates?",
    answer:
      "Pariksha does not record video or audio of candidates. Strict proctoring instead takes 320×240 JPEG snapshots, about 25 KB each, every sixty seconds and on each violation, stored in a private bucket behind signed URLs that expire in ten minutes. Face counting runs on-device and stores no biometric template.",
  },
  {
    question: "Can browser proctoring actually prevent cheating?",
    answer:
      "Pariksha's own documentation says browser proctoring cannot actually prevent cheating. Browser checks deter and record; a second phone is invisible to all of them. Pariksha marks an attempt clean, review or high risk and leaves the judgement to a person, and for high-stakes use the docs recommend a supervised follow-up round.",
  },
  {
    question: "Is Pariksha better than Google Forms for an exam?",
    answer:
      "Pariksha is better than Google Forms for an exam on the things that matter: question pools so no two candidates share a paper, twelve question types to choose from rather than a form's handful, answer keys that never reach the browser, a server-enforced timer, unique-field checks that block repeat registrations, and tab-switch logging. Microsoft Forms offers none of those either.",
  },
  {
    question: "How is it different from Mettl, HackerEarth or Testlify?",
    answer:
      "Pariksha differs from Mettl, HackerEarth and Testlify in not charging per candidate or per month and not keeping candidate data on their servers. It is Apache-2.0, self-hosted, and designed to cost nothing, with scoring code you can read and change, and a whole test exports as one JSON file that imports into any other installation, so nothing is trapped.",
  },
  {
    question: "Can I write questions before the app exists?",
    answer:
      "Pariksha lets you write questions before the app exists, and doing so today is the most useful thing you can do. Write them against pariksha/question@1, validate them with one npx ajv command against the schemas in schemas/, and they will import into Pariksha on day one; the worked example in examples/reasoning-aptitude/ is a template to copy.",
  },
  {
    question: "Can Pariksha generate questions with AI?",
    answer:
      "Pariksha cannot generate questions with AI yet. Phase 9 plans bring-your-own-key drafting: your own Anthropic or OpenAI key, stored encrypted per workspace and never sent to the browser, drafting questions into a bank — never whole tests. Every draft is schema-validated and waits for a human to accept it, and nothing auto-publishes.",
  },
  {
    question: "What licence is it under, and can I sell a service built on it?",
    answer:
      "Pariksha's code is licensed Apache-2.0, which carries an explicit patent grant, so you may self-host, modify, embed or sell a service built on it, including as a closed hosted service. Documentation, the JSON Schemas and the sample tests are CC BY 4.0. The name Pariksha itself is not licensed with the code.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="section wrap">
      <SectionHeading id="faq-heading" scale="band" eyebrow="FAQ">
        Questions and answers
      </SectionHeading>
      <div className="faq-grid">
        {FAQ_ITEMS.map((item) => (
          <div className="faq-item" key={item.question}>
            <h3 className="faq-item__question">{item.question}</h3>
            <p className="faq-item__answer">{item.answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
