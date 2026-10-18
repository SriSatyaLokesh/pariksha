import { useEffect, useState } from "react";
import { renderMarkdown } from "../../render/markdown";

/**
 * The one `dangerouslySetInnerHTML` site in the application.
 *
 * It takes Markdown rather than HTML, which is what makes that safe: no call
 * site can hand it a string the renderer did not just produce, and the
 * renderer runs `markdown-it` with `html: false`, so raw HTML in a prompt is
 * escaped to text and never becomes an element (ADR 0004). Nothing is stored
 * but Markdown, so there is no sanitiser here and nothing to keep in step.
 *
 * It also owns the awaiting. `renderMarkdown` is async because KaTeX arrives
 * through a dynamic import, and one place doing the await is what stops each
 * call site inventing its own loading state.
 */
export function RenderedHtml({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let current = true;
    void renderMarkdown(markdown).then((next) => {
      if (current) setHtml(next);
    });
    // A slow KaTeX fetch for an earlier value must not land on a later one.
    return () => {
      current = false;
    };
  }, [markdown]);

  return (
    <div
      className={className ? `rendered ${className}` : "rendered"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
