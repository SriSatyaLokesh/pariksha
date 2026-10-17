import { SectionHeading } from "../../components/SectionHeading";

// Design contract §3 S8 (2026-10-17-landing-page-v2-design.md): the page's
// strongest trust signal, kept at a deliberate 680px rest-point measure.
// Every sentence is sourced in content-inventory.md §3 and kept close to
// its own definitive wording — not softened, not turned into cards.
export function NotForSection() {
  return (
    <section
      id="not-for"
      aria-labelledby="not-for-heading"
      className="section wrap"
    >
      <SectionHeading id="not-for-heading" scale="band" eyebrow="SCOPE">
        Who is Pariksha not for?
      </SectionHeading>
      <div className="not-for-list">
        <p>
          Pariksha is not for every exam, and the product says so without
          hedging. It is pre-alpha software with eight specific situations
          where a different tool is the right call, and if any of the eight
          match what you need this week, this is not it yet.
        </p>
        <p>
          Anyone who needs to run a test this week. Pariksha is pre-alpha
          software; the formats are ready to write against, but the
          application is not ready to run.
        </p>
        <p>
          Anyone who wants somebody else to host it. There is no Pariksha
          SaaS — hosting it is the organiser&apos;s own Cloudflare account or
          server, by design.
        </p>
        <p>
          High-stakes examinations that must be invigilated — licensing
          boards, public service commissions, anything where a result is
          legally contestable. Browser checks deter and record; they cannot
          prove.
        </p>
        <p>
          Anyone who needs live human proctoring or a lockdown browser. Both
          are explicit non-goals for this project.
        </p>
        <p>
          Tests candidates will sit on a phone. With Standard or Strict
          proctoring, phones and tablets are blocked by design, including an
          iPad sending a desktop user agent.
        </p>
        <p>
          Coding interviews that need a code runner. It is not in v1 and is
          planned only as a later plugin.
        </p>
        <p>
          Organisations whose policy requires a vendor to carry the
          liability. Self-hosting means the data, the retention and the
          consent text are an organiser&apos;s own to get right; what
          Pariksha specifies is a template, not an indemnity.
        </p>
        <p>
          Anyone who wants an AI to decide who cheated. Pariksha flags an
          attempt; a person decides — and that is not a limitation to be
          lifted later, it is the design.
        </p>
      </div>
    </section>
  );
}
