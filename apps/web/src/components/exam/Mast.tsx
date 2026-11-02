import { useEffect, useRef } from "react";
import { brandColourIssue } from "@pariksha/core";

// The chrome the candidate path shares before an attempt starts: a 4px
// line in the organiser's colour and a masthead with the organiser's
// name on the left and Pariksha's plaque on the right. The landing page
// and the registration screen both wear it, so a candidate meets one
// product between the invitation and question one.

/**
 * Paints `--color-brand` on the screen's root without a `style`
 * attribute — `apps/web/test/no-hex-colors.test.ts` bans `style={}` in
 * any .tsx under src, so the colour reaches CSS the way the organiser's
 * branding preview already does it (`BrandingPanel.tsx`'s
 * `useBrandColour`): a custom property set in an effect. The value came
 * from the server, which ran `brandColourIssue` on the write; it is run
 * again here so a value that is not `#rrggbb` or fails 4.5:1 on cream
 * falls back to `exam.css`'s voltage-deep rather than painting anything.
 */
export function useBrandColour(colour: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (colour === null || brandColourIssue({ primary_colour: colour }) !== null) {
      element.style.removeProperty("--color-brand");
    } else {
      element.style.setProperty("--color-brand", colour);
    }
  }, [colour]);
  return ref;
}

export function ExamMast({ organiser }: { organiser: string | null }) {
  return (
    <>
      <div className="exam-brandline" aria-hidden="true" />
      <header className="exam-mast">
        {/* `branding.logo` is a media key, and the only route that can
            serve one to a candidate is Task 7's attempt-scoped media route
            — `GET /workspaces/:id/media/:key` keeps `banks.edit` (standing
            decision 4). An <img> pointed at a route that does not exist
            yet would be a broken image on the first screen a candidate
            ever sees, so the organiser's name carries the masthead until
            that route ships. */}
        <div className="exam-mast-organiser">{organiser && <strong>{organiser}</strong>}</div>
        <p className="exam-mast-plaque">
          Conducted on <span className="exam-wordmark">Pariksha</span>
        </p>
      </header>
    </>
  );
}
