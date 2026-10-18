import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { HeroSection } from "../src/components/HeroSection";
import { TopNav } from "../src/components/TopNav";
import { SectionHeading } from "../src/components/SectionHeading";
import { ButtonPrimary } from "../src/components/ButtonPrimary";
import { tokens } from "../src/styles/tokens";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPONENTS_CSS_PATH = resolve(
  __dirname,
  "../src/styles/components.css",
);
const css = readFileSync(COMPONENTS_CSS_PATH, "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

// --- ButtonPrimary -----------------------------------------------------

describe("ButtonPrimary", () => {
  it("moves the arrow into an aria-hidden span, leaving the accessible name arrow-free", () => {
    render(<ButtonPrimary href="https://example.com">Start</ButtonPrimary>);
    const link = screen.getByRole("link", { name: "Start" });
    expect(link).toHaveAccessibleName("Start");
    const arrow = link.querySelector("[aria-hidden='true']");
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveTextContent("→");
  });

  it("defaults to the plain cream-pill surface", () => {
    render(<ButtonPrimary href="https://example.com">Go</ButtonPrimary>);
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.className.split(" ")).toEqual(["button-primary"]);
  });

  it("the surface variant adds a modifier class for a CTA on a light band", () => {
    render(
      <ButtonPrimary href="https://example.com" surface>
        Go
      </ButtonPrimary>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.className.split(" ")).toEqual([
      "button-primary",
      "button-primary--surface",
    ]);
  });
});

// --- SectionHeading ------------------------------------------------------

describe("SectionHeading", () => {
  it("renders an h2 at the chapter (display-lg) scale with no eyebrow by default", () => {
    render(
      <SectionHeading id="s" scale="chapter">
        Why not a form tool?
      </SectionHeading>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Why not a form tool?");
    expect(heading.className).toContain("section-heading--chapter");
    expect(document.querySelector(".section-eyebrow")).toBeNull();
  });

  it("renders the band scale with its eyebrow above the h2", () => {
    render(
      <SectionHeading id="s2" scale="band" eyebrow="WHAT IT COSTS">
        What is Pariksha?
      </SectionHeading>,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.className).toContain("section-heading--band");
    const eyebrow = document.querySelector(".section-eyebrow");
    expect(eyebrow).not.toBeNull();
    expect(eyebrow).toHaveTextContent("WHAT IT COSTS");
  });
});

// `scale` is required at the type level (no default, so it cannot silently
// fall back to 56px) — verified by `tsc`, not by vitest, which does not
// type-check: `pnpm --filter @pariksha/web exec tsc --noEmit` fails if
// `<SectionHeading id="x">text</SectionHeading>` is written without it.

// --- TopNav ----------------------------------------------------------------

describe("TopNav", () => {
  it("still renders every nav link with its accessible name and href", () => {
    render(<TopNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "GitHub" }),
    ).toHaveAttribute("href", "https://github.com/SriSatyaLokesh/pariksha");
  });

  it("is positioned sticky at the top, flat and un-nested in components.css", () => {
    const match = /(?:^|\n)\.top-nav\s*\{([^}]*)\}/.exec(css);
    expect(match, ".top-nav rule not found").not.toBeNull();
    const body = match?.[1] ?? "";
    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/top:\s*0/);
  });

  it("every in-page anchor target clears the sticky bar via scroll-margin-top", () => {
    expect(css).toMatch(/\[id\]\s*\{[^}]*scroll-margin-top:/);
  });

  it("raises the nav link's block padding to --space-md, reaching a 44px hit area", () => {
    const match = /\.nav-link\s*\{([^}]*)\}/.exec(css);
    expect(match, ".nav-link rule not found").not.toBeNull();
    const body = match?.[1] ?? "";
    const paddingDecl = /padding(?:-block)?:\s*([^;]+);/.exec(body)?.[1] ?? "";
    expect(paddingDecl).toContain("var(--space-md)");

    // Two --space-md paddings plus the token's own line-height is the
    // rendered box height — the arithmetic A10 is checked against, not a
    // jsdom layout measurement (jsdom has no layout engine).
    const spaceMd = Number(
      /--space-md:\s*(\d+)px/.exec(
        readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8"),
      )?.[1],
    );
    const lineHeight = tokens.typography["nav-link"].lineHeight;
    const lineHeightPx = Number(/^(\d+)px$/.exec(lineHeight)?.[1]);
    expect(spaceMd * 2 + lineHeightPx).toBeGreaterThanOrEqual(44);
  });
});

// --- HeroSection -------------------------------------------------------

describe("HeroSection", () => {
  // v3 §3.1: display-xl's shape is chip -> h1 -> demo -> lead -> links ->
  // bridge, in that source order at every width. There is no primaryCta,
  // no secondaryCta and no mock slot in this variant any more — the CTA
  // moved to B8 and the static mock became the demo.
  it("renders the opening (display-xl) variant as an h1 with the chip, demo, lead, links and bridge in source order", () => {
    const { container } = render(
      <HeroSection
        headingId="hero-heading"
        heading="Pariksha — run real exams you host yourself."
        chip="PRE-ALPHA · APACHE-2.0"
        demo={<div data-testid="demo">demo content</div>}
        lead="Question pools, twelve question types."
        links={
          <a className="hero-text-link" href="https://example.com/secondary">
            Read the code on GitHub
          </a>
        }
        masthead={<div data-testid="masthead">Pariksha</div>}
        bridge={<div data-testid="bridge">bridge content</div>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(
      "Pariksha — run real exams you host yourself.",
    );
    expect(heading.className).toContain("hero-heading--display-xl");
    expect(container.querySelector(".hero-chip")).toHaveTextContent(
      "PRE-ALPHA · APACHE-2.0",
    );
    expect(screen.getByTestId("demo")).not.toBeNull();
    expect(screen.getByTestId("bridge")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Read the code on GitHub" }),
    ).not.toBeNull();
    expect(container.querySelector(".hero-section")).not.toHaveClass(
      "hero-section--display-lg",
    );

    // Source order is the contract (v4 §3): the head block reads chip, h1,
    // lead, links, with the masthead beside it, and the demo follows the
    // whole head row — never reordered by CSS. The demo left the copy
    // column because the three cards span the hero's full width.
    const order = Array.from(
      container.querySelectorAll(
        ".hero-chip, h1, .hero-lead, .hero-links, [data-testid='masthead'], [data-testid='demo'], [data-testid='bridge']",
      ),
    ).map((el) => el.getAttribute("data-testid") ?? el.className.split(" ")[0]);
    expect(order).toEqual([
      "hero-chip",
      "hero-heading",
      "hero-lead",
      "hero-links",
      "masthead",
      "demo",
      "bridge",
    ]);
  });

  it("renders the closing (display-lg) variant as an h2, with no chip and no secondary required", () => {
    const { container } = render(
      <HeroSection
        variant="display-lg"
        headingId="closing-heading"
        heading="Read one real test, end to end."
        lead="Everything the worked example folder holds."
        primaryCta={
          <ButtonPrimary href="https://example.com/example">
            Open the example
          </ButtonPrimary>
        }
      />,
    );
    expect(
      screen.queryByRole("heading", { level: 1 }),
    ).toBeNull();
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("Read one real test, end to end.");
    expect(heading.className).toContain("hero-heading--display-lg");
    expect(container.querySelector(".hero-section")).toHaveClass(
      "hero-section--display-lg",
    );
    expect(container.querySelector(".hero-chip")).toBeNull();
  });

  it("the section is labelled by its own heading", () => {
    const { container } = render(
      <HeroSection
        headingId="hero-heading-2"
        heading="Heading"
        lead="Lead."
        primaryCta={<ButtonPrimary href="https://example.com">Go</ButtonPrimary>}
      />,
    );
    const section = container.querySelector(".hero-section");
    expect(section).toHaveAttribute("aria-labelledby", "hero-heading-2");
  });
});

// --- The hard invariants, scoped to this file's own stylesheet -----------

describe("components.css keeps the page's hard invariants", () => {
  it("has no hex colour literal, and every colour function reads from a token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const colorFunctionCalls = css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/g) ?? [];
    for (const call of colorFunctionCalls) {
      const index = css.indexOf(call);
      const slice = css.slice(index, index + 80);
      expect(slice).toMatch(/\(from var\(--color-[a-z0-9-]+\)/);
    }
  });

  it("never wraps a colour rule in @supports, @layer or @container", () => {
    expect(css).not.toMatch(/@supports/);
    expect(css).not.toMatch(/@layer/);
    expect(css).not.toMatch(/@container/);
  });

  it("never sets outline: none (the global focus ring stays the only focus style)", () => {
    expect(css).not.toMatch(/outline:\s*none/);
  });

  it("the first .hero-section rule is flat and keeps the literal voltage background", () => {
    const openIndex = css.indexOf(".hero-section");
    expect(openIndex).toBeGreaterThanOrEqual(0);
    // Flat: nothing but whitespace between the start of the file's relevant
    // segment and the selector — i.e. it is not nested inside another rule
    // or at-rule. A crude but sufficient check: the brace count immediately
    // before this selector is balanced (depth 0).
    const before = css.slice(0, openIndex);
    const depth =
      (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(depth).toBe(0);

    const closeIndex = css.indexOf("}", openIndex);
    const body = css.slice(openIndex, closeIndex);
    expect(body).toMatch(/background:\s*var\(--color-voltage\)/);
  });

  it("has no inline style attribute in any of the four components", () => {
    const files = [
      "../src/components/HeroSection.tsx",
      "../src/components/TopNav.tsx",
      "../src/components/SectionHeading.tsx",
      "../src/components/ButtonPrimary.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source).not.toMatch(/\sstyle=\{/);
    }
  });
});
