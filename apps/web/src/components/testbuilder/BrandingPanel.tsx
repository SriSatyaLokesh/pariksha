import { useEffect, useId, useRef, useState } from "react";
import {
  CREAM,
  EXAMPLE_BRAND_COLOUR,
  HEX_COLOUR,
  contrastRatio,
  meetsAA,
  type TestBranding,
} from "@pariksha/core";

// T-23 (Task 10, #61, P5.8): the logo, the brand colour, the footer, and
// the two messages a candidate meets.
//
// **Two owners, one panel.** The PRD's own sentence splits branding: the
// logo, colour and footer are *per workspace* and go through
// `PATCH /workspaces/:id` behind `workspace.settings`, which only an owner
// holds; the start and finish messages are *per test* and ride the draft
// patch behind `tests.edit`. An Author sees the workspace half and cannot
// save it, which is the point — they should know what their candidates
// will see without being able to change it for everyone.
//
// **The colour reaches CSS as a custom property, never a style attribute.**
// `apps/web/test/no-hex-colors.test.ts` bans `style={}` in any .tsx under
// src (and any hex literal), so the previews set `--brand-primary` with
// `ref.current.style.setProperty` in an effect. The value is
// user-supplied, so it is refused unless it is `#rrggbb` *and* clears
// 4.5:1 against cream — the same gate, from the same function, that the
// server runs on the write.

/** The ratio an unreadable colour is reported at, rounded the way the
 * server rounds it so the two messages cannot read differently. */
function ratioAgainstCream(colour: string): number {
  return Math.round(contrastRatio(colour, CREAM) * 100) / 100;
}

/** Why this colour cannot be saved, or `null`. The server's own refusal,
 * reproduced here only so the organiser hears it before the round trip. */
function colourRefusal(colour: string): string | null {
  if (colour === "") return null;
  if (!HEX_COLOUR.test(colour)) return `"${colour}" is not a colour. Use a hex value like ${EXAMPLE_BRAND_COLOUR}.`;
  if (meetsAA(colour, CREAM)) return null;
  return `${colour} reaches only ${ratioAgainstCream(colour)}:1 against cream, and candidate text in the brand colour needs at least 4.5:1. Choose a darker shade.`;
}

/** Paints `--brand-primary` on an element without a `style` attribute. */
function useBrandColour(colour: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (colour === undefined || colourRefusal(colour) !== null) element.style.removeProperty("--brand-primary");
    else element.style.setProperty("--brand-primary", colour);
  }, [colour]);
  return ref;
}

export function BrandingPanel({
  branding,
  workspaceBranding,
  canEditWorkspace,
  onChange,
  onSaveWorkspace,
  onUploadLogo,
}: {
  /** The test's own half: `start_message` and `finish_message`. */
  branding: TestBranding;
  /** The workspace's half: `logo`, `primary_colour`, `footer_text`. */
  workspaceBranding: TestBranding;
  /** Whether this actor holds `workspace.settings`. The server refuses
   * either way; this is so an Author is told rather than 403'd. */
  canEditWorkspace: boolean;
  onChange: (next: TestBranding) => void;
  onSaveWorkspace: (next: TestBranding) => Promise<void>;
  onUploadLogo: (file: File, alt: string) => Promise<{ key: string }>;
}) {
  const ids = useId();
  const [workspace, setWorkspace] = useState<TestBranding>(workspaceBranding);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");

  useEffect(() => {
    setWorkspace(workspaceBranding);
  }, [workspaceBranding]);

  const colour = workspace.primary_colour ?? "";
  const refusal = colourRefusal(colour);
  const previewRef = useBrandColour(workspace.primary_colour);

  function setWorkspaceKey(key: "primary_colour" | "footer_text" | "logo", value: string): void {
    setSaved(false);
    setWorkspace((prev) => {
      const next: Record<string, unknown> = { ...prev };
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function save(): Promise<void> {
    try {
      await onSaveWorkspace(workspace);
      setSaveError(undefined);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "The branding could not be saved.");
    }
  }

  return (
    <section className="branding-panel" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Branding</h2>

      <section aria-labelledby={`${ids}-ws-heading`} className="branding-panel__half">
        <h3 id={`${ids}-ws-heading`}>Across the whole workspace</h3>
        <p className="branding-panel__fact">
          {canEditWorkspace
            ? "The logo, colour and footer are the same on every test in this workspace."
            : "The logo, colour and footer are the same on every test in this workspace, and only an owner can change them."}
        </p>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-logo`}>
            Logo file
          </label>
          <input
            id={`${ids}-logo`}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={!canEditWorkspace}
            onChange={(event) => {
              setLogoFile(event.target.files?.[0] ?? null);
              setSaved(false);
            }}
          />
          <p className="branding-panel__fact">PNG, JPEG, GIF or WebP. It renders at 32 px tall on every page.</p>

          <label className="field-label" htmlFor={`${ids}-alt`}>
            Alt text
          </label>
          <input
            className="text-input"
            id={`${ids}-alt`}
            value={alt}
            disabled={!canEditWorkspace}
            onChange={(event) => setAlt(event.target.value)}
          />
          <p className="branding-panel__fact">
            What a screen reader says in place of the image. Name the institution, not the file.
          </p>

          <button
            type="button"
            className="button-secondary"
            // Alt text is required, not nagged about afterwards: an image
            // with no alt text is one a candidate using a screen reader
            // cannot identify, and nothing later in the product asks again.
            disabled={!canEditWorkspace || logoFile === null || alt.trim() === ""}
            onClick={() => {
              if (logoFile === null) return;
              void onUploadLogo(logoFile, alt.trim()).then(
                ({ key }) => setWorkspaceKey("logo", key),
                (cause: unknown) =>
                  setSaveError(cause instanceof Error ? cause.message : "The logo could not be uploaded."),
              );
            }}
          >
            Upload
          </button>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-colour`}>
            Primary colour
          </label>
          <input
            className="text-input"
            id={`${ids}-colour`}
            value={colour}
            disabled={!canEditWorkspace}
            onChange={(event) => setWorkspaceKey("primary_colour", event.target.value)}
          />
          {HEX_COLOUR.test(colour) && (
            <p className="branding-panel__fact">
              <span className="branding-panel__figure">{ratioAgainstCream(colour)}:1</span> against cream.
            </p>
          )}
          {refusal !== null && (
            <p className="branding-panel__risk" role="alert">
              <span aria-hidden="true">⚠ </span>
              {refusal}
            </p>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-footer`}>
            Footer text
          </label>
          <input
            className="text-input"
            id={`${ids}-footer`}
            value={workspace.footer_text ?? ""}
            disabled={!canEditWorkspace}
            onChange={(event) => setWorkspaceKey("footer_text", event.target.value)}
          />
        </div>

        <button
          type="button"
          className="button-primary"
          disabled={!canEditWorkspace || refusal !== null}
          onClick={() => void save()}
        >
          Save workspace branding
        </button>
        <p role="status" className="branding-panel__fact">
          {saved ? "Workspace branding saved." : ""}
        </p>
        {saveError !== undefined && (
          <p className="branding-panel__risk" role="alert">
            <span aria-hidden="true">⚠ </span>
            {saveError}
          </p>
        )}
      </section>

      <section aria-labelledby={`${ids}-test-heading`} className="branding-panel__half">
        <h3 id={`${ids}-test-heading`}>On this test only</h3>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-start`}>
            Start message
          </label>
          <textarea
            className="text-input"
            id={`${ids}-start`}
            rows={3}
            value={branding.start_message ?? ""}
            onChange={(event) => onChange(withMessage(branding, "start_message", event.target.value))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${ids}-finish`}>
            Finish message
          </label>
          <textarea
            className="text-input"
            id={`${ids}-finish`}
            rows={3}
            value={branding.finish_message ?? ""}
            onChange={(event) => onChange(withMessage(branding, "finish_message", event.target.value))}
          />
        </div>
      </section>

      {/* Three previews, one wrapper: the custom property cascades, so the
          colour is set once rather than three times, and a preview that
          forgot to inherit it would be visible rather than silent. */}
      <div className="branding-panel__previews" ref={previewRef}>
        <section aria-label="Start page preview" className="branding-panel__preview">
          <h4>Start page</h4>
          {workspace.logo !== undefined && <p className="branding-panel__fact">Logo: {workspace.logo}</p>}
          <p>{branding.start_message ?? "No start message yet."}</p>
          <p className="branding-panel__footer">{workspace.footer_text ?? ""}</p>
        </section>
        <section aria-label="Finish page preview" className="branding-panel__preview">
          <h4>Finish page</h4>
          <p>{branding.finish_message ?? "No finish message yet."}</p>
          <p className="branding-panel__footer">{workspace.footer_text ?? ""}</p>
        </section>
        <section aria-label="Released result preview" className="branding-panel__preview">
          <h4>Released result</h4>
          <p>What a candidate sees once their result is released.</p>
          <p className="branding-panel__footer">{workspace.footer_text ?? ""}</p>
        </section>
      </div>
    </section>
  );
}

function withMessage(
  branding: TestBranding,
  key: "start_message" | "finish_message",
  value: string,
): TestBranding {
  const next: Record<string, unknown> = { ...branding };
  if (value === "") delete next[key];
  else next[key] = value;
  return next;
}
