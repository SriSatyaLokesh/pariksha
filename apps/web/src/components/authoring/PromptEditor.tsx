import { useId, useRef, useState } from "react";
import { RenderedHtml } from "./RenderedHtml";

// UX-19: a Markdown text area with a small toolbar and the live preview, and
// no WYSIWYG document tree. The stored value is exactly what a JSON export
// carries, which is only true while the author is editing the source itself.

/** `[label, text inserted before the selection, text inserted after it]`. */
const WRAPS: [string, string, string][] = [
  ["Bold", "**", "**"],
  ["Italic", "*", "*"],
  ["Link", "[", "](https://)"],
  ["LaTeX", "$", "$"],
  ["List", "\n- ", ""],
  ["Code block", "\n```\n", "\n```\n"],
  ["Table", "\n| A | B |\n| --- | --- |\n| 1 | 2 |\n", ""],
];

export function PromptEditor({
  value,
  onChange,
  onUploadImage,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  onUploadImage?: (file: File) => Promise<{ src: string; alt: string }>;
  label: string;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [picking, setPicking] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");

  function wrap(before: string, after: string): void {
    const element = textarea.current;
    if (!element) return;
    const { selectionStart: start, selectionEnd: end } = element;
    onChange(
      value.slice(0, start) +
        before +
        value.slice(start, end) +
        after +
        value.slice(end),
    );
  }

  async function insertImage(): Promise<void> {
    if (!file || !onUploadImage) return;
    const { src } = await onUploadImage(file);
    wrap(`![${alt}](${src})`, "");
    setPicking(false);
    setFile(null);
    setAlt("");
  }

  return (
    <div className="prompt-editor">
      <div className="prompt-editor__toolbar" role="group" aria-label={`${label} formatting`}>
        {WRAPS.map(([name, before, after]) => (
          <button
            className="prompt-editor__tool"
            key={name}
            type="button"
            onClick={() => wrap(before, after)}
          >
            {name}
          </button>
        ))}
        <button
          className="prompt-editor__tool"
          type="button"
          onClick={() =>
            onUploadImage ? setPicking(true) : wrap("![alt text](", ")")
          }
        >
          Image
        </button>
      </div>

      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        className="prompt-editor__source"
        id={id}
        ref={textarea}
        rows={10}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />

      {picking && (
        // UX-09/UX-20: alt text is required before an image can be inserted,
        // and this is where that is checked — a candidate using a screen
        // reader has no second chance at it.
        <div className="prompt-editor__image">
          <label className="field-label" htmlFor={`${id}-file`}>
            Image file
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <label className="field-label" htmlFor={`${id}-alt`}>
            Alt text
          </label>
          <input
            className="text-input"
            id={`${id}-alt`}
            type="text"
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
          />
          <p className="field-help">
            Describe what the image shows, as you would to someone who cannot see it.
          </p>
          <button
            className="button-secondary"
            type="button"
            disabled={!file || alt.trim() === ""}
            onClick={() => void insertImage()}
          >
            Insert
          </button>
        </div>
      )}

      <RenderedHtml className="rendered--stem" markdown={value} />
    </div>
  );
}
