import MarkdownIt, { type MarkdownIt as Renderer } from "markdown-it";

// The one renderer, per ADR 0004. The admin preview imports it today and
// Phase 6's exam runtime imports it next; admin.html, index.html and the
// island are already Rollup inputs of this same Vite application, so
// "shared" is an import and not a package. UX-09's "the preview is the same
// renderer the candidate runtime uses" is therefore literally true, and a
// change to it cannot reach one side and miss the other.
//
// `html: false` is the security boundary: raw HTML in a prompt is escaped to
// text and never becomes an element, so there is no injection path and
// nothing for a sanitiser to defend. Nothing is stored but Markdown.
//
// KaTeX is 76 KB gzipped against a 300 KB candidate budget, so it is named
// in exactly one `await import()` — this file's, below — and nowhere else in
// the repository. apps/web/test/bundle.test.ts walks the static import graph
// of every entry and fails if it ever becomes statically reachable.

const OPTIONS = { html: false, linkify: false, typographer: false } as const;

const plain = new MarkdownIt(OPTIONS);

// Display first: `$$…$$` is unambiguous. Inline mathematics requires the
// character after the opening `$` to be neither a space nor a digit, and the
// one before the closing `$` to be a non-space — the rule that keeps
// "Costs $5 and $7" from reading as a formula. Deliberately conservative: a
// missed formula shows as literal text, which an author sees in the preview
// at once, while a false positive costs 76 KB on one question that nobody
// sees.
const DISPLAY_MATH = /\$\$[\s\S]*?\$\$/;
const INLINE_MATH = /\$(?![\s\d])[^$\n]*[^$\s]\$/;

/** Whether `source` contains LaTeX, and so whether KaTeX has to be fetched. */
export function hasLatex(source: string): boolean {
  return DISPLAY_MATH.test(source) || INLINE_MATH.test(source);
}

// Memoised as the promise rather than the instance, so concurrent first
// renders share one fetch instead of racing two.
let withMath: Promise<Renderer> | undefined;

function mathRenderer(): Promise<Renderer> {
  withMath ??= (async () => {
    const [plugin, katex] = await Promise.all([
      import("@vscode/markdown-it-katex"),
      import("katex"),
    ]);
    return new MarkdownIt(OPTIONS).use(plugin.default, {
      // MathML only: no katex.css and none of KaTeX's eight woff2 faces,
      // which under S-11 and `default-src 'self'` would all have to be
      // self-hosted.
      output: "mathml",
      trust: false,
      // UX-20: a broken formula renders as its own source, flagged as an
      // error, which is exactly what the author needs to see before a
      // candidate does.
      throwOnError: false,
      katex: katex.default,
    });
  })();
  return withMath;
}

/** Markdown (with LaTeX and fenced code) to HTML, for the page about to show it. */
export async function renderMarkdown(source: string): Promise<string> {
  const md = hasLatex(source) ? await mathRenderer() : plain;
  return md.render(source);
}
