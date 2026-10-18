import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Question, SingleQuestion } from "@pariksha/core";

import { hasLatex, renderMarkdown } from "../../src/render/markdown";
import { RenderedHtml } from "../../src/components/authoring/RenderedHtml";
import { PromptEditor } from "../../src/components/authoring/PromptEditor";
import { PreviewPane } from "../../src/components/authoring/PreviewPane";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SINGLE: SingleQuestion = {
  id: "QNT-003",
  type: "single",
  prompt: "Which of these is prime?",
  options: [
    { id: "a", text: "51" },
    { id: "b", text: "53" },
  ],
  key: "b",
  explanation: "51 = 3 × 17.",
};

describe("renderMarkdown (ADR 0004, UX-20)", () => {
  it("turns inline LaTeX into MathML, with no KaTeX HTML and no stylesheet", async () => {
    const html = await renderMarkdown("Area is $x^2$.");
    expect(html).toContain("<math");
    expect(html).not.toContain("katex-html");
    expect(html).not.toMatch(/<link|katex\.css/);
  });

  it("renders display LaTeX too", async () => {
    expect(await renderMarkdown("$$\\int_0^1 x\\,dx$$")).toContain("<math");
  });

  it("shows a broken formula as its source instead of throwing", async () => {
    const html = await renderMarkdown("$\\frobnicate{x}$");
    expect(html).toContain("frobnicate");
  });

  it("escapes raw HTML in a prompt to text, so it is never an element", async () => {
    const html = await renderMarkdown("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("gives a fenced block the language class the code-block CSS styles", async () => {
    expect(await renderMarkdown("```sql\nSELECT 1\n```")).toContain("language-sql");
  });

  it("renders every construct the question format uses", async () => {
    const html = await renderMarkdown(
      readFileSync(resolve(__dirname, "../fixtures/every-construct.md"), "utf8"),
    );
    for (const fragment of [
      "<strong>",
      "<em>",
      "<ul>",
      "<ol>",
      "<a href=",
      "<img",
      "<table>",
      "language-sql",
      "<blockquote>",
      "<math",
    ]) {
      expect(html, fragment).toContain(fragment);
    }
    expect(html).toContain("&lt;strong&gt;");
  });
});

describe("hasLatex is the dynamic-import trigger", () => {
  it.each([
    ["Area is $x^2$.", true],
    ["$$\\int_0^1 x\\,dx$$", true],
    // Conservative on purpose: a missed formula shows as literal text, which
    // the author sees in the preview; a false positive costs 76 KB once.
    ["Costs $5 and $7, total $12.", false],
    ["```sql\nSELECT 1\n```", false],
    ["No maths here at all.", false],
    ["", false],
  ])("hasLatex(%j) is %s", (source, expected) => {
    expect(hasLatex(source)).toBe(expected);
  });
});

describe("RenderedHtml", () => {
  it("shows the rendered Markdown once the renderer resolves", async () => {
    render(<RenderedHtml markdown="A **bold** claim." />);
    expect(await screen.findByText("bold")).toBeInTheDocument();
  });
});

function PreviewHarness({ question }: { question: Question }) {
  const [reveal, setReveal] = useState(false);
  return (
    <PreviewPane question={question} reveal={reveal} onRevealChange={setReveal} />
  );
}

describe("PreviewPane (UX-09)", () => {
  it("shows the candidate's view, and the toggle reveals the key and explanation", async () => {
    render(<PreviewHarness question={SINGLE} />);

    expect(await screen.findByText("Which of these is prime?")).toBeInTheDocument();
    expect(screen.queryByText(/correct answer/i)).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: /as the reviewer sees it/i }));

    expect(await screen.findByText(/correct answer/i)).toBeVisible();
    expect(await screen.findByText(/51 = 3/)).toBeVisible();
  });

  it("has no axe violations in either state", async () => {
    const { container } = render(<PreviewHarness question={SINGLE} />);
    await screen.findByText("Which of these is prime?");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("PromptEditor (UX-19, UX-20)", () => {
  const upload = () =>
    Promise.resolve({ src: "/media/mda_1.png", alt: "" });

  it("edits the Markdown source directly", () => {
    const onChange = vi.fn();
    render(<PromptEditor value="" onChange={onChange} label="Prompt" />);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("wraps the selection when a toolbar button is used", () => {
    const onChange = vi.fn();
    render(<PromptEditor value="word" onChange={onChange} label="Prompt" />);
    const textarea = screen.getByLabelText("Prompt") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 4);
    fireEvent.click(screen.getByRole("button", { name: /^bold$/i }));
    expect(onChange).toHaveBeenCalledWith("**word**");
  });

  it("cannot insert an image without alt text", async () => {
    render(
      <PromptEditor
        value=""
        onChange={vi.fn()}
        onUploadImage={upload}
        label="Prompt"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));

    const file = screen.getByLabelText(/image file/i);
    // jsdom's `files` has no setter, so fireEvent cannot assign it through
    // `target`; the property is defined on the element directly instead.
    Object.defineProperty(file, "files", {
      value: [new File(["x"], "chart.png", { type: "image/png" })],
    });
    fireEvent.change(file);

    expect(await screen.findByRole("button", { name: /^insert$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/alt text/i), {
      target: { value: "A bar chart of loans" },
    });
    expect(screen.getByRole("button", { name: /^insert$/i })).toBeEnabled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PromptEditor
        value="A **bold** claim."
        onChange={vi.fn()}
        onUploadImage={upload}
        label="Prompt"
      />,
    );
    await screen.findByText("bold");
    expect(await axe(container)).toHaveNoViolations();
  });
});
