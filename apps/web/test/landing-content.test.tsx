import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { Landing } from "../src/routes/landing";

// The Signal rebuild (src/sections/signal/) replaced the old banded S1-S12
// landing page wholesale. This file checks the new page's content against
// the rendered markup — every string below is taken verbatim from
// src/sections/signal/{Head,Body,Tail}.tsx, not guessed from a class name.

const HERO_HEADING = "Run real exams on infrastructure you own.";

// Every top-level section: its id, the level its own heading renders at
// (#start is an h3 nested inside #status, not its own h2 section), and the
// heading's exact text. #docs's h2 is visually-hidden but still in the
// accessibility tree, so getByRole still finds it.
const SECTIONS: { id: string; level: 2 | 3; heading: string }[] = [
  {
    id: "how-it-works",
    level: 2,
    heading: "Twelve question types. Five ways to score them.",
  },
  {
    id: "screens",
    level: 2,
    heading: "Five screens, captured from the running app.",
  },
  { id: "integrity", level: 2, heading: "No video. No audio. No verdicts." },
  {
    id: "cost",
    level: 2,
    heading: "Five hundred candidates in an hour, for nothing.",
  },
  {
    id: "compare",
    level: 2,
    heading: "What you keep, and what you give up.",
  },
  {
    id: "status",
    level: 2,
    heading: "What is built, and what is honestly not.",
  },
  { id: "faq", level: 2, heading: "FAQs" },
  { id: "start", level: 3, heading: "What you can do today" },
  { id: "docs", level: 2, heading: "Footer" },
];

const NAV_LINKS: { text: string; href: string }[] = [
  { text: "How it works", href: "#how-it-works" },
  { text: "Screens", href: "#screens" },
  { text: "Integrity", href: "#integrity" },
  { text: "Compare", href: "#compare" },
  { text: "Status", href: "#status" },
  {
    text: "Docs",
    href: "https://github.com/SriSatyaLokesh/pariksha/tree/main/docs",
  },
];

// The nine FAQ questions, in document order — src/sections/signal/Tail.tsx's
// SignalFaq.
const FAQ_QUESTIONS = [
  "Can I use Pariksha today?",
  "Where is candidate data stored?",
  "How many question types does it support?",
  "How does it stop candidates copying from each other?",
  "Does Pariksha record video of candidates?",
  "Is Pariksha better than Google Forms for an exam?",
  "How is it different from Mettl, HackerEarth or Testlify?",
  "Can I write questions outside Pariksha and import them?",
  "Can Pariksha generate questions with AI?",
];

describe("landing content — Signal", () => {
  it("renders exactly one h1 with the verbatim hero heading", () => {
    render(<Landing />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(HERO_HEADING);
  });

  describe("every section exists with its stated id and verbatim heading", () => {
    for (const section of SECTIONS) {
      it(`#${section.id} — "${section.heading}"`, () => {
        render(<Landing />);
        const el = document.getElementById(section.id);
        expect(el, `#${section.id} does not exist`).not.toBeNull();
        const heading = within(el as HTMLElement).getByRole("heading", {
          level: section.level,
        });
        expect(heading.textContent).toBe(section.heading);
      });
    }
  });

  it("has a sane heading order with no skipped level", () => {
    render(<Landing />);
    const headings = screen.getAllByRole("heading");
    const levels = headings.map((heading) => Number(heading.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      const previous = levels[i - 1] ?? 0;
      const current = levels[i] ?? 0;
      expect(current - previous).toBeLessThanOrEqual(1);
    }
  });

  it("has the four page landmarks: banner, primary nav, main and contentinfo", () => {
    render(<Landing />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("the primary nav has exactly these six links, in order, to the right targets", () => {
    render(<Landing />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(
      NAV_LINKS.map((link) => link.text),
    );
    links.forEach((link, i) => {
      expect(link).toHaveAttribute("href", NAV_LINKS[i]?.href);
    });
  });

  // #253 retired "Start your question bank" and "Watch the repo for v0.1":
  // the app exists, so the primary ask is to run it, not to write questions
  // against a format and wait.
  it("carries the two CTA labels, each pointing at the real repo or an in-page anchor", () => {
    const { container } = render(<Landing />);
    const byText = (text: string) =>
      [...container.querySelectorAll("a.signal-btn")].filter(
        (el) => el.textContent === text,
      );

    const runIt = byText("Run your first exam");
    expect(runIt.length).toBeGreaterThanOrEqual(3);
    expect(
      runIt.every((el) => {
        const href = el.getAttribute("href") ?? "";
        return (
          href === "#start" ||
          href ===
            "https://github.com/SriSatyaLokesh/pariksha/blob/main/README.md"
        );
      }),
    ).toBe(true);

    const seeExam = byText("See a real exam");
    expect(seeExam).toHaveLength(2);
    expect(
      seeExam.every(
        (el) =>
          el.getAttribute("href") ===
          "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude",
      ),
    ).toBe(true);

    // The retired labels must not come back by a stale copy-paste.
    expect(byText("Start your question bank")).toHaveLength(0);
    expect(byText("Watch the repo for v0.1")).toHaveLength(0);
  });

  it("the FAQ contains exactly these nine questions, in order", () => {
    render(<Landing />);
    const faq = document.getElementById("faq") as HTMLElement;
    expect(faq).not.toBeNull();
    const h3s = within(faq).getAllByRole("heading", { level: 3 });
    expect(h3s.map((h3) => h3.textContent)).toEqual(FAQ_QUESTIONS);
  });

  it("is free of axe violations", async () => {
    const { container } = render(<Landing />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
