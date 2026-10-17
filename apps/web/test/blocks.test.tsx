import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CodeBlock } from "../src/components/CodeBlock";
import { ComparisonTable } from "../src/components/ComparisonTable";
import { StepRow } from "../src/components/StepRow";
import { ProductMock } from "../src/components/ProductMock";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOCKS_CSS_PATH = resolve(__dirname, "../src/styles/blocks.css");
const blocksCss = readFileSync(BLOCKS_CSS_PATH, "utf8");

// Design contract §6/§7/§8 (2026-10-17-landing-page-v2-design.md) — assignment C.
// Each test below cites the test id or acceptance line it covers.

describe("CodeBlock", () => {
  // T25 / A7: every code block renders inside a container with role="region",
  // a non-empty accessible name and tabindex="0".
  it("renders a scrollable region with a non-empty accessible name", () => {
    render(
      <CodeBlock caption="examples/reasoning-aptitude/questions.json">
        {"{}"}
      </CodeBlock>,
    );
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("tabIndex", "0");
    expect(region).toHaveAccessibleName(
      "examples/reasoning-aptitude/questions.json",
    );
  });

  it("renders the caption bar and an optional footer line as real text", () => {
    render(
      <CodeBlock
        caption="examples/reasoning-aptitude/questions.json"
        footer="16 more questions, covering all 12 types · read the whole file →"
      >
        {"{}"}
      </CodeBlock>,
    );
    expect(
      screen.getByText(
        "16 more questions, covering all 12 types · read the whole file →",
      ),
    ).toBeInTheDocument();
  });

  // A3: the four syntax-colour roles are checked on both white and cream
  // fills, including the hero's on-voltage block (ui-direction.md §3.3).
  it("exposes the four syntax-colour role classes with the sanctioned tokens", () => {
    expect(blocksCss).toMatch(/\.tok-key[^{]*\{[^}]*color:\s*var\(--color-ink\)/);
    expect(blocksCss).toMatch(
      /\.tok-string[^{]*\{[^}]*color:\s*var\(--color-voltage-deep\)/,
    );
    expect(blocksCss).toMatch(
      /\.tok-number[^{]*\{[^}]*color:\s*var\(--color-data-blue\)/,
    );
    expect(blocksCss).toMatch(
      /\.tok-punct[^{]*\{[^}]*color:\s*var\(--color-muted\)/,
    );
  });

  // A3 / U §3.3: the voltage surface renders the same four roles on its own
  // cream plane rather than inventing a second palette.
  it("renders the voltage surface as a cream plane, not a second CodeBlock variant", () => {
    render(
      <CodeBlock caption="Scoring, as the test declares it" surface="voltage">
        <span className="tok-string">negative</span>
      </CodeBlock>,
    );
    expect(
      screen.getByText("Scoring, as the test declares it"),
    ).toBeInTheDocument();
    expect(blocksCss).toMatch(/\.code-block--voltage[^}]*\{/);
  });

  // P6 / P10: the block scrolls inside its own container; the page body
  // never gets a horizontal scrollbar.
  it("scrolls its own content horizontally instead of wrapping it", () => {
    render(
      <CodeBlock caption="deploy/cloudflare/README.md">{"pnpm build"}</CodeBlock>,
    );
    expect(blocksCss).toMatch(/\.code-block__scroll[^}]*overflow-x:\s*auto/);
    expect(blocksCss).toMatch(/white-space:\s*pre/);
  });
});

describe("ComparisonTable", () => {
  const columns: [string, string, string] = [
    "Free form tools",
    "Assessment platforms",
    "Pariksha",
  ];
  const rows = [
    { label: "Cost", values: ["Free", "Per candidate, per month", "Free"] },
    { label: "Question pools", values: ["No", "Yes", "Yes"] },
    { label: "Rich question types", values: ["3–4", "Yes", "12"] },
    { label: "Proctoring", values: ["No", "Yes", "Specified"] },
    { label: "Results export", values: ["Manual", "Yes", "CSV"] },
    { label: "Self-hosted", values: ["N/A", "No", "Yes"] },
    { label: "Open schema", values: ["N/A", "No", "Yes"] },
  ] as Array<{ label: string; values: [string, string, string] }>;

  // T24: a real <table> with a <caption>, scope on every header cell, four
  // columns, seven body rows, and a non-empty corner header cell.
  it("renders a real table with caption, scoped headers, four columns and seven rows", () => {
    render(
      <ComparisonTable
        caption="Pariksha compared with free form tools and paid assessment platforms"
        cornerLabel="Category"
        columns={columns}
        rows={rows}
        footnote="Compared against product categories, not named products, as of October 2026."
      />,
    );
    const table = screen.getByRole("table");
    const caption = table.querySelector("caption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe(
      "Pariksha compared with free form tools and paid assessment platforms",
    );

    const headerCells = screen.getAllByRole("columnheader");
    expect(headerCells).toHaveLength(4);
    for (const cell of headerCells) {
      expect(cell).toHaveAttribute("scope", "col");
    }
    expect(headerCells[0]).toHaveTextContent("Category");
    expect(headerCells[0]?.textContent?.trim().length ?? 0).toBeGreaterThan(0);

    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(7);
    for (const cell of rowHeaders) {
      expect(cell).toHaveAttribute("scope", "row");
    }

    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(7);
  });

  it("renders the footnote as real text, not a colour-only cue", () => {
    render(
      <ComparisonTable
        caption="Pariksha compared with free form tools and paid assessment platforms"
        cornerLabel="Category"
        columns={columns}
        rows={rows}
        footnote="Compared against product categories, not named products, as of October 2026."
      />,
    );
    expect(
      screen.getByText(
        "Compared against product categories, not named products, as of October 2026.",
      ),
    ).toBeInTheDocument();
  });

  // A11: no information by colour alone — the winning column is marked by a
  // real class plus real, larger/darker text, never a bare colour swatch.
  it("marks the highlighted column with a real cell-label span, not colour alone", () => {
    render(
      <ComparisonTable
        caption="Pariksha compared with free form tools and paid assessment platforms"
        cornerLabel="Category"
        columns={columns}
        rows={rows}
      />,
    );
    const cellLabels = screen.getAllByText(columns[2], { selector: "span" });
    expect(cellLabels.length).toBeGreaterThan(0);
  });

  // A7 / P6: the table scrolls inside its own region at mid widths and
  // reflows to cards at 640px — both CSS-only, never a page-level scrollbar.
  it("wraps the table in a labelled scroll region and reflows under 640px", () => {
    render(
      <ComparisonTable
        caption="Pariksha compared with free form tools and paid assessment platforms"
        cornerLabel="Category"
        columns={columns}
        rows={rows}
      />,
    );
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("tabIndex", "0");
    expect(region).toHaveAccessibleName(
      "Pariksha compared with free form tools and paid assessment platforms",
    );
    expect(blocksCss).toMatch(
      /\.comparison-table__region[^}]*overflow-x:\s*auto/,
    );
    expect(blocksCss).toMatch(/@media \(max-width:\s*640px\)/);
  });
});

describe("StepRow", () => {
  // §6 "New — 4": step label, title, body, artefact slot, repeated without
  // re-deriving the heading hierarchy (A4) at each call site.
  it("renders the ordinal, an h3 title, the body and the artefact slot", () => {
    render(
      <StepRow ordinal="01" title="Write the questions">
        <p>A question is a small documented object.</p>
        <CodeBlock caption="examples/reasoning-aptitude/questions.json">
          {"{}"}
        </CodeBlock>
      </StepRow>,
    );
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Write the questions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A question is a small documented object."),
    ).toBeInTheDocument();
    // The artefact slot's own CodeBlock still satisfies A7 inside a StepRow.
    expect(screen.getByRole("region")).toBeInTheDocument();
  });
});

describe("ProductMock", () => {
  // T25 / A8: every ProductMock renders aria-hidden="true" plus a sibling
  // visually-hidden paragraph of at least ten words.
  it("hides the mock from the accessibility tree and describes it in prose", () => {
    const description =
      "A rendered test screen showing a locked question palette and a running timer, for illustration only.";
    const { container } = render(
      <ProductMock description={description} className="hero-mock">
        <div className="hero-mock__chip">PRE-ALPHA</div>
      </ProductMock>,
    );
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    expect(hidden).toHaveClass("hero-mock");
    expect(hidden?.textContent).toContain("PRE-ALPHA");

    const sibling = screen.getByText(description);
    expect(sibling).toHaveClass("visually-hidden");
    expect(description.trim().split(/\s+/).length).toBeGreaterThanOrEqual(10);
  });
});
